import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MessageItem } from './MessageItem';
import type { Message, User } from '../../lib/types';
import { useAuthStore } from '../../store/auth';

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
  createdAt: '2026-01-01T00:00:00.000Z',
};

const message: Message = {
  id: 'message-1',
  conversationId: 'conversation-1',
  senderId: 'user-1',
  sender: {
    id: 'user-1',
    username: 'ana',
    displayName: 'Ana',
    avatarUrl: null,
    presence: 'online',
  },
  content: 'Veja https://unison.example e fale com @bia',
  kind: 'text',
  deleted: false,
  edited: false,
  replyTo: null,
  attachments: [],
  reactions: [
    {
      emoji: '🔥',
      count: 2,
      users: [
        { id: 'user-1', username: 'ana', displayName: 'Ana' },
        { id: 'user-2', username: 'bia', displayName: 'Bia' },
      ],
    },
  ],
  pinned: false,
  readByCount: 1,
  recipientCount: 1,
  createdAt: new Date().toISOString(),
  editedAt: null,
  deletedAt: null,
};

function renderMessage(overrides: Partial<Message> = {}) {
  return render(
    <MessageItem
      message={{ ...message, ...overrides }}
      showAuthor
      canModerate
      canPin
      onReply={vi.fn()}
      onJump={vi.fn()}
    />,
  );
}

beforeEach(() => {
  useAuthStore.setState({ user: currentUser, status: 'authenticated' });
});

afterEach(() => {
  useAuthStore.setState({ user: null, status: 'guest' });
});

describe('MessageItem', () => {
  it('renders the author, escaped text, links and mentions', () => {
    renderMessage();
    expect(screen.getByText('Ana')).toBeInTheDocument();
    expect(screen.getByText(/fale com/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'https://unison.example' })).toHaveAttribute(
      'href',
      'https://unison.example',
    );
    expect(screen.getByText('@bia')).toBeInTheDocument();
  });

  it('renders grouped reactions with count and viewer state', () => {
    const { container } = renderMessage();
    const chip = screen.getByTitle('Ana, Bia');
    expect(chip).toHaveTextContent('🔥');
    expect(chip).toHaveTextContent('2');
    expect(chip).toHaveClass('me');
    expect(container.querySelector('.message-text')?.innerHTML).not.toContain('<script');
  });

  it('shows the read receipt only for the sender', () => {
    renderMessage();
    expect(screen.getByText('lida')).toBeInTheDocument();
  });

  it('does not show sender-only controls on someone else’s message', () => {
    renderMessage({ senderId: 'user-2', sender: { ...message.sender!, id: 'user-2', displayName: 'Bia' } });
    expect(screen.queryByText('lida')).not.toBeInTheDocument();
  });
});
