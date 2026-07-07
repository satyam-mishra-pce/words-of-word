import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './styles.css';

function syncVisualViewportVars(): void {
  const viewport = window.visualViewport;
  const root = document.documentElement;

  root.style.setProperty('--vv-top', `${viewport?.offsetTop ?? 0}px`);
  root.style.setProperty('--vv-height', `${viewport?.height ?? window.innerHeight}px`);
}

syncVisualViewportVars();
window.visualViewport?.addEventListener('resize', syncVisualViewportVars);
window.visualViewport?.addEventListener('scroll', syncVisualViewportVars);
window.addEventListener('resize', syncVisualViewportVars);
window.addEventListener('orientationchange', () => window.setTimeout(syncVisualViewportVars, 250));

document.addEventListener('focusin', () => window.setTimeout(syncVisualViewportVars, 50));
document.addEventListener('focusout', () => window.setTimeout(syncVisualViewportVars, 50));

ReactDOM.createRoot(document.getElementById('root') ?? document.body).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);
