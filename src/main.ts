import { mount } from 'svelte';
import '@material-symbols/font-400/outlined.css';
import App from './App.svelte';
import './options/app.css';
import './app.css';
import { initializeTheme } from '$lib/services/theme';
import { registerAppServiceWorker } from '$lib/services/pwa-updates';
import { initializeLocalization } from '$lib/i18n';

if (import.meta.env.PROD) {
  registerAppServiceWorker();
}

initializeTheme();
initializeLocalization();

mount(App, {
  target: document.getElementById('app')!
});
