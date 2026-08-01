import { ImpactStyle, Haptics, NotificationType } from '@capacitor/haptics';
import { isNativeApp } from './platform';

async function onDevice(action: () => Promise<void>): Promise<void> {
  if (!isNativeApp) return;

  try {
    await action();
  } catch {
    // Haptics are progressive enhancement; game actions must never depend on them.
  }
}

export function hapticSelection(): Promise<void> {
  return onDevice(() => Haptics.selectionChanged());
}

export function hapticLight(): Promise<void> {
  return onDevice(() => Haptics.impact({ style: ImpactStyle.Light }));
}

export function hapticMedium(): Promise<void> {
  return onDevice(() => Haptics.impact({ style: ImpactStyle.Medium }));
}

export function hapticSuccess(): Promise<void> {
  return onDevice(() => Haptics.notification({ type: NotificationType.Success }));
}

export function hapticError(): Promise<void> {
  return onDevice(() => Haptics.notification({ type: NotificationType.Error }));
}

export function hapticWarning(): Promise<void> {
  return onDevice(() => Haptics.notification({ type: NotificationType.Warning }));
}
