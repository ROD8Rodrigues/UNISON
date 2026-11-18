import { Link } from 'react-router-dom';
import {
  ArrowUpRight,
  Bell,
  Compass,
  MessageCircle,
  Plus,
  Sparkles,
  UserPlus,
  Users,
  VolumeX,
} from 'lucide-react';
import { useState } from 'react';
import { formatTime, relativeTime, truncate } from '../lib/utils';
import { useAppStore } from '../store/app';
import { useAuthStore } from '../store/auth';
import { Avatar } from '../components/ui/Avatar';
import { NewConversationModal } from '../components/chat/NewConversationModal';
import { EmptyState } from '../components/ui/EmptyState';

export function ConversationsPage() {
  const user = useAuthStore((state) => state.user);
  const conversations = useAppStore((state) => state.conversations);
  const friends = useAppStore((state) => state.friends);
  const spaces = useAppStore((state) => state.spaces);
  const notifications = useAppStore((state) => state.notifications);
  const [newConversationOpen, setNewConversationOpen] = useState(false);
  const unread = conversations.reduce((total, item) => total + item.unreadCount, 0);
  const onlineFriends = friends.filter((friend) => friend.presence !== 'offline');
  const recent = conversations.slice(0, 6);
  const initials = user?.displayName?.split(' ')[0] || 'você';

  return (
    <div className="home-page">
      <header className="home-hero">
        <div className="home-hero-copy">
          <span className="eyebrow">
            <Sparkles size={14} /> Seu espaço de trabalho
          </span>
          <h1>Olá, {initials}.</h1>
          <p>
            {unread > 0
              ? `Você tem ${unread} ${unread === 1 ? 'mensagem não lida' : 'mensagens não lidas'}.`
              : 'Tudo em dia por aqui. Retome uma conversa ou encontre sua equipe.'}
          </p>
          <div className="home-hero-actions">
            <button
              type="button"
              className="btn btn-primary btn-lg"
              onClick={() => setNewConversationOpen(true)}
            >
              <Plus size={18} /> Nova conversa
            </button>
            <Link to="/app/friends" className="btn btn-secondary btn-lg">
              <UserPlus size={18} /> Encontrar pessoas
            </Link>
          </div>
        </div>
        <div className="home-hero-panel">
          <div className="hero-stat">
            <span className="hero-stat-icon">
              <MessageCircle size={19} />
            </span>
            <div>
              <strong>{conversations.length}</strong>
              <span>conversas ativas</span>
            </div>
          </div>
          <div className="hero-stat">
            <span className="hero-stat-icon">
              <Users size={19} />
            </span>
            <div>
              <strong>{onlineFriends.length}</strong>
              <span>{onlineFriends.length === 1 ? 'amigo online' : 'amigos online'}</span>
            </div>
          </div>
          <div className="hero-stat">
            <span className="hero-stat-icon">
              <Compass size={19} />
            </span>
            <div>
              <strong>{spaces.length}</strong>
              <span>{spaces.length === 1 ? 'espaço' : 'espaços'}</span>
            </div>
          </div>
          <div className="hero-stat">
            <span className="hero-stat-icon">
              <Bell size={19} />
            </span>
            <div>
              <strong>{notifications.filter((item) => !item.readAt).length}</strong>
              <span>avisos não lidos</span>
            </div>
          </div>
        </div>
      </header>

      <div className="home-grid">
        <section className="home-section home-conversations">
          <header className="section-title-row">
            <div>
              <h2>Continuar de onde parou</h2>
              <p>Suas conversas mais recentes.</p>
            </div>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setNewConversationOpen(true)}>
              <Plus size={15} /> Nova
            </button>
          </header>

          {recent.length === 0 ? (
            <EmptyState
              icon={<MessageCircle size={26} />}
              title="Nenhuma conversa ainda"
              message="Comece uma conversa direta com um amigo ou crie um grupo para a sua equipe."
              action={
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => setNewConversationOpen(true)}
                >
                  <Plus size={16} /> Iniciar conversa
                </button>
              }
            />
          ) : (
            <div className="home-conversation-list">
              {recent.map((conversation) => {
                const title =
                  conversation.title || conversation.otherUser?.displayName || 'Conversa';
                return (
                  <Link
                    key={conversation.id}
                    to={`/app/dm/${conversation.id}`}
                    className="home-conversation"
                  >
                    <Avatar
                      name={title}
                      src={
                        conversation.avatarUrl ||
                        (conversation.type === 'dm' ? conversation.otherUser?.avatarUrl : null)
                      }
                      size={46}
                      presence={
                        conversation.type === 'dm' ? conversation.otherUser?.presence : null
                      }
                    />
                    <div className="home-conversation-copy">
                      <div>
                        <strong>{title}</strong>
                        {conversation.type === 'group' && (
                          <span className="type-tag">
                            <Users size={11} /> grupo
                          </span>
                        )}
                        <time>
                          {relativeTime(conversation.lastMessageAt || conversation.createdAt)}
                        </time>
                      </div>
                      <p>
                        {conversation.muted && <VolumeX size={12} />}
                        {truncate(conversation.lastMessagePreview || 'Sem mensagens ainda', 90)}
                      </p>
                    </div>
                    {conversation.unreadCount > 0 ? (
                      <span className="unread-badge">
                        {conversation.unreadCount > 99 ? '99+' : conversation.unreadCount}
                      </span>
                    ) : (
                      <ArrowUpRight size={17} className="home-arrow" />
                    )}
                  </Link>
                );
              })}
            </div>
          )}
        </section>

        <aside className="home-aside">
          <section className="home-section home-friends">
            <header className="section-title-row">
              <div>
                <h2>Pessoas</h2>
                <p>{onlineFriends.length} online agora.</p>
              </div>
              <Link to="/app/friends" className="mini-link">
                Ver todos
              </Link>
            </header>
            {friends.length === 0 ? (
              <div className="home-friend-empty">
                <UserPlus size={20} />
                <p>Construa sua rede para conversar mais rápido.</p>
                <Link to="/app/friends" className="btn btn-secondary btn-sm">
                  Adicionar amigos
                </Link>
              </div>
            ) : (
              <div className="home-friends-list">
                {friends.slice(0, 5).map((friend) => (
                  <Link
                    to={`/app/friends?userId=${friend.id}`}
                    key={friend.id}
                    className="home-friend"
                  >
                    <Avatar
                      name={friend.displayName}
                      src={friend.avatarUrl}
                      size={38}
                      presence={friend.presence}
                    />
                    <div>
                      <strong>{friend.displayName}</strong>
                      <span>@{friend.username}</span>
                    </div>
                    <span className={`presence-text presence-${friend.presence}`}>
                      {friend.presence === 'online'
                        ? 'online'
                        : friend.presence === 'offline'
                          ? 'offline'
                          : friend.presence === 'dnd'
                            ? 'ocupado'
                            : 'ausente'}
                    </span>
                  </Link>
                ))}
              </div>
            )}
          </section>

          <section className="home-section home-notifications">
            <header className="section-title-row">
              <div>
                <h2>Avisos recentes</h2>
                <p>Menções e novidades.</p>
              </div>
            </header>
            {notifications.length === 0 ? (
              <p className="muted-label">Nada por aqui por enquanto.</p>
            ) : (
              <div className="home-notifications-list">
                {notifications.slice(0, 4).map((notification) => (
                  <div
                    key={notification.id}
                    className={`home-notification${notification.readAt ? '' : ' unread'}`}
                  >
                    <span className="home-notification-dot" />
                    <div>
                      <strong>{notification.title}</strong>
                      <p>{truncate(notification.body || 'UNISON', 80)}</p>
                      <time>
                        {formatTime(notification.createdAt) || relativeTime(notification.createdAt)}
                      </time>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="home-section home-spaces">
            <header className="section-title-row">
              <div>
                <h2>Espaços</h2>
                <p>Comunidades e canais.</p>
              </div>
              <Link to="/app/spaces" className="mini-link">
                Explorar
              </Link>
            </header>
            {spaces.length === 0 ? (
              <div className="home-spaces-empty">
                <Compass size={20} />
                <p>Crie um espaço ou descubra comunidades públicas.</p>
                <Link to="/app/spaces" className="btn btn-secondary btn-sm">
                  Descobrir espaços
                </Link>
              </div>
            ) : (
              <div className="home-spaces-list">
                {spaces.slice(0, 4).map((space) => (
                  <Link key={space.id} to={`/app/spaces/${space.id}`} className="home-space">
                    <Avatar name={space.name} src={space.iconUrl} size={36} rounded={false} />
                    <div>
                      <strong>{space.name}</strong>
                      <span>
                        {space.memberCount} membros · {space.channelCount} canais
                      </span>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </section>
        </aside>
      </div>

      <NewConversationModal
        open={newConversationOpen}
        onClose={() => setNewConversationOpen(false)}
      />
    </div>
  );
}
