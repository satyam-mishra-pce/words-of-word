import type { PluginListenerHandle, PermissionState } from '@capacitor/core';
import { Capacitor } from '@capacitor/core';
import {
  PushNotifications,
  type ActionPerformed,
  type PushNotificationSchema,
} from '@capacitor/push-notifications';
import { isNativeApp } from './platform';
import { STORAGE_KEYS, readStoredValue, writeStoredValue } from './storage';

export interface PushRegistration {
  token: string;
  platform: 'android' | 'ios';
  registeredAt: number;
}

interface NativePushCallbacks {
  onNotificationOpen: (data: unknown) => void;
  onRegistration: () => void;
}

function platformForPush(): PushRegistration['platform'] | undefined {
  const platform = Capacitor.getPlatform();
  return platform === 'android' || platform === 'ios' ? platform : undefined;
}

function savePushRegistration(token: string): void {
  const platform = platformForPush();
  if (!platform || !token.trim()) return;

  writeStoredValue(STORAGE_KEYS.pushRegistration, JSON.stringify({
    token,
    platform,
    registeredAt: Date.now()
  } satisfies PushRegistration));
}

export function getStoredPushRegistration(): PushRegistration | undefined {
  const raw = readStoredValue(STORAGE_KEYS.pushRegistration);
  if (!raw) return undefined;

  try {
    const parsed = JSON.parse(raw) as Partial<PushRegistration>;
    if (
      typeof parsed.token !== 'string' ||
      !parsed.token ||
      (parsed.platform !== 'ios' && parsed.platform !== 'android') ||
      typeof parsed.registeredAt !== 'number'
    ) {
      return undefined;
    }

    return {
      token: parsed.token,
      platform: parsed.platform,
      registeredAt: parsed.registeredAt
    };
  } catch {
    return undefined;
  }
}

async function createAndroidChannel(): Promise<void> {
  if (Capacitor.getPlatform() !== 'android') return;

  await PushNotifications.createChannel({
    id: 'game-alerts',
    name: 'Game alerts',
    description: 'Room invitations, round reminders, and game updates.',
    importance: 4,
    visibility: 1,
    vibration: true,
    lightColor: '#E2B714'
  });
}

export async function notificationPermission(): Promise<PermissionState | 'unsupported'> {
  if (!isNativeApp) return 'unsupported';
  return (await PushNotifications.checkPermissions()).receive;
}

export async function requestNativePushPermission(): Promise<PermissionState | 'unsupported'> {
  if (!isNativeApp) return 'unsupported';

  const existing = await PushNotifications.checkPermissions();
  const permission = existing.receive === 'prompt' || existing.receive === 'prompt-with-rationale'
    ? await PushNotifications.requestPermissions()
    : existing;

  if (permission.receive === 'granted') {
    await createAndroidChannel();
    await PushNotifications.register();
  }

  return permission.receive;
}

export async function installNativePushListeners(callbacks: NativePushCallbacks): Promise<() => void> {
  if (!isNativeApp) return () => undefined;

  const handles: PluginListenerHandle[] = [];
  const registration = await PushNotifications.addListener('registration', (token) => {
    savePushRegistration(token.value);
    callbacks.onRegistration();
  });
  handles.push(registration);

  const registrationError = await PushNotifications.addListener('registrationError', (error) => {
    console.warn('Push registration failed', error.error);
  });
  handles.push(registrationError);

  const notificationReceived = await PushNotifications.addListener('pushNotificationReceived', (notification: PushNotificationSchema) => {
    window.dispatchEvent(new CustomEvent('wow:push-received', { detail: notification }));
  });
  handles.push(notificationReceived);

  const notificationOpened = await PushNotifications.addListener('pushNotificationActionPerformed', (action: ActionPerformed) => {
    callbacks.onNotificationOpen(action.notification.data);
  });
  handles.push(notificationOpened);

  const currentPermission = await PushNotifications.checkPermissions();
  if (currentPermission.receive === 'granted') {
    try {
      await createAndroidChannel();
      await PushNotifications.register();
    } catch (error) {
      console.warn('Push registration refresh failed', error);
    }
  }

  return () => {
    for (const handle of handles) {
      void handle.remove();
    }
  };
}
