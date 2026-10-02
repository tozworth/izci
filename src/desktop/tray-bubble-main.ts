import '@material-symbols/font-400/outlined.css';
import { mount } from 'svelte';
import { initializeLocalization } from '$lib/i18n';
import { initializeTheme } from '$lib/services/theme';
import TrayBubble from './TrayBubble.svelte';
import './tray-bubble.css';

initializeTheme(); initializeLocalization();
mount(TrayBubble, { target: document.getElementById('app')! });
