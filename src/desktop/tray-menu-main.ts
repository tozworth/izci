import '@material-symbols/font-400/outlined.css';
import { mount } from 'svelte';
import { initializeTheme } from '$lib/services/theme';
import { initializeLocalization } from '$lib/i18n';
import TrayMenu from './TrayMenu.svelte';
import './tray-menu.css';

initializeTheme(); initializeLocalization();
mount(TrayMenu, { target: document.getElementById('app')! });
