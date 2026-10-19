import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { mirrorRole } from './host/buzzHost';
import brandLogo from '@brand/logo.png?url';
import './design/global.css';
import './i18n';

const favicon = document.createElement('link');
favicon.rel = 'icon';
favicon.type = 'image/png';
favicon.href = brandLogo;
document.head.appendChild(favicon);

const splashMark = document.querySelector('#cth-splash .mk');
if (splashMark) {
  const img = document.createElement('img');
  img.src = brandLogo;
  img.alt = 'Munder Difflin';
  img.style.cssText = 'height:56px;width:auto;display:block';
  splashMark.replaceWith(img);
}

const root = document.getElementById('root');
if (!root) throw new Error('No root element');

// Kenn's Harness's background frame draws only the floor (host/MirrorFloor);
// everything else runs the full Office.
const Root = mirrorRole
  ? (await import('./host/MirrorFloor')).MirrorFloor
  : (await import('./App')).App;

createRoot(root).render(
  <StrictMode>
    <Root />
  </StrictMode>
);
