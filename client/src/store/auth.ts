import { create } from 'zustand';
import { api, bootstrapSession, setAccessToken, setAuthLostListener, setSessionListener } from '../lib/api';
import { disconnectSocket, updateSocketToken } from '../lib/socket';
import type { User, UserSettings } from '../lib/types';

type AuthStatus = 'booting' | 'guest' | 'authenticated';

let bootstrapPromise: Promise<void> | null = null;

export interface RegisterResult {
  user: User;
  accessToken: string;
  emailVerification?: { delivered: boolean; token?: string };
}

interface AuthState {
  user: User | null;
  status: AuthStatus;
  bootError: string | null;
  login: (identifier: string, password: string) => Promise<User>;
  register: (input: {
    username: string;
    email: string;
    password: string;
    displayName?: string;
  }) => Promise<RegisterResult>;
  bootstrap: () => Promise<void>;
  logout: () => Promise<void>;
  setUser: (user: User) => void;
  refreshUser: () => Promise<void>;
  updateSettings: (patch: Partial<UserSettings>) => Promise<UserSettings>;
  sessionLost: () => void;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  status: 'booting',
  bootError: null,

  bootstrap: async () => {
    if (get().status === 'authenticated') return;
    if (bootstrapPromise) return bootstrapPromise;
    bootstrapPromise = (async () => {
      set({ status: 'booting' });
      try {
        const session = await bootstrapSession();
        if (session) {
          setAccessToken(session.accessToken);
          updateSocketToken(session.accessToken);
          set({ user: session.user, status: 'authenticated', bootError: null });
        } else {
          setAccessToken(null);
          set({ user: null, status: 'guest', bootError: null });
        }
      } catch (error) {
        set({
          user: null,
          status: 'guest',
          bootError: error instanceof Error ? error.message : 'Falha ao iniciar a sessão',
        });
      }
    })();
    try {
      await bootstrapPromise;
    } finally {
      bootstrapPromise = null;
    }
  },

  login: async (identifier, password) => {
    const data = await api.post<{ user: User; accessToken: string }>(
      '/auth/login',
      { identifier, password },
      { auth: false, retry: false },
    );
    setAccessToken(data.accessToken);
    updateSocketToken(data.accessToken);
    set({ user: data.user, status: 'authenticated' });
    return data.user;
  },

  register: async (input) => {
    const data = await api.post<RegisterResult>(
      '/auth/register',
      input,
      { auth: false, retry: false },
    );
    setAccessToken(data.accessToken);
    updateSocketToken(data.accessToken);
    set({ user: data.user, status: 'authenticated' });
    return data;
  },

  logout: async () => {
    try {
      await api.post('/auth/logout');
    } catch {
      // Local logout must always succeed.
    }
    setAccessToken(null);
    disconnectSocket();
    set({ user: null, status: 'guest' });
  },

  setUser: (user) => {
    set({ user });
  },

  refreshUser: async () => {
    const data = await api.get<{ user: User }>('/auth/me');
    set({ user: data.user });
  },

  updateSettings: async (patch) => {
    const data = await api.put<{ settings: UserSettings }>('/users/me/settings', patch);
    const user = get().user;
    if (user) set({ user: { ...user, settings: data.settings } });
    return data.settings;
  },

  sessionLost: () => {
    disconnectSocket();
    setAccessToken(null);
    set({ user: null, status: 'guest' });
  },
}));

setSessionListener((user, token) => {
  setAccessToken(token);
  updateSocketToken(token);
  useAuthStore.setState({ user, status: 'authenticated' });
});

setAuthLostListener(() => {
  useAuthStore.getState().sessionLost();
});
