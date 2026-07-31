import '@material-symbols/font-400/outlined.css';
import { mount } from 'svelte';
import OptionsApp from './OptionsApp.svelte';
import '$lib/styles/options-view.css';
import { initializeTheme } from '$lib/services/theme';
import { initializePopupWindowSizePersistence } from '$lib/services/popup-window-state';
import { initializeScrollbarVisibility } from '$lib/services/scrollbar-visibility';
import { initializeLocalization } from '$lib/i18n';

initializeTheme();
initializeScrollbarVisibility();
initializeLocalization();
initializePopupWindowSizePersistence('options');

mount(OptionsApp, {
  target: document.getElementById('app')!
});
