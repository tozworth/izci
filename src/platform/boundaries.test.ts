import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../..');
const src = resolve(root, 'src');
const targets = {
  pwa: 'src/platform/pwa/platform.ts',
  desktop: 'src/desktop/platform.ts',
  android: 'src/android/platform.ts'
} as const;

function files(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? (entry.name === 'vendor' ? [] : files(path))
      : /\.(?:ts|svelte)$/.test(path) && !/\.(?:test|bench|d)\.ts$/.test(path) ? [path] : [];
  });
}

function script(path: string): ts.SourceFile {
  const text = readFileSync(path, 'utf8');
  const code = path.endsWith('.svelte')
    ? Array.from(text.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g), match => match[1]).join('\n') : text;
  return ts.createSourceFile(path, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}

function imports(path: string): string[] {
  const result: string[] = [];
  function visit(node: ts.Node): void {
    if (ts.isImportDeclaration(node) && !node.importClause?.isTypeOnly && ts.isStringLiteral(node.moduleSpecifier)) {
      // An import containing exclusively `type X` specifiers has no runtime edge.
      const bindings = node.importClause?.namedBindings;
      if (!(bindings && ts.isNamedImports(bindings) && bindings.elements.every(item => item.isTypeOnly))) result.push(node.moduleSpecifier.text);
    }
    if (ts.isExportDeclaration(node) && !node.isTypeOnly && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      result.push(node.moduleSpecifier.text);
    }
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) {
      result.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  }
  visit(script(path));
  return result;
}

function dependency(from: string, name: string, target: keyof typeof targets): string | null {
  const base = name === '$platform' ? resolve(root, targets[target])
    : name.startsWith('$lib/') ? resolve(src, 'lib', name.slice(5))
    : name.startsWith('.') ? resolve(dirname(from), name) : null;
  if (!base || /[?#]/.test(base)) return null;
  return [base, `${base}.ts`, `${base}.svelte`, resolve(base, 'index.ts')].find(path => existsSync(path) && /\.(?:ts|svelte)$/.test(path)) ?? null;
}

describe('platform ownership', () => {
  it('keeps the PWA adapter free of dependencies back into its own platform barrel', () => {
    const entry = resolve(root, targets.pwa);
    const visited = new Set<string>();
    const cycles: string[] = [];
    function visit(path: string): void {
      if (visited.has(path)) return;
      visited.add(path);
      for (const name of imports(path)) {
        const next = dependency(path, name, 'pwa');
        if (next === entry) cycles.push(relative(root, path).replaceAll('\\', '/'));
        else if (next) visit(next);
      }
    }
    visit(entry);
    expect(cycles).toEqual([]);
  });

  it('keeps bridge imports and browser pickers inside the platform boundary', () => {
    const violations: string[] = [];
    for (const path of files(src)) {
      const local = relative(root, path).replaceAll('\\', '/');
      if (/^src\/(?:platform|desktop|android)\//.test(local)) continue;
      for (const name of imports(path)) {
        const resolved = dependency(path, name, 'pwa');
        if (name.startsWith('@tauri-apps/') || resolved && /^src\/(?:desktop|android)\//.test(relative(root, resolved).replaceAll('\\', '/'))) {
          violations.push(`${local}: native import ${name}`);
        }
      }
      const text = script(path).text;
      if (/\b(?:showOpenFilePicker|showSaveFilePicker|showDirectoryPicker|getAsFileSystemHandle|nativeFilesystem|isDesktop)\b/.test(text)) {
        violations.push(`${local}: platform API outside its owner`);
      }
    }
    expect(violations).toEqual([]);
  });

  it.each(Object.keys(targets) as (keyof typeof targets)[])('%s entrypoint cannot reach another native target', target => {
    const entries = files(src).filter(path => /(?:^|[\\/])main\.ts$/.test(path) && !/[\\/](?:desktop|android)[\\/]/.test(path));
    const visited = new Set<string>();
    function visit(path: string): void {
      if (visited.has(path)) return;
      visited.add(path);
      for (const name of imports(path)) {
        const next = dependency(path, name, target);
        if (next) visit(next);
      }
    }
    entries.forEach(visit);
    const forbidden = [...visited].map(path => relative(root, path).replaceAll('\\', '/')).filter(path =>
      target !== 'desktop' && path.startsWith('src/desktop/') || target !== 'android' && path.startsWith('src/android/'));
    expect(forbidden).toEqual([]);
    expect(visited.has(resolve(root, targets[target]))).toBe(true);
    if (target !== 'pwa') expect([...visited].filter(path => path.includes(`${resolve(src, 'platform/pwa')}/`) || path.startsWith(resolve(src, 'platform/pwa') + '\\'))).toEqual([]);
  });
});
