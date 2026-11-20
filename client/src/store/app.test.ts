import { afterEach, describe, expect, it } from 'vitest';
import type { Conversation, Message, User } from '../lib/types';
import { useAppStore } from './app';

const user: User = {
  id: 'user-1',
  username: 'chrx',
  displayName: 'CHRX',
  bio: '',
  avatarUrl: '/uploads/new-avatar.png',
  bannerUrl: null,
  customStatus: '',
  presence: 'online',
  lastSeen: null,
  emailVerified: true,
  createdAt: '2026-11-19T00:00:00.000Z',
};

const otherUser: User = { ...user, id: 'user-2', username: 'friend', displayName: 'Friend', avatarUrl: '/uploads/old.png' };

const conversation: Conversation = {
  id: 'conversation-1',
  type: 'dm',
  title: null,
  avatarUrl: null,
  spaceId: null,
  channelId: null,
  ownerId: null,
  createdAt: '2026-11-19T00:00:00.000Z',
  updatedAt: '2026-11-19T00:00:00.000Z',
  lastMessageAt: null,
  lastMessagePreview: '',
  unreadCount: 0,
  muted: false,
  myRole: 'member',
  memberCount: 2,
  members: [
    { ...user, role: 'member', joinedAt: '2026-11-19T00:00:00.000Z', lastReadAt: null },
    { ...otherUser, role: 'member', joinedAt: '2026-11-19T00:00:00.000Z', lastReadAt: null },
  ],
  otherUser: { ...otherUser, role: 'member', joinedAt: '2026-11-19T00:00:00.000Z', lastReadAt: null },
};

const message: Message = {
  id: 'message-1',
  conversationId: conversation.id,
  senderId: otherUser.id,
  sender: {
    id: otherUser.id,
    username: otherUser.username,
    displayName: otherUser.displayName,
    avatarUrl: otherUser.avatarUrl,
    presence: otherUser.presence,
  },
  content: 'hello',
  kind: 'text',
  deleted: false,
  edited: false,
  replyTo: null,
  attachments: [],
  reactions: [],
  pinned: false,
  readByCount: 1,
  recipientCount: 2,
  createdAt: '2026-11-19T00:00:00.000Z',
  editedAt: null,
  deletedAt: null,
};

afterEach(() => useAppStore.getState().reset());

describe('app store profile synchronization', () => {
  it('updates avatar and identity in friend, conversation, and message caches', () => {
    useAppStore.setState({
      friends: [otherUser],
      conversations: [conversation],
      messages: { [conversation.id]: [message] },
    });

    useAppStore.getState().applyUserProfile({ ...otherUser, avatarUrl: '/uploads/updated.png', displayName: 'Updated' });

    const state = useAppStore.getState();
    expect(state.friends[0].avatarUrl).toBe('/uploads/updated.png');
    expect(state.conversations[0].members[1].displayName).toBe('Updated');
    expect(state.conversations[0].otherUser?.avatarUrl).toBe('/uploads/updated.png');
    expect(state.messages[conversation.id][0].sender?.avatarUrl).toBe('/uploads/updated.png');
  });
});
