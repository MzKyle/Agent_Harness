import ts from 'typescript';
import path from 'node:path';
import { readBounded } from '../safety.js';
import { ExternalRegistry } from './registry.js';
import { sourceFiles, revision } from './git.js';
import { filterContent, permittedFile, portableFile, sourceExtensions } from './content.js';
import { HarnessError } from './contracts.js';

export interface CodeMatch { path: string; line: number; snippet: string; matchType: string }
export class CodeIntelligence {
  constructor(readonly registry: ExternalRegistry) {}
  async read(projectId: string, file: string, start = 1, end = start + 39, overrideRoot?: string) {
    const project = await this.registry.get(projectId); const root = overrideRoot ?? project.root;
    portableFile(file);
    if (!permittedFile(file, true)) throw new HarnessError('SOURCE_FILE_DENIED');
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start || end - start >= 200) throw new HarnessError('LINE_RANGE_DENIED');
    const filtered = filterContent(await readBounded(root, file, 512 * 1024));
    const lines = filtered.content.split(/\r?\n/); const chosen: { line: number; text: string }[] = []; let bytes = 0; let truncated = end > lines.length;
    for (let line = start; line <= Math.min(end, lines.length); line++) {
      const text = lines[line - 1]!; const length = Buffer.byteLength(text);
      if (bytes + length > 16384) { truncated = true; break; }
      chosen.push({ line, text }); bytes += length;
    }
    return { projectId, path: file, source: { kind: 'source', revision: revision(root), path: file },
      trust: filtered.trust, redactions: filtered.redactions, injectionWarnings: filtered.injectionWarnings, lines: chosen, truncated };
  }
  async search(projectId: string, query: string, options: { language?: string; module?: string; limit?: number } = {}, overrideRoot?: string) {
    if (!query || query.length > 200 || query.includes('\0')) throw new HarnessError('QUERY_DENIED');
    const item = await this.registry.get(projectId); const root = overrideRoot ?? item.root;
    const listing = await sourceFiles(root, 15000); const matches: CodeMatch[] = []; let scanned = 0; let bytes = 0; let limited = listing.truncated;
    const scope = options.module ? portableFile(options.module) : null;
    const extensions: Record<string, string[]> = { python: ['.py'], typescript: ['.ts', '.tsx', '.js', '.mjs'], csharp: ['.cs'] };
    if (options.language && !extensions[options.language]) throw new HarnessError('UNSUPPORTED_LANGUAGE');
    for (const file of listing.files) {
      if (!permittedFile(file, true) || scope && file !== scope && !file.startsWith(`${scope}/`)) continue;
      if (options.language && !extensions[options.language]!.includes(path.posix.extname(file))) continue;
      if (++scanned > 800) { limited = true; break; }
      let text: string;
      try { text = filterContent(await readBounded(root, file, 512 * 1024)).content; } catch { continue; }
      const lines = text.split(/\r?\n/);
      for (let index = 0; index < lines.length; index++) {
        if (!lines[index]!.toLowerCase().includes(query.toLowerCase())) continue;
        const snippet = lines[index]!.slice(0, 400); const length = Buffer.byteLength(snippet);
        if (matches.length >= Math.min(50, Math.max(1, options.limit ?? 30)) || bytes + length > 16384) { limited = true; break; }
        matches.push({ path: file, line: index + 1, snippet, matchType: 'literal-case-insensitive' }); bytes += length;
      }
      if (limited && matches.length >= (options.limit ?? 30)) break;
    }
    return { projectId, matches, scanned, truncated: limited, source: { kind: 'bounded-static-source-search', revision: revision(root) },
      graph: { status: 'degraded', reason: 'graphify-not-run-on-read-only-source', fallback: 'bounded-source-search' }, trust: 'untrusted-context' };
  }
  async symbols(projectId: string, name: string, overrideRoot?: string) {
    if (!/^[\p{L}_$][\p{L}\p{N}_.$]{0,99}$/u.test(name)) throw new HarnessError('SYMBOL_NAME_DENIED');
    const project = await this.registry.get(projectId); const root = overrideRoot ?? project.root;
    const listing = await sourceFiles(root); const symbols: CodeMatch[] = []; let scanned = 0; let limited = listing.truncated;
    for (const file of listing.files) {
      if (!permittedFile(file, true)) continue;
      if (++scanned > 800) { limited = true; break; }
      let text: string;
      try { text = filterContent(await readBounded(root, file, 512 * 1024)).content; } catch { continue; }
      if (/\.(?:tsx?|jsx?|mjs|cjs)$/.test(file)) {
        const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
        const visit = (node: ts.Node) => {
          if (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node) || ts.isInterfaceDeclaration(node) || ts.isMethodDeclaration(node) || ts.isVariableDeclaration(node) || ts.isTypeAliasDeclaration(node)) {
            const symbol = node.name?.getText(source);
            if (symbol === name) {
              const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
              symbols.push({ path: file, line, snippet: text.split(/\r?\n/)[line - 1]!.slice(0, 300), matchType: `typescript-ast:${ts.SyntaxKind[node.kind]}` });
            }
          }
          ts.forEachChild(node, visit);
        };
        visit(source);
      } else {
        const expression = file.endsWith('.py') ? /^\s*(?:async\s+)?(?:def|class)\s+([A-Za-z_][\w]*)\b/ : /^\s*(?:(?:public|private|protected|internal|static|async|sealed|partial|override|virtual|abstract)\s+)*(?:(?:class|interface|record|enum)\s+|[\w<>?[\],.]+\s+)([A-Za-z_][\w]*)\s*(?:[(:<{=]|$)/;
        text.split(/\r?\n/).forEach((line, index) => {
          if (expression.exec(line)?.[1] === name) symbols.push({ path: file, line: index + 1, snippet: line.slice(0, 300), matchType: file.endsWith('.py') ? 'python-static-declaration' : 'csharp-lexical-declaration' });
        });
      }
      if (symbols.length >= 50) { limited = true; break; }
    }
    return { projectId, symbols: symbols.slice(0, 50), truncated: limited, source: { kind: 'static-symbol-analysis', revision: revision(root) },
      limitations: ['Python/C# lexical declarations are not semantic resolution', 'No runtime call graph'] };
  }
  async dependencies(projectId: string, file: string, overrideRoot?: string) {
    const project = await this.registry.get(projectId); const root = overrideRoot ?? project.root;
    if (!permittedFile(file, true)) throw new HarnessError('SOURCE_FILE_DENIED');
    const text = filterContent(await readBounded(root, file, 512 * 1024)).content;
    const dependencies: { target: string; line: number; kind: string }[] = [];
    if (/\.(?:tsx?|jsx?|mjs|cjs)$/.test(file)) {
      const ast = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
      const visit = (node: ts.Node) => {
        if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) dependencies.push({ target: node.moduleSpecifier.text, line: ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1, kind: 'typescript-ast-import' });
        ts.forEachChild(node, visit);
      }; visit(ast);
    } else text.split(/\r?\n/).forEach((line, index) => {
      const match = file.endsWith('.py') ? /^\s*(?:from\s+([\w.]+)\s+import|import\s+([\w.]+))/.exec(line) : /^\s*(?:global\s+)?using\s+(?:static\s+)?([\w.]+)\s*;/.exec(line);
      if (match) dependencies.push({ target: match[1] ?? match[2]!, line: index + 1, kind: file.endsWith('.py') ? 'python-static-import' : 'csharp-static-using' });
    });
    return { projectId, path: file, dependencies: dependencies.slice(0, 100), truncated: dependencies.length > 100,
      source: { kind: 'static-import-analysis', revision: revision(root) }, limitations: ['Imports are not runtime calls', 'Dynamic imports, reflection and dependency injection may be unresolved'] };
  }
  async architecture(projectId: string, overrideRoot?: string) {
    const project = await this.registry.get(projectId); const root = overrideRoot ?? project.root; const listing = await sourceFiles(root);
    const layers = ['domain', 'application', 'infrastructure', 'presentation', 'renderer', 'web', 'worker', 'api', 'MockHardware'];
    const modules = layers.map((layer) => ({ layer, evidence: listing.files.filter((file) => permittedFile(file, true) && file.toLowerCase().split(/[/.]/).some((part) => part.includes(layer.toLowerCase()))).slice(0, 12) })).filter((item) => item.evidence.length);
    return { projectId, revision: revision(root), modules,
      entrypoints: listing.files.filter((file) => /(?:^|\/)(?:main|app|server|worker|App)\.(?:py|ts|tsx|cs|xaml)$/.test(file)).slice(0, 30),
      tests: listing.files.filter((file) => /(?:test|spec)/i.test(file) && sourceExtensions.has(path.posix.extname(file))).slice(0, 40),
      source: 'bounded-directory-and-static-code-evidence', truncated: listing.truncated,
      limitations: ['Layer names are evidence-based candidates', 'No claim of a complete runtime call chain'] };
  }
}
