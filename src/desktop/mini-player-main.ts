import { initializePlatformWindow } from '$platform';
import '@material-symbols/font-400/outlined.css';
import { mount } from 'svelte';
import '../app.css';
import { initializeLocalization } from '$lib/i18n';
import { initializeTheme } from '$lib/services/theme';
import DesktopMiniPlayer from './DesktopMiniPlayer.svelte';

initializeLocalization();
initializeTheme();
mount(DesktopMiniPlayer, { target: document.getElementById('app')! });

void initializePlatformWindow().catch((error) => {
  console.error('Could not present desktop window.', error);
});
