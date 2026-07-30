import '@material-symbols/font-400/outlined.css';
import { mount } from 'svelte';
import { initializeLocalization } from '$lib/i18n';
import { initializeScrollbarVisibility } from '$lib/services/scrollbar-visibility';
import { initializeTheme } from '$lib/services/theme';
import LoudnessApp from './LoudnessApp.svelte';
import './loudness.css';

initializeTheme();
initializeScrollbarVisibility();
initializeLocalization();

mount(LoudnessApp, { target: document.getElementById('app')! });
