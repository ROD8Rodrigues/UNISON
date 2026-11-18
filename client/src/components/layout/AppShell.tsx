import { useCallback, useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { Bell, Menu, MessageCircle, Plus, Settings, Users } from 'lucide-react';
import { classNames } from '../../lib/utils';
import { useAppStore } from '../../store/app';
import { Logo } from '../ui/Logo';
import { CreateSpaceModal } from '../spaces/CreateSpaceModal';
import { NewConversationModal } from '../chat/NewConversationModal';
import { EmailVerificationBanner } from './EmailVerificationBanner';
import { NotificationCenter } from './NotificationCenter';
import { Sidebar } from './Sidebar';
import { SpaceRail } from './SpaceRail';

export function AppShell() {
  const location = useLocation();
  const conversations = useAppStore((state) => state.conversations);
  const incomingRequests = useAppStore((state) => state.incomingRequests);
  const unreadNotifications = useAppStore((state) => state.unreadNotifications);
  const unreadTotal = conversations.reduce((total, item) => total + item.unreadCount, 0);
  const [newConversationOpen, setNewConversationOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [createSpaceOpen, setCreateSpaceOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const closeNotifications = useCallback(() => setNotificationsOpen(false), []);
  const chatOpen = /^\/app\/(dm\/[^/]+|spaces\/[^/]+\/channels\/[^/]+)/.test(location.pathname);
  const spaceMode = /^\/app\/spaces\/[^/]+/.test(location.pathname);

  useEffect(() => {
    setSidebarOpen(false);
  }, [location.pathname]);

  return (
    <div className={classNames('app-shell', chatOpen && 'chat-open', spaceMode && 'space-mode')}>
      <SpaceRail onCreateSpace={() => setCreateSpaceOpen(true)} />
      <Sidebar
        mobileOpen={sidebarOpen}
        onNewConversation={() => setNewConversationOpen(true)}
        onOpenNotifications={() => setNotificationsOpen(true)}
      />
      <div
        className={classNames('sidebar-backdrop', sidebarOpen && 'show')}
        onClick={() => setSidebarOpen(false)}
        aria-hidden="true"
      />
      <main className="workspace">
        {!chatOpen && (
          <header className="mobile-topbar">
            <button
              type="button"
              className="icon-btn ghost"
              onClick={() => setSidebarOpen(true)}
              aria-label="Abrir conversas"
            >
              <Menu size={21} />
            </button>
            <span className="mobile-topbar-brand">
              <Logo size={28} withWord />
            </span>
            <button
              type="button"
              className="icon-btn ghost notification-trigger"
              onClick={() => setNotificationsOpen(true)}
              aria-label="Notificações"
            >
              <Bell size={19} />
              {unreadNotifications > 0 && (
                <span className="count-badge">{unreadNotifications > 99 ? '99+' : unreadNotifications}</span>
              )}
            </button>
          </header>
        )}
        <EmailVerificationBanner />
        <Outlet />
      </main>

      <nav className="mobile-nav" aria-label="Navegação principal">
        <NavLink to="/app" end className={({ isActive }) => classNames('mobile-tab', isActive && 'active')}>
          <span className="mobile-tab-icon">
            <MessageCircle size={20} />
            {unreadTotal > 0 && (
              <span className="count-badge">{unreadTotal > 99 ? '99+' : unreadTotal}</span>
            )}
          </span>
          <span>Conversas</span>
        </NavLink>
        <NavLink to="/app/spaces" className={({ isActive }) => classNames('mobile-tab', isActive && 'active')}>
          <span className="mobile-tab-icon">
            <Users size={20} />
          </span>
          <span>Espaços</span>
        </NavLink>
        <NavLink to="/app/friends" className={({ isActive }) => classNames('mobile-tab', isActive && 'active')}>
          <span className="mobile-tab-icon">
            <Users size={20} />
            {incomingRequests.length > 0 && (
              <span className="count-badge">{incomingRequests.length}</span>
            )}
          </span>
          <span>Amigos</span>
        </NavLink>
        <NavLink to="/app/settings" className={({ isActive }) => classNames('mobile-tab', isActive && 'active')}>
          <span className="mobile-tab-icon">
            <Settings size={20} />
          </span>
          <span>Ajustes</span>
        </NavLink>
      </nav>

      <button
        type="button"
        className="mobile-compose"
        onClick={() => setNewConversationOpen(true)}
        aria-label="Nova conversa"
      >
        <Plus size={22} />
      </button>

      <NewConversationModal
        open={newConversationOpen}
        onClose={() => setNewConversationOpen(false)}
      />
      <NotificationCenter open={notificationsOpen} onClose={closeNotifications} />
      <CreateSpaceModal open={createSpaceOpen} onClose={() => setCreateSpaceOpen(false)} />
    </div>
  );
}
