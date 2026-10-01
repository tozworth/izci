import { mount } from 'svelte';
import { initializeTheme } from '$lib/services/theme';
import TrayBubble from './TrayBubble.svelte';
import './tray-bubble.css';

initializeTheme();
mount(TrayBubble, { target: document.getElementById('app')! });
