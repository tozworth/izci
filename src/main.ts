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
import { initLogging } from '$lib/services/logging';
import './mobile/mobile.css';
import './mobile/mobile-options.css';
import './oda/oda.css';
import { initializePlatformWindow } from '$platform';
import { warmOptionsWindow } from '$lib/services/window-manager';

if (import.meta.env.PROD) {
  void registerAppServiceWorker().catch(error => console.error('Could not register service worker.', error));
}

initializeTheme();
initializeMobileDocument();
initializeScrollbarVisibility({ overlayVertical: true });
initializeLocalization();
initLogging();

mount(App, {
  target: document.getElementById('app')!
});

void initializePlatformWindow().then(warmOptionsWindow).catch((error) => {
  console.error('Could not present desktop window.', error);
});
