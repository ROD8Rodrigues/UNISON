import { useEffect, useRef } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import { getAccessToken } from '../lib/api';
import { connectSocket } from '../lib/socket';
import type {
  AppNotification,
  Conversation,
  FriendRequest,
  Message,
  Presence,
  User,
} from '../lib/types';
import { playNotificationSound } from '../lib/utils';
import { useAppStore } from '../store/app';
import { useAuthStore } from '../store/auth';
import { toast } from '../store/toast';
import { CallProvider } from './calls/CallProvider';

interface FriendRequestPayload {
  request: FriendRequest;
}

function browserNotify(title: string, body: string) {
  try {
    if (typeof Notification === 'undefined') return;
    if (Notification.permission !== 'granted') return;
    const notification = new Notification(title, {
      body,
      icon: '/icon.svg',
      silent: true,
      tag: 'unison-message',
    });
    notification.onclick = () => {
      window.focus();
      notification.close();
    };
  } catch {
    // Notifications are an optional enhancement.
  }
}

export function RealtimeBridge() {
  const navigate = useNavigate();
  const navigateRef = useRef(navigate);
  useEffect(() => {
    navigateRef.current = navigate;
  }, [navigate]);
  const user = useAuthStore((state) => state.user);
  const userId = user?.id;
  const conversations = useAppStore((state) => state.conversations);
  const unreadNotifications = useAppStore((state) => state.unreadNotifications);

  useEffect(() => {
    if (!userId) return;
    const app = useAppStore.getState();
    app.loadInitial().catch(() => undefined);
    const socket = connectSocket();
    socket.auth = { token: getAccessToken() };
    if (socket.connected) useAppStore.getState().setSocketConnected(true);
    if (!socket.connected) socket.connect();

    const handleConnect = () => {
      useAppStore.getState().setSocketConnected(true);
      const current = useAuthStore.getState().user;
      if (current) {
        useAppStore
          .getState()
          .loadInitial()
          .catch(() => undefined);
      }
    };

    const handleDisconnect = () => {
      useAppStore.getState().setSocketConnected(false);
    };

    const handleMessage = (payload: { message: Message }) => {
      const message = payload.message;
      if (!message) return;
      const store = useAppStore.getState();
      const conversation = store.conversations.find((item) => item.id === message.conversationId);
      if (!conversation) {
        store.refreshConversations().catch(() => undefined);
      }
      store.addMessage(message);
      const currentUser = useAuthStore.getState().user;
      const settings = currentUser?.settings;
      if (message.senderId && message.senderId !== currentUser?.id) {
        const active = useAppStore.getState().activeConversationId === message.conversationId;
        const muted = conversation?.muted || false;
        if (active) {
          useAppStore.getState().markConversationRead(message.conversationId);
        } else if (!muted) {
          if (settings?.notificationSounds !== false) playNotificationSound();
          if (document.visibilityState !== 'visible' && settings?.desktopNotifications) {
            const title = conversation?.title || message.sender?.displayName || 'Nova mensagem';
            browserNotify(
              title,
              settings.messagePreviews === false
                ? 'Você recebeu uma nova mensagem'
                : message.content || '📎 Anexo',
            );
          }
        }
      }
    };

    const handleMessageUpdated = (payload: { message: Message }) => {
      if (payload.message) useAppStore.getState().updateMessage(payload.message);
    };

    const handleMessageDeleted = (payload: { conversationId: string; messageId: string }) => {
      if (payload.conversationId && payload.messageId) {
        useAppStore.getState().removeMessageLocal(payload.conversationId, payload.messageId);
      }
    };

    const handleConversationNew = (payload: { conversation: Conversation }) => {
      if (!payload.conversation) return;
      if (payload.conversation.type !== 'channel') {
        useAppStore.getState().upsertConversation(payload.conversation);
      }
      useAppStore.getState().refreshSpaces().catch(() => undefined);
    };

    const handleConversationUpdated = (payload: { conversation: Conversation }) => {
      if (payload.conversation) useAppStore.getState().upsertConversation(payload.conversation);
    };

    const handleConversationMembers = () => {
      useAppStore.getState().refreshConversations().catch(() => undefined);
    };

    const handleConversationRemoved = (payload: { conversationId?: string }) => {
      if (!payload.conversationId) return;
      const store = useAppStore.getState();
      if (store.activeConversationId === payload.conversationId) {
        navigateRef.current('/app', { replace: true });
      }
      store.removeConversation(payload.conversationId);
      store.refreshSpaces().catch(() => undefined);
    };

    const handleConversationRead = (payload: {
      conversationId: string;
      userId: string;
      lastReadAt: string;
    }) => {
      useAppStore
        .getState()
        .applyReadReceipt(payload.conversationId, payload.userId, payload.lastReadAt);
    };

    const handleTyping = (payload: {
      conversationId: string;
      userId: string;
      username: string;
      isTyping: boolean;
    }) => {
      useAppStore
        .getState()
        .setTyping(payload.conversationId, payload.userId, payload.username, payload.isTyping);
    };

    const handlePresence = (payload: { userId: string; presence: Presence; lastSeen: string | null }) => {
      useAppStore.getState().applyPresence(payload.userId, payload.presence, payload.lastSeen);
    };

    const handleUserUpdated = (payload: { user?: User }) => {
      if (!payload.user) return;
      useAppStore.getState().applyUserProfile(payload.user);
      const current = useAuthStore.getState().user;
      if (current?.id === payload.user.id) {
        useAuthStore.getState().setUser({ ...current, ...payload.user });
      }
    };

    const handleFriendRequest = (payload: FriendRequestPayload) => {
      useAppStore.getState().refreshRequests().catch(() => undefined);
      const request = payload.request;
      if (!request) return;
      if (request.direction === 'incoming') {
        toast.info('Novo pedido de amizade', `${request.sender.displayName} quer se conectar.`);
      }
    };

    const handleFriendAccepted = (payload: { friend: User }) => {
      useAppStore.getState().refreshFriends().catch(() => undefined);
      useAppStore.getState().refreshRequests().catch(() => undefined);
      if (payload.friend) toast.success(`Vocês agora são amigos`, payload.friend.displayName);
    };

    const handleFriendRemoved = () => {
      useAppStore.getState().refreshFriends().catch(() => undefined);
      useAppStore.getState().refreshRequests().catch(() => undefined);
    };

    const handleRequestRejected = () => {
      useAppStore.getState().refreshRequests().catch(() => undefined);
    };

    const handleBlocked = () => {
      useAppStore.getState().refreshFriends().catch(() => undefined);
      useAppStore.getState().refreshBlocked().catch(() => undefined);
    };

    const handleNotification = (payload: { notification: AppNotification }) => {
      const notification = payload.notification;
      if (!notification) return;
      useAppStore.getState().addNotification(notification);
      const current = useAuthStore.getState().user;
      const settings = current?.settings;
      if (notification.type === 'mention' || notification.type === 'friend_request') {
        toast.info(notification.title, notification.body || undefined);
      }
      if (document.visibilityState !== 'visible' && settings?.desktopNotifications) {
        browserNotify(notification.title, notification.body || 'UNISON');
      }
    };

    const handleSpaceChanged = () => {
      useAppStore.getState().bumpSpaceVersion();
      useAppStore.getState().refreshSpaces().catch(() => undefined);
    };

    const handleSpaceRemoved = () => {
      useAppStore.getState().bumpSpaceVersion();
      useAppStore.getState().refreshSpaces().catch(() => undefined);
      useAppStore.getState().refreshConversations().catch(() => undefined);
    };

    const handleSpaceBanned = () => {
      useAppStore.getState().refreshSpaces().catch(() => undefined);
      useAppStore.getState().refreshConversations().catch(() => undefined);
      toast.info('Acesso ao espaço encerrado');
    };

    const handleChannelAdded = (payload: { spaceId?: string }) => {
      useAppStore.getState().bumpSpaceVersion();
      useAppStore.getState().refreshSpaces().catch(() => undefined);
      useAppStore.getState().refreshConversations().catch(() => undefined);
      void payload;
    };

    const handleSessionRevoked = () => {
      toast.info('Sessão encerrada', 'Sua sessão foi encerrada. Entre novamente para continuar.');
      useAppStore.getState().reset();
      useAuthStore.getState().sessionLost();
      navigateRef.current('/login', { replace: true });
    };

    socket.on('connect', handleConnect);
    socket.on('disconnect', handleDisconnect);
    socket.on('message:new', handleMessage);
    socket.on('message:updated', handleMessageUpdated);
    socket.on('message:deleted', handleMessageDeleted);
    socket.on('conversation:new', handleConversationNew);
    socket.on('conversation:updated', handleConversationUpdated);
    socket.on('conversation:member-added', handleConversationMembers);
    socket.on('conversation:member-removed', handleConversationRemoved);
    socket.on('conversation:removed', handleConversationRemoved);
    socket.on('conversation:hidden', handleConversationRemoved);
    socket.on('conversation:read', handleConversationRead);
    socket.on('typing:update', handleTyping);
    socket.on('presence:update', handlePresence);
    socket.on('user:updated', handleUserUpdated);
    socket.on('friend:request', handleFriendRequest);
    socket.on('friend:accepted', handleFriendAccepted);
    socket.on('friend:removed', handleFriendRemoved);
    socket.on('friend:request-rejected', handleRequestRejected);
    socket.on('user:blocked', handleBlocked);
    socket.on('user:unblocked', handleBlocked);
    socket.on('notification:new', handleNotification);
    socket.on('space:updated', handleSpaceChanged);
    socket.on('space:member-joined', handleSpaceChanged);
    socket.on('space:member-left', handleSpaceChanged);
    socket.on('space:deleted', handleSpaceRemoved);
    socket.on('space:removed', handleSpaceRemoved);
    socket.on('space:banned', handleSpaceBanned);
    socket.on('channel:added', handleChannelAdded);
    socket.on('session:revoked', handleSessionRevoked);

    return () => {
      socket.off('connect', handleConnect);
      socket.off('disconnect', handleDisconnect);
      socket.off('message:new', handleMessage);
      socket.off('message:updated', handleMessageUpdated);
      socket.off('message:deleted', handleMessageDeleted);
      socket.off('conversation:new', handleConversationNew);
      socket.off('conversation:updated', handleConversationUpdated);
      socket.off('conversation:member-added', handleConversationMembers);
      socket.off('conversation:member-removed', handleConversationRemoved);
      socket.off('conversation:removed', handleConversationRemoved);
      socket.off('conversation:hidden', handleConversationRemoved);
      socket.off('conversation:read', handleConversationRead);
      socket.off('typing:update', handleTyping);
      socket.off('presence:update', handlePresence);
      socket.off('user:updated', handleUserUpdated);
      socket.off('friend:request', handleFriendRequest);
      socket.off('friend:accepted', handleFriendAccepted);
      socket.off('friend:removed', handleFriendRemoved);
      socket.off('friend:request-rejected', handleRequestRejected);
      socket.off('user:blocked', handleBlocked);
      socket.off('user:unblocked', handleBlocked);
      socket.off('notification:new', handleNotification);
      socket.off('space:updated', handleSpaceChanged);
      socket.off('space:member-joined', handleSpaceChanged);
      socket.off('space:member-left', handleSpaceChanged);
      socket.off('space:deleted', handleSpaceRemoved);
      socket.off('space:removed', handleSpaceRemoved);
      socket.off('space:banned', handleSpaceBanned);
      socket.off('channel:added', handleChannelAdded);
      socket.off('session:revoked', handleSessionRevoked);
    };
  }, [userId]);

  useEffect(() => {
    const unread = conversations.reduce((total, item) => total + item.unreadCount, 0);
    document.title = unread > 0 ? `(${unread > 99 ? '99+' : unread}) UNISON` : 'UNISON';
  }, [conversations, unreadNotifications]);

  return (
    <CallProvider>
      <Outlet />
    </CallProvider>
  );
}
