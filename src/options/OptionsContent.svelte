<script lang="ts">
  import AboutView from './components/views/AboutView.svelte';
  import AppearanceView from './components/views/AppearanceView.svelte';
  import BackdropsView from './components/views/BackdropsView.svelte';
  import BackupsView from './components/views/BackupsView.svelte';
  import ExperimentalView from './components/views/ExperimentalView.svelte';
  import LyricsView from './components/views/LyricsView.svelte';
  import MetadataView from './components/views/MetadataView.svelte';
  import ModulesView from './components/views/ModulesView.svelte';
  import LoadoutsView from './components/views/LoadoutsView.svelte';
  import NowPlayingView from './components/views/NowPlayingView.svelte';
  import PlaybackView from './components/views/PlaybackView.svelte';
  import PatternsView from './components/views/PatternsView.svelte';
  import TracksView from './components/views/TracksView.svelte';
  import FoldersView from './components/views/FoldersView.svelte';
  import LicensesView from './components/views/LicensesView.svelte';
  import VisualizerView from './components/views/VisualizerView.svelte';
  import VideoView from './components/views/VideoView.svelte';
  import RafView from './components/raf/RafView.svelte';
  import type { OptionsViewName } from './views';

  export let activeView: OptionsViewName;
  export let onSelectView: (view: OptionsViewName) => void;
</script>

{#if activeView === 'appearance'}
  <AppearanceView />
{:else if activeView === 'backdrops'}
  <BackdropsView />
{:else if activeView === 'now-playing'}
  <NowPlayingView />
{:else if activeView === 'lyrics'}
  <LyricsView />
{:else if activeView === 'playback'}
  <PlaybackView />
{:else if activeView === 'video'}
  <VideoView />
{:else if activeView === 'visualizer'}
  <VisualizerView />
{:else if activeView === 'patterns'}
  <PatternsView />
{:else if activeView === 'raf'}
  <RafView />
{:else if activeView === 'modules'}
  <ModulesView />
{:else if activeView === 'loadouts'}
  <LoadoutsView />
{:else if activeView === 'tracks'}
  <TracksView />
{:else if activeView === 'folders'}
  <FoldersView />
{:else if activeView === 'metadata'}
  <MetadataView />
{:else if activeView === 'backups'}
  <BackupsView onOpenFolders={() => onSelectView('folders')} />
{:else if activeView === 'experimental'}
  <ExperimentalView />
{:else if activeView === 'about'}
  <AboutView onOpenLicenses={() => onSelectView('licenses')} />
{:else if activeView === 'licenses'}
  <LicensesView />
{/if}
