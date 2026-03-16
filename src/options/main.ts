import '@material-symbols/font-400/outlined.css';
import { mount } from 'svelte';
import OptionsApp from './OptionsApp.svelte';
import './app.css';

mount(OptionsApp, {
  target: document.getElementById('app')!
});
