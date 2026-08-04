import { mount } from 'svelte';
import '@material-symbols/font-400/outlined.css';
import App from './App.svelte';
import '$lib/styles/options-view.css';
import './app.css';
import { initializeTheme } from '$lib/services/theme';
import { initializeScrollbarVisibility } from '$lib/services/scrollbar-visibility';
import { registerAppServiceWorker } from '$lib/services/pwa-updates';
import { initializeLocalization } from '$lib/i18n';
import { initializeMobileDocument } from './mobile/mobile-device';
import './mobile/mobile.css';
import './mobile/mobile-options.css';

if (import.meta.env.PROD) {
  registerAppServiceWorker();
}

initializeTheme();
initializeMobileDocument();
initializeScrollbarVisibility({ overlayVertical: true });
initializeLocalization();

mount(App, {
  target: document.getElementById('app')!
});
