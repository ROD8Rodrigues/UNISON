import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, Outlet, useNavigate, useOutletContext, useParams } from 'react-router-dom';
import {
  AlertCircle,
  ArrowRight,
  Compass,
  Globe,
  Hash,
  Lock,
  Plus,
  Settings2,
  Ticket,
  Users,
} from 'lucide-react';
import { api, ApiError } from '../lib/api';
import type { Channel, SpaceDetails } from '../lib/types';
import { classNames, truncate } from '../lib/utils';
import { useAppStore } from '../store/app';
import { confirmDialog } from '../store/dialog';
import { toast } from '../store/toast';
import { Avatar } from '../components/ui/Avatar';
import { EmptyState } from '../components/ui/EmptyState';
import { Spinner } from '../components/ui/Spinner';
import { CreateChannelModal } from '../components/spaces/CreateChannelModal';
import { SpaceSettingsModal } from '../components/spaces/SpaceSettingsModal';
import { SpaceSidebar } from '../components/spaces/SpaceSidebar';

export interface SpacePageContext {
  details: SpaceDetails;
  refresh: () => Promise<void>;
  openSettings: (tab?: string) => void;
  openInvites: () => void;
  openCreateChannel: () => void;
}

function groupChannels(channels: Channel[]) {
  const groups = new Map<string, Channel[]>();
  for (const channel of channels) {
    const category = channel.category || 'Geral';
    if (!groups.has(category)) groups.set(category, []);
    groups.get(category)!.push(channel);
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b, 'pt-BR'));
}

function SpaceOverview() {
  const { details, openSettings, openInvites, openCreateChannel } = useOutletContext<SpacePageContext>();
  const { space } = details;
  const permissions = new Set(details.myMember.permissions);
  const groups = useMemo(() => groupChannels(details.channels), [details.channels]);
  const firstChannel = details.channels[0];
  const canManageChannels = permissions.has('manage_channels');
  const canInvite = permissions.has('create_invites');
  const canManage = (
    [
      'manage_space',
      'manage_channels',
      'manage_members',
      'manage_roles',
      'kick_members',
      'ban_members',
      'create_invites',
      'view_audit',
    ] as const
  ).some((permission) => permissions.has(permission));

  return (
    <div className="space-overview">
      <header className="space-hero">
        <div className="space-hero-banner">
          {space.bannerUrl ? <img src={space.bannerUrl} alt="" /> : <span className="space-hero-pattern" />}
        </div>
        <div className="space-hero-body">
          <div className="space-hero-icon">
            <Avatar name={space.name} src={space.iconUrl} size={88} rounded={false} />
          </div>
          <div className="space-hero-copy">
            <div className="space-hero-title">
              <h1>{space.name}</h1>
              <span className={classNames('space-badge', space.visibility)}>
                {space.visibility === 'public' ? <Globe size={12} /> : <Lock size={12} />}
                {space.visibility === 'public' ? 'Público' : 'Privado'}
              </span>
            </div>
            <p>{space.description || 'Este espaço ainda não tem uma descrição.'}</p>
            <div className="space-hero-meta">
              <span>
                <Users size={14} /> {space.memberCount} membros
              </span>
              <span>
                <Hash size={14} /> {space.channelCount} canais
              </span>
              <span>Criado em {new Date(space.createdAt).toLocaleDateString('pt-BR')}</span>
            </div>
          </div>
          <div className="space-hero-actions">
            {firstChannel && (
              <Link
                to={`/app/spaces/${space.id}/channels/${firstChannel.id}`}
                className="btn btn-primary"
              >
                Abrir canais <ArrowRight size={16} />
              </Link>
            )}
            {canInvite && (
              <button type="button" className="btn btn-secondary" onClick={openInvites}>
                <Ticket size={16} /> Convidar
              </button>
            )}
            {canManage && (
              <button type="button" className="btn btn-ghost" onClick={() => openSettings()}>
                <Settings2 size={16} /> Ajustes
              </button>
            )}
          </div>
        </div>
      </header>

      <div className="space-overview-grid">
        <section className="space-overview-channels">
          <header className="section-title-row">
            <div>
              <h2>Canais</h2>
              <p>Escolha um assunto para participar.</p>
            </div>
            {canManageChannels && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={openCreateChannel}>
                <Plus size={15} /> Novo canal
              </button>
            )}
          </header>
          {details.channels.length === 0 ? (
            <EmptyState
              compact
              icon={<Hash size={22} />}
              title="Nenhum canal ainda"
              message="Crie o primeiro canal para começar as conversas."
              action={
                canManageChannels ? (
                  <button type="button" className="btn btn-primary btn-sm" onClick={openCreateChannel}>
                    <Plus size={15} /> Criar canal
                  </button>
                ) : undefined
              }
            />
          ) : (
            <div className="channel-group-grid">
              {groups.map(([category, channels]) => (
                <div className="channel-group-card" key={category}>
                  <header>
                    <span>{category}</span>
                    <small>{channels.length}</small>
                  </header>
                  {channels.map((channel) => (
                    <Link
                      key={channel.id}
                      to={`/app/spaces/${space.id}/channels/${channel.id}`}
                      className="channel-link-row"
                    >
                      <span className="channel-link-icon">
                        {channel.isPrivate ? <Lock size={15} /> : <Hash size={15} />}
                      </span>
                      <div>
                        <strong>{channel.name}</strong>
                        <span>{truncate(channel.topic || 'Sem tópico definido', 70)}</span>
                      </div>
                      {channel.unreadCount > 0 ? (
                        <span className="unread-badge">{channel.unreadCount}</span>
                      ) : (
                        <ArrowRight size={15} className="channel-arrow" />
                      )}
                    </Link>
                  ))}
                </div>
              ))}
            </div>
          )}
        </section>

        <aside className="space-overview-aside">
          <section className="overview-card">
            <header>
              <Users size={17} />
              <h3>Comunidade</h3>
            </header>
            <p>
              {space.memberCount} {space.memberCount === 1 ? 'pessoa participa' : 'pessoas participam'} deste
              espaço.
            </p>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => openSettings('members')}>
              Ver membros
            </button>
          </section>
          <section className="overview-card">
            <header>
              <Ticket size={17} />
              <h3>Convites</h3>
            </header>
            <p>
              {space.visibility === 'public'
                ? 'Este espaço é público. Compartilhe o link para trazer mais pessoas.'
                : 'Este espaço é privado. Gere um convite para permitir a entrada.'}
            </p>
            {canInvite ? (
              <button type="button" className="btn btn-secondary btn-sm" onClick={openInvites}>
                Gerenciar convites
              </button>
            ) : (
              <span className="muted-label">Peça a um administrador para convidar pessoas.</span>
            )}
          </section>
          <section className="overview-card subtle">
            <header>
              <Compass size={17} />
              <h3>Seu acesso</h3>
            </header>
            <p>
              Você entrou em {new Date(details.myMember.joinedAt).toLocaleDateString('pt-BR')}
              {details.myMember.nickname ? ` como ${details.myMember.nickname}` : ''}.
            </p>
            <div className="permission-summary">
              {details.myMember.permissions.includes('manage_space') && <span>Administração</span>}
              {details.myMember.permissions.includes('send_messages') && <span>Conversas</span>}
              {details.myMember.permissions.includes('create_invites') && <span>Convites</span>}
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}

export function SpacePage() {
  const { spaceId = '' } = useParams();
  const channelId = useParams().channelId || null;
  const navigate = useNavigate();
  const spaceVersion = useAppStore((state) => state.spaceVersion);
  const refreshSpaces = useAppStore((state) => state.refreshSpaces);
  const bumpSpaceVersion = useAppStore((state) => state.bumpSpaceVersion);
  const [details, setDetails] = useState<SpaceDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<string | undefined>(undefined);
  const [createChannelOpen, setCreateChannelOpen] = useState(false);

  const loadDetails = useCallback(async () => {
    const data = await api.get<SpaceDetails>(`/spaces/${spaceId}`);
    setDetails(data);
    setError('');
  }, [spaceId]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    setDetails(null);
    setSettingsOpen(false);
    useAppStore.getState().setActiveSpace(spaceId);
    api
      .get<SpaceDetails>(`/spaces/${spaceId}`)
      .then((data) => {
        if (!cancelled) setDetails(data);
      })
      .catch((requestError) => {
        if (cancelled) return;
        setError(
          requestError instanceof ApiError
            ? requestError.message
            : 'Não foi possível abrir este espaço.',
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      useAppStore.getState().setActiveSpace(null);
    };
  }, [spaceId, spaceVersion]);

  function openSettings(tab?: string) {
    setSettingsTab(tab);
    setSettingsOpen(true);
  }

  function openInvites() {
    openSettings('invites');
  }

  function openCreateChannel() {
    setSettingsOpen(false);
    setCreateChannelOpen(true);
  }

  async function leaveSpace() {
    if (!details) return;
    const ok = await confirmDialog({
      title: `Sair de ${details.space.name}?`,
      message: 'Você perderá o acesso aos canais e ao histórico deste espaço.',
      confirmLabel: 'Sair do espaço',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.post(`/spaces/${details.space.id}/leave`);
      await refreshSpaces();
      useAppStore.getState().bumpSpaceVersion();
      toast.success('Você saiu do espaço');
      navigate('/app/spaces');
    } catch (requestError) {
      toast.error(
        'Não foi possível sair',
        requestError instanceof ApiError ? requestError.message : undefined,
      );
    }
  }

  async function handleChannelCreated(channel: Channel) {
    bumpSpaceVersion();
    await Promise.all([
      loadDetails().catch(() => undefined),
      refreshSpaces().catch(() => undefined),
      useAppStore.getState().refreshConversations().catch(() => undefined),
    ]);
    navigate(`/app/spaces/${spaceId}/channels/${channel.id}`);
  }

  if (loading) {
    return (
      <div className="space-page space-loading">
        <Spinner size={28} />
        <p>Abrindo espaço…</p>
      </div>
    );
  }

  if (error || !details) {
    return (
      <div className="space-page space-loading">
        <EmptyState
          icon={<AlertCircle size={28} />}
          title="Espaço indisponível"
          message={error || 'Você pode não ter acesso a este espaço.'}
          action={
            <Link to="/app/spaces" className="btn btn-secondary">
              Ver espaços
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <div className="space-page">
      <SpaceSidebar
        details={details}
        activeChannelId={channelId}
        onCreateChannel={openCreateChannel}
        onOpenSettings={openSettings}
        onOpenInvites={openInvites}
        onLeave={() => void leaveSpace()}
      />
      <div className="space-content">
        <Outlet
          context={
            {
              details,
              refresh: loadDetails,
              openSettings,
              openInvites,
              openCreateChannel,
            } satisfies SpacePageContext
          }
        />
      </div>

      <SpaceSettingsModal
        open={settingsOpen}
        details={details}
        initialTab={settingsTab}
        onClose={() => setSettingsOpen(false)}
        onRefresh={loadDetails}
        onRequestCreateChannel={openCreateChannel}
        onExit={() => {
          setSettingsOpen(false);
          navigate('/app/spaces');
        }}
        onDeleted={() => {
          setSettingsOpen(false);
          void refreshSpaces();
          useAppStore.getState().bumpSpaceVersion();
          navigate('/app/spaces');
        }}
      />

      <CreateChannelModal
        open={createChannelOpen}
        spaceId={spaceId}
        onClose={() => setCreateChannelOpen(false)}
        onCreated={(channel) => void handleChannelCreated(channel)}
      />
    </div>
  );
}

export { SpaceOverview };
