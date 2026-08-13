import { mount, tick, unmount } from 'svelte';
import '@material-symbols/font-400/outlined.css';
import '$lib/styles/options-view.css';
import './app.css';
import { startApplicationPage } from '$lib/application/page-entry';
import { startMainBackupOwner } from '$lib/services/browser-backup-owner';
import './mobile/mobile.css';
import './mobile/mobile-options.css';

const backupOwner = startMainBackupOwner();
const mainModules = backupOwner.ready.then(async (acquired) => {
  if (!acquired) throw new Error('main-backup-owner-unavailable');
  const [app, collections, catalogMetadata, folderScanner, mediaSource] = await Promise.all([
    import('./App.svelte'),
    import('$lib/stores/playlist'),
    import('$lib/collections/catalog-metadata'),
    import('$lib/services/library-folder-scanner'),
    import('$lib/media/media-source')
  ]);
  return { app, collections, catalogMetadata, folderScanner, mediaSource };
});

startApplicationPage({
  pageId: 'main',
  production: import.meta.env.PROD,
  mobileDocument: true,
  scrollbar: { overlayVertical: true },
  orphanPolicy: 'survive-opener',
  readyMarker: 'main-hydrated',
  mount: async () => {
    const modules = await mainModules;
    const app = mount(modules.app.default, { target: document.getElementById('app')! });
    return () => unmount(app);
  },
  ready: async () => {
    const { collections } = await mainModules;
    await Promise.all([
      collections.playlistStore.ready(),
      collections.libraryStore.ready(),
      collections.favoritesStore.ready()
    ]);
    await tick();
  },
  shutdown: async () => {
    await backupOwner.stop();
    const { catalogMetadata, folderScanner } = await mainModules;
    await Promise.all([
      catalogMetadata.disposePlaylistMetadata(),
      folderScanner.disposeLibraryFolderScanner()
    ]);
  },
  afterPersistence: async () => {
    await backupOwner.dispose();
    const { mediaSource } = await mainModules;
    mediaSource.mediaSources.clear();
  }
});
