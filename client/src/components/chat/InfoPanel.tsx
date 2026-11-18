import { useEffect, useState } from 'react';
import {
  Ban,
  CalendarDays,
  Hash,
  Lock,
  MessageCircle,
  Settings2,
  ShieldCheck,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import { api, ApiError } from '../../lib/api';
import type { Channel, Conversation, ConversationMember, Presence, User } from '../../lib/types';
import { formatDate, lastSeenLabel, presenceLabel } from '../../lib/utils';
import { useAppStore } from '../../store/app';
import { confirmDialog } from '../../store/dialog';
import { toast } from '../../store/toast';
import { Avatar } from '../ui/Avatar';
import { Spinner } from '../ui/Spinner';

interface ChannelMember {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  presence: Presence;
  joinedAt: string;
}

interface Relationship {
  friend: boolean;
  blockedByMe: boolean;
  canMessage: boolean;
  pendingRequest: { id: string; direction: 'incoming' | 'outgoing' } | null;
}

function MemberRow({
  member,
  canManage,
  onOpenSettings,
}: {
  member: ConversationMember;
  canManage: boolean;
  onOpenSettings?: () => void;
}) {
  return (
    <div className="info-member">
      <Avatar name={member.displayName} src={member.avatarUrl} size={38} presence={member.presence} />
      <div className="info-member-copy">
        <strong>
          {member.displayName}
          {member.role !== 'member' && (
            <span className={`role-chip role-${member.role}`}>
              <ShieldCheck size={11} /> {member.role === 'owner' ? 'Dono' : 'Admin'}
            </span>
          )}
        </strong>
        <span>
          @{member.username} · {presenceLabel(member.presence)}
        </span>
        {member.customStatus && <small>{member.customStatus}</small>}
      </div>
      {canManage && onOpenSettings && member.role !== 'owner' && (
        <button
          type="button"
          className="icon-btn ghost"
          onClick={onOpenSettings}
          aria-label="Gerenciar membro"
          title="Gerenciar membro"
        >
          <Settings2 size={15} />
        </button>
      )}
    </div>
  );
}

export function InfoPanel({
  conversation,
  channel,
  onClose,
  onOpenGroupSettings,
}: {
  conversation: Conversation;
  channel?: Channel | null;
  onClose: () => void;
  onOpenGroupSettings?: () => void;
}) {
  const friends = useAppStore((state) => state.friends);
  const [channelMembers, setChannelMembers] = useState<ChannelMember[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [relationship, setRelationship] = useState<Relationship | null>(null);
  const [busy, setBusy] = useState(false);
  const other = conversation.otherUser;
  const otherId = other?.id;
  const channelId = channel?.id;
  const canManageGroup = ['owner', 'admin'].includes(conversation.myRole);
  const isFriend = other ? friends.some((friend) => friend.id === other.id) : false;

  useEffect(() => {
    if (!channelId) return;
    let cancelled = false;
    setLoadingMembers(true);
    api
      .get<{ members: ChannelMember[] }>(`/channels/${channelId}/members`)
      .then((data) => {
        if (!cancelled) setChannelMembers(data.members);
      })
      .catch(() => {
        if (!cancelled) setChannelMembers([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingMembers(false);
      });
    return () => {
      cancelled = true;
    };
  }, [channelId]);

  useEffect(() => {
    if (!otherId) return;
    let cancelled = false;
    api
      .get<{ user: User; relationship: Relationship }>(`/users/${otherId}`)
      .then((data) => {
        if (!cancelled) setRelationship(data.relationship);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [otherId]);

  async function toggleBlock() {
    if (!other) return;
    const blocked = relationship?.blockedByMe;
    const ok = await confirmDialog({
      title: blocked ? `Desbloquear ${other.displayName}?` : `Bloquear ${other.displayName}?`,
      message: blocked
        ? 'Vocês poderão voltar a trocar mensagens e pedidos de amizade.'
        : 'A pessoa não poderá enviar mensagens nem pedidos de amizade para você.',
      confirmLabel: blocked ? 'Desbloquear' : 'Bloquear',
      danger: !blocked,
    });
    if (!ok) return;
    setBusy(true);
    try {
      if (blocked) await api.delete(`/friends/blocks/${other.id}`);
      else await api.post(`/friends/blocks/${other.id}`);
      setRelationship((current) =>
        current ? { ...current, blockedByMe: !blocked, friend: blocked ? current.friend : false } : current,
      );
      await useAppStore.getState().refreshFriends().catch(() => undefined);
      await useAppStore.getState().refreshBlocked().catch(() => undefined);
      toast.success(blocked ? 'Usuário desbloqueado' : 'Usuário bloqueado');
    } catch (error) {
      toast.error(
        'Não foi possível concluir',
        error instanceof ApiError ? error.message : undefined,
      );
    } finally {
      setBusy(false);
    }
  }

  async function addFriend() {
    if (!other) return;
    setBusy(true);
    try {
      await api.post('/friends/requests', { username: other.username });
      setRelationship((current) =>
        current
          ? { ...current, pendingRequest: { id: 'pending', direction: 'outgoing' } }
          : current,
      );
      await useAppStore.getState().refreshRequests().catch(() => undefined);
      toast.success('Pedido enviado', `Convite enviado para @${other.username}.`);
    } catch (error) {
      toast.error(
        'Não foi possível enviar o pedido',
        error instanceof ApiError ? error.message : undefined,
      );
    } finally {
      setBusy(false);
    }
  }

  const members = channel ? channelMembers : conversation.members;

  return (
    <aside className="info-panel">
      <header className="info-head">
        <h2>Detalhes</h2>
        <button type="button" className="icon-btn ghost" onClick={onClose} aria-label="Fechar detalhes">
          <X size={17} />
        </button>
      </header>

      <div className="info-scroll">
        {channel ? (
          <section className="info-hero">
            <span className="info-hero-icon">
              <Hash size={30} />
            </span>
            <h3>#{channel.name}</h3>
            <p>{channel.topic || 'Canal do espaço.'}</p>
            <div className="info-chips">
              <span>
                <Users size={13} /> {members.length} membros
              </span>
              {channel.isPrivate && (
                <span>
                  <Lock size={13} /> Privado
                </span>
              )}
            </div>
          </section>
        ) : other ? (
          <section className="info-hero profile-hero">
            <Avatar name={other.displayName} src={other.avatarUrl} size={86} presence={other.presence} />
            <h3>{other.displayName}</h3>
            <p className="info-username">@{other.username}</p>
            {other.customStatus && <p className="info-status">{other.customStatus}</p>}
            <span className="info-lastseen">
              {lastSeenLabel(other.lastSeen, other.presence)}
            </span>
            {other.bio && <p className="info-bio">{other.bio}</p>}
            <div className="info-actions">
              {!isFriend && relationship && !relationship.blockedByMe && !relationship.pendingRequest && (
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => void addFriend()} disabled={busy}>
                  {busy ? <Spinner size={14} /> : <UserPlus size={15} />} Adicionar amigo
                </button>
              )}
              {relationship?.pendingRequest?.direction === 'outgoing' && (
                <span className="muted-label">Pedido de amizade pendente</span>
              )}
              <button
                type="button"
                className="btn btn-ghost btn-sm danger-text"
                onClick={() => void toggleBlock()}
                disabled={busy}
              >
                <Ban size={15} /> {relationship?.blockedByMe ? 'Desbloquear' : 'Bloquear'}
              </button>
            </div>
            {relationship?.blockedByMe && (
              <div className="info-warning">
                Você bloqueou esta pessoa. Desbloqueie para voltar a conversar.
              </div>
            )}
          </section>
        ) : (
          <section className="info-hero">
            <Avatar name={conversation.title || 'Grupo'} src={conversation.avatarUrl} size={86} rounded={false} />
            <h3>{conversation.title || 'Grupo'}</h3>
            <p className="info-username">Grupo · {conversation.memberCount} participantes</p>
            <div className="info-actions">
              {canManageGroup && onOpenGroupSettings && (
                <button type="button" className="btn btn-secondary btn-sm" onClick={onOpenGroupSettings}>
                  <Settings2 size={15} /> Editar grupo
                </button>
              )}
            </div>
          </section>
        )}

        {!channel && !other && (
          <section className="info-section">
            <h4>Boas práticas</h4>
            <p className="info-note">
              Use <strong>@nome</strong> para mencionar alguém. Administradores podem fixar mensagens
              importantes e remover conteúdo inadequado.
            </p>
          </section>
        )}

        <section className="info-section">
          <h4>
            {channel ? 'Membros do canal' : 'Participantes'} ({members.length})
          </h4>
          {loadingMembers ? (
            <div className="info-loading">
              <Spinner size={18} /> Carregando…
            </div>
          ) : conversation.type === 'dm' && other ? (
            <div className="info-member">
              <Avatar name={other.displayName} src={other.avatarUrl} size={38} presence={other.presence} />
              <div className="info-member-copy">
                <strong>Você e {other.displayName}</strong>
                <span>Conversa direta</span>
              </div>
              <MessageCircle size={15} />
            </div>
          ) : channel ? (
            channelMembers.map((member) => (
              <div className="info-member" key={member.id}>
                <Avatar name={member.displayName} src={member.avatarUrl} size={36} presence={member.presence} />
                <div className="info-member-copy">
                  <strong>{member.displayName}</strong>
                  <span>@{member.username}</span>
                </div>
                <span className="info-member-presence">{presenceLabel(member.presence)}</span>
              </div>
            ))
          ) : (
            conversation.members.map((member) => (
              <MemberRow
                key={member.id}
                member={member}
                canManage={canManageGroup && Boolean(onOpenGroupSettings)}
                onOpenSettings={onOpenGroupSettings}
              />
            ))
          )}
        </section>

        <section className="info-section info-meta">
          <div>
            <CalendarDays size={14} />
            <span>Criado em {formatDate(conversation.createdAt)}</span>
          </div>
          {conversation.type === 'channel' && (
            <div>
              <Lock size={14} />
              <span>Acesso controlado pelo espaço</span>
            </div>
          )}
        </section>
      </div>
    </aside>
  );
}
