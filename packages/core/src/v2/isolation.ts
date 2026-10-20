import { execFileSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { StateStore, newId } from './store.js';
import { HarnessError } from './contracts.js';

export interface IsolationCapability { level: 'full' | 'partial' | 'unavailable'; verified: boolean; backend: 'docker-linux'; image: string | null; reason: string; remedy: string }
export function docker(args: string[]): string {
  return execFileSync('docker', args, { encoding: 'utf8', timeout: 30000, maxBuffer: 1024 * 1024, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }).trim();
}
export function containerArgs(name: string, image: string, workspace: string, argv: string[], extraMount?: { source: string; target: string }) {
  if (!/^sha256:[a-f0-9]{64}$/.test(image) || !/^devagent-[a-f0-9-]+$/.test(name) || workspace.includes(',') || workspace.includes('\n')) throw new HarnessError('ISOLATION_ARGUMENT_DENIED');
  return ['create', '--name', name, '--label', 'devagent.managed=v2', '--pull=never', '--network=none', '--read-only',
    '--cap-drop=ALL', '--security-opt=no-new-privileges:true', '--user=1000:1000', '--init', '--pids-limit=128', '--memory=512m', '--cpus=1',
    '--tmpfs', '/tmp:rw,nosuid,noexec,size=67108864', '--workdir=/workspace', '--env', 'HOME=/tmp/home',
    '--mount', `type=bind,src=${workspace},dst=/workspace`,
    ...(existsSync(path.join(workspace, '.git')) ? ['--mount', `type=bind,src=${path.join(workspace, '.git')},dst=/workspace/.git,readonly`] : []),
    ...(extraMount ? ['--mount', `type=bind,src=${extraMount.source},dst=${extraMount.target},readonly`] : []), image, ...argv];
}
export function removeOwnedContainer(name: string) {
  if (!/^devagent-[a-f0-9-]+$/.test(name)) throw new HarnessError('CONTAINER_OWNERSHIP_DENIED');
  try {
    if (docker(['inspect', '--format', '{{index .Config.Labels "devagent.managed"}}', name]) !== 'v2') throw new HarnessError('CONTAINER_OWNERSHIP_DENIED');
    docker(['rm', '--force', name]);
  } catch (error) { if (error instanceof HarnessError) throw error; }
}
export async function isolationCheck(store: StateStore): Promise<IsolationCapability> {
  let image: string | null = null;
  try {
    const configured = await store.get<{ image: string }>('isolation.json'); image = configured.image;
    if (!/^sha256:[a-f0-9]{64}$/.test(image)) throw new HarnessError('PINNED_IMAGE_REQUIRED');
    const server = JSON.parse(docker(['info', '--format', '{{json .}}'])) as { OSType: string; SecurityOptions: string[] };
    if (server.OSType !== 'linux' || !server.SecurityOptions.some((item) => item.includes('seccomp'))) return { level: 'partial', verified: false, backend: 'docker-linux', image, reason: 'LINUX_SECCOMP_REQUIRED', remedy: 'Use a Linux engine with seccomp and cgroup resource enforcement' };
    const actual = JSON.parse(docker(['image', 'inspect', image]))[0] as { Os: string };
    if (actual.Os !== 'linux') throw new HarnessError('LINUX_IMAGE_REQUIRED');
    const root = await store.directory('runtime/isolation-probe'); const name = `devagent-${newId('execution').slice(10)}`;
    const program = `const fs=require('fs');const status=fs.readFileSync('/proc/self/status','utf8');if(process.getuid()===0||!status.includes('NoNewPrivs:\\t1'))process.exit(41);try{fs.writeFileSync('/outside','x');process.exit(42)}catch{};if(fs.existsSync('/var/run/docker.sock'))process.exit(43);const route=fs.readFileSync('/proc/net/route','utf8').trim().split('\\n');if(route.length>1)process.exit(44);for(const p of ['/sys/fs/cgroup/memory.max','/sys/fs/cgroup/pids.max'])if(fs.readFileSync(p,'utf8').trim()==='max')process.exit(45);console.log('DEVAGENT_ISOLATION_VERIFIED')`;
    try {
      docker(containerArgs(name, image, root, ['node', '-e', program]));
      const output = docker(['start', '--attach', name]);
      const code = docker(['inspect', '--format', '{{.State.ExitCode}}', name]);
      if (code !== '0' || !output.includes('DEVAGENT_ISOLATION_VERIFIED')) throw new HarnessError('ISOLATION_PROBE_FAILED');
    } finally { removeOwnedContainer(name); }
    return { level: 'full', verified: true, backend: 'docker-linux', image, reason: 'CONTAINER_POLICY_PROBED', remedy: '' };
  } catch (error) {
    return { level: 'unavailable', verified: false, backend: 'docker-linux', image, reason: error instanceof HarnessError ? error.code : 'DOCKER_OR_RUNNER_UNAVAILABLE', remedy: 'Run devagent isolation configure --image <local Linux Node image>; no host execution fallback' };
  }
}
export async function configureIsolation(store: StateStore, requested: string) {
  if (!/^[a-zA-Z0-9_./:@-]+$/.test(requested) || requested.startsWith('-')) throw new HarnessError('IMAGE_ARGUMENT_DENIED');
  const image = docker(['image', 'inspect', '--format', '{{.Id}}', requested]);
  await store.put('isolation.json', { image, configuredAt: new Date().toISOString(), policy: 'linux-container-v1' });
  const check = await isolationCheck(store); await store.put('isolation-capability.json', check); return check;
}
export async function attachContainer(name: string, options: { signal?: AbortSignal; timeoutMs: number; maxBytes: number }) {
  return new Promise<{ stdout: string; stderr: string; timedOut: boolean; cancelled: boolean; truncated: boolean }>((resolve) => {
    const process = spawn('docker', ['start', '--attach', name], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const stdout: Buffer[] = []; const stderr: Buffer[] = []; let bytes = 0; let truncated = false; let timedOut = false; let cancelled = false;
    const append = (target: Buffer[], chunk: Buffer) => { const remaining = Math.max(0, options.maxBytes - bytes); bytes += chunk.length; if (remaining) target.push(chunk.subarray(0, remaining)); if (bytes > options.maxBytes) truncated = true; };
    process.stdout.on('data', (chunk: Buffer) => append(stdout, chunk)); process.stderr.on('data', (chunk: Buffer) => append(stderr, chunk));
    const kill = () => { try { docker(['kill', name]); } catch { /* An already exited container needs no signal. */ } };
    const cancel = () => { cancelled = true; kill(); removeOwnedContainer(name); };
    const timer = setTimeout(() => { timedOut = true; kill(); }, options.timeoutMs);
    options.signal?.addEventListener('abort', cancel, { once: true }); if (options.signal?.aborted) cancel();
    const done = () => { clearTimeout(timer); options.signal?.removeEventListener('abort', cancel); resolve({ stdout: Buffer.concat(stdout).toString(), stderr: Buffer.concat(stderr).toString(), timedOut, cancelled, truncated }); };
    process.once('error', done); process.once('close', done);
  });
}
