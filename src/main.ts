import { mount, tick, unmount } from 'svelte';
import '@material-symbols/font-400/outlined.css';
import App from './App.svelte';
import '$lib/styles/options-view.css';
import './app.css';
import { startApplicationPage } from '$lib/application/page-entry';
import { favoritesStore, libraryStore, playlistStore } from '$lib/stores/playlist';
import './mobile/mobile.css';
import './mobile/mobile-options.css';

startApplicationPage({
  pageId: 'main',
  production: import.meta.env.PROD,
  mobileDocument: true,
  scrollbar: { overlayVertical: true },
  orphanPolicy: 'survive-opener',
  readyMarker: 'main-hydrated',
  mount: () => {
    const app = mount(App, { target: document.getElementById('app')! });
    return () => unmount(app);
  },
  ready: async () => {
    await Promise.all([playlistStore.ready(), libraryStore.ready(), favoritesStore.ready()]);
    await tick();
  }
});
