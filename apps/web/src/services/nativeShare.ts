import { Share } from '@capacitor/share';
import { isNativeApp } from './platform';

export type ShareMethod = 'native' | 'web' | 'clipboard' | 'unavailable';

interface ShareContent {
  title: string;
  text: string;
  url: string;
  dialogTitle?: string;
}

export async function copyTextToClipboard(value: string): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch {
      // Fall through to the legacy browser path below.
    }
  }

  if (typeof document === 'undefined' || !document.body) return false;

  const textarea = document.createElement('textarea');
  textarea.value = value;
  textarea.setAttribute('readonly', '');
  textarea.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none;';
  document.body.append(textarea);
  textarea.select();

  try {
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    textarea.remove();
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

  return (await copyTextToClipboard(`${text} ${url}`.trim())) ? 'clipboard' : 'unavailable';
}
