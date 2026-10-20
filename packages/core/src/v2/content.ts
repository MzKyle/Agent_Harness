import path from 'node:path';
import { HarnessError } from './contracts.js';
export const sourceExtensions = new Set(['.py', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.cs']);
const configExtensions = new Set(['.json', '.toml', '.yaml', '.yml', '.md', '.txt', '.csproj', '.sln', '.slnx', '.xaml', '.xml', '.lock', '.props', '.targets', '.html', '.css', '.scss']);
export const deniedDirectories = new Set(['.git', '.env', '.ssh', '.aws', '.azure', '.codex', '.dsh', '.devagent', 'graphify-out', 'node_modules', '.venv', 'venv', 'bin', 'obj', 'dist', 'build', 'coverage', '__pycache__', '.pytest_cache', 'data', 'datasets', 'models', 'weights', 'cache', 'logs', 'secrets', 'credentials', 'artifacts', 'test-results']);
export function portableFile(file: string): string {
  if (!file || file.length > 240 || file.includes('\\') || file.startsWith('/') || /[:\x00-\x1f*?"<>|]/.test(file)) throw new HarnessError('PATH_DENIED'); // eslint-disable-line no-control-regex
  if (file.split('/').some((part) => !part || part === '.' || part === '..' || /[. ]$/.test(part) || /^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(part))) throw new HarnessError('PATH_DENIED');
  return file;
}
export function permittedFile(file: string, sourceOnly = false): boolean {
  try { portableFile(file); } catch { return false; }
  if (file.split('/').some((part) => deniedDirectories.has(part.toLowerCase()))) return false;
  if (file.split('/').slice(0, -1).some((part) => part.startsWith('.'))) return false;
  const name = path.posix.basename(file);
  if (/^\.env(?:\.|$)|(?:credentials?|secrets?|private[-_]?key)|\.(?:db|sqlite\d*|pem|key|pfx|p12|csv|parquet|onnx|pt|pth|png|jpg|zip)$/i.test(name)) return false;
  if (sourceOnly) return sourceExtensions.has(path.posix.extname(file));
  if (name.startsWith('.') && !['.gitignore', '.gitattributes', '.editorconfig'].includes(name)) return false;
  return sourceExtensions.has(path.posix.extname(file)) || configExtensions.has(path.posix.extname(file)) || ['Dockerfile', 'Makefile', '.gitignore', '.gitattributes', '.editorconfig'].includes(name);
}
export function filterContent(text: string, kind: 'source' | 'rules' | 'log' = 'source') {
  if (text.includes('\0') || /-----BEGIN (?:[A-Z ]*PRIVATE KEY|OPENSSH)/.test(text)) throw new HarnessError('UNSAFE_CONTENT_REFUSED');
  let redactions = 0;
  const redact = () => { redactions++; return '[REDACTED]'; };
  let content = text.replace(/\b(?:sk-[A-Za-z0-9_-]{8,}|gh[pousr]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+|AKIA[A-Z0-9]{16}|Bearer\s+[^\s"']+)/gi, redact);
  content = content.replace(/((?:password|passwd|api[_-]?key|access[_-]?token|client[_-]?secret|密码|密钥|用户名)\s*["'`]*\s*[:=：]\s*)[^\r\n,;}]+/gi, (_match, prefix: string) => `${prefix}${redact()}`);
  content = content.replace(/(["'])([A-Za-z0-9+/=_-]{40,})\1/g, (_match, quote: string) => `${quote}${redact()}${quote}`);
  if (kind === 'log') {
    content = content.replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, redact)
      .replace(/((?:device[_-]?id|serial[_-]?number|patient|phone|email|user[_-]?id)\s*["']*\s*[:=]\s*)["']?[^\s,}\r\n]+/gi, (_match, prefix: string) => `${prefix}${redact()}`);
  }
  const injectionWarnings = /ignore\s+(?:all\s+)?(?:previous|system)|system\s*prompt|绕过.*(?:权限|安全)|忽略.*(?:指令|规则)|reveal.*(?:secret|token)|unrestricted|danger-full-access/i.test(text) ? ['untrusted-instruction-content'] : [];
  return { content, redactions, injectionWarnings, trust: 'untrusted-context' as const };
}
