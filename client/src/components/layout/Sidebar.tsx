import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  Bell,
  ChevronDown,
  LogOut,
  MessageCircle,
  Plus,
  Search,
  Settings,
  Users,
  VolumeX,
} from 'lucide-react';
import { api, ApiError } from '../../lib/api';
import type { Presence } from '../../lib/types';
import { classNames, relativeTime, truncate } from '../../lib/utils';
import { useAppStore } from '../../store/app';
import { useAuthStore } from '../../store/auth';
import { toast } from '../../store/toast';
import { Avatar } from '../ui/Avatar';
import { Logo } from '../ui/Logo';

const PRESENCES: { value: Presence; label: string; hint: string }[] = [
  { value: 'online', label: 'Online', hint: 'Disponível para conversar' },
  { value: 'away', label: 'Ausente', hint: 'Longe do teclado' },
  { value: 'dnd', label: 'Não perturbe', hint: 'Silencie as notificações' },
];

export function Sidebar({
  onNewConversation,
  onOpenNotifications,
  mobileOpen = false,
}: {
  onNewConversation: () => void;
  onOpenNotifications: () => void;
  mobileOpen?: boolean;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const conversations = useAppStore((state) => state.conversations);
  const incomingRequests = useAppStore((state) => state.incomingRequests);
  const unreadNotifications = useAppStore((state) => state.unreadNotifications);
  const user = useAuthStore((state) => state.user);
  const logout = useAuthStore((state) => state.logout);
  const setUser = useAuthStore((state) => state.setUser);
  const [filter, setFilter] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const activeId = location.pathname.match(/^\/app\/dm\/([^/]+)/)?.[1] || null;

  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [menuOpen]);

  const filtered = useMemo(() => {
    const term = filter.trim().toLowerCase();
    if (!term) return conversations;
    return conversations.filter((conversation) => {
      const title = (conversation.title || conversation.otherUser?.displayName || '').toLowerCase();
      const username = conversation.otherUser?.username?.toLowerCase() || '';
      return title.includes(term) || username.includes(term);
    });
  }, [conversations, filter]);

  async function changePresence(presence: Presence) {
    try {
      await api.post('/users/me/presence', { presence });
      if (user) setUser({ ...user, presence });
      setMenuOpen(false);
      toast.success('Status atualizado');
    } catch (error) {
      toast.error('Não foi possível mudar o status', error instanceof ApiError ? error.message : undefined);
    }
  }

  async function handleLogout() {
    setMenuOpen(false);
    await logout();
    useAppStore.getState().reset();
    toast.info('Sessão encerrada');
    navigate('/login', { replace: true });
  }

  return (
    <aside className={`sidebar${mobileOpen ? ' mobile-open' : ''}`}>
      <header className="sidebar-head">
        <Link to="/app" className="sidebar-brand">
          <Logo size={30} withWord />
        </Link>
        <div className="sidebar-head-actions">
          <button
            type="button"
            className="icon-btn ghost notification-trigger"
            onClick={onOpenNotifications}
            aria-label="Notificações"
          >
            <Bell size={19} />
            {unreadNotifications > 0 && (
              <span className="count-badge">{unreadNotifications > 99 ? '99+' : unreadNotifications}</span>
            )}
          </button>
          <button
            type="button"
            className="icon-btn solid"
            onClick={onNewConversation}
            aria-label="Nova conversa"
          >
            <Plus size={18} />
          </button>
        </div>
      </header>

      <div className="sidebar-search">
        <Search size={16} />
        <input
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder="Buscar conversas"
          aria-label="Buscar conversas"
        />
      </div>

      <nav className="sidebar-nav">
        <NavLink to="/app/friends" className={({ isActive }) => classNames('nav-row', isActive && 'active')}>
          <Users size={18} />
          <span>Amigos</span>
          {incomingRequests.length > 0 && (
            <span className="nav-badge">{incomingRequests.length}</span>
          )}
        </NavLink>
        <NavLink to="/app/spaces" end className={({ isActive }) => classNames('nav-row', isActive && 'active')}>
          <MessageCircle size={18} />
          <span>Espaços</span>
        </NavLink>
      </nav>

      <div className="sidebar-section">
        <span>Mensagens</span>
        <button type="button" className="mini-action" onClick={onNewConversation} aria-label="Criar conversa">
          <Plus size={15} />
        </button>
      </div>

      <div className="conversation-list">
        {filtered.length === 0 && (
          <div className="sidebar-empty">
            <MessageCircle size={22} />
            <p>{filter ? 'Nenhuma conversa encontrada' : 'Nenhuma conversa ainda'}</p>
            {!filter && (
              <button type="button" className="btn btn-secondary btn-sm" onClick={onNewConversation}>
                Iniciar conversa
              </button>
            )}
          </div>
        )}
        {filtered.map((conversation) => {
          const title = conversation.title || conversation.otherUser?.displayName || 'Conversa';
          const preview = conversation.lastMessagePreview || 'Sem mensagens ainda';
          return (
            <Link
              key={conversation.id}
              to={`/app/dm/${conversation.id}`}
              className={classNames(
                'conversation-row',
                activeId === conversation.id && 'active',
                conversation.unreadCount > 0 && 'unread',
              )}
            >
              <Avatar
                name={title}
                src={conversation.avatarUrl}
                size={44}
                presence={conversation.type === 'dm' ? conversation.otherUser?.presence : null}
              />
              <div className="conversation-copy">
                <div className="conversation-top">
                  <strong>{truncate(title, 28)}</strong>
                  <span className="conversation-time">
                    {relativeTime(conversation.lastMessageAt || conversation.createdAt)}
                  </span>
                </div>
                <div className="conversation-bottom">
                  <span className="conversation-preview">
                    {conversation.muted && <VolumeX size={12} />}
                    {truncate(preview, 42)}
                  </span>
                  {conversation.unreadCount > 0 && (
                    <span className="unread-badge">
                      {conversation.unreadCount > 99 ? '99+' : conversation.unreadCount}
                    </span>
                  )}
                </div>
              </div>
            </Link>
          );
        })}
      </div>

      <div className="sidebar-user" ref={menuRef}>
        {menuOpen && (
          <div className="user-menu">
            <div className="user-menu-head">
              <Avatar name={user?.displayName || 'Você'} src={user?.avatarUrl} size={38} presence={user?.presence} />
              <div>
                <strong>{user?.displayName}</strong>
                <span>@{user?.username}</span>
              </div>
            </div>
            <div className="user-menu-presence">
              {PRESENCES.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  className={classNames('presence-option', user?.presence === item.value && 'active')}
                  onClick={() => void changePresence(item.value)}
                >
                  <span className={`presence-swatch presence-${item.value}`} />
                  <span>
                    <strong>{item.label}</strong>
                    <small>{item.hint}</small>
                  </span>
                </button>
              ))}
            </div>
            <Link to="/app/settings" className="menu-row" onClick={() => setMenuOpen(false)}>
              <Settings size={16} /> Configurações
            </Link>
            <button type="button" className="menu-row danger" onClick={() => void handleLogout()}>
              <LogOut size={16} /> Sair da conta
            </button>
          </div>
        )}
        <button
          type="button"
          className="user-trigger"
          onClick={() => setMenuOpen((value) => !value)}
          aria-expanded={menuOpen}
        >
          <Avatar name={user?.displayName || 'Você'} src={user?.avatarUrl} size={36} presence={user?.presence} />
          <div>
            <strong>{user?.displayName}</strong>
            <span>@{user?.username}</span>
          </div>
          <ChevronDown size={16} className={classNames('chevron', menuOpen && 'open')} />
        </button>
      </div>
    </aside>
  );
}
