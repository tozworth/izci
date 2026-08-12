import '@material-symbols/font-400/outlined.css';
import { mount, tick, unmount } from 'svelte';
import { startApplicationPage } from '$lib/application/page-entry';
import TroubadourApp from './TroubadourApp.svelte';
import './troubadour.css';

startApplicationPage({
  pageId: 'troubadour',
  production: import.meta.env.PROD,
  mobileDocument: false,
  popupWindow: 'troubadour',
  orphanPolicy: 'survive-opener',
  readyMarker: 'troubadour-mounted',
  mount: () => {
    const app = mount(TroubadourApp, { target: document.getElementById('app')! });
    return () => unmount(app);
  },
  ready: () => tick()
});
