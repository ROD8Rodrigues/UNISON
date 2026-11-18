import { create } from 'zustand';

export interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

interface DialogState {
  options: ConfirmOptions | null;
  resolve: ((value: boolean) => void) | null;
  open: (options: ConfirmOptions) => Promise<boolean>;
  close: (value: boolean) => void;
}

export const useDialogStore = create<DialogState>((set, get) => ({
  options: null,
  resolve: null,
  open: (options) => {
    const current = get().resolve;
    if (current) current(false);
    return new Promise<boolean>((resolve) => {
      set({ options, resolve });
    });
  },
  close: (value) => {
    const resolver = get().resolve;
    set({ options: null, resolve: null });
    resolver?.(value);
  },
}));

export function confirmDialog(options: ConfirmOptions) {
  return useDialogStore.getState().open(options);
}
