import { isIP } from 'node:net';
import { readFile } from 'node:fs/promises';
import { loadEnv } from 'vite';

const env = { ...loadEnv('mobile', process.cwd(), ''), ...process.env };
const gameServerName = env.VITE_GAME_SERVER_URL?.trim() ? 'VITE_GAME_SERVER_URL' : 'VITE_SOCKET_URL';
const values = {
  [gameServerName]: env[gameServerName]?.trim(),
  VITE_PUBLIC_WEB_URL: env.VITE_PUBLIC_WEB_URL?.trim()
};
const errors = [];
let publicWebUrl;

function isPrivateIpv4(hostname) {
  const parts = hostname.split('.').map(Number);
  return parts[0] === 10
    || parts[0] === 127
    || (parts[0] === 169 && parts[1] === 254)
    || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
    || (parts[0] === 192 && parts[1] === 168)
    || (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127)
    || parts[0] === 0;
}

function isNonPublicHost(hostname) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  const ipVersion = isIP(host);
  if (ipVersion === 4) return isPrivateIpv4(host);
  if (ipVersion === 6) {
    return host === '::1' || host === '::' || host.startsWith('fc') || host.startsWith('fd') || /^fe[89ab]/.test(host);
  }
  return host === 'localhost'
    || host.endsWith('.localhost')
    || host.endsWith('.local')
    || host.endsWith('.internal')
    || host.endsWith('.home.arpa')
    || host.endsWith('.invalid')
    || host.endsWith('.test');
}

for (const [name, value] of Object.entries(values)) {
  if (!value) {
    errors.push(`${name === 'VITE_SOCKET_URL' ? 'VITE_GAME_SERVER_URL (or legacy VITE_SOCKET_URL)' : name} is required for a Capacitor release build.`);
    continue;
  }

  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') {
      errors.push(`${name} must use https:// for an iOS/Android release build.`);
    }
    if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
      errors.push(`${name} must be an origin with no credentials, path, query, or hash.`);
    }
    if (isNonPublicHost(url.hostname)) {
      errors.push(`${name} must use a public host, not localhost or a private/special-use address.`);
    }
    if (name === 'VITE_PUBLIC_WEB_URL') publicWebUrl = url;
  } catch {
    errors.push(`${name} must be a valid absolute URL.`);
  }
}

if (publicWebUrl) {
  const expectedHost = publicWebUrl.hostname;
  const [manifest, project] = await Promise.all([
    readFile('android/app/src/main/AndroidManifest.xml', 'utf8'),
    readFile('ios/App/App.xcodeproj/project.pbxproj', 'utf8')
  ]);
  const androidHosts = [...manifest.matchAll(/<data\s+android:scheme="https"\s+android:host="([^"]+)"/g)]
    .map((match) => match[1])
    .filter((host) => Boolean(host));
  const iosHosts = [...project.matchAll(/APP_LINK_HOST = "([^"]+)";/g)]
    .map((match) => match[1])
    .filter((host) => Boolean(host));

  if (androidHosts.length === 0 || androidHosts.some((host) => host !== expectedHost)) {
    errors.push(`Android App Link host must be ${expectedHost}; update android/app/src/main/AndroidManifest.xml before release.`);
  }
  if (iosHosts.length === 0 || iosHosts.some((host) => host !== expectedHost)) {
    errors.push(`iOS APP_LINK_HOST must be ${expectedHost}; update ios/App/App.xcodeproj/project.pbxproj before release.`);
  }
}

if (errors.length > 0) {
  console.error('\nMobile build configuration is incomplete:\n');
  for (const error of errors) console.error(`  • ${error}`);
  console.error('\nCopy .env.mobile.example to a private .env.mobile file or provide the values through CI.\n');
  process.exit(1);
}
