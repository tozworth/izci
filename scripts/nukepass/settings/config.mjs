export const settingsReportConfig = Object.freeze({
  sourceRoots: ['src'],
  sourceExtensions: ['.js', '.ts', '.svelte'],
  excludedPathPatterns: [/\.d\.ts$/, /(?:^|\/)(?:node_modules|dist|dev-dist)(?:\/|$)/],
  ledgerFiles: [
    'docs/nukepass/stage-0/settings-ledger/experimental.md',
    'docs/nukepass/stage-0/settings-ledger/library-workspace.md',
    'docs/nukepass/stage-0/settings-ledger/main-options.md',
    'docs/nukepass/stage-0/settings-ledger/other-state.md',
    'docs/nukepass/stage-0/settings-ledger/raf.md',
    'docs/nukepass/stage-0/settings-ledger/tools.md'
  ],
  persistentStoreFactories: ['createPersistentStore', 'createSettingsStore'],
  directStores: [
    {
      id: 'converter-settings',
      persistenceFile: 'src/tools/converter/converter-settings.ts',
      defaultFile: 'src/tools/converter/converter-options.ts',
      defaultName: 'DEFAULT_CONVERTER_SETTINGS',
      storageKey: 'izci:converter-settings'
    }
  ],
  presentationPathPatterns: [/\.svelte$/],
  presentationOnlyPathPatterns: [/^src\/options\//, /^src\/tools\/troubadour-options\//],
  testPathPattern: /(?:^|\/)[^/]+\.(?:test|spec)\.[^.]+$/
});
