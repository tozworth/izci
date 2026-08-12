import '@material-symbols/font-400/outlined.css';
import { mount, tick, unmount } from 'svelte';
import OptionsApp from './OptionsApp.svelte';
import '$lib/styles/options-view.css';
import '../mobile/mobile-options.css';
import { startApplicationPage } from '$lib/application/page-entry';

startApplicationPage({
  pageId: 'options',
  production: import.meta.env.PROD,
  mobileDocument: true,
  popupWindow: 'options',
  orphanPolicy: 'close-with-opener',
  readyMarker: 'options-mounted',
  mount: () => {
    const app = mount(OptionsApp, { target: document.getElementById('app')! });
    return () => unmount(app);
  },
  ready: () => tick()
});
