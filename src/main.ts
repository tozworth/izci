import { mount } from 'svelte';
import '@material-symbols/font-400/outlined.css';
import App from './App.svelte';
import './app.css';
import { registerAppServiceWorker } from '$lib/services/pwa-updates';

if (import.meta.env.PROD) {
  registerAppServiceWorker();
}

mount(App, {
  target: document.getElementById('app')!
});
