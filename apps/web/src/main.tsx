import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { hydrateApplicationStorage } from './services/storage';
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

async function bootstrap(): Promise<void> {
  // Native Preferences is asynchronous. Hydrate it before importing pages so the
  // synchronous username/theme/session reads begin with the durable device value.
  await hydrateApplicationStorage();

  const [{ default: App }, { NativeAppBridge }] = await Promise.all([
    import('./App'),
    import('./components/NativeAppBridge')
  ]);

  ReactDOM.createRoot(document.getElementById('root') ?? document.body).render(
    <React.StrictMode>
      <BrowserRouter>
        <NativeAppBridge />
        <App />
      </BrowserRouter>
    </React.StrictMode>
  );
}

void bootstrap();
