import { useState } from 'react';
import { declineHotjarConsent, grantHotjarConsent, shouldAskForHotjarConsent } from '../services/hotjar';
import { Button } from './ui';

/** A one-time, explicit gate before the optional Hotjar SDK can load. */
export function HotjarConsentPrompt(): JSX.Element | null {
  const [isOpen, setIsOpen] = useState(() => shouldAskForHotjarConsent());

  if (!isOpen) return null;

  function decline(): void {
    declineHotjarConsent();
    setIsOpen(false);
  }

  function accept(): void {
    grantHotjarConsent();
    setIsOpen(false);
  }

  return (
    <aside className="analytics-consent" data-hj-suppress role="dialog" aria-modal="false" aria-labelledby="analytics-consent-title">
      <div>
        <p className="eyebrow">Your call</p>
        <h2 id="analytics-consent-title">Help improve W.o.W</h2>
        <p>Allow anonymous product analytics and session replay. Player names, room codes, and words stay masked.</p>
      </div>
      <div className="analytics-consent__actions">
        <Button variant="ghost" size="sm" type="button" onClick={decline}>Not now</Button>
        <Button variant="primary" size="sm" type="button" onClick={accept}>Allow analytics</Button>
      </div>
    </aside>
  );
}
