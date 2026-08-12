import '@material-symbols/font-400/outlined.css';
import { mount, tick, unmount } from 'svelte';
import { startApplicationPage } from '$lib/application/page-entry';
import AudioCompareApp from './AudioCompareApp.svelte';
import './audio-compare.css';

startApplicationPage({
  pageId: 'audio-compare',
  production: import.meta.env.PROD,
  mobileDocument: false,
  popupWindow: 'audioCompare',
  orphanPolicy: 'close-with-opener',
  readyMarker: 'audio-compare-mounted',
  mount: () => {
    const app = mount(AudioCompareApp, { target: document.getElementById('app')! });
    return () => unmount(app);
  },
  ready: () => tick()
});
