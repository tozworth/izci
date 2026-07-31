import '@material-symbols/font-400/outlined.css';
import { mount } from 'svelte';
import { initializeLocalization } from '$lib/i18n';
import { initializePopupWindowSizePersistence } from '$lib/services/popup-window-state';
import { initializeScrollbarVisibility } from '$lib/services/scrollbar-visibility';
import { initializeTheme } from '$lib/services/theme';
import '$lib/styles/options-view.css';
import TroubadourOptionsApp from './TroubadourOptionsApp.svelte';

initializeTheme();
initializeScrollbarVisibility();
initializeLocalization();
initializePopupWindowSizePersistence('troubadourOptions');

mount(TroubadourOptionsApp, { target: document.getElementById('app')! });
