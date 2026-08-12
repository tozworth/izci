import '@material-symbols/font-400/outlined.css';
import { mount, tick, unmount } from 'svelte';
import { startApplicationPage } from '$lib/application/page-entry';
import '$lib/styles/options-view.css';
import TroubadourOptionsApp from './TroubadourOptionsApp.svelte';

startApplicationPage({
  pageId: 'troubadour-options',
  production: import.meta.env.PROD,
  mobileDocument: false,
  popupWindow: 'troubadourOptions',
  orphanPolicy: 'close-with-opener',
  readyMarker: 'troubadour-options-mounted',
  mount: () => {
    const app = mount(TroubadourOptionsApp, { target: document.getElementById('app')! });
    return () => unmount(app);
  },
  ready: () => tick()
});
