import '@material-symbols/font-400/outlined.css';
import { mount } from 'svelte';
import { initializeLocalization } from '$lib/i18n';
import { initializePopupWindowSizePersistence } from '$lib/services/popup-window-state';
import { initializeScrollbarVisibility } from '$lib/services/scrollbar-visibility';
import { initializeTheme } from '$lib/services/theme';
import ConverterApp from './ConverterApp.svelte';
import './converter.css';

initializeTheme();
initializeScrollbarVisibility();
initializeLocalization();
initializePopupWindowSizePersistence('converter');

mount(ConverterApp, {
  target: document.getElementById('app')!
});
