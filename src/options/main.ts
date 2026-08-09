import '@material-symbols/font-400/outlined.css';
import { mount } from 'svelte';
import OptionsApp from './OptionsApp.svelte';
import '$lib/styles/options-view.css';
import '../mobile/mobile-options.css';
import { initializeTheme } from '$lib/services/theme';
import { initializePopupWindowSizePersistence } from '$lib/services/popup-window-state';
import { initializeScrollbarVisibility } from '$lib/services/scrollbar-visibility';
import { initializeLocalization } from '$lib/i18n';
import { registerAppServiceWorker } from '$lib/services/pwa-updates';
import { initializeMobileDocument } from '../mobile/mobile-device';
import { initLogging } from '$lib/services/logging';

if (import.meta.env.PROD) {
  registerAppServiceWorker();
}

initializeTheme();
initializeMobileDocument();
initializeScrollbarVisibility();
initializeLocalization();
initLogging();
initializePopupWindowSizePersistence('options');

mount(OptionsApp, {
  target: document.getElementById('app')!
});
