import { create } from 'zustand';
import { api, queryString } from '../lib/api';
import { getSocket } from '../lib/socket';
import type {
  AppNotification,
  Conversation,
  FriendRequest,
  Message,
  Presence,
  SpaceSummary,
  User,
} from '../lib/types';
import { useAuthStore } from './auth';

interface MessageMeta {
  hasMore: boolean;
  nextCursor: number | null;
  loading: boolean;
  loaded: boolean;
}

interface TypingUser {
  username: string;
  expires: number;
}

interface AppState {
  hydrated: boolean;
  conversations: Conversation[];
  friends: User[];
  incomingRequests: FriendRequest[];
  outgoingRequests: FriendRequest[];
  blockedUsers: User[];
  spaces: SpaceSummary[];
  notifications: AppNotification[];
  unreadNotifications: number;
  messages: Record<string, Message[]>;
  messageMeta: Record<string, MessageMeta>;
  typing: Record<string, Record<string, TypingUser>>;
  presenceMap: Record<string, { presence: Presence; lastSeen: string | null }>;
  activeConversationId: string | null;
  activeSpaceId: string | null;
  spaceVersion: number;
  socketConnected: boolean;
  loadInitial: () => Promise<void>;
  refreshConversations: () => Promise<void>;
  refreshFriends: () => Promise<void>;
  refreshRequests: () => Promise<void>;
  refreshSpaces: () => Promise<void>;
  refreshNotifications: () => Promise<void>;
  refreshBlocked: () => Promise<void>;
  upsertConversation: (conversation: Conversation) => void;
  removeConversation: (conversationId: string) => void;
  setActiveConversation: (conversationId: string | null) => void;
  setActiveSpace: (spaceId: string | null) => void;
  bumpSpaceVersion: () => void;
  loadMessages: (conversationId: string, before?: number) => Promise<void>;
  addMessage: (message: Message) => void;
  updateMessage: (message: Message) => void;
  removeMessageLocal: (conversationId: string, messageId: string) => void;
  markConversationRead: (conversationId: string) => void;
  applyReadReceipt: (conversationId: string, userId: string, lastReadAt: string) => void;
  setTyping: (conversationId: string, userId: string, username: string, isTyping: boolean) => void;
  applyUserProfile: (user: User) => void;
  applyPresence: (userId: string, presence: Presence, lastSeen: string | null) => void;
  addNotification: (notification: AppNotification) => void;
  markNotificationRead: (notificationId: string) => Promise<void>;
  markAllNotificationsRead: () => Promise<void>;
  removeNotification: (notificationId: string) => void;
  clearNotifications: () => Promise<void>;
  setSocketConnected: (connected: boolean) => void;
  reset: () => void;
}

const typingTimers = new Map<string, number>();

function sortConversations(conversations: Conversation[]) {
  return [...conversations].sort((a, b) => {
    const aTime = new Date(a.lastMessageAt || a.createdAt).getTime();
    const bTime = new Date(b.lastMessageAt || b.createdAt).getTime();
    return bTime - aTime;
  });
}

function updateConversationPreview(conversation: Conversation, message: Message): Conversation {
  return {
    ...conversation,
    lastMessageAt: message.createdAt,
    lastMessagePreview: message.deleted ? '' : message.content || (message.attachments.length ? '📎 Anexo' : ''),
    updatedAt: message.createdAt,
  };
}

export const useAppStore = create<AppState>((set, get) => ({
  hydrated: false,
  conversations: [],
  friends: [],
  incomingRequests: [],
  outgoingRequests: [],
  blockedUsers: [],
  spaces: [],
  notifications: [],
  unreadNotifications: 0,
  messages: {},
  messageMeta: {},
  typing: {},
  presenceMap: {},
  activeConversationId: null,
  activeSpaceId: null,
  spaceVersion: 0,
  socketConnected: false,

  loadInitial: async () => {
    const results = await Promise.allSettled([
      api.get<{ conversations: Conversation[] }>('/conversations'),
      api.get<{ friends: User[] }>('/friends'),
      api.get<{ incoming: FriendRequest[]; outgoing: FriendRequest[] }>('/friends/requests'),
      api.get<{ spaces: SpaceSummary[] }>('/spaces'),
      api.get<{ notifications: AppNotification[]; unreadCount: number }>('/notifications'),
    ]);
    const [conversations, friends, requests, spaces, notifications] = results;
    set({
      hydrated: true,
      ...(conversations.status === 'fulfilled'
        ? { conversations: sortConversations(conversations.value.conversations) }
        : {}),
      ...(friends.status === 'fulfilled' ? { friends: friends.value.friends } : {}),
      ...(requests.status === 'fulfilled'
        ? {
            incomingRequests: requests.value.incoming,
            outgoingRequests: requests.value.outgoing,
          }
        : {}),
      ...(spaces.status === 'fulfilled' ? { spaces: spaces.value.spaces } : {}),
      ...(notifications.status === 'fulfilled'
        ? {
            notifications: notifications.value.notifications,
            unreadNotifications: notifications.value.unreadCount,
          }
        : {}),
    });
  },

  refreshConversations: async () => {
    const data = await api.get<{ conversations: Conversation[] }>('/conversations');
    set({ conversations: sortConversations(data.conversations) });
  },

  refreshFriends: async () => {
    const data = await api.get<{ friends: User[] }>('/friends');
    set({ friends: data.friends });
  },

  refreshRequests: async () => {
    const data = await api.get<{ incoming: FriendRequest[]; outgoing: FriendRequest[] }>('/friends/requests');
    set({ incomingRequests: data.incoming, outgoingRequests: data.outgoing });
  },

  refreshSpaces: async () => {
    const data = await api.get<{ spaces: SpaceSummary[] }>('/spaces');
    set({ spaces: data.spaces });
  },

  refreshNotifications: async () => {
    const data = await api.get<{ notifications: AppNotification[]; unreadCount: number }>('/notifications');
    set({ notifications: data.notifications, unreadNotifications: data.unreadCount });
  },

  refreshBlocked: async () => {
    const data = await api.get<{ blockedUsers: User[] }>('/friends/blocks/list');
    set({ blockedUsers: data.blockedUsers });
  },

  upsertConversation: (conversation) => {
    set((state) => {
      const exists = state.conversations.some((item) => item.id === conversation.id);
      return {
        conversations: sortConversations(
          exists
            ? state.conversations.map((item) => (item.id === conversation.id ? conversation : item))
            : [...state.conversations, conversation],
        ),
      };
    });
  },

  removeConversation: (conversationId) => {
    set((state) => {
      const messages = { ...state.messages };
      delete messages[conversationId];
      return {
        conversations: state.conversations.filter((conversation) => conversation.id !== conversationId),
        messages,
        activeConversationId:
          state.activeConversationId === conversationId ? null : state.activeConversationId,
      };
    });
  },

  setActiveConversation: (conversationId) => set({ activeConversationId: conversationId }),
  setActiveSpace: (spaceId) => set({ activeSpaceId: spaceId }),
  bumpSpaceVersion: () => set((state) => ({ spaceVersion: state.spaceVersion + 1 })),

  loadMessages: async (conversationId, before) => {
    const state = get();
    const meta = state.messageMeta[conversationId];
    if (meta?.loading) return;
    if (!before && meta?.loaded) return;
    set((current) => ({
      messageMeta: {
        ...current.messageMeta,
        [conversationId]: {
          hasMore: meta?.hasMore ?? false,
          nextCursor: meta?.nextCursor ?? null,
          loaded: meta?.loaded ?? false,
          loading: true,
        },
      },
    }));
    try {
      const data = await api.get<{ messages: Message[]; hasMore: boolean; nextCursor: number | null }>(
        `/conversations/${conversationId}/messages${queryString({ before, limit: 50 })}`,
      );
      set((current) => {
        const existing = current.messages[conversationId] || [];
        const incoming = data.messages.filter((message) => !existing.some((item) => item.id === message.id));
        return {
          messages: {
            ...current.messages,
            [conversationId]: before ? [...incoming, ...existing] : data.messages,
          },
          messageMeta: {
            ...current.messageMeta,
            [conversationId]: {
              hasMore: data.hasMore,
              nextCursor: data.nextCursor,
              loading: false,
              loaded: true,
            },
          },
        };
      });
    } catch (error) {
      set((current) => ({
        messageMeta: {
          ...current.messageMeta,
          [conversationId]: {
            ...(current.messageMeta[conversationId] || { hasMore: false, nextCursor: null, loaded: false }),
            loading: false,
          },
        },
      }));
      throw error;
    }
  },

  addMessage: (message) => {
    const userId = useAuthStore.getState().user?.id;
    set((state) => {
      const cached = state.messages[message.conversationId];
      const messages = cached
        ? cached.some((item) => item.id === message.id)
          ? cached
          : [...cached, message]
        : cached;
      const exists = state.conversations.some((conversation) => conversation.id === message.conversationId);
      const active = state.activeConversationId === message.conversationId;
      const conversations = exists
        ? state.conversations.map((conversation) =>
            conversation.id === message.conversationId
              ? {
                  ...updateConversationPreview(conversation, message),
                  unreadCount:
                    active || message.senderId === userId
                      ? conversation.id === message.conversationId && active
                        ? 0
                        : conversation.unreadCount
                      : conversation.unreadCount + 1,
                }
              : conversation,
          )
        : state.conversations;
      return {
        messages: messages ? { ...state.messages, [message.conversationId]: messages } : state.messages,
        conversations: sortConversations(conversations),
      };
    });
  },

  updateMessage: (message) => {
    set((state) => {
      const cached = state.messages[message.conversationId];
      if (!cached) return {};
      return {
        messages: {
          ...state.messages,
          [message.conversationId]: cached.map((item) => (item.id === message.id ? message : item)),
        },
      };
    });
  },

  removeMessageLocal: (conversationId, messageId) => {
    set((state) => {
      const cached = state.messages[conversationId];
      if (!cached) return {};
      return {
        messages: {
          ...state.messages,
          [conversationId]: cached.map((message) =>
            message.id === messageId ? { ...message, deleted: true, content: '', attachments: [], reactions: [] } : message,
          ),
        },
      };
    });
  },

  markConversationRead: (conversationId) => {
    const state = get();
    const cached = state.messages[conversationId];
    const lastMessage = cached?.[cached.length - 1];
    set((current) => ({
      conversations: current.conversations.map((conversation) =>
        conversation.id === conversationId ? { ...conversation, unreadCount: 0 } : conversation,
      ),
    }));
    const socket = getSocket();
    if (socket?.connected) {
      socket.emit('conversation:read', { conversationId, messageId: lastMessage?.id });
    } else {
      api.post(`/conversations/${conversationId}/read`, { messageId: lastMessage?.id }).catch(() => undefined);
    }
  },

  applyReadReceipt: (conversationId, userId, lastReadAt) => {
    set((state) => ({
      conversations: state.conversations.map((conversation) =>
        conversation.id === conversationId
          ? {
              ...conversation,
              members: conversation.members.map((member) =>
                member.id === userId ? { ...member, lastReadAt } : member,
              ),
            }
          : conversation,
      ),
    }));
  },

  setTyping: (conversationId, userId, username, isTyping) => {
    const key = `${conversationId}:${userId}`;
    const existingTimer = typingTimers.get(key);
    if (existingTimer) window.clearTimeout(existingTimer);
    if (!isTyping) {
      typingTimers.delete(key);
      set((state) => {
        const conversation = { ...(state.typing[conversationId] || {}) };
        delete conversation[userId];
        return { typing: { ...state.typing, [conversationId]: conversation } };
      });
      return;
    }
    set((state) => ({
      typing: {
        ...state.typing,
        [conversationId]: {
          ...(state.typing[conversationId] || {}),
          [userId]: { username, expires: Date.now() + 6000 },
        },
      },
    }));
    const timer = window.setTimeout(() => {
      set((state) => {
        const conversation = { ...(state.typing[conversationId] || {}) };
        delete conversation[userId];
        return { typing: { ...state.typing, [conversationId]: conversation } };
      });
      typingTimers.delete(key);
    }, 6000);
    typingTimers.set(key, timer);
  },

  applyPresence: (userId, presence, lastSeen) => {
    set((state) => ({
      presenceMap: { ...state.presenceMap, [userId]: { presence, lastSeen } },
      friends: state.friends.map((friend) =>
        friend.id === userId ? { ...friend, presence, lastSeen } : friend,
      ),
      conversations: state.conversations.map((conversation) => ({
        ...conversation,
        members: conversation.members.map((member) =>
          member.id === userId ? { ...member, presence, lastSeen } : member,
        ),
        otherUser:
          conversation.otherUser?.id === userId
            ? { ...conversation.otherUser, presence, lastSeen }
            : conversation.otherUser,
      })),
    }));
  },

  applyUserProfile: (user) => {
    const update = <T extends User>(candidate: T): T =>
      candidate.id === user.id ? { ...candidate, ...user } : candidate;
    set((state) => ({
      friends: state.friends.map(update),
      blockedUsers: state.blockedUsers.map(update),
      incomingRequests: state.incomingRequests.map((request) => ({
        ...request,
        sender: update(request.sender),
        receiver: update(request.receiver),
      })),
      outgoingRequests: state.outgoingRequests.map((request) => ({
        ...request,
        sender: update(request.sender),
        receiver: update(request.receiver),
      })),
      conversations: state.conversations.map((conversation) => ({
        ...conversation,
        members: conversation.members.map(update),
        otherUser: conversation.otherUser ? update(conversation.otherUser) : null,
      })),
      messages: Object.fromEntries(
        Object.entries(state.messages).map(([conversationId, messages]) => [
          conversationId,
          messages.map((message) =>
            message.sender?.id === user.id
              ? {
                  ...message,
                  sender: {
                    ...message.sender,
                    username: user.username,
                    displayName: user.displayName,
                    avatarUrl: user.avatarUrl,
                    presence: user.presence,
                  },
                }
              : message,
          ),
        ]),
      ),
      spaceVersion: state.spaceVersion + 1,
    }));
  },

  addNotification: (notification) => {
    set((state) => ({
      notifications: [notification, ...state.notifications.filter((item) => item.id !== notification.id)].slice(0, 100),
      unreadNotifications: state.unreadNotifications + (notification.readAt ? 0 : 1),
    }));
  },

  markNotificationRead: async (notificationId) => {
    await api.post(`/notifications/${notificationId}/read`);
    set((state) => {
      const target = state.notifications.find((item) => item.id === notificationId);
      return {
        notifications: state.notifications.map((item) =>
          item.id === notificationId ? { ...item, readAt: new Date().toISOString() } : item,
        ),
        unreadNotifications: Math.max(0, state.unreadNotifications - (target && !target.readAt ? 1 : 0)),
      };
    });
  },

  markAllNotificationsRead: async () => {
    await api.post('/notifications/read-all');
    set((state) => ({
      notifications: state.notifications.map((item) => ({
        ...item,
        readAt: item.readAt || new Date().toISOString(),
      })),
      unreadNotifications: 0,
    }));
  },

  removeNotification: (notificationId) => {
    set((state) => {
      const target = state.notifications.find((item) => item.id === notificationId);
      return {
        notifications: state.notifications.filter((item) => item.id !== notificationId),
        unreadNotifications: Math.max(0, state.unreadNotifications - (target && !target.readAt ? 1 : 0)),
      };
    });
  },

  clearNotifications: async () => {
    await api.delete('/notifications');
    set({ notifications: [], unreadNotifications: 0 });
  },

  setSocketConnected: (connected) => set({ socketConnected: connected }),

  reset: () => {
    for (const timer of typingTimers.values()) window.clearTimeout(timer);
    typingTimers.clear();
    set({
      hydrated: false,
      conversations: [],
      friends: [],
      incomingRequests: [],
      outgoingRequests: [],
      blockedUsers: [],
      spaces: [],
      notifications: [],
      unreadNotifications: 0,
      messages: {},
      messageMeta: {},
      typing: {},
      presenceMap: {},
      activeConversationId: null,
      activeSpaceId: null,
      socketConnected: false,
    });
  },
}));
