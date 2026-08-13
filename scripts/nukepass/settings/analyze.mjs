import { promises as fs } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

import { settingsReportConfig } from './config.mjs';

const posix = (value) => value.split(path.sep).join('/');
const compareText = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const sorted = (values) => [...values].sort(compareText);

function validateConfig(config) {
  if (!config || !Array.isArray(config.sourceRoots) || config.sourceRoots.length === 0) {
    throw new Error('Settings reporter config must declare source roots.');
  }
  for (const field of ['sourceExtensions', 'ledgerFiles', 'persistentStoreFactories', 'directStores', 'presentationPathPatterns', 'presentationOnlyPathPatterns']) {
    if (!Array.isArray(config[field])) throw new Error(`Settings reporter config ${field} must be an array.`);
  }
  if (!(config.testPathPattern instanceof RegExp)) throw new Error('Settings reporter config needs a testPathPattern.');
}

async function walkFiles(root, relativeDirectory, config) {
  let entries;
  try {
    entries = await fs.readdir(path.join(root, relativeDirectory), { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') throw new Error(`Configured source root does not exist: ${relativeDirectory}`);
    throw error;
  }
  const files = [];
  for (const entry of entries.sort((a, b) => compareText(a.name, b.name))) {
    const relative = posix(path.join(relativeDirectory, entry.name));
    if (config.excludedPathPatterns.some((pattern) => pattern.test(relative))) continue;
    if (entry.isDirectory()) files.push(...await walkFiles(root, relative, config));
    if (entry.isFile() && config.sourceExtensions.includes(path.extname(entry.name))) files.push(relative);
  }
  return files;
}

function svelteScriptsOnly(source) {
  const output = [...source].map((character) => character === '\n' ? '\n' : ' ');
  for (const match of source.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script\s*>/gi)) {
    const content = match[1];
    const start = (match.index ?? 0) + match[0].indexOf(content);
    for (let index = 0; index < content.length; index += 1) output[start + index] = content[index];
  }
  return output.join('');
}

function parseSource(file, raw) {
  const source = file.endsWith('.svelte') ? svelteScriptsOnly(raw) : raw;
  const kind = file.endsWith('.js') ? ts.ScriptKind.JS : ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, kind);
  if (sourceFile.parseDiagnostics.length > 0) {
    const diagnostic = sourceFile.parseDiagnostics[0];
    const location = sourceFile.getLineAndCharacterOfPosition(diagnostic.start ?? 0);
    throw new Error(`Could not parse ${file}:${location.line + 1}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')}`);
  }
  return sourceFile;
}

function lineOf(sourceFile, node) {
  return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
}

function unwrap(node) {
  let current = node;
  while (
    ts.isAsExpression(current) || ts.isTypeAssertionExpression(current) ||
    ts.isSatisfiesExpression(current) || ts.isParenthesizedExpression(current)
  ) current = current.expression;
  return current;
}

function propertyName(node, sourceFile) {
  if (ts.isIdentifier(node) || ts.isStringLiteral(node) || ts.isNumericLiteral(node)) return node.text;
  return node.getText(sourceFile);
}

function constantsIn(sourceFile) {
  const constants = new Map();
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && declaration.initializer) constants.set(declaration.name.text, declaration.initializer);
    }
  }
  return constants;
}

function importsIn(sourceFile) {
  const imports = new Map();
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier) || !statement.importClause) continue;
    const bindings = statement.importClause.namedBindings;
    if (bindings && ts.isNamedImports(bindings)) {
      for (const element of bindings.elements) {
        imports.set(element.name.text, {
          importedName: element.propertyName?.text ?? element.name.text,
          specifier: statement.moduleSpecifier.text
        });
      }
    }
  }
  return imports;
}

function resolveModule(source, specifier, parsedByFile) {
  if (!specifier.startsWith('.')) return null;
  const base = posix(path.normalize(path.join(path.dirname(source), specifier))).split(/[?#]/, 1)[0];
  return [base, `${base}.ts`, `${base}.js`, `${base}.svelte`, `${base}/index.ts`, `${base}/index.js`]
    .find((candidate) => parsedByFile.has(candidate)) ?? null;
}

function resolveExpression(file, expression, parsedByFile, seen = new Set()) {
  const node = unwrap(expression);
  if (!ts.isIdentifier(node)) return { file, expression: node };
  const key = `${file}:${node.text}`;
  if (seen.has(key)) return { file, expression: node };
  seen.add(key);
  const module = parsedByFile.get(file);
  const local = module.constants.get(node.text);
  if (local) return resolveExpression(file, local, parsedByFile, seen);
  const imported = module.imports.get(node.text);
  if (imported) {
    const target = resolveModule(file, imported.specifier, parsedByFile);
    const targetExpression = target ? parsedByFile.get(target).constants.get(imported.importedName) : null;
    if (target && targetExpression) return resolveExpression(target, targetExpression, parsedByFile, seen);
  }
  return { file, expression: node };
}

function flattenDefault(file, expression, parsedByFile, prefix = '', seen = new Set()) {
  const resolved = resolveExpression(file, expression, parsedByFile, new Set(seen));
  const node = unwrap(resolved.expression);
  const sourceFile = parsedByFile.get(resolved.file).sourceFile;
  const cycleKey = `${resolved.file}:${node.pos}:${prefix}`;
  if (seen.has(cycleKey)) return [];
  seen.add(cycleKey);
  if (!ts.isObjectLiteralExpression(node)) {
    return [{
      identity: prefix || '$value',
      defaultSource: node.getText(sourceFile),
      defaultFile: resolved.file,
      line: lineOf(sourceFile, node)
    }];
  }
  const fields = [];
  for (const property of node.properties) {
    if (ts.isSpreadAssignment(property)) {
      fields.push(...flattenDefault(resolved.file, property.expression, parsedByFile, prefix, new Set(seen)));
      continue;
    }
    if (!ts.isPropertyAssignment(property) && !ts.isShorthandPropertyAssignment(property)) continue;
    const name = propertyName(property.name, sourceFile);
    const identity = prefix ? `${prefix}.${name}` : name;
    const initializer = ts.isShorthandPropertyAssignment(property) ? property.name : property.initializer;
    const expanded = flattenDefault(resolved.file, initializer, parsedByFile, identity, new Set(seen));
    fields.push(...expanded);
  }
  return fields;
}

function objectProperty(object, name) {
  return object.properties.find((property) =>
    ts.isPropertyAssignment(property) && propertyName(property.name, object.getSourceFile()) === name
  );
}

function literalOrSource(file, expression, parsedByFile) {
  const resolved = resolveExpression(file, expression, parsedByFile);
  const node = unwrap(resolved.expression);
  return ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)
    ? node.text
    : node.getText(parsedByFile.get(resolved.file).sourceFile);
}

function discoverStores(parsedByFile, config) {
  const stores = [];
  for (const [file, module] of parsedByFile) {
    if (config.testPathPattern.test(file)) continue;
    const visit = (node) => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && config.persistentStoreFactories.includes(node.expression.text)) {
        const argument = unwrap(node.arguments[0]);
        if (argument && ts.isObjectLiteralExpression(argument)) {
          const defaultProperty = objectProperty(argument, 'defaultValue');
          const storageProperty = objectProperty(argument, 'storageKey');
          if (defaultProperty && storageProperty) {
            const channelProperty = objectProperty(argument, 'channelName');
            stores.push({
              id: `${file}:${lineOf(module.sourceFile, node)}`,
              declarationFile: file,
              line: lineOf(module.sourceFile, node),
              factory: node.expression.text,
              storageKey: literalOrSource(file, storageProperty.initializer, parsedByFile),
              channelName: channelProperty ? literalOrSource(file, channelProperty.initializer, parsedByFile) : null,
              fields: flattenDefault(file, defaultProperty.initializer, parsedByFile)
            });
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(module.sourceFile);
  }
  for (const direct of config.directStores) {
    const module = parsedByFile.get(direct.defaultFile);
    if (!module) throw new Error(`Configured direct store default file is absent: ${direct.defaultFile}`);
    const expression = module.constants.get(direct.defaultName);
    if (!expression) throw new Error(`Configured direct store default is absent: ${direct.defaultFile}#${direct.defaultName}`);
    stores.push({
      id: direct.id,
      declarationFile: direct.persistenceFile,
      line: 1,
      factory: 'direct-localStorage',
      storageKey: direct.storageKey,
      channelName: null,
      fields: flattenDefault(direct.defaultFile, expression, parsedByFile)
    });
  }
  stores.sort((a, b) => compareText(a.id, b.id));
  for (const store of stores) store.fields.sort((a, b) => compareText(a.identity, b.identity));
  return stores;
}

function splitTableRow(line) {
  return line.trim().replace(/^\||\|$/g, '').split('|').map((cell) => cell.trim());
}

function expandLedgerIdentity(identity) {
  const normalized = identity
    .replace(/\*\*/g, '')
    .replace(/\s+\/\s+.*$/, '')
    .replace(/\s+order$/, '')
    .trim();
  const brace = normalized.match(/^(.*)\{([^}]+)\}(.*)$/);
  if (brace) return brace[2].split(',').map((part) => `${brace[1]}${part.trim()}${brace[3]}`);
  return normalized ? [normalized] : [];
}

async function readLedger(root, config) {
  const rows = [];
  for (const file of sorted(config.ledgerFiles)) {
    let source;
    try {
      source = await fs.readFile(path.join(root, file), 'utf8');
    } catch (error) {
      if (error?.code === 'ENOENT') throw new Error(`Configured ledger file does not exist: ${file}`);
      throw error;
    }
    const lines = source.split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      if (!/^\s*\|/.test(line) || /^\s*\|?\s*:?-+/.test(line)) continue;
      const cells = splitTableRow(line);
      if (cells.length < 2 || /^(?:Identity|Field|Setting|State|Surface|Column|Index|View)$/i.test(cells[0])) continue;
      const codeIdentities = [...cells[0].matchAll(/`([^`]+)`/g)].map((match) => match[1]);
      const rawIdentities = codeIdentities.length > 0 ? codeIdentities : [cells[0]];
      const identities = rawIdentities.flatMap(expandLedgerIdentity);
      if (identities.length === 0) continue;
      rows.push({
        file,
        line: index + 1,
        rawIdentity: cells[0],
        identities: sorted(new Set(identities)),
        explicitDisconnected: /no (?:runtime consumer|UI|presentation)|disconnected/i.test(cells.join(' | ')),
        row: cells.join(' | ')
      });
    }
  }
  return rows.sort((a, b) => compareText(a.file, b.file) || a.line - b.line);
}

function normalizedIdentity(identity) {
  return identity.replace(/\[\d+\]/g, '[]').replace(/\s+/g, ' ').trim();
}

function ledgerMatches(fieldIdentity, ledgerRows) {
  const field = normalizedIdentity(fieldIdentity);
  const leaf = field.split('.').at(-1);
  const exact = ledgerRows.filter((row) => row.identities.some((identity) => normalizedIdentity(identity) === field));
  if (exact.length > 0) return { confidence: 'exact', rows: exact };
  const suffix = ledgerRows.filter((row) => row.identities.some((identity) => {
    const candidate = normalizedIdentity(identity);
    return candidate.endsWith(`.${field}`) || field.endsWith(`.${candidate}`);
  }));
  if (suffix.length > 0) return { confidence: 'suffix', rows: suffix };
  const leafRows = ledgerRows.filter((row) => row.identities.some((identity) => normalizedIdentity(identity) === leaf));
  return leafRows.length === 1 ? { confidence: 'unique-leaf', rows: leafRows } : { confidence: 'none', rows: [] };
}

function referenceFiles(identity, rawByFile, store, config) {
  const leaf = identity === '$value' ? null : identity.replace(/\[\d+\]/g, '').split('.').at(-1);
  if (!leaf || !/^[A-Za-z_$][\w$]*$/.test(leaf)) return { presentation: [], runtime: [], tests: [] };
  const pattern = new RegExp(`\\b${leaf.replace(/[$]/g, '\\$&')}\\b`);
  const declarationFiles = new Set([store.declarationFile, ...store.fields.map((field) => field.defaultFile)]);
  const presentation = [];
  const runtime = [];
  const tests = [];
  for (const [file, source] of rawByFile) {
    if (declarationFiles.has(file) || !pattern.test(source)) continue;
    if (config.testPathPattern.test(file)) tests.push(file);
    else {
      if (config.presentationPathPatterns.some((candidate) => candidate.test(file))) presentation.push(file);
      if (!config.presentationOnlyPathPatterns.some((candidate) => candidate.test(file))) runtime.push(file);
    }
  }
  return { presentation: sorted(presentation), runtime: sorted(runtime), tests: sorted(tests) };
}

export async function analyzeSettings({ root = process.cwd(), config = settingsReportConfig } = {}) {
  validateConfig(config);
  const normalizedRoot = path.resolve(root);
  const files = sorted((await Promise.all(config.sourceRoots.map((sourceRoot) => walkFiles(normalizedRoot, sourceRoot, config)))).flat());
  const parsedByFile = new Map();
  const rawByFile = new Map();
  for (const file of files) {
    const raw = await fs.readFile(path.join(normalizedRoot, file), 'utf8');
    const sourceFile = parseSource(file, raw);
    parsedByFile.set(file, { sourceFile, constants: constantsIn(sourceFile), imports: importsIn(sourceFile) });
    rawByFile.set(file, raw);
  }
  const ledgerRows = await readLedger(normalizedRoot, config);
  const stores = discoverStores(parsedByFile, config);
  const declaredFields = [];
  for (const store of stores) {
    for (const field of store.fields) {
      const references = referenceFiles(field.identity, rawByFile, store, config);
      const match = ledgerMatches(field.identity, ledgerRows);
      const connection = references.presentation.length > 0 && references.runtime.length === 0
        ? 'presentation-without-static-runtime'
        : references.presentation.length === 0 && references.runtime.length === 0
          ? 'no-static-presentation-or-runtime'
          : references.presentation.length === 0
            ? 'runtime-without-static-presentation'
            : 'statically-connected';
      declaredFields.push({
        store: store.id,
        storageKey: store.storageKey,
        identity: field.identity,
        defaultSource: field.defaultSource,
        defaultFile: field.defaultFile,
        line: field.line,
        ledger: {
          status: match.confidence === 'none' ? 'missing' : 'mapped',
          confidence: match.confidence,
          rows: match.rows.map((row) => ({ file: row.file, line: row.line, rawIdentity: row.rawIdentity }))
        },
        references,
        connection
      });
    }
  }
  declaredFields.sort((a, b) => compareText(a.store, b.store) || compareText(a.identity, b.identity));

  const matchedLedgerKeys = new Set(declaredFields.flatMap((field) => field.ledger.rows.map((row) => `${row.file}:${row.line}`)));
  const ledgerWithoutDeclaredField = ledgerRows
    .filter((row) => !matchedLedgerKeys.has(`${row.file}:${row.line}`))
    .map((row) => ({ file: row.file, line: row.line, rawIdentity: row.rawIdentity, identities: row.identities }));
  const explicitDisconnectedLedgerRows = ledgerRows
    .filter((row) => row.explicitDisconnected)
    .map((row) => ({ file: row.file, line: row.line, rawIdentity: row.rawIdentity, identities: row.identities }));

  const connectionCounts = Object.fromEntries(sorted(new Set(declaredFields.map((field) => field.connection)))
    .map((connection) => [connection, declaredFields.filter((field) => field.connection === connection).length]));
  return {
    schemaVersion: 1,
    mode: 'informational',
    semantics: {
      exitPolicy: 'Mapped omissions and disconnected candidates never fail; invalid config, unreadable inputs, parse failures, and reporter/output errors fail.',
      declaredFields: 'Object-shaped defaultValue fields from statically recognizable settings-engine calls plus any configured direct-localStorage settings; scalar/array/dynamic defaults remain bounded leaf rows.',
      ledger: 'Markdown table identities from the configured checked-in Stage 0 setting ledgers; matching is exact, suffix, then unique leaf and is reported with confidence.',
      references: 'Identifier-presence evidence separated into Svelte presentation, non-test non-Svelte runtime, and tests; it does not prove reachability, control semantics, or that updates are applied.',
      disconnected: 'Includes ledger rows explicitly documenting no consumer/presentation and declared fields whose conservative static references lack presentation or runtime evidence.'
    },
    configuration: {
      sourceRoots: config.sourceRoots,
      ledgerFiles: config.ledgerFiles,
      directStores: config.directStores.map(({ id, persistenceFile, defaultFile, defaultName, storageKey }) => ({ id, persistenceFile, defaultFile, defaultName, storageKey }))
    },
    source: { files: files.length },
    ledger: { rows: ledgerRows.length },
    stores: stores.map(({ fields, ...store }) => ({ ...store, fields: fields.length })),
    declaredFields: { count: declaredFields.length, connectionCounts, findings: declaredFields },
    omissions: {
      declaredWithoutLedger: declaredFields.filter((field) => field.ledger.confidence === 'none').map((field) => ({ store: field.store, identity: field.identity })),
      ledgerWithoutDeclaredField
    },
    disconnected: {
      explicitLedgerRows: explicitDisconnectedLedgerRows,
      staticCandidates: declaredFields.filter((field) => field.connection.includes('without-static') || field.connection === 'no-static-presentation-or-runtime')
        .map((field) => ({ store: field.store, identity: field.identity, connection: field.connection, references: field.references }))
    }
  };
}

export function serializeSettingsReport(report) {
  return `${JSON.stringify(report, null, 2)}\n`;
}
