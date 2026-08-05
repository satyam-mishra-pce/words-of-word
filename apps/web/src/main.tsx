import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { hydrateApplicationStorage } from './services/storage';
import './styles.css';

let visualViewportSyncFrame: number | undefined;

function syncVisualViewportVars(): void {
  const viewport = window.visualViewport;
  const root = document.documentElement;
  const height = Math.round(viewport?.height || window.innerHeight);
  const top = Math.round(viewport?.offsetTop ?? 0);
  const left = Math.round(viewport?.offsetLeft ?? 0);

  root.style.setProperty('--vv-top', `${top}px`);
  root.style.setProperty('--vv-left', `${left}px`);
  root.style.setProperty('--vv-height', `${height}px`);
}

function scheduleVisualViewportSync(): void {
  if (visualViewportSyncFrame !== undefined) return;

  visualViewportSyncFrame = window.requestAnimationFrame(() => {
    visualViewportSyncFrame = undefined;
    syncVisualViewportVars();
  });
}

syncVisualViewportVars();
window.visualViewport?.addEventListener('resize', scheduleVisualViewportSync);
window.visualViewport?.addEventListener('scroll', scheduleVisualViewportSync);
window.addEventListener('resize', scheduleVisualViewportSync);
window.addEventListener('orientationchange', () => window.setTimeout(scheduleVisualViewportSync, 250));

// WebKit reports several intermediate dimensions while its software keyboard
// animates. Sync on the next frame and once more after that animation settles.
document.addEventListener('focusin', () => {
  scheduleVisualViewportSync();
  window.setTimeout(scheduleVisualViewportSync, 120);
  window.setTimeout(scheduleVisualViewportSync, 360);
});
document.addEventListener('focusout', () => {
  scheduleVisualViewportSync();
  window.setTimeout(scheduleVisualViewportSync, 120);
});

function isAnalyticsAdminPath(): boolean {
  return window.location.pathname.replace(/\/+$/, '') === '/admin/analytics';
}

async function bootstrap(): Promise<void> {
  const root = ReactDOM.createRoot(document.getElementById('root') ?? document.body);

  // Keep the private admin view isolated from the play app: it should not create
  // a game socket, emit player analytics, or load native game integrations.
  if (isAnalyticsAdminPath()) {
    const { default: AnalyticsPage } = await import('./pages/AnalyticsPage');
    root.render(
      <React.StrictMode>
        <AnalyticsPage />
      </React.StrictMode>
    );
    return;
  }

  // Native Preferences is asynchronous. Hydrate it before importing pages so the
  // synchronous username/theme/session reads begin with the durable device value.
  await hydrateApplicationStorage();

  const [{ default: App }, { NativeAppBridge }] = await Promise.all([
    import('./App'),
    import('./components/NativeAppBridge')
  ]);

  root.render(
    <React.StrictMode>
      <BrowserRouter>
        <NativeAppBridge />
        <App />
      </BrowserRouter>
    </React.StrictMode>
  );
}

void bootstrap();
