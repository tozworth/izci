import '@material-symbols/font-400/outlined.css';
import { mount, tick, unmount } from 'svelte';
import { startApplicationPage } from '$lib/application/page-entry';
import LogsApp from './LogsApp.svelte';
import './logs.css';

startApplicationPage({
  pageId: 'logs',
  production: import.meta.env.PROD,
  mobileDocument: false,
  popupWindow: 'logs',
  orphanPolicy: 'parent-owned',
  readyMarker: 'logs-mounted',
  mount: () => {
    const app = mount(LogsApp, { target: document.getElementById('app')! });
    return () => unmount(app);
  },
  ready: () => tick()
});
