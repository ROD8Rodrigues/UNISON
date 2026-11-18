import { createContext, useContext } from 'react';
import type { Call, Presence, User } from '../../lib/types';

export interface IncomingCall {
  call: Call;
  caller: Pick<User, 'id' | 'username' | 'displayName' | 'avatarUrl'> & { presence?: Presence };
  conversationId: string;
  conversationType: string;
  conversationTitle: string | null;
}

export interface ParticipantMediaState {
  audio: boolean;
  video: boolean;
  screen: boolean;
}

export interface CallContextValue {
  activeCall: Call | null;
  incoming: IncomingCall | null;
  localStream: MediaStream | null;
  screenStream: MediaStream | null;
  remoteStreams: Record<string, MediaStream>;
  mediaStates: Record<string, ParticipantMediaState>;
  micEnabled: boolean;
  cameraEnabled: boolean;
  screenSharing: boolean;
  screenAudioEnabled: boolean;
  connecting: boolean;
  durationSeconds: number;
  startCall: (conversationId: string, kind: 'audio' | 'video') => Promise<void>;
  joinVoice: (channelId: string) => Promise<void>;
  acceptIncoming: () => Promise<void>;
  rejectIncoming: () => void;
  leaveCall: () => void;
  toggleMic: () => void;
  toggleCamera: () => void;
  toggleScreen: () => Promise<void>;
}

export const CallContext = createContext<CallContextValue | null>(null);

export function useCall() {
  const context = useContext(CallContext);
  if (!context) throw new Error('useCall must be used inside CallProvider');
  return context;
}
