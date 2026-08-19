import { useEffect, useState } from 'react';
import { Dialog } from './ui';
import {
  isAnalyticsOptedOut,
  setAnalyticsOptOut,
  isAnalyticsEnabled
} from '../services/analytics';

interface PrivacyDialogProps {
  open: boolean;
  onClose: () => void;
}

/**
 * Privacy shield modal from the home footer. Lets the user opt in/out of
 * analytics. Default is OPTED IN (product decision). Opting out stops all
 * client-side tracking for this installation immediately (pending events are
 * dropped) and stops sending the installation identity to the game server.
 */
export function PrivacyDialog({ open, onClose }: PrivacyDialogProps): JSX.Element {
  const [optedOut, setOptedOut] = useState(isAnalyticsOptedOut());
  const enabled = isAnalyticsEnabled();

  // Keep the toggle in sync with reality whenever the dialog opens.
  useEffect(() => {
    if (open) setOptedOut(isAnalyticsOptedOut());
  }, [open]);

  function toggle(value: boolean): void {
    setOptedOut(setAnalyticsOptOut(value));
  }

  return (
    <Dialog open={open} onClose={onClose} size="sm" ariaLabel="Privacy & analytics">
      <div className="settings-panel" style={{ textAlign: 'left' }}>
        <p className="eyebrow">privacy</p>
        <h2>Analytics & privacy</h2>
        <p className="muted" style={{ fontSize: '0.85rem', lineHeight: 1.6 }}>
          We collect anonymised analytics — page views, clicks, room &amp; game
          activity, words found, emotes, feature usage — to decide what to build
          next. You are <b>opted in</b> by default. You can turn this off at any
          time; we stop recording from this device immediately.
        </p>

        <label className="privacy-toggle">
          <input
            type="checkbox"
            checked={!optedOut}
            onChange={(event) => toggle(!event.target.checked)}
          />
          <span className="privacy-toggle__track">
            <span className="privacy-toggle__thumb" aria-hidden="true" />
          </span>
          <span className="privacy-toggle__label">
            {optedOut ? 'Tracking off' : 'Tracking on'}
          </span>
        </label>

        {!enabled && (
          <p className="muted" style={{ fontSize: '0.8rem', marginTop: '0.75rem' }}>
            Analytics is disabled because this build has no Supabase
            configuration.
          </p>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '1.25rem' }}>
          <button type="button" className="footer-settings" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </Dialog>
  );
}
