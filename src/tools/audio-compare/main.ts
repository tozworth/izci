import '@material-symbols/font-400/outlined.css';
import { mount } from 'svelte';
import { initializeLocalization } from '$lib/i18n';
import { initializePopupWindowSizePersistence } from '$lib/services/popup-window-state';
import { initializeScrollbarVisibility } from '$lib/services/scrollbar-visibility';
import { initializeTheme } from '$lib/services/theme';
import AudioCompareApp from './AudioCompareApp.svelte';
import './audio-compare.css';

initializeTheme();
initializeScrollbarVisibility();
initializeLocalization();
initializePopupWindowSizePersistence('audioCompare');

mount(AudioCompareApp, { target: document.getElementById('app')! });
