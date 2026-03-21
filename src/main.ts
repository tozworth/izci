import { mount } from 'svelte';
import '@material-symbols/font-400/outlined.css';
import App from './App.svelte';
import './app.css';
import { initializeTheme } from '$lib/services/theme';
import { registerAppServiceWorker } from '$lib/services/pwa-updates';

if (import.meta.env.PROD) {
  registerAppServiceWorker();
}

initializeTheme();

mount(App, {
  target: document.getElementById('app')!
});
