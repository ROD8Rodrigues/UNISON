import { create } from 'zustand';

export type ToastType = 'success' | 'error' | 'info';

export interface Toast {
  id: string;
  type: ToastType;
  title: string;
  message?: string;
}

interface ToastState {
  toasts: Toast[];
  push: (type: ToastType, title: string, message?: string) => void;
  dismiss: (id: string) => void;
}

const timers = new Map<string, number>();

export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],
  push: (type, title, message) => {
    const id = crypto.randomUUID();
    set((state) => ({ toasts: [...state.toasts.slice(-3), { id, type, title, message }] }));
    const timer = window.setTimeout(() => {
      get().dismiss(id);
    }, type === 'error' ? 6000 : 4200);
    timers.set(id, timer);
  },
  dismiss: (id) => {
    const timer = timers.get(id);
    if (timer) window.clearTimeout(timer);
    timers.delete(id);
    set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) }));
  },
}));

export const toast = {
  success: (title: string, message?: string) => useToastStore.getState().push('success', title, message),
  error: (title: string, message?: string) => useToastStore.getState().push('error', title, message),
  info: (title: string, message?: string) => useToastStore.getState().push('info', title, message),
};
