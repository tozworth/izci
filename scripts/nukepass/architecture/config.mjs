export const architectureConfig = Object.freeze({
  sourceRoots: ['src'],
  sourceFiles: ['sites-worker.js', 'svelte.config.js', 'vite.config.ts'],
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
      prefixes: ['src/lib/vendor/']
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
    'self',
    'sessionStorage',
    'setInterval',
    'setTimeout',
    'structuredClone',
    'webkitAudioContext',
    'webkitOfflineAudioContext',
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
    /(?:^|\/)\w[\w.-]*\.worker\.[jt]s$/,
    /(?:^|\/)\w[\w.-]*\.worklet\.[jt]s$/,
    /^src\/lib\/vendor\/chiptune3\/chiptune3\.js$/,
    /^sites-worker\.js$/,
    /^(?:svelte|vite)\.config\.[jt]s$/
  ],
  bundleDirectory: 'dist'
});
