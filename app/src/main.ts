import '@fontsource/ibm-plex-sans/latin-400.css';
import '@fontsource/ibm-plex-sans/latin-500.css';
import '@fontsource/ibm-plex-sans/latin-600.css';
import '@fontsource/ibm-plex-sans/latin-700.css';
import '@fontsource/ibm-plex-sans/latin-ext-400.css';
import '@fontsource/ibm-plex-sans/latin-ext-500.css';
import '@fontsource/ibm-plex-sans/latin-ext-600.css';
import '@fontsource/ibm-plex-sans/latin-ext-700.css';
import '@fontsource/ibm-plex-mono/latin-400.css';
import '@fontsource/ibm-plex-mono/latin-500.css';
import '@fontsource/ibm-plex-mono/latin-ext-400.css';
import '@fontsource/ibm-plex-mono/latin-ext-500.css';
import './ui/styles.css';
import { createApp } from './app';
import './ui/soft.css'; // after the screens' own stylesheets: rounded panels, pills, round slider thumbs
import './ui/v1.css'; // 1.0 layout layer: Betaflight-like panels and form rows
import './ui/theme.css'; // 2.0 design layer: light/dark tokens, shell, new screens
import './ui/legacy-theme.css'; // 2.0 look for the tabs not rebuilt yet (last: wins over the legacy layers)
import { migrateLegacyStorage } from './migrate-storage';

migrateLegacyStorage(); // before anything reads settings / language

const root = document.getElementById('app');
if (!root) throw new Error('Missing #app');
createApp(root);
