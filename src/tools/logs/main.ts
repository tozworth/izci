import { initializeDesktopWindow } from '$platform';
import '@material-symbols/font-400/outlined.css';
import { mount } from 'svelte';
import { initializeLocalization } from '$lib/i18n';
import { initLogging } from '$lib/services/logging';
import { initializePopupWindowSizePersistence } from '$lib/services/popup-window-state';
import { initializeScrollbarVisibility } from '$lib/services/scrollbar-visibility';
import { initializeTheme } from '$lib/services/theme';
import { registerAppServiceWorker } from '$lib/services/pwa-updates';
import LogsApp from './LogsApp.svelte';
import './logs.css';

if (import.meta.env.PROD) registerAppServiceWorker();
initializeTheme();
initializeScrollbarVisibility();
initializeLocalization();
initLogging();
initializePopupWindowSizePersistence('logs');
mount(LogsApp, { target: document.getElementById('app')! });

void initializeDesktopWindow().catch((error) => {
  console.error('Could not present desktop window.', error);
});
