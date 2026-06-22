import { io, Socket } from 'socket.io-client';
import { ClientToServerEvents, ServerToClientEvents } from '@wow/shared';

const configuredSocketUrl = import.meta.env.VITE_SOCKET_URL;
const socketUrl = configuredSocketUrl || window.location.origin;

const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io(socketUrl, {
  reconnection: true,
  reconnectionAttempts: 8,
  reconnectionDelay: 600,
  reconnectionDelayMax: 3000,
  timeout: 15000
});

socket.on('connect', () => {
  console.info('Connected to server', socket.id);
});

socket.on('disconnect', () => {
  console.info('Disconnected from server');
});

socket.on('connect_error', (error) => {
  console.error('Socket connection error', error.message);
});

export default socket;
