import { promises as fs } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

import { architectureConfig } from './config.mjs';

const posix = (value) => value.split(path.sep).join('/');
const compareText = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const sorted = (values) => [...values].sort(compareText);

function validateConfig(config) {
  if (!config || !Array.isArray(config.sourceRoots) || config.sourceRoots.length === 0) {
    throw new Error('Architecture config must declare at least one source root.');
  }
  if (!Array.isArray(config.sourceExtensions) || config.sourceExtensions.some((value) => !value.startsWith('.'))) {
    throw new Error('Architecture config sourceExtensions must be an array of extensions.');
  }
  if (!Array.isArray(config.sourceFiles)) {
    throw new Error('Architecture config sourceFiles must be an array.');
  }
  if (!Array.isArray(config.sourceRuntimeRules) || config.sourceRuntimeRules.some((rule) => !rule.runtime)) {
    throw new Error('Architecture config sourceRuntimeRules must declare runtime classifications.');
  }
  if (typeof config.defaultSourceRuntime !== 'string' || !Array.isArray(config.browserCapabilityRuntimes)) {
    throw new Error('Architecture config must declare a default runtime and browser capability runtimes.');
  }
  if (!Array.isArray(config.directionRules) || config.directionRules.some((rule) => !rule.id || !rule.from || !rule.to)) {
    throw new Error('Every architecture direction rule needs id, from, and to fields.');
  }
  const ids = config.directionRules.map((rule) => rule.id);
  if (new Set(ids).size !== ids.length) {
    throw new Error('Architecture direction rule ids must be unique.');
  }
  if (!Array.isArray(config.browserGlobalAllowedPathPatterns)) {
    throw new Error('Architecture config browserGlobalAllowedPathPatterns must be an array.');
  }
}

async function walkFiles(root, relativeDirectory, config) {
  const absoluteDirectory = path.join(root, relativeDirectory);
  let entries;
  try {
    entries = await fs.readdir(absoluteDirectory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw new Error(`Configured source root does not exist: ${posix(relativeDirectory)}`);
    }
    throw error;
  }
  const files = [];
  for (const entry of entries.sort((a, b) => compareText(a.name, b.name))) {
    const relativePath = posix(path.join(relativeDirectory, entry.name));
    if (config.excludedPathPatterns.some((pattern) => pattern.test(relativePath))) continue;
    if (entry.isDirectory()) files.push(...await walkFiles(root, relativePath, config));
    if (entry.isFile() && config.sourceExtensions.includes(path.extname(entry.name))) files.push(relativePath);
  }
  return files;
}

function svelteScriptsOnly(source) {
  const output = [...source].map((character) => character === '\n' ? '\n' : ' ');
  const scriptPattern = /<script(?:\s[^>]*)?>([\s\S]*?)<\/script\s*>/gi;
  for (const match of source.matchAll(scriptPattern)) {
    const content = match[1];
    const start = (match.index ?? 0) + match[0].indexOf(content);
    for (let index = 0; index < content.length; index += 1) output[start + index] = content[index];
  }
  return output.join('');
}

function moduleSource(file, source) {
  return file.endsWith('.svelte') ? svelteScriptsOnly(source) : source;
}

function lineOf(sourceFile, node) {
  return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
}

function importNames(node) {
  if (ts.isImportDeclaration(node)) {
    const clause = node.importClause;
    if (!clause) return [];
    const names = [];
    if (clause.name) names.push('default');
    if (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings)) names.push('*');
    if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
      for (const element of clause.namedBindings.elements) names.push(element.propertyName?.text ?? element.name.text);
    }
    return names;
  }
  if (ts.isExportDeclaration(node)) {
    if (!node.exportClause) return ['*'];
    if (ts.isNamespaceExport(node.exportClause)) return ['*'];
    return node.exportClause.elements.map((element) => element.propertyName?.text ?? element.name.text);
  }
  return ['*'];
}

function collectImports(sourceFile) {
  const imports = [];
  const visit = (node) => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      imports.push({
        specifier: node.moduleSpecifier.text,
        kind: ts.isImportDeclaration(node) ? (node.importClause?.isTypeOnly ? 'type-import' : 'import') : 're-export',
        names: sorted(importNames(node)),
        line: lineOf(sourceFile, node)
      });
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length === 1 &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      imports.push({ specifier: node.arguments[0].text, kind: 'dynamic-import', names: ['*'], line: lineOf(sourceFile, node) });
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return imports.sort((a, b) => a.line - b.line || compareText(a.specifier, b.specifier));
}

function hasExportModifier(node) {
  return Boolean(ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword));
}

function collectExports(sourceFile, file) {
  if (file.endsWith('.svelte')) return [];
  const exports = [];
  for (const statement of sourceFile.statements) {
    if (hasExportModifier(statement)) {
      const isDefault = ts.getModifiers(statement)?.some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword);
      if (isDefault) {
        exports.push({ name: 'default', line: lineOf(sourceFile, statement) });
      } else if (ts.isVariableStatement(statement)) {
        for (const declaration of statement.declarationList.declarations) {
          if (ts.isIdentifier(declaration.name)) exports.push({ name: declaration.name.text, line: lineOf(sourceFile, declaration.name) });
        }
      } else if ('name' in statement && statement.name && ts.isIdentifier(statement.name)) {
        exports.push({ name: statement.name.text, line: lineOf(sourceFile, statement.name) });
      }
    }
    if (ts.isExportDeclaration(statement) && !statement.moduleSpecifier && statement.exportClause && ts.isNamedExports(statement.exportClause)) {
      for (const element of statement.exportClause.elements) {
        exports.push({ name: element.name.text, line: lineOf(sourceFile, element.name) });
      }
    }
  }
  return exports.sort((a, b) => a.line - b.line || compareText(a.name, b.name));
}

function isIdentifierUse(node, bindingIdentifiers) {
  const parent = node.parent;
  if (!parent) return false;
  if (bindingIdentifiers.has(node)) return false;
  if ((ts.isPropertyAccessExpression(parent) || ts.isQualifiedName(parent)) && parent.name === node) return false;
  if (
    (ts.isPropertyAssignment(parent) || ts.isPropertyDeclaration(parent) || ts.isPropertySignature(parent) ||
     ts.isMethodDeclaration(parent) || ts.isMethodSignature(parent) || ts.isGetAccessorDeclaration(parent) ||
     ts.isSetAccessorDeclaration(parent) || ts.isEnumMember(parent)) && parent.name === node
  ) return false;
  if (ts.isBindingElement(parent) && (parent.name === node || parent.propertyName === node)) return false;
  if ((ts.isImportSpecifier(parent) || ts.isExportSpecifier(parent)) && (parent.name === node || parent.propertyName === node)) return false;
  if (
    ts.isExpressionWithTypeArguments(parent) && parent.expression === node &&
    ts.isHeritageClause(parent.parent) && parent.parent.token === ts.SyntaxKind.ExtendsKeyword
  ) return true;
  if (ts.isShorthandPropertyAssignment(parent)) return true;
  if (
    (ts.isVariableDeclaration(parent) || ts.isParameter(parent) || ts.isFunctionDeclaration(parent) ||
     ts.isClassDeclaration(parent) || ts.isInterfaceDeclaration(parent) || ts.isTypeAliasDeclaration(parent) ||
     ts.isImportClause(parent) || ts.isImportSpecifier(parent) || ts.isNamespaceImport(parent)) && parent.name === node
  ) return false;
  for (let current = parent; current; current = current.parent) {
    if (ts.isTypeNode(current)) return false;
    if (ts.isExpression(current) || ts.isStatement(current) || ts.isSourceFile(current)) break;
  }
  return true;
}

function createsLexicalScope(node) {
  return ts.isSourceFile(node) || ts.isFunctionLike(node) || ts.isBlock(node) ||
    ts.isCatchClause(node) || ts.isForStatement(node) || ts.isForInStatement(node) ||
    ts.isForOfStatement(node) || ts.isCaseBlock(node) || ts.isClassLike(node);
}

function createScope(parent, kind) {
  return { parent, kind, bindings: new Set() };
}

function collectBindingIdentifiers(name, identifiers) {
  if (ts.isIdentifier(name)) {
    identifiers.push(name);
    return;
  }
  for (const element of name.elements) {
    if (ts.isOmittedExpression(element)) continue;
    collectBindingIdentifiers(element.name, identifiers);
  }
}

function nearestFunctionOrSourceScope(scope) {
  for (let current = scope; current; current = current.parent) {
    if (current.kind === 'function' || current.kind === 'source') return current;
  }
  return scope;
}

function buildLexicalScopes(sourceFile) {
  const scopeAtNode = new Map();
  const bindingIdentifiers = new Set();

  const bind = (name, scope) => {
    const identifiers = [];
    collectBindingIdentifiers(name, identifiers);
    for (const identifier of identifiers) {
      scope.bindings.add(identifier.text);
      bindingIdentifiers.add(identifier);
    }
  };

  const visit = (node, inheritedScope) => {
    let scope = inheritedScope;
    if (node === sourceFile) {
      scope = createScope(null, 'source');
      scopeAtNode.set(node, scope);
    } else {
      if ((ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) && node.name && inheritedScope) {
        bind(node.name, inheritedScope);
      }
      if (createsLexicalScope(node)) {
        const kind = ts.isFunctionLike(node) ? 'function' : 'block';
        scope = createScope(inheritedScope, kind);
        scopeAtNode.set(node, scope);
      }
      if ((ts.isFunctionExpression(node) || ts.isClassExpression(node)) && node.name) bind(node.name, scope);
    }

    if (ts.isImportClause(node) && !node.isTypeOnly) {
      if (node.name) bind(node.name, scope);
      if (node.namedBindings && ts.isNamespaceImport(node.namedBindings)) bind(node.namedBindings.name, scope);
      if (node.namedBindings && ts.isNamedImports(node.namedBindings)) {
        for (const element of node.namedBindings.elements) if (!element.isTypeOnly) bind(element.name, scope);
      }
    } else if (ts.isVariableDeclaration(node) && !ts.isCatchClause(node.parent)) {
      const declarationList = node.parent;
      const blockScoped = ts.isVariableDeclarationList(declarationList) && Boolean(declarationList.flags & ts.NodeFlags.BlockScoped);
      bind(node.name, blockScoped ? scope : nearestFunctionOrSourceScope(scope));
    } else if (ts.isParameter(node)) {
      bind(node.name, nearestFunctionOrSourceScope(scope));
    } else if (ts.isCatchClause(node) && node.variableDeclaration) {
      bind(node.variableDeclaration.name, scope);
    } else if ((ts.isEnumDeclaration(node) || ts.isModuleDeclaration(node)) && node.name && ts.isIdentifier(node.name)) {
      bind(node.name, scope);
    }

    ts.forEachChild(node, (child) => visit(child, scope));
  };
  visit(sourceFile, null);
  return { scopeAtNode, bindingIdentifiers };
}

function collectBrowserGlobals(sourceFile, configuredGlobals) {
  const globals = new Set(configuredGlobals);
  const { scopeAtNode, bindingIdentifiers } = buildLexicalScopes(sourceFile);
  const findings = new Map();
  const isShadowed = (name, scope) => {
    for (let current = scope; current; current = current.parent) {
      if (current.bindings.has(name)) return true;
    }
    return false;
  };
  const visit = (node, inheritedScope) => {
    const scope = scopeAtNode.get(node) ?? inheritedScope;
    if (ts.isIdentifier(node) && globals.has(node.text) && !isShadowed(node.text, scope) && isIdentifierUse(node, bindingIdentifiers)) {
      const line = lineOf(sourceFile, node);
      const current = findings.get(node.text) ?? [];
      current.push(line);
      findings.set(node.text, current);
    }
    ts.forEachChild(node, (child) => visit(child, scope));
  };
  visit(sourceFile, scopeAtNode.get(sourceFile));
  return sorted(findings.keys()).map((name) => ({ name, lines: [...new Set(findings.get(name))].sort((a, b) => a - b) }));
}

function resolveInternal(source, specifier, moduleSet, config) {
  let base;
  if (specifier.startsWith('.')) {
    base = posix(path.normalize(path.join(path.dirname(source), specifier)));
  } else {
    const alias = Object.entries(config.aliases).find(([prefix]) => specifier.startsWith(prefix));
    if (!alias) return null;
    base = `${alias[1]}${specifier.slice(alias[0].length)}`;
  }
  const withoutQuery = base.split(/[?#]/, 1)[0];
  const candidates = [withoutQuery];
  for (const extension of config.sourceExtensions) candidates.push(`${withoutQuery}${extension}`);
  for (const extension of config.sourceExtensions) candidates.push(`${withoutQuery}/index${extension}`);
  return candidates.find((candidate) => moduleSet.has(candidate)) ?? null;
}

function matchSelector(file, selector) {
  if (selector.paths && !selector.paths.includes(file)) return false;
  if (selector.prefixes && !selector.prefixes.some((prefix) => file.startsWith(prefix))) return false;
  if (selector.extension && path.posix.extname(file) !== selector.extension) return false;
  return true;
}

function sourceScope(file) {
  return /(?:^|\/)[^/]+\.(?:test|spec)\.[^.]+$/.test(file) ? 'test' : 'production';
}

function sourceRuntime(file, config) {
  for (const rule of config.sourceRuntimeRules) {
    if (rule.paths?.includes(file)) return rule.runtime;
    if (rule.prefixes?.some((prefix) => file.startsWith(prefix))) return rule.runtime;
    if (rule.patterns?.some((pattern) => pattern.test(file))) return rule.runtime;
  }
  return config.defaultSourceRuntime;
}

function stronglyConnectedComponents(modules, edges) {
  const adjacency = new Map(modules.map((module) => [module, []]));
  for (const edge of edges) adjacency.get(edge.source)?.push(edge.target);
  for (const targets of adjacency.values()) targets.sort(compareText);
  const stack = [];
  const onStack = new Set();
  const indexes = new Map();
  const lowLinks = new Map();
  const components = [];
  let nextIndex = 0;
  const connect = (module) => {
    indexes.set(module, nextIndex);
    lowLinks.set(module, nextIndex);
    nextIndex += 1;
    stack.push(module);
    onStack.add(module);
    for (const target of adjacency.get(module)) {
      if (!indexes.has(target)) {
        connect(target);
        lowLinks.set(module, Math.min(lowLinks.get(module), lowLinks.get(target)));
      } else if (onStack.has(target)) {
        lowLinks.set(module, Math.min(lowLinks.get(module), indexes.get(target)));
      }
    }
    if (lowLinks.get(module) === indexes.get(module)) {
      const component = [];
      let member;
      do {
        member = stack.pop();
        onStack.delete(member);
        component.push(member);
      } while (member !== module);
      components.push(sorted(component));
    }
  };
  for (const module of modules) if (!indexes.has(module)) connect(module);
  return components
    .filter((component) => component.length > 1 || edges.some((edge) => edge.source === component[0] && edge.target === component[0]))
    .sort((a, b) => compareText(a[0], b[0]));
}

async function bundleFacts(root, relativeDirectory) {
  const absoluteDirectory = path.join(root, relativeDirectory);
  try {
    await fs.access(absoluteDirectory);
  } catch (error) {
    if (error?.code === 'ENOENT') return { status: 'absent', directory: relativeDirectory };
    throw error;
  }
  const files = [];
  const visit = async (directory) => {
    const entries = await fs.readdir(path.join(absoluteDirectory, directory), { withFileTypes: true });
    for (const entry of entries.sort((a, b) => compareText(a.name, b.name))) {
      const relative = posix(path.join(directory, entry.name));
      if (entry.isDirectory()) await visit(relative);
      if (entry.isFile()) {
        const stat = await fs.stat(path.join(absoluteDirectory, relative));
        files.push({ path: relative, bytes: stat.size });
      }
    }
  };
  await visit('');
  files.sort((a, b) => compareText(a.path, b.path));
  const byExtension = {};
  for (const file of files) {
    const extension = path.posix.extname(file.path) || '(none)';
    byExtension[extension] ??= { files: 0, bytes: 0 };
    byExtension[extension].files += 1;
    byExtension[extension].bytes += file.bytes;
  }
  const precache = [];
  const serviceWorker = files.find((file) => file.path === 'sw.js');
  if (serviceWorker) {
    const source = await fs.readFile(path.join(absoluteDirectory, serviceWorker.path), 'utf8');
    for (const match of source.matchAll(/\{url:["']([^"']+)["'],revision:(?:["']([^"']*)["']|null)\}/g)) {
      precache.push({ url: match[1], revision: match[2] ?? null });
    }
    precache.sort((a, b) => compareText(a.url, b.url));
  }
  return {
    status: 'present',
    directory: relativeDirectory,
    totals: { files: files.length, bytes: files.reduce((sum, file) => sum + file.bytes, 0) },
    byExtension: Object.fromEntries(Object.entries(byExtension).sort(([a], [b]) => compareText(a, b))),
    htmlEntrypoints: files.filter((file) => file.path.endsWith('.html')),
    largestJavaScript: files.filter((file) => file.path.endsWith('.js')).sort((a, b) => b.bytes - a.bytes || compareText(a.path, b.path)).slice(0, 20),
    files,
    precache: { entries: precache.length, assets: precache }
  };
}

export async function analyzeProject({ root = process.cwd(), config = architectureConfig, includeBundle = true } = {}) {
  validateConfig(config);
  const normalizedRoot = path.resolve(root);
  const discoveredFiles = (await Promise.all(config.sourceRoots.map((sourceRoot) => walkFiles(normalizedRoot, sourceRoot, config)))).flat();
  for (const sourceFile of config.sourceFiles) {
    const normalizedFile = posix(sourceFile);
    try {
      const stat = await fs.stat(path.join(normalizedRoot, normalizedFile));
      if (!stat.isFile()) throw new Error(`Configured source file is not a file: ${normalizedFile}`);
    } catch (error) {
      if (error?.code === 'ENOENT') throw new Error(`Configured source file does not exist: ${normalizedFile}`);
      throw error;
    }
    if (!config.excludedPathPatterns.some((pattern) => pattern.test(normalizedFile))) discoveredFiles.push(normalizedFile);
  }
  const moduleFiles = sorted(new Set(discoveredFiles));
  const moduleSet = new Set(moduleFiles);
  const parsedModules = [];
  for (const file of moduleFiles) {
    const raw = await fs.readFile(path.join(normalizedRoot, file), 'utf8');
    const source = moduleSource(file, raw);
    const scriptKind = file.endsWith('.js') ? ts.ScriptKind.JS : ts.ScriptKind.TS;
    const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, scriptKind);
    const diagnostics = sourceFile.parseDiagnostics;
    if (diagnostics.length > 0) {
      const first = diagnostics[0];
      const location = sourceFile.getLineAndCharacterOfPosition(first.start ?? 0);
      throw new Error(`Could not parse ${file}:${location.line + 1}: ${ts.flattenDiagnosticMessageText(first.messageText, '\n')}`);
    }
    parsedModules.push({
      file,
      runtime: sourceRuntime(file, config),
      imports: collectImports(sourceFile),
      exports: collectExports(sourceFile, file),
      browserGlobals: collectBrowserGlobals(sourceFile, config.browserGlobals)
    });
  }

  const internalEdges = [];
  const externalImports = [];
  const unresolvedRelativeImports = [];
  for (const module of parsedModules) {
    for (const item of module.imports) {
      const target = resolveInternal(module.file, item.specifier, moduleSet, config);
      const fact = { source: module.file, specifier: item.specifier, kind: item.kind, names: item.names, line: item.line };
      if (target) internalEdges.push({ ...fact, target });
      else if (item.specifier.startsWith('.') || Object.keys(config.aliases).some((prefix) => item.specifier.startsWith(prefix))) unresolvedRelativeImports.push(fact);
      else externalImports.push(fact);
    }
  }
  const edgeSort = (a, b) => compareText(a.source, b.source) || a.line - b.line || compareText(a.target ?? a.specifier, b.target ?? b.specifier);
  internalEdges.sort(edgeSort);
  externalImports.sort(edgeSort);
  unresolvedRelativeImports.sort(edgeSort);

  const directionViolations = [];
  for (const edge of internalEdges) {
    for (const rule of config.directionRules) {
      if (matchSelector(edge.source, rule.from) && matchSelector(edge.target, rule.to)) {
        directionViolations.push({ rule: rule.id, scope: sourceScope(edge.source), source: edge.source, target: edge.target, line: edge.line });
      }
    }
  }
  directionViolations.sort((a, b) => compareText(a.rule, b.rule) || compareText(a.source, b.source) || a.line - b.line || compareText(a.target, b.target));

  const incoming = new Map(moduleFiles.map((file) => [file, []]));
  for (const edge of internalEdges) incoming.get(edge.target).push(edge);
  const entrypoints = new Set(moduleFiles.filter((file) => config.entrypointPatterns.some((pattern) => pattern.test(file))));
  const unreferencedExports = [];
  for (const module of parsedModules) {
    const consumers = incoming.get(module.file);
    if (consumers.length === 0 || entrypoints.has(module.file) || consumers.some((edge) => edge.names.includes('*'))) continue;
    const used = new Set(consumers.flatMap((edge) => edge.names));
    for (const exported of module.exports) {
      if (!used.has(exported.name)) unreferencedExports.push({ file: module.file, name: exported.name, line: exported.line });
    }
  }
  unreferencedExports.sort((a, b) => compareText(a.file, b.file) || a.line - b.line || compareText(a.name, b.name));

  const possibleUnreferencedModules = [];
  for (const module of parsedModules) {
    if (sourceScope(module.file) === 'test' || entrypoints.has(module.file)) continue;
    const inbound = incoming.get(module.file);
    const productionEdges = inbound.filter((edge) => sourceScope(edge.source) === 'production');
    if (productionEdges.length > 0) continue;
    const testEdges = inbound.filter((edge) => sourceScope(edge.source) === 'test');
    possibleUnreferencedModules.push({
      file: module.file,
      runtime: module.runtime,
      productionInboundEdges: 0,
      productionImporters: [],
      testInboundEdges: testEdges.length,
      testImporters: sorted(new Set(testEdges.map((edge) => edge.source)))
    });
  }
  possibleUnreferencedModules.sort((a, b) => compareText(a.file, b.file));

  const browserAccess = parsedModules.flatMap((module) => module.browserGlobals.map((finding) => ({
    scope: sourceScope(module.file),
    runtime: module.runtime,
    file: module.file,
    global: finding.name,
    lines: finding.lines,
    applicable: config.browserCapabilityRuntimes.includes(module.runtime),
    allowed: config.browserGlobalAllowedPathPatterns.some((pattern) => pattern.test(module.file))
  })))
    .sort((a, b) => compareText(a.file, b.file) || compareText(a.global, b.global));
  const cycles = stronglyConnectedComponents(moduleFiles, internalEdges);
  const bundle = includeBundle ? await bundleFacts(normalizedRoot, config.bundleDirectory) : { status: 'not-requested', directory: config.bundleDirectory };

  return {
    schemaVersion: 1,
    mode: 'informational',
    semantics: {
      exitPolicy: 'Architecture findings do not fail Stage 1; only invalid configuration, unreadable inputs, or reporter errors fail.',
      staticImports: 'ES import, re-export, and string-literal dynamic import edges resolved to configured source modules; unresolved relative edges include CSS, JSON, raw, and other non-source assets.',
      cycles: 'Strongly connected components of resolved internal import edges.',
      browserGlobals: 'Lexical identifier candidates, excluding declarations, property names, and type positions; allowed is config-driven and is not a capability ownership proof.',
      unreferencedExports: 'Conservative candidates from explicit non-Svelte exports; modules with namespace/dynamic consumers, no inbound edge, or entrypoint status are suppressed.',
      unreferencedModules: 'Production modules with no production import edge after excluding declared entrypoints and test modules; test-only inbound edges remain explicit.',
      sourceRuntimes: 'Path-based execution-realm classification; browser capability violations apply only to configured browser and worker runtimes, while all observations remain reported.',
      bundle: 'Byte facts from an existing dist tree; the reporter never builds or mutates dist.'
    },
    configuration: {
      sourceRoots: config.sourceRoots,
      sourceFiles: config.sourceFiles,
      sourceExtensions: config.sourceExtensions,
      sourceRuntimeRules: config.sourceRuntimeRules.map(({ runtime, description }) => ({ runtime, description })),
      defaultSourceRuntime: config.defaultSourceRuntime,
      browserCapabilityRuntimes: config.browserCapabilityRuntimes,
      directionRules: config.directionRules.map(({ id, description }) => ({ id, description })),
      browserGlobals: sorted(config.browserGlobals),
      bundleDirectory: config.bundleDirectory
    },
    source: {
      modules: moduleFiles.length,
      files: moduleFiles,
      entrypoints: sorted(entrypoints),
      runtimes: Object.fromEntries(sorted(new Set(parsedModules.map((module) => module.runtime))).map((runtime) => [
        runtime,
        parsedModules.filter((module) => module.runtime === runtime).map((module) => module.file)
      ]))
    },
    imports: {
      internalEdges: internalEdges.length,
      externalEdges: externalImports.length,
      unresolvedRelativeEdges: unresolvedRelativeImports.length,
      edges: internalEdges,
      external: externalImports,
      unresolvedRelative: unresolvedRelativeImports
    },
    directionViolations: {
      count: directionViolations.length,
      production: directionViolations.filter((finding) => finding.scope === 'production').length,
      test: directionViolations.filter((finding) => finding.scope === 'test').length,
      findings: directionViolations
    },
    cycles: { count: cycles.length, stronglyConnectedComponents: cycles },
    browserGlobalAccess: {
      files: new Set(browserAccess.filter((finding) => finding.applicable).map((finding) => finding.file)).size,
      productionFiles: new Set(browserAccess.filter((finding) => finding.applicable && finding.scope === 'production').map((finding) => finding.file)).size,
      testFiles: new Set(browserAccess.filter((finding) => finding.applicable && finding.scope === 'test').map((finding) => finding.file)).size,
      violations: browserAccess.filter((finding) => finding.applicable && !finding.allowed).length,
      observations: browserAccess.length,
      byRuntime: Object.fromEntries(sorted(new Set(parsedModules.map((module) => module.runtime))).map((runtime) => {
        const runtimeFindings = browserAccess.filter((finding) => finding.runtime === runtime);
        return [runtime, {
          applicable: config.browserCapabilityRuntimes.includes(runtime),
          files: new Set(runtimeFindings.map((finding) => finding.file)).size,
          productionFiles: new Set(runtimeFindings.filter((finding) => finding.scope === 'production').map((finding) => finding.file)).size,
          testFiles: new Set(runtimeFindings.filter((finding) => finding.scope === 'test').map((finding) => finding.file)).size,
          observations: runtimeFindings.length,
          violations: runtimeFindings.filter((finding) => config.browserCapabilityRuntimes.includes(runtime) && !finding.allowed).length
        }];
      })),
      findings: browserAccess
    },
    possibleUnreferencedExports: { count: unreferencedExports.length, findings: unreferencedExports },
    possibleUnreferencedModules: { count: possibleUnreferencedModules.length, findings: possibleUnreferencedModules },
    bundle
  };
}

export function serializeReport(report) {
  return `${JSON.stringify(report, null, 2)}\n`;
}
