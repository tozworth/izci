import '@material-symbols/font-400/outlined.css';
import { mount, tick, unmount } from 'svelte';
import { startApplicationPage } from '$lib/application/page-entry';
import EditorApp from './EditorApp.svelte';
import './editor.css';

startApplicationPage({
  pageId: 'editor',
  production: import.meta.env.PROD,
  mobileDocument: false,
  popupWindow: 'editor',
  orphanPolicy: 'close-with-opener',
  readyMarker: 'editor-mounted',
  mount: () => {
    const app = mount(EditorApp, { target: document.getElementById('app')! });
    return () => unmount(app);
  },
  ready: () => tick()
});
