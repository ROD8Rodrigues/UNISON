export interface DesktopVoiceParticipant {
  id: string;
  name: string;
  avatarUrl: string | null;
  muted: boolean;
}

export interface DesktopVoiceState {
  title: string;
  channelId: string | null;
  startedAt: string | null;
  micEnabled: boolean;
  screenSharing: boolean;
  pinned: boolean;
  participants: DesktopVoiceParticipant[];
}

export interface DesktopVoiceCommand {
  action: 'toggle-mic' | 'leave' | 'open';
}

export interface DesktopBridge {
  isDesktop: true;
  platform: string;
  updateVoiceOverlay: (state: DesktopVoiceState | null) => void;
  setVoiceOverlayInteractive: (interactive: boolean) => void;
  onVoiceOverlayCommand: (callback: (command: DesktopVoiceCommand) => void) => () => void;
}

export interface DocumentPictureInPicture {
  requestWindow: (options?: {
    width?: number;
    height?: number;
    disallowReturnToOpener?: boolean;
  }) => Promise<Window>;
  window: Window | null;
}

declare global {
  interface Window {
    unisonDesktop?: DesktopBridge;
    documentPictureInPicture?: DocumentPictureInPicture;
  }
}

export function desktopBridge() {
  return typeof window !== 'undefined' ? window.unisonDesktop : undefined;
}

export function pictureInPictureSupported() {
  return typeof window !== 'undefined' && Boolean(window.documentPictureInPicture);
}
