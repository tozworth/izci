import '@material-symbols/font-400/outlined.css';
import { mount } from 'svelte';
import { initializeLocalization } from '$lib/i18n';
import { initializeScrollbarVisibility } from '$lib/services/scrollbar-visibility';
import { initializeTheme } from '$lib/services/theme';
import TroubadourApp from './TroubadourApp.svelte';
import './troubadour.css';

initializeTheme();
initializeScrollbarVisibility();
initializeLocalization();

mount(TroubadourApp, { target: document.getElementById('app')! });
