import { Share } from '@capacitor/share';
import { isNativeApp } from './platform';

export type ShareMethod = 'native' | 'web' | 'clipboard' | 'unavailable';

interface ShareContent {
  title: string;
  text: string;
  url: string;
  dialogTitle?: string;
}

interface ShareRoomInviteOptions {
  roomId: string;
  url: string;
}

async function copyToClipboard(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    return false;
  }
}

export async function shareContent({ title, text, url, dialogTitle }: ShareContent): Promise<ShareMethod> {
  if (isNativeApp) {
    try {
      const { value: canShare } = await Share.canShare();
      if (canShare) {
        await Share.share({ title, text, url, ...(dialogTitle ? { dialogTitle } : {}) });
        return 'native';
      }
    } catch {
      // Fall through to the browser and clipboard paths below.
    }
  }

  if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
    try {
      await navigator.share({ title, text, url });
      return 'web';
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return 'unavailable';
    }
  }

  return (await copyToClipboard(`${text} ${url}`.trim())) ? 'clipboard' : 'unavailable';
}

export function shareRoomInvite({ roomId, url }: ShareRoomInviteOptions): Promise<ShareMethod> {
  return shareContent({
    title: 'Join my Words of Word room',
    text: `Join my Words of Word room ${roomId}.`,
    url,
    dialogTitle: 'Invite players'
  });
}
