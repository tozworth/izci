import type { OptionsViewName } from './views';

// Keep each page behind its own import boundary for desktop, mobile, and Oda.
// Workbox precaches all emitted chunks, including pages not visited yet.
const OPTIONS_VIEW_LOADERS = {
  appearance: () => import('./components/views/AppearanceView.svelte'),
  backdrops: () => import('./components/views/BackdropsView.svelte'),
  'now-playing': () => import('./components/views/NowPlayingView.svelte'),
  lyrics: () => import('./components/views/LyricsView.svelte'),
  playback: () => import('./components/views/PlaybackView.svelte'),
  oda: () => import('./components/views/OdaView.svelte'),
  video: () => import('./components/views/VideoView.svelte'),
  visualizer: () => import('./components/views/VisualizerView.svelte'),
  patterns: () => import('./components/views/PatternsView.svelte'),
  raf: () => import('./components/raf/RafView.svelte'),
  modules: () => import('./components/views/ModulesView.svelte'),
  loadouts: () => import('./components/views/LoadoutsView.svelte'),
  tracks: () => import('./components/views/TracksView.svelte'),
  folders: () => import('./components/views/FoldersView.svelte'),
  metadata: () => import('./components/views/MetadataView.svelte'),
  backups: () => import('./components/views/BackupsView.svelte'),
  multiplayer: () => import('./components/views/MultiplayerView.svelte'),
  hosting: () => import('./components/views/HostingView.svelte'),
  experimental: () => import('./components/views/ExperimentalView.svelte'),
  cache: () => import('./components/views/CacheView.svelte'),
  about: () => import('./components/views/AboutView.svelte'),
  licenses: () => import('./components/views/LicensesView.svelte')
} satisfies Record<OptionsViewName, () => Promise<unknown>>;

export async function loadOptionsView(view: OptionsViewName, mobile = false) {
  if (view === 'raf' && mobile) {
    return { kind: 'standard' as const, ...await import('../mobile/raf/MobileRafView.svelte') };
  }
  if (view === 'about') {
    return { kind: 'about' as const, ...await OPTIONS_VIEW_LOADERS.about() };
  }
  if (view === 'backups') {
    return { kind: 'backups' as const, ...await OPTIONS_VIEW_LOADERS.backups() };
  }
  return { kind: 'standard' as const, ...await OPTIONS_VIEW_LOADERS[view]() };
}
