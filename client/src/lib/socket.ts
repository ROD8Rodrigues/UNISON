import { io, type Socket } from 'socket.io-client';
import { getAccessToken } from './api';

let socket: Socket | null = null;

export function connectSocket(): Socket {
  if (socket?.connected) return socket;
  if (socket) {
    socket.auth = { token: getAccessToken() };
    socket.connect();
    return socket;
  }
  socket = io({
    auth: { token: getAccessToken() },
    autoConnect: true,
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 800,
    reconnectionDelayMax: 5000,
    timeout: 10000,
  });
  return socket;
}

export function updateSocketToken(token: string) {
  if (!socket) return;
  socket.auth = { token };
  if (!socket.connected) socket.connect();
}

export function getSocket(): Socket | null {
  return socket;
}

export function disconnectSocket() {
  if (!socket) return;
  socket.removeAllListeners();
  socket.disconnect();
  socket = null;
}

export function emitWithAck<T = unknown>(event: string, payload: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    const active = socket;
    if (!active) return reject(new Error('Socket is not connected'));
    const timeout = window.setTimeout(() => reject(new Error('A operação demorou demais')), 12000);
    active.emit(event, payload, (response: T & { error?: { code: string; message: string } }) => {
      window.clearTimeout(timeout);
      if (response && typeof response === 'object' && response.error) {
        reject(new Error(response.error.message));
      } else {
        resolve(response);
      }
    });
  });
}
