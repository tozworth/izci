import '@material-symbols/font-400/outlined.css';
import { mount } from 'svelte';
import { initializeLocalization } from '$lib/i18n';
import { initializeScrollbarVisibility } from '$lib/services/scrollbar-visibility';
import { initializeTheme } from '$lib/services/theme';
import ClipTagApp from './ClipTagApp.svelte';
import './clip-tag.css';

initializeTheme();
initializeScrollbarVisibility();
initializeLocalization();

mount(ClipTagApp, {
  target: document.getElementById('app')!
});
