import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import {
  AtSign,
  Bell,
  BellOff,
  Building2,
  CheckCheck,
  MessageCircle,
  Phone,
  Trash2,
  UserPlus,
  X,
} from 'lucide-react';
import { relativeTime } from '../../lib/utils';
import { confirmDialog } from '../../store/dialog';
import { useAppStore } from '../../store/app';
import { useToastStore } from '../../store/toast';
import { EmptyState } from '../ui/EmptyState';

function iconFor(type: string) {
  switch (type) {
    case 'friend_request':
    case 'friend_accepted':
      return <UserPlus size={18} />;
    case 'mention':
      return <AtSign size={18} />;
    case 'message':
      return <MessageCircle size={18} />;
    case 'call':
      return <Phone size={18} />;
    case 'space_kicked':
    case 'space_banned':
    case 'channel_added':
    case 'roles_updated':
      return <Building2 size={18} />;
    default:
      return <Bell size={18} />;
  }
}

export function NotificationCenter({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const notifications = useAppStore((state) => state.notifications);
  const unread = useAppStore((state) => state.unreadNotifications);
  const markAll = useAppStore((state) => state.markAllNotificationsRead);
  const markOne = useAppStore((state) => state.markNotificationRead);
  const clear = useAppStore((state) => state.clearNotifications);
  const refresh = useAppStore((state) => state.refreshNotifications);
  const pushToast = useToastStore((state) => state.push);

  useEffect(() => {
    if (!open) return;
    refresh().catch(() => undefined);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = previous;
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onClose, refresh]);

  if (!open) return null;

  async function openNotification(id: string) {
    const notification = notifications.find((item) => item.id === id);
    if (!notification) return;
    if (!notification.readAt) await markOne(id).catch(() => undefined);
    const { conversationId, spaceId, channelId, requestId } = notification.data;
    onClose();
    if (requestId) {
      navigate('/app/friends?tab=requests');
    } else if (spaceId && channelId) {
      navigate(`/app/spaces/${spaceId}/channels/${channelId}`);
    } else if (spaceId) {
      navigate(`/app/spaces/${spaceId}`);
    } else if (conversationId) {
      navigate(`/app/dm/${conversationId}`);
    }
  }

  async function clearAll() {
    const ok = await confirmDialog({
      title: 'Limpar notificações?',
      message: 'Todas as notificações serão removidas da sua conta. Essa ação não pode ser desfeita.',
      confirmLabel: 'Limpar tudo',
      danger: true,
    });
    if (!ok) return;
    try {
      await clear();
      pushToast('success', 'Notificações limpas');
    } catch {
      pushToast('error', 'Não foi possível limpar as notificações');
    }
  }

  return createPortal(
    <div
      className="drawer-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <aside className="drawer notification-drawer" aria-label="Notificações">
        <header className="drawer-head">
          <div>
            <h2>Notificações</h2>
            <p>{unread > 0 ? `${unread} não lida(s)` : 'Tudo em dia'}</p>
          </div>
          <button type="button" className="icon-btn ghost" onClick={onClose} aria-label="Fechar notificações">
            <X size={18} />
          </button>
        </header>
        <div className="drawer-actions">
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => void markAll()}
            disabled={unread === 0}
          >
            <CheckCheck size={15} /> Marcar todas como lidas
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm danger-text"
            onClick={() => void clearAll()}
            disabled={notifications.length === 0}
          >
            <Trash2 size={15} /> Limpar
          </button>
        </div>
        <div className="notification-list">
          {notifications.length === 0 ? (
            <EmptyState
              icon={<BellOff size={24} />}
              title="Sem notificações"
              message="Menções, pedidos de amizade e novidades dos espaços aparecem aqui."
            />
          ) : (
            notifications.map((notification) => (
              <button
                key={notification.id}
                type="button"
                className={`notification-row${notification.readAt ? '' : ' unread'}`}
                onClick={() => void openNotification(notification.id)}
              >
                <span className="notification-icon">{iconFor(notification.type)}</span>
                <div className="notification-copy">
                  <strong>{notification.title}</strong>
                  {notification.body && <p>{notification.body}</p>}
                  <span>{relativeTime(notification.createdAt)}</span>
                </div>
                {!notification.readAt && <span className="unread-pin" />}
              </button>
            ))
          )}
        </div>
      </aside>
    </div>,
    document.body,
  );
}
