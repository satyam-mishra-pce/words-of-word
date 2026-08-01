import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { App } from '@capacitor/app';
import type { PluginListenerHandle } from '@capacitor/core';
import { Keyboard, KeyboardResize, KeyboardStyle } from '@capacitor/keyboard';
import { NavigationBar, Style as NavigationBarStyle } from '@capawesome/capacitor-navigation-bar';
import { StatusBar, Style as StatusBarStyle } from '@capacitor/status-bar';
import { SplashScreen } from '@capacitor/splash-screen';
import { installNativePushListeners } from '../services/nativePush';
import { isNativeApp, nativePlatform, routeFromExternalUrl } from '../services/platform';
import { resumeGameConnection, setGameAppActivity, syncPushRegistration } from '../services/socket';

type Navigate = ReturnType<typeof useNavigate>;

function isLightTheme(): boolean {
  return document.documentElement.getAttribute('data-theme') === 'light';
}

async function configureSystemBars(): Promise<void> {
  if (!isNativeApp) return;

  const lightTheme = isLightTheme();
  const backgroundColor = lightTheme ? '#FFF3E4' : '#111111';

  try {
    await StatusBar.setOverlaysWebView({ overlay: true });
    await StatusBar.setStyle({ style: lightTheme ? StatusBarStyle.Light : StatusBarStyle.Dark });
    // On Android 15+ the browser surface supplies the background under an edge-to-edge bar.
    await StatusBar.setBackgroundColor({ color: backgroundColor });
  } catch {
    // Platform versions differ in which edge-to-edge controls are available.
  }

  if (nativePlatform === 'android') {
    try {
      await NavigationBar.setColor({ color: backgroundColor, dividerColor: backgroundColor });
      await NavigationBar.setStyle({ style: lightTheme ? NavigationBarStyle.Light : NavigationBarStyle.Dark });
    } catch {
      // The web surface and CSS safe-area padding remain the primary Android 15 strategy.
    }
  }

  if (nativePlatform === 'ios') {
    try {
      await Keyboard.setResizeMode({ mode: KeyboardResize.Body });
      await Keyboard.setStyle({ style: lightTheme ? KeyboardStyle.Light : KeyboardStyle.Dark });
    } catch {
      // Keyboard plugin controls are iOS-only and remain progressive enhancement.
    }
  }
}

function navigateExternalUrl(navigate: Navigate, url: string): void {
  const path = routeFromExternalUrl(url);
  if (path) navigate(path);
}

function navigateFromNotification(navigate: Navigate, data: unknown): void {
  if (!data || typeof data !== 'object') return;

  const payload = data as Record<string, unknown>;
  const url = typeof payload.url === 'string'
    ? payload.url
    : typeof payload.roomId === 'string'
      ? `wordsofword://join/${payload.roomId}`
      : undefined;

  if (url) navigateExternalUrl(navigate, url);
}

/**
 * Owns Capacitor-only behavior in one place so game screens retain browser
 * fallbacks and future Swift/Kotlin plugins have a single integration seam.
 */
export function NativeAppBridge(): null {
  const navigate = useNavigate();

  useEffect(() => {
    if (!isNativeApp) return;

    document.documentElement.dataset.nativeApp = 'true';
    document.body.classList.add('native-app');

    let disposed = false;
    const listenerHandles: PluginListenerHandle[] = [];
    let removePushListeners: (() => void) | undefined;

    function addListener(promise: Promise<PluginListenerHandle>): void {
      void promise
        .then((handle) => {
          if (disposed) {
            void handle.remove();
          } else {
            listenerHandles.push(handle);
          }
        })
        .catch((error: unknown) => console.warn('Native listener setup failed', error));
    }

    function onThemeChange(): void {
      void configureSystemBars();
    }

    document.addEventListener('wow:theme-change', onThemeChange);
    void configureSystemBars();

    // Keep the branded launch surface visible until React has a rendered frame.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        void SplashScreen.hide({ fadeOutDuration: 220 }).catch(() => {
          // The app remains usable even if a platform does not expose the splash plugin.
        });
      });
    });

    addListener(App.addListener('appUrlOpen', ({ url }) => navigateExternalUrl(navigate, url)));
    addListener(App.addListener('appStateChange', ({ isActive }) => {
      document.documentElement.dataset.appState = isActive ? 'active' : 'inactive';
      setGameAppActivity(isActive);
      if (isActive) resumeGameConnection();
    }));
    addListener(Keyboard.addListener('keyboardWillShow', () => {
      document.documentElement.dataset.keyboardOpen = 'true';
    }));
    addListener(Keyboard.addListener('keyboardWillHide', () => {
      delete document.documentElement.dataset.keyboardOpen;
    }));

    void App.getLaunchUrl()
      .then((launchUrl) => {
        if (!disposed && launchUrl?.url) navigateExternalUrl(navigate, launchUrl.url);
      })
      .catch((error: unknown) => console.warn('Launch URL lookup failed', error));

    void installNativePushListeners({
      onRegistration: syncPushRegistration,
      onNotificationOpen: (data) => navigateFromNotification(navigate, data)
    }).then((cleanup) => {
      if (disposed) {
        cleanup();
      } else {
        removePushListeners = cleanup;
      }
    }).catch((error: unknown) => console.warn('Push listener setup failed', error));

    return () => {
      disposed = true;
      document.removeEventListener('wow:theme-change', onThemeChange);
      document.body.classList.remove('native-app');
      delete document.documentElement.dataset.nativeApp;
      delete document.documentElement.dataset.appState;
      delete document.documentElement.dataset.keyboardOpen;
      removePushListeners?.();
      for (const handle of listenerHandles) {
        void handle.remove();
      }
    };
  }, [navigate]);

  return null;
}
