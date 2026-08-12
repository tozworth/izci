import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { analyzeSettings, serializeSettingsReport } from './analyze.mjs';
import { settingsReportConfig } from './config.mjs';

async function fixture(files) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'izci-settings-report-'));
  await Promise.all(Object.entries(files).map(async ([file, source]) => {
    const target = path.join(root, file);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, source, 'utf8');
  }));
  return root;
}

const fixtureConfig = {
  ...settingsReportConfig,
  sourceRoots: ['src'],
  ledgerFiles: ['docs/ledger.md'],
  directStores: []
};

test('compares nested defaults, ledger identities, and presentation/runtime evidence', async (t) => {
  const root = await fixture({
    'docs/ledger.md': [
      '| Identity | Runtime | Disposition |',
      '| --- | --- | --- |',
      '| `enabled` | engine | Preserve |',
      '| `nested.amount` | no runtime consumer | Repair |',
      '| `ledgerOnly` | runtime | Preserve |',
      ''
    ].join('\n'),
    'src/store.ts': [
      'const DEFAULT_NESTED = { amount: 2 };',
      'export const DEFAULT_SETTINGS = { enabled: true, nested: DEFAULT_NESTED, orphan: false };',
      'const store = createPersistentStore({ storageKey: "test", channelName: "test-channel", defaultValue: DEFAULT_SETTINGS });',
      'void store;',
      ''
    ].join('\n'),
    'src/options/Options.svelte': '<script>let enabled; let amount; void enabled; void amount;</script>\n',
    'src/runtime.ts': 'export function apply(enabled) { return enabled; }\n',
    'src/store.test.ts': 'const orphan = true; void orphan;\n'
  });
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  const report = await analyzeSettings({ root, config: fixtureConfig });
  assert.equal(report.mode, 'informational');
  assert.equal(report.declaredFields.count, 3);
  const enabled = report.declaredFields.findings.find((field) => field.identity === 'enabled');
  assert.equal(enabled.connection, 'statically-connected');
  assert.equal(enabled.ledger.confidence, 'exact');
  const amount = report.declaredFields.findings.find((field) => field.identity === 'nested.amount');
  assert.equal(amount.connection, 'presentation-without-static-runtime');
  assert.equal(amount.defaultSource, '2');
  const orphan = report.declaredFields.findings.find((field) => field.identity === 'orphan');
  assert.equal(orphan.ledger.status, 'missing');
  assert.equal(orphan.connection, 'no-static-presentation-or-runtime');
  assert.deepEqual(orphan.references.tests, ['src/store.test.ts']);
  assert.deepEqual(report.omissions.ledgerWithoutDeclaredField.map((row) => row.rawIdentity), ['`ledgerOnly`']);
  assert.deepEqual(report.disconnected.explicitLedgerRows.map((row) => row.rawIdentity), ['`nested.amount`']);
});

test('includes configured direct-localStorage tool settings', async (t) => {
  const root = await fixture({
    'docs/ledger.md': '| Identity | Runtime |\n| --- | --- |\n| `format` | engine |\n',
    'src/tool/options.ts': 'export const DEFAULT_TOOL = { format: "flac", parallelism: 2 };\n',
    'src/tool/settings.ts': 'localStorage.setItem("tool", "{}");\n',
    'src/tool/Tool.svelte': '<script>let format; let parallelism;</script>\n',
    'src/tool/engine.ts': 'export const consume = (format) => format;\n'
  });
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const config = {
    ...fixtureConfig,
    directStores: [{
      id: 'tool',
      persistenceFile: 'src/tool/settings.ts',
      defaultFile: 'src/tool/options.ts',
      defaultName: 'DEFAULT_TOOL',
      storageKey: 'tool'
    }]
  };
  const report = await analyzeSettings({ root, config });
  assert.equal(report.stores[0].factory, 'direct-localStorage');
  assert.deepEqual(report.declaredFields.findings.map((field) => field.identity), ['format', 'parallelism']);
});

test('serialization is deterministic and findings remain informational', async (t) => {
  const root = await fixture({
    'docs/ledger.md': '| Identity | Runtime |\n| --- | --- |\n| `missing` | none |\n',
    'src/store.ts': 'createPersistentStore({ storageKey: "x", channelName: "x", defaultValue: { extra: true } });\n'
  });
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const first = await analyzeSettings({ root, config: fixtureConfig });
  const second = await analyzeSettings({ root, config: fixtureConfig });
  assert.equal(serializeSettingsReport(first), serializeSettingsReport(second));
  assert.equal(first.omissions.declaredWithoutLedger.length, 1);
  assert.equal(first.omissions.ledgerWithoutDeclaredField.length, 1);
});

test('invalid config, missing ledgers, and parse failures are reporter errors', async (t) => {
  await assert.rejects(() => analyzeSettings({ config: { ...fixtureConfig, sourceRoots: [] } }), /source roots/);
  const root = await fixture({ 'src/broken.ts': 'const = ;\n' });
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await assert.rejects(() => analyzeSettings({ root, config: fixtureConfig }), /Could not parse/);
});
