import { registerSW } from 'virtual:pwa-register';
import { mount } from 'svelte';
import '@material-symbols/font-400/outlined.css';
import App from './App.svelte';
import './app.css';

if (import.meta.env.PROD) {
  registerSW({ immediate: true });
}

mount(App, {
  target: document.getElementById('app')!
});
