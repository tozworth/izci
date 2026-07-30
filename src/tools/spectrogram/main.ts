import '@material-symbols/font-400/outlined.css';
import { mount } from 'svelte';
import { initializeLocalization } from '$lib/i18n';
import { initializeScrollbarVisibility } from '$lib/services/scrollbar-visibility';
import { initializeTheme } from '$lib/services/theme';
import SpectrogramApp from './SpectrogramApp.svelte';
import './spectrogram.css';

initializeTheme();
initializeScrollbarVisibility();
initializeLocalization();

mount(SpectrogramApp, { target: document.getElementById('app')! });
