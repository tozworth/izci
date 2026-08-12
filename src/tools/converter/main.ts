import '@material-symbols/font-400/outlined.css';
import { mount, tick, unmount } from 'svelte';
import { startApplicationPage } from '$lib/application/page-entry';
import ConverterApp from './ConverterApp.svelte';
import './converter.css';

startApplicationPage({
  pageId: 'converter',
  production: import.meta.env.PROD,
  mobileDocument: false,
  popupWindow: 'converter',
  orphanPolicy: 'parent-owned',
  readyMarker: 'converter-mounted',
  mount: () => {
    const app = mount(ConverterApp, { target: document.getElementById('app')! });
    return () => unmount(app);
  },
  ready: () => tick()
});
