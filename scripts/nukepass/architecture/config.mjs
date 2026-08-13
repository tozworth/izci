export const architectureConfig = Object.freeze({
  sourceRoots: ['src'],
  sourceFiles: [
    'public/raf-upward-compressor.worklet.js',
    'public/vendor/ahx-worklet.js',
    'sites-worker.js',
    'svelte.config.js',
    'vite.config.ts'
  ],
  sourceExtensions: ['.js', '.ts', '.svelte'],
  excludedPathPatterns: [
    /(?:^|\/)node_modules(?:\/|$)/,
    /(?:^|\/)(?:dist|dev-dist)(?:\/|$)/,
    /\.d\.ts$/
  ],
  aliases: {
    '$lib/': 'src/lib/'
  },
  sourceRuntimeRules: [
    {
      runtime: 'vendor',
      description: 'Checked-in third-party runtime code is measured separately from application ownership.',
      prefixes: ['public/vendor/', 'src/lib/vendor/']
    },
    {
      runtime: 'node-build',
      description: 'Root build configuration executes under Node rather than in the application browser runtime.',
      paths: ['svelte.config.js', 'vite.config.ts']
    },
    {
      runtime: 'worker',
      description: 'Worker, worklet, and Sites Worker entrypoints execute outside the browser window realm.',
      paths: ['sites-worker.js'],
      patterns: [/(?:^|\/)\w[\w.-]*\.(?:worker|worklet)\.[jt]s$/]
    }
  ],
  defaultSourceRuntime: 'browser',
  browserCapabilityRuntimes: ['browser', 'worker'],
  browserGlobals: [
    'AudioContext',
    'AudioDecoder',
    'AudioEncoder',
    'AudioWorklet',
    'AudioWorkletNode',
    'AudioWorkletProcessor',
    'Blob',
    'BroadcastChannel',
    'DOMParser',
    'EncodedAudioChunk',
    'EncodedVideoChunk',
    'EventSource',
    'File',
    'FileReader',
    'FileSystemDirectoryHandle',
    'FileSystemFileHandle',
    'IDBKeyRange',
    'Image',
    'IntersectionObserver',
    'MediaSource',
    'MediaRecorder',
    'MediaStream',
    'MediaStreamTrack',
    'MediaStreamTrackGenerator',
    'MediaStreamTrackProcessor',
    'MessageChannel',
    'MessagePort',
    'MutationObserver',
    'Notification',
    'OfflineAudioContext',
    'OffscreenCanvas',
    'PerformanceObserver',
    'RTCCertificate',
    'RTCDataChannel',
    'RTCIceCandidate',
    'RTCPeerConnection',
    'RTCSessionDescription',
    'ResizeObserver',
    'ServiceWorkerRegistration',
    'SharedWorker',
    'URL',
    'URLSearchParams',
    'VideoDecoder',
    'VideoEncoder',
    'WebSocket',
    'WebTransport',
    'WebAssembly',
    'Worker',
    'addEventListener',
    'atob',
    'btoa',
    'cancelAnimationFrame',
    'cancelIdleCallback',
    'caches',
    'clearInterval',
    'clearTimeout',
    'close',
    'createImageBitmap',
    'crypto',
    'currentFrame',
    'currentTime',
    'customElements',
    'document',
    'dispatchEvent',
    'fetch',
    'globalThis',
    'history',
    'indexedDB',
    'localStorage',
    'location',
    'matchMedia',
    'navigator',
    'open',
    'performance',
    'postMessage',
    'queueMicrotask',
    'registerProcessor',
    'removeEventListener',
    'requestAnimationFrame',
    'requestIdleCallback',
    'screen',
    'sampleRate',
    'self',
    'sessionStorage',
    'setInterval',
    'setTimeout',
    'structuredClone',
    'webkitAudioContext',
    'webkitOfflineAudioContext',
    'window'
  ],
  browserGlobalAllowedPathPatterns: [
    /^src\/lib\/runtime\/adapters\//,
    /^src\/lib\/settings\/browser\.ts$/,
    /^src\/lib\/persistence\/browser-indexed-db\.ts$/,
    /^src\/lib\/application\/page-entry\.ts$/,
    /^src\/(?:main|options\/main|tools\/[^/]+\/main)\.ts$/
  ],
  browserGlobalEnforcedPathPatterns: [
    /^src\/lib\/contracts\//,
    /^src\/lib\/logging\//,
    /^src\/lib\/runtime\/(?!adapters\/)/,
    /^src\/lib\/settings\/(?!browser\.ts$)/,
    /^src\/lib\/persistence\/(?!browser-indexed-db\.ts$)/,
    /^src\/lib\/services\/(?:multiplayer-protocol|window-orphan)\.ts$/,
    /^src\/lib\/application\/page-entry\.ts$/,
    /^src\/(?:main|options\/main|tools\/[^/]+\/main)\.ts$/
  ],
  enforceCycles: true,
  forbiddenBrowserGlobalRules: [
    {
      id: 'idb-owner-bypasses-persistence-kernel',
      description: 'IndexedDB owners must transact through the typed persistence kernel.',
      from: {
        paths: [
          'src/lib/services/artwork-cache.ts',
          'src/lib/services/backups.ts',
          'src/lib/services/filesystem-folders.ts',
          'src/lib/services/multiplayer-render-disk-cache.ts',
          'src/lib/services/playback-progress.ts',
          'src/lib/stores/playlist-persistence.ts'
        ]
      },
      globals: ['indexedDB']
    },
    {
      id: 'settings-owner-bypasses-settings-engine',
      description: 'Normalized settings owners must use the convergent settings engine for storage and synchronization.',
      from: { prefixes: ['src/lib/stores/'] },
      globals: ['localStorage', 'sessionStorage', 'BroadcastChannel']
    },
    {
      id: 'nonstore-settings-owner-bypasses-settings-engine',
      description: 'Locale and tool settings owners must use the convergent settings engine for storage and synchronization.',
      from: { paths: ['src/lib/i18n/index.ts', 'src/tools/converter/converter-settings.ts'] },
      globals: ['localStorage', 'sessionStorage', 'BroadcastChannel']
    },
    {
      id: 'backup-bypasses-settings-owner',
      description: 'Backup export and restore must call classified live owners rather than writing browser storage.',
      from: { paths: ['src/lib/services/backups.ts', 'src/lib/services/backup-registry.ts'] },
      globals: ['localStorage', 'sessionStorage']
    }
  ],
  enforcedDirectionRuleIds: [
    'contract-imports-implementation',
    'implementation-imports-page-bootstrap',
    'logging-core-imports-application',
    'runtime-imports-application',
    'settings-imports-application',
    'persistence-kernel-imports-application',
    'wire-imports-internal-module'
  ],
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
      id: 'contract-imports-implementation',
      description: 'Leaf contracts cannot depend on runtime, services, stores, or presentation implementations.',
      from: { prefixes: ['src/lib/contracts/'] },
      to: { prefixes: ['src/lib/runtime/', 'src/lib/services/', 'src/lib/stores/', 'src/lib/components/'] }
    },
    {
      id: 'logging-core-imports-application',
      description: 'The logging data/runtime/API kernel cannot depend on application domains or presentation.',
      from: {
        paths: [
          'src/lib/logging/api.ts',
          'src/lib/logging/contracts.ts',
          'src/lib/logging/details.ts',
          'src/lib/logging/runtime.ts'
        ]
      },
      to: { prefixes: ['src/lib/application/', 'src/lib/services/', 'src/lib/stores/', 'src/lib/components/'] }
    },
    {
      id: 'implementation-imports-page-bootstrap',
      description: 'The page composition root is consumed only by page entrypoints, never by domains or views.',
      from: { prefixes: ['src/lib/services/', 'src/lib/stores/', 'src/lib/components/'] },
      to: { paths: ['src/lib/application/page-entry.ts'] }
    },
    {
      id: 'runtime-imports-application',
      description: 'The runtime kernel cannot depend on application domains or presentation.',
      from: { prefixes: ['src/lib/runtime/'] },
      to: { prefixes: ['src/lib/contracts/', 'src/lib/services/', 'src/lib/stores/', 'src/lib/components/'] }
    },
    {
      id: 'settings-imports-application',
      description: 'The settings engine and adapter cannot depend on domain owners or presentation.',
      from: { prefixes: ['src/lib/settings/'] },
      to: { prefixes: ['src/lib/application/', 'src/lib/services/', 'src/lib/stores/', 'src/lib/components/'] }
    },
    {
      id: 'persistence-kernel-imports-application',
      description: 'The typed persistence kernel and browser adapter cannot depend on application domains or presentation.',
      from: { prefixes: ['src/lib/persistence/'] },
      to: { prefixes: ['src/lib/application/', 'src/lib/services/', 'src/lib/stores/', 'src/lib/components/'] }
    },
    {
      id: 'wire-imports-internal-module',
      description: 'The canonical Multiplayer wire contract is a self-contained DTO, validation, and framing leaf.',
      from: { paths: ['src/lib/services/multiplayer-protocol.ts'] },
      to: { prefixes: ['src/'] }
    }
  ],
  entrypointPatterns: [
    /^src\/main\.ts$/,
    /^src\/(?:options|tools\/[^/]+)\/main\.ts$/,
    /(?:^|\/)\w[\w.-]*\.worker\.[jt]s$/,
    /(?:^|\/)\w[\w.-]*\.worklet\.[jt]s$/,
    /^src\/lib\/vendor\/chiptune3\/chiptune3\.js$/,
    /^public\/vendor\/ahx-worklet\.js$/,
    /^sites-worker\.js$/,
    /^(?:svelte|vite)\.config\.[jt]s$/
  ],
  bundleDirectory: 'dist'
});
