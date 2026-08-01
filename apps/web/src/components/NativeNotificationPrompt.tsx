import { useEffect, useState } from 'react';
import type { PermissionState } from '@capacitor/core';
import { hapticSuccess } from '../services/nativeFeedback';
import { notificationPermission, requestNativePushPermission } from '../services/nativePush';
import { isNativeApp } from '../services/platform';

type NotificationState = PermissionState | 'unsupported' | 'checking';

export function NativeNotificationPrompt(): JSX.Element | null {
  const [status, setStatus] = useState<NotificationState>('checking');
  const [isRequesting, setIsRequesting] = useState(false);

  useEffect(() => {
    if (!isNativeApp) return;

    let cancelled = false;
    void notificationPermission()
      .then((nextStatus) => {
        if (!cancelled) setStatus(nextStatus);
      })
      .catch(() => {
        if (!cancelled) setStatus('unsupported');
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (!isNativeApp || status === 'checking' || status === 'unsupported' || status === 'granted') return null;

  async function enableAlerts(): Promise<void> {
    setIsRequesting(true);
    try {
      const nextStatus = await requestNativePushPermission();
      setStatus(nextStatus);
      if (nextStatus === 'granted') void hapticSuccess();
    } finally {
      setIsRequesting(false);
    }
  }

  const denied = status === 'denied';

  return (
    <aside className="native-notification-prompt" aria-live="polite">
      <div>
        <span className="native-notification-prompt__eyebrow">Game alerts</span>
        <strong>{denied ? 'Alerts are off' : 'Never miss the next round'}</strong>
        <p>{denied ? 'Enable notifications in your device settings to receive round reminders.' : 'Get round reminders when a room you are in becomes active.'}</p>
      </div>
      {!denied && (
        <button type="button" onClick={() => void enableAlerts()} disabled={isRequesting}>
          {isRequesting ? 'Enabling…' : 'Enable'}
        </button>
      )}
    </aside>
  );
}
