export const architectureConfig = Object.freeze({
  sourceRoots: ['src'],
  sourceExtensions: ['.ts', '.svelte'],
  excludedPathPatterns: [
    /(?:^|\/)node_modules(?:\/|$)/,
    /(?:^|\/)(?:dist|dev-dist)(?:\/|$)/,
    /\.d\.ts$/
  ],
  aliases: {
    '$lib/': 'src/lib/'
  },
  browserGlobals: [
    'AudioContext',
    'BroadcastChannel',
    'File',
    'FileReader',
    'MediaSource',
    'MutationObserver',
    'ResizeObserver',
    'SharedWorker',
    'URL',
    'Worker',
    'cancelAnimationFrame',
    'caches',
    'crypto',
    'document',
    'fetch',
    'indexedDB',
    'localStorage',
    'matchMedia',
    'navigator',
    'performance',
    'requestAnimationFrame',
    'screen',
    'sessionStorage',
    'webkitAudioContext',
    'window'
  ],
  // Stage 1 deliberately starts with no browser-capability adapter allowlist.
  // Later stages can add narrowly owned adapter paths as they are reconstructed.
  browserGlobalAllowedPathPatterns: [],
  directionRules: [
    {
      id: 'presentation-bypasses-application',
      description: 'Svelte views currently reach directly into service or store implementations.',
      from: { extension: '.svelte' },
      to: { prefixes: ['src/lib/services/', 'src/lib/stores/'] }
    },
    {
      id: 'domain-imports-presentation',
      description: 'Services and stores must not depend on Svelte presentation modules.',
      from: { prefixes: ['src/lib/services/', 'src/lib/stores/'] },
      to: { extension: '.svelte' }
    },
    {
      id: 'store-imports-service',
      description: 'Persisted/domain stores currently call service implementations in the reverse direction.',
      from: { prefixes: ['src/lib/stores/'] },
      to: { prefixes: ['src/lib/services/'] }
    },
    {
      id: 'wire-imports-application-types',
      description: 'The Multiplayer wire contract currently depends on the application-wide type bucket.',
      from: { paths: ['src/lib/services/multiplayer-protocol.ts'] },
      to: { paths: ['src/lib/types.ts'] }
    }
  ],
  entrypointPatterns: [
    /^src\/main\.ts$/,
    /^src\/(?:options|tools\/[^/]+)\/main\.ts$/,
    /(?:^|\/)\w[\w.-]*\.worker\.ts$/,
    /(?:^|\/)\w[\w.-]*\.worklet\.ts$/
  ],
  bundleDirectory: 'dist'
});
