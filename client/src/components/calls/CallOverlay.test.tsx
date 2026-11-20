import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { Call, User } from '../../lib/types';
import { useAppStore } from '../../store/app';
import { useAuthStore } from '../../store/auth';
import { CallContext, type CallContextValue } from './call-context';
import { CallOverlay } from './CallOverlay';

vi.mock('./VoiceDock', () => ({
  VoiceDock: ({ onExpand }: { onExpand: () => void }) => (
    <button type="button" onClick={onExpand}>
      Expandir dock
    </button>
  ),
  VoiceOverlaySync: () => null,
}));

const currentUser: User = {
  id: 'user-1',
  username: 'ana',
  displayName: 'Ana',
  bio: '',
  avatarUrl: null,
  bannerUrl: null,
  customStatus: '',
  presence: 'online',
  lastSeen: null,
  emailVerified: true,
  createdAt: '2026-11-19T00:00:00.000Z',
};

const remoteUser: User = {
  ...currentUser,
  id: 'user-2',
  username: 'bia',
  displayName: 'Bia',
};

const activeCall: Call = {
  id: 'call-1',
  conversationId: 'conversation-1',
  channelId: 'channel-1',
  initiatorId: currentUser.id,
  kind: 'audio',
  status: 'active',
  createdAt: '2026-11-19T00:00:00.000Z',
  startedAt: '2026-11-19T00:00:01.000Z',
  endedAt: null,
  participants: [
    {
      userId: currentUser.id,
      username: currentUser.username,
      displayName: currentUser.displayName,
      avatarUrl: currentUser.avatarUrl,
      presence: currentUser.presence,
      status: 'joined',
      joinedAt: '2026-11-19T00:00:01.000Z',
      leftAt: null,
    },
    {
      userId: remoteUser.id,
      username: remoteUser.username,
      displayName: remoteUser.displayName,
      avatarUrl: remoteUser.avatarUrl,
      presence: remoteUser.presence,
      status: 'joined',
      joinedAt: '2026-11-19T00:00:02.000Z',
      leftAt: null,
    },
  ],
};

const remoteStream = { id: 'remote-stream' } as unknown as MediaStream;

function contextValue(): CallContextValue {
  return {
    activeCall,
    incoming: null,
    localStream: null,
    screenStream: null,
    remoteStreams: { [remoteUser.id]: remoteStream },
    mediaStates: {},
    micEnabled: true,
    cameraEnabled: false,
    screenSharing: false,
    screenAudioEnabled: false,
    connecting: false,
    durationSeconds: 5,
    startCall: vi.fn(),
    joinVoice: vi.fn(),
    acceptIncoming: vi.fn(),
    rejectIncoming: vi.fn(),
    leaveCall: vi.fn(),
    toggleMic: vi.fn(),
    toggleCamera: vi.fn(),
    toggleScreen: vi.fn(),
  };
}

function renderOverlay() {
  return render(
    <CallContext.Provider value={contextValue()}>
      <CallOverlay />
    </CallContext.Provider>,
  );
}

beforeEach(() => {
  useAuthStore.setState({ user: currentUser });
  useAppStore.setState({ conversations: [] });
  Object.defineProperty(HTMLMediaElement.prototype, 'srcObject', {
    configurable: true,
    writable: true,
    value: null,
  });
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
});

describe('CallOverlay remote audio', () => {
  it('keeps the remote audio sink mounted in dock mode and after expanding', () => {
    const { container } = renderOverlay();

    // Voice channels open in the compact dock, where call tiles are not rendered.
    expect(screen.getByRole('button', { name: 'Expandir dock' })).toBeInTheDocument();
    expect(container.querySelectorAll('audio')).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: 'Expandir dock' }));

    // The full window keeps the same sink and the remote video tile is muted,
    // so audio is not lost or played twice.
    expect(screen.queryByRole('button', { name: 'Expandir dock' })).not.toBeInTheDocument();
    expect(container.querySelectorAll('audio')).toHaveLength(1);
  });
});
