import { io, Socket } from 'socket.io-client';
import { ClientToServerEvents, ServerToClientEvents } from '@wow/shared';
import { getInstallationId } from './identity';
import { getAnalyticsIdentity } from './analyticsIdentity';
import { getGameServerUrl, isNativeApp } from './platform';
import { getStoredPushRegistration } from './nativePush';

const socketUrl = getGameServerUrl();
const clientId = isNativeApp ? getInstallationId() : undefined;
const analyticsIdentity = getAnalyticsIdentity();
let appIsActive = true;

const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io(socketUrl, {
  auth: {
    // Lets the server use compact live-score patches while keeping its legacy
    // full-snapshot event shape for older installed/mobile clients.
    scoreUpdateProtocol: 2,
    ...(clientId ? { clientId } : {}),
    ...(analyticsIdentity ? { analytics: analyticsIdentity } : {})
  },
  reconnection: true,
  // Keep retrying after transport failures. The previous cap of eight attempts
  // left a player permanently disconnected until they reloaded the app.
  reconnectionAttempts: Infinity,
  reconnectionDelay: 600,
  reconnectionDelayMax: 3000,
  timeout: 15000
});

export function syncPushRegistration(): void {
  if (!isNativeApp) return;
  const registration = getStoredPushRegistration();
  if (!socket.connected || !registration) return;

  socket.emit('registerPushToken', {
    token: registration.token,
    platform: registration.platform
  });
}

export function setGameAppActivity(isActive: boolean): void {
  appIsActive = isActive;
  if (isNativeApp && socket.connected) socket.emit('setAppActivity', { isActive });
}

/** Re-open a suspended WebSocket when the native app becomes active again. */
export function resumeGameConnection(): void {
  if (!socket.connected) socket.connect();
}

socket.on('connect', () => {
  console.info('Connected to server', socket.id);
  if (isNativeApp) socket.emit('setAppActivity', { isActive: appIsActive });
  syncPushRegistration();
});

socket.on('disconnect', () => {
  console.info('Disconnected from server');
});

socket.on('connect_error', (error) => {
  console.error('Socket connection error', error.message);
});

export default socket;
