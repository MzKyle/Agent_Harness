import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { packageVersions, dshBin } from '@devagent/dsh-bridge';

export interface ToolCheck { tool: string; status: 'available' | 'unavailable' | 'unsupported'; version: string | null }
export function toolVersion(tool: 'npm' | 'pnpm' | 'git' | 'codex'): ToolCheck {
  const extensions = process.platform === 'win32' ? ['.exe', '.cmd'] : [''];
  let executable: string | undefined;
  for (const directory of (process.env.PATH ?? '').split(path.delimiter)) {
    executable = extensions.map((extension) => path.join(directory, `${tool}${extension}`)).find(existsSync);
    if (executable) break;
  }
  if (!executable || /["\r\n%]/.test(executable)) return { tool, status: 'unavailable', version: null };
  const result = executable.endsWith('.cmd')
    ? spawnSync(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', `""${executable}" --version"`], { encoding: 'utf8', timeout: 10000, windowsHide: true, windowsVerbatimArguments: true, maxBuffer: 65536 })
    : spawnSync(executable, ['--version'], { encoding: 'utf8', timeout: 10000, windowsHide: true, maxBuffer: 65536 });
  const version = result.stdout?.match(/\b\d+\.\d+\.\d+(?:[-.][a-zA-Z0-9.]+)?\b/)?.[0] ?? null;
  return { tool, status: result.status === 0 && version ? 'available' : 'unavailable', version };
}
export async function doctor() {
  const [major = 0, minor = 0] = process.versions.node.split('.').map(Number);
  const supported = major === 22 && minor >= 13 || major === 24 || major >= 26;
  const tools: ToolCheck[] = [{ tool: 'node', status: supported ? 'available' : 'unsupported', version: process.versions.node },
    ...(['npm', 'pnpm', 'git', 'codex'] as const).map(toolVersion)];
  const dsh = spawnSync(process.execPath, [dshBin, '--version'], { encoding: 'utf8', timeout: 10000, windowsHide: true });
  tools.push({ tool: 'dsh', status: dsh.status === 0 ? 'available' : 'unavailable', version: dsh.stdout?.match(/\d+\.\d+\.\d+[-.\w]*/)?.[0] ?? null });
  return { status: tools.every((check) => check.status === 'available') ? 'ok' : 'attention', tools,
    packages: await packageVersions(),
    integrations: { modelCall: 'not-verified', codexDelegation: 'not-verified',
      credentialPolicy: 'native-or-environment; values never inspected or printed' },
  };
}
