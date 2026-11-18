import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Ban,
  Check,
  MessageCircle,
  Search,
  ShieldOff,
  UserCheck,
  UserMinus,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import { api, ApiError, queryString } from '../lib/api';
import type { User } from '../lib/types';
import { classNames, lastSeenLabel, presenceLabel, truncate } from '../lib/utils';
import { useAppStore } from '../store/app';
import { useAuthStore } from '../store/auth';
import { confirmDialog } from '../store/dialog';
import { toast } from '../store/toast';
import { Avatar } from '../components/ui/Avatar';
import { EmptyState } from '../components/ui/EmptyState';
import { Modal } from '../components/ui/Modal';
import { Spinner } from '../components/ui/Spinner';
import type { Conversation } from '../lib/types';

type Tab = 'friends' | 'requests' | 'blocked' | 'discover';

const TABS: { id: Tab; label: string; icon: typeof Users }[] = [
  { id: 'friends', label: 'Amigos', icon: Users },
  { id: 'requests', label: 'Pedidos', icon: UserPlus },
  { id: 'blocked', label: 'Bloqueados', icon: ShieldOff },
  { id: 'discover', label: 'Descobrir', icon: Search },
];

function errorMessage(error: unknown) {
  return error instanceof ApiError ? error.message : undefined;
}

export function FriendsPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const initialTab = searchParams.get('tab');
  const [tab, setTab] = useState<Tab>(
    initialTab === 'requests' || initialTab === 'blocked' || initialTab === 'discover'
      ? initialTab
      : 'friends',
  );
  const friends = useAppStore((state) => state.friends);
  const incoming = useAppStore((state) => state.incomingRequests);
  const outgoing = useAppStore((state) => state.outgoingRequests);
  const blocked = useAppStore((state) => state.blockedUsers);
  const refreshFriends = useAppStore((state) => state.refreshFriends);
  const refreshRequests = useAppStore((state) => state.refreshRequests);
  const refreshBlocked = useAppStore((state) => state.refreshBlocked);
  const user = useAuthStore((state) => state.user);
  const [filter, setFilter] = useState('');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<User[]>([]);
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [profile, setProfile] = useState<User | null>(null);
  const [profileRelationship, setProfileRelationship] = useState<{
    friend: boolean;
    blockedByMe: boolean;
    canMessage: boolean;
    pendingRequest: { id: string; direction: 'incoming' | 'outgoing' } | null;
  } | null>(null);

  useEffect(() => {
    void refreshFriends();
    void refreshRequests();
    void refreshBlocked();
  }, [refreshBlocked, refreshFriends, refreshRequests]);

  useEffect(() => {
    const requested = searchParams.get('userId');
    if (!requested) return;
    if (friends.some((friend) => friend.id === requested)) {
      const found = friends.find((friend) => friend.id === requested) || null;
      setProfile(found);
    } else {
      api
        .get<{
          user: User;
          relationship: typeof profileRelationship;
        }>(`/users/${requested}`)
        .then((data) => {
          setProfile(data.user);
          setProfileRelationship(data.relationship);
        })
        .catch(() => undefined);
    }
    const next = new URLSearchParams(searchParams);
    next.delete('userId');
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, friends]);

  useEffect(() => {
    if (tab !== 'discover' || query.trim().length < 2) {
      setResults([]);
      setSearching(false);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const timer = window.setTimeout(async () => {
      try {
        const data = await api.get<{ users: User[] }>(
          `/users/search${queryString({ q: query.trim() })}`,
        );
        if (!cancelled) setResults(data.users);
      } catch {
        if (!cancelled) setResults([]);
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 280);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [tab, query]);

  function changeTab(nextTab: Tab) {
    setTab(nextTab);
    setFilter('');
    const next = new URLSearchParams(searchParams);
    next.set('tab', nextTab);
    setSearchParams(next, { replace: true });
  }

  const filteredFriends = useMemo(() => {
    const term = filter.trim().toLowerCase();
    if (!term) return friends;
    return friends.filter(
      (friend) =>
        friend.displayName.toLowerCase().includes(term) ||
        friend.username.toLowerCase().includes(term),
    );
  }, [friends, filter]);

  const friendIds = useMemo(() => new Set(friends.map((friend) => friend.id)), [friends]);
  const blockedIds = useMemo(() => new Set(blocked.map((item) => item.id)), [blocked]);
  const incomingFromIds = useMemo(
    () => new Set(incoming.map((request) => request.sender.id)),
    [incoming],
  );
  const outgoingToIds = useMemo(
    () => new Set(outgoing.map((request) => request.receiver.id)),
    [outgoing],
  );

  async function openConversation(target: User) {
    setBusy(`dm:${target.id}`);
    try {
      const data = await api.post<{ conversation: Conversation }>('/conversations/dm', {
        userId: target.id,
      });
      useAppStore.getState().upsertConversation(data.conversation);
      setProfile(null);
      navigate(`/app/dm/${data.conversation.id}`);
    } catch (error) {
      toast.error('Não foi possível abrir a conversa', errorMessage(error));
    } finally {
      setBusy(null);
    }
  }

  async function sendRequest(target: User) {
    setBusy(`request:${target.id}`);
    try {
      await api.post('/friends/requests', { username: target.username });
      await refreshRequests();
      toast.success('Pedido enviado', `Convite enviado para @${target.username}.`);
    } catch (error) {
      toast.error('Não foi possível enviar o pedido', errorMessage(error));
    } finally {
      setBusy(null);
    }
  }

  async function acceptRequest(requestId: string, name: string) {
    setBusy(`accept:${requestId}`);
    try {
      await api.post(`/friends/requests/${requestId}/accept`);
      await Promise.all([refreshFriends(), refreshRequests()]);
      toast.success('Pedido aceito', `${name} agora faz parte da sua rede.`);
    } catch (error) {
      toast.error('Não foi possível aceitar', errorMessage(error));
    } finally {
      setBusy(null);
    }
  }

  async function rejectRequest(requestId: string) {
    setBusy(`reject:${requestId}`);
    try {
      await api.post(`/friends/requests/${requestId}/reject`);
      await refreshRequests();
      toast.info('Pedido recusado');
    } catch (error) {
      toast.error('Não foi possível recusar', errorMessage(error));
    } finally {
      setBusy(null);
    }
  }

  async function cancelOutgoing(target: User) {
    const ok = await confirmDialog({
      title: 'Cancelar pedido?',
      message: `O pedido de amizade para ${target.displayName} será retirado.`,
      confirmLabel: 'Cancelar pedido',
      cancelLabel: 'Manter',
    });
    if (!ok) return;
    setBusy(`cancel:${target.id}`);
    try {
      await api.delete(`/friends/${target.id}`);
      await refreshRequests();
      toast.info('Pedido cancelado');
    } catch (error) {
      toast.error('Não foi possível cancelar', errorMessage(error));
    } finally {
      setBusy(null);
    }
  }

  async function removeFriend(target: User) {
    const ok = await confirmDialog({
      title: `Remover ${target.displayName}?`,
      message: 'Vocês deixarão de aparecer na lista de amigos um do outro. O histórico das conversas continua.',
      confirmLabel: 'Remover amigo',
      danger: true,
    });
    if (!ok) return;
    setBusy(`remove:${target.id}`);
    try {
      await api.delete(`/friends/${target.id}`);
      await refreshFriends();
      setProfile(null);
      toast.success('Amigo removido');
    } catch (error) {
      toast.error('Não foi possível remover', errorMessage(error));
    } finally {
      setBusy(null);
    }
  }

  async function blockUser(target: User) {
    const ok = await confirmDialog({
      title: `Bloquear ${target.displayName}?`,
      message: 'A pessoa não poderá enviar mensagens nem pedidos de amizade para você.',
      confirmLabel: 'Bloquear',
      danger: true,
    });
    if (!ok) return;
    setBusy(`block:${target.id}`);
    try {
      await api.post(`/friends/blocks/${target.id}`);
      await Promise.all([refreshFriends(), refreshRequests(), refreshBlocked()]);
      setProfile(null);
      toast.success('Usuário bloqueado');
    } catch (error) {
      toast.error('Não foi possível bloquear', errorMessage(error));
    } finally {
      setBusy(null);
    }
  }

  async function unblockUser(target: User) {
    setBusy(`unblock:${target.id}`);
    try {
      await api.delete(`/friends/blocks/${target.id}`);
      await refreshBlocked();
      toast.success('Usuário desbloqueado');
    } catch (error) {
      toast.error('Não foi possível desbloquear', errorMessage(error));
    } finally {
      setBusy(null);
    }
  }

  function openProfile(target: User) {
    setProfile(target);
    setProfileRelationship(null);
    api
      .get<{ user: User; relationship: NonNullable<typeof profileRelationship> }>(`/users/${target.id}`)
      .then((data) => setProfileRelationship(data.relationship))
      .catch(() => undefined);
  }

  const profileIsFriend = profile ? friendIds.has(profile.id) : false;
  const profileIsBlocked = profile ? blockedIds.has(profile.id) : false;
  const profileIncoming = profile ? incoming.find((request) => request.sender.id === profile.id) : null;
  const profileOutgoing = profile ? outgoing.find((request) => request.receiver.id === profile.id) : null;
  const profilePending = profileRelationship?.pendingRequest;

  return (
    <div className="page friends-page">
      <header className="page-head">
        <div>
          <span className="eyebrow">
            <Users size={14} /> Sua rede
          </span>
          <h1>Amigos</h1>
          <p>Conecte-se, converse e controle quem pode falar com você.</p>
        </div>
        <div className="page-head-stats">
          <div>
            <strong>{friends.length}</strong>
            <span>amigos</span>
          </div>
          <div>
            <strong>{incoming.length}</strong>
            <span>pedidos</span>
          </div>
          <div>
            <strong>{friends.filter((friend) => friend.presence === 'online').length}</strong>
            <span>online</span>
          </div>
        </div>
      </header>

      <div className="compact-tabs" role="tablist" aria-label="Seções de amigos">
        {TABS.map((item) => {
          const Icon = item.icon;
          const badge =
            item.id === 'requests' && incoming.length > 0
              ? incoming.length
              : item.id === 'blocked' && blocked.length > 0
                ? blocked.length
                : null;
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={tab === item.id}
              className={classNames('compact-tab', tab === item.id && 'active')}
              onClick={() => changeTab(item.id)}
            >
              <Icon size={16} />
              {item.label}
              {badge && <span className="nav-badge">{badge}</span>}
            </button>
          );
        })}
      </div>

      {tab === 'friends' && (
        <section className="page-panel">
          <header className="section-title-row">
            <div>
              <h2>Todos os amigos</h2>
              <p>Pessoas com quem você já pode conversar.</p>
            </div>
            <div className="input-shell compact-search">
              <Search size={15} />
              <input
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
                placeholder="Filtrar amigos"
                aria-label="Filtrar amigos"
              />
            </div>
          </header>
          {filteredFriends.length === 0 ? (
            <EmptyState
              icon={<Users size={26} />}
              title={friends.length === 0 ? 'Sua rede está começando' : 'Nenhum amigo encontrado'}
              message={
                friends.length === 0
                  ? 'Busque pessoas pelo nome ou @usuário e envie um pedido de amizade.'
                  : 'Tente outro nome ou limpe o filtro.'
              }
              action={
                friends.length === 0 ? (
                  <button type="button" className="btn btn-primary" onClick={() => changeTab('discover')}>
                    <UserPlus size={16} /> Encontrar pessoas
                  </button>
                ) : undefined
              }
            />
          ) : (
            <div className="people-grid">
              {filteredFriends.map((friend) => (
                <article className="person-card" key={friend.id}>
                  <button type="button" className="person-card-main" onClick={() => openProfile(friend)}>
                    <Avatar
                      name={friend.displayName}
                      src={friend.avatarUrl}
                      size={54}
                      presence={friend.presence}
                    />
                    <div>
                      <strong>{friend.displayName}</strong>
                      <span>@{friend.username}</span>
                      <small>{friend.customStatus || lastSeenLabel(friend.lastSeen, friend.presence)}</small>
                    </div>
                  </button>
                  <div className="person-card-actions">
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => void openConversation(friend)}
                      disabled={busy === `dm:${friend.id}`}
                    >
                      {busy === `dm:${friend.id}` ? <Spinner size={14} /> : <MessageCircle size={14} />}
                      Conversar
                    </button>
                    <button
                      type="button"
                      className="icon-btn ghost"
                      onClick={() => void removeFriend(friend)}
                      disabled={busy === `remove:${friend.id}`}
                      aria-label={`Remover ${friend.displayName}`}
                      title="Remover amigo"
                    >
                      <UserMinus size={16} />
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      )}

      {tab === 'requests' && (
        <div className="two-column-grid">
          <section className="page-panel">
            <header className="section-title-row">
              <div>
                <h2>Recebidos</h2>
                <p>{incoming.length} pedido(s) aguardando você.</p>
              </div>
            </header>
            {incoming.length === 0 ? (
              <EmptyState
                compact
                icon={<UserCheck size={22} />}
                title="Nenhum pedido pendente"
                message="Quando alguém quiser se conectar, o pedido aparece aqui."
              />
            ) : (
              <div className="request-list">
                {incoming.map((request) => (
                  <div className="request-row" key={request.id}>
                    <Avatar
                      name={request.sender.displayName}
                      src={request.sender.avatarUrl}
                      size={42}
                      presence={request.sender.presence}
                    />
                    <button type="button" className="request-copy" onClick={() => openProfile(request.sender)}>
                      <strong>{request.sender.displayName}</strong>
                      <span>@{request.sender.username}</span>
                    </button>
                    <div className="request-actions">
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        onClick={() => void acceptRequest(request.id, request.sender.displayName)}
                        disabled={busy === `accept:${request.id}`}
                      >
                        {busy === `accept:${request.id}` ? <Spinner size={14} /> : <Check size={14} />}
                        Aceitar
                      </button>
                      <button
                        type="button"
                        className="icon-btn ghost"
                        onClick={() => void rejectRequest(request.id)}
                        disabled={busy === `reject:${request.id}`}
                        aria-label="Recusar pedido"
                        title="Recusar"
                      >
                        <X size={16} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="page-panel">
            <header className="section-title-row">
              <div>
                <h2>Enviados</h2>
                <p>Aguardando resposta.</p>
              </div>
            </header>
            {outgoing.length === 0 ? (
              <EmptyState
                compact
                icon={<UserPlus size={22} />}
                title="Nenhum pedido enviado"
                message="Encontre pessoas na aba Descobrir para ampliar sua rede."
              />
            ) : (
              <div className="request-list">
                {outgoing.map((request) => (
                  <div className="request-row" key={request.id}>
                    <Avatar
                      name={request.receiver.displayName}
                      src={request.receiver.avatarUrl}
                      size={42}
                      presence={request.receiver.presence}
                    />
                    <div className="request-copy">
                      <strong>{request.receiver.displayName}</strong>
                      <span>@{request.receiver.username}</span>
                    </div>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => void cancelOutgoing(request.receiver)}
                      disabled={busy === `cancel:${request.receiver.id}`}
                    >
                      Cancelar
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      )}

      {tab === 'blocked' && (
        <section className="page-panel">
          <header className="section-title-row">
            <div>
              <h2>Usuários bloqueados</h2>
              <p>Eles não podem enviar mensagens nem pedidos de amizade para você.</p>
            </div>
          </header>
          {blocked.length === 0 ? (
            <EmptyState
              icon={<ShieldOff size={26} />}
              title="Ninguém bloqueado"
              message="Sua lista de bloqueios está vazia."
            />
          ) : (
            <div className="request-list">
              {blocked.map((item) => (
                <div className="request-row" key={item.id}>
                  <Avatar name={item.displayName} src={item.avatarUrl} size={42} />
                  <div className="request-copy">
                    <strong>{item.displayName}</strong>
                    <span>@{item.username}</span>
                  </div>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => void unblockUser(item)}
                    disabled={busy === `unblock:${item.id}`}
                  >
                    {busy === `unblock:${item.id}` ? <Spinner size={14} /> : <ShieldOff size={14} />}
                    Desbloquear
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {tab === 'discover' && (
        <section className="page-panel">
          <header className="section-title-row">
            <div>
              <h2>Descobrir pessoas</h2>
              <p>Busque por nome ou @usuário. Envie um pedido para começar a conversar.</p>
            </div>
          </header>
          <div className="input-shell discover-search">
            <Search size={18} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Buscar pessoas no UNISON…"
              autoFocus
              aria-label="Buscar pessoas"
            />
            {searching && <Spinner size={16} />}
          </div>
          {query.trim().length < 2 ? (
            <EmptyState
              icon={<Search size={26} />}
              title="Encontre sua equipe"
              message="Digite pelo menos 2 caracteres para buscar pessoas."
            />
          ) : results.length === 0 && !searching ? (
            <EmptyState
              icon={<Users size={26} />}
              title="Nenhuma pessoa encontrada"
              message="Confira a grafia ou tente outro nome."
            />
          ) : (
            <div className="people-grid">
              {results
                .filter((person) => person.id !== user?.id)
                .map((person) => {
                  const isFriend = friendIds.has(person.id);
                  const isBlocked = blockedIds.has(person.id);
                  const hasIncoming = incomingFromIds.has(person.id);
                  const hasOutgoing = outgoingToIds.has(person.id);
                  return (
                    <article className="person-card" key={person.id}>
                      <button type="button" className="person-card-main" onClick={() => openProfile(person)}>
                        <Avatar
                          name={person.displayName}
                          src={person.avatarUrl}
                          size={54}
                          presence={person.presence}
                        />
                        <div>
                          <strong>{truncate(person.displayName, 24)}</strong>
                          <span>@{person.username}</span>
                          <small>{person.customStatus || presenceLabel(person.presence)}</small>
                        </div>
                      </button>
                      <div className="person-card-actions">
                        {isFriend ? (
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            onClick={() => void openConversation(person)}
                            disabled={busy === `dm:${person.id}`}
                          >
                            <MessageCircle size={14} /> Conversar
                          </button>
                        ) : isBlocked ? (
                          <span className="muted-label">Bloqueado</span>
                        ) : hasOutgoing ? (
                          <span className="muted-label">Pedido enviado</span>
                        ) : hasIncoming ? (
                          <button
                            type="button"
                            className="btn btn-primary btn-sm"
                            onClick={() => {
                              const request = incoming.find((item) => item.sender.id === person.id);
                              if (request) void acceptRequest(request.id, person.displayName);
                            }}
                          >
                            <Check size={14} /> Aceitar pedido
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            onClick={() => void sendRequest(person)}
                            disabled={busy === `request:${person.id}`}
                          >
                            {busy === `request:${person.id}` ? <Spinner size={14} /> : <UserPlus size={14} />}
                            Adicionar
                          </button>
                        )}
                        <button
                          type="button"
                          className="icon-btn ghost"
                          onClick={() => void blockUser(person)}
                          disabled={isBlocked || busy === `block:${person.id}`}
                          aria-label={`Bloquear ${person.displayName}`}
                          title="Bloquear"
                        >
                          <Ban size={15} />
                        </button>
                      </div>
                    </article>
                  );
                })}
            </div>
          )}
        </section>
      )}

      <Modal
        open={Boolean(profile)}
        onClose={() => {
          setProfile(null);
          setProfileRelationship(null);
        }}
        title={profile?.displayName || 'Perfil'}
        description={profile ? `@${profile.username}` : undefined}
        size="sm"
        footer={
          profile ? (
            <>
              {!profileIsBlocked && (
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => void openConversation(profile)}
                  disabled={busy === `dm:${profile.id}`}
                >
                  <MessageCircle size={16} /> Conversar
                </button>
              )}
              <button
                type="button"
                className={classNames('btn', profileIsBlocked ? 'btn-primary' : 'btn-ghost danger-text')}
                onClick={() => (profileIsBlocked ? void unblockUser(profile) : void blockUser(profile))}
                disabled={busy?.endsWith(profile.id)}
              >
                {profileIsBlocked ? <ShieldOff size={16} /> : <Ban size={16} />}
                {profileIsBlocked ? 'Desbloquear' : 'Bloquear'}
              </button>
            </>
          ) : null
        }
      >
        {profile && (
          <div className="profile-modal">
            <Avatar name={profile.displayName} src={profile.avatarUrl} size={88} presence={profile.presence} />
            <h3>{profile.displayName}</h3>
            <span className="info-username">@{profile.username}</span>
            <span className={`presence-text presence-${profile.presence}`}>
              {lastSeenLabel(profile.lastSeen, profile.presence)}
            </span>
            {profile.customStatus && <p className="profile-status">{profile.customStatus}</p>}
            {profile.bio && <p className="profile-bio">{profile.bio}</p>}
            <div className="profile-facts">
              <span>Membro desde {new Date(profile.createdAt).toLocaleDateString('pt-BR')}</span>
              {profile.emailVerified && <span>Email verificado</span>}
            </div>
            {!profileIsFriend && !profileIsBlocked && (
              <div className="profile-relationship">
                {profilePending?.direction === 'outgoing' || profileOutgoing ? (
                  <span className="muted-label">Pedido de amizade pendente</span>
                ) : profilePending?.direction === 'incoming' || profileIncoming ? (
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={() => {
                      const request = profileIncoming || incoming.find((item) => item.sender.id === profile.id);
                      if (request) void acceptRequest(request.id, profile.displayName);
                    }}
                  >
                    <Check size={14} /> Aceitar pedido de amizade
                  </button>
                ) : (
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => void sendRequest(profile)}
                    disabled={busy === `request:${profile.id}`}
                  >
                    <UserPlus size={14} /> Enviar pedido de amizade
                  </button>
                )}
              </div>
            )}
            {profileIsFriend && (
              <div className="profile-relationship">
                <UserCheck size={15} /> Vocês são amigos
                <button
                  type="button"
                  className="mini-link danger-text"
                  onClick={() => void removeFriend(profile)}
                >
                  Remover
                </button>
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
