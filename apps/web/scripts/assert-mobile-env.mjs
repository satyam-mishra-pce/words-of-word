import { readFile } from 'node:fs/promises';
import { loadEnv } from 'vite';

const env = { ...loadEnv('mobile', process.cwd(), ''), ...process.env };
const required = ['VITE_SOCKET_URL', 'VITE_PUBLIC_WEB_URL'];
const errors = [];
let publicWebUrl;

for (const name of required) {
  const value = env[name]?.trim();
  if (!value) {
    errors.push(`${name} is required for a Capacitor release build.`);
    continue;
  }

  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') {
      errors.push(`${name} must use https:// for an iOS/Android release build.`);
    }
    if (name === 'VITE_PUBLIC_WEB_URL') {
      if (url.pathname !== '/' || url.search || url.hash) {
        errors.push('VITE_PUBLIC_WEB_URL must be an origin with no path, query, or hash.');
      }
      publicWebUrl = url;
    }
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
