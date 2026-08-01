import type { CapacitorConfig } from '@capacitor/cli';
import { KeyboardResize, KeyboardStyle } from '@capacitor/keyboard';

const config: CapacitorConfig = {
  appId: 'com.wordsofword.game',
  appName: 'Words of Word',
  webDir: 'dist',
  backgroundColor: '#111111',
  loggingBehavior: 'debug',
  initialFocus: true,
  android: {
    backgroundColor: '#111111',
    allowMixedContent: false,
    webContentsDebuggingEnabled: false
  },
  ios: {
    backgroundColor: '#111111'
  },
  plugins: {
    StatusBar: {
      style: 'DARK',
      overlaysWebView: true
    },
    Keyboard: {
      resize: KeyboardResize.Body,
      style: KeyboardStyle.Dark,
      resizeOnFullScreen: true,
      autoBackdropColor: 'dom'
    },
    NavigationBar: {
      color: '#111111',
      dividerColor: '#111111',
      style: 'DARK'
    },
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'banner', 'list']
    },
    SplashScreen: {
      launchAutoHide: false,
      launchFadeOutDuration: 220,
      backgroundColor: '#111111',
      androidSplashResourceName: 'splash',
      androidScaleType: 'CENTER_CROP',
      showSpinner: false
    }
  }
};

export default config;
