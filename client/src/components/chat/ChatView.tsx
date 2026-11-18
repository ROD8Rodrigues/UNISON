import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  AlertCircle,
  ArrowLeft,
  BellOff,
  Bell,
  ChevronRight,
  EyeOff,
  Hash,
  Info,
  LogOut,
  Menu,
  MessageSquareText,
  Phone,
  Pin,
  PinOff,
  Search,
  Settings2,
  Video,
  X,
} from 'lucide-react';
import { api, ApiError, queryString } from '../../lib/api';
import type { Channel, Conversation, Message, SpaceDetails } from '../../lib/types';
import {
  classNames,
  lastSeenLabel,
  relativeTime,
  safeName,
  truncate,
} from '../../lib/utils';
import { useAppStore } from '../../store/app';
import { useAuthStore } from '../../store/auth';
import { confirmDialog } from '../../store/dialog';
import { toast } from '../../store/toast';
import { useCall } from '../calls/call-context';
import { Avatar } from '../ui/Avatar';
import { EmptyState } from '../ui/EmptyState';
import { Spinner } from '../ui/Spinner';
import { Composer } from './Composer';
import { GroupSettingsModal } from './GroupSettingsModal';
import { InfoPanel } from './InfoPanel';
import { MessageList } from './MessageList';

const EMPTY_MESSAGES: Message[] = [];
const EMPTY_TYPING: Record<string, { username: string; expires: number }> = {};
const EMPTY_META = { hasMore: false, nextCursor: null, loading: false, loaded: false };

interface SearchResult {
  messages: Message[];
  hasMore: boolean;
}

export function ChatView({ mode }: { mode: 'conversation' | 'channel' }) {
  const params = useParams();
  const navigate = useNavigate();
  const conversationParam = params.conversationId || '';
  const spaceParam = params.spaceId || '';
  const channelParam = params.channelId || '';
  const user = useAuthStore((state) => state.user);
  const spaceVersion = useAppStore((state) => state.spaceVersion);
  const [fetchedConversation, setFetchedConversation] = useState<Conversation | null>(null);
  const [channel, setChannel] = useState<Channel | null>(null);
  const [space, setSpace] = useState<SpaceDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Message[]>([]);
  const [searching, setSearching] = useState(false);
  const [pinsOpen, setPinsOpen] = useState(false);
  const [pins, setPins] = useState<Message[]>([]);
  const [pinsLoading, setPinsLoading] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [groupSettingsOpen, setGroupSettingsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const focusTimerRef = useRef<number | null>(null);
  const call = useCall();

  const storeConversation = useAppStore((state) =>
    mode === 'conversation'
      ? state.conversations.find((item) => item.id === conversationParam) || null
      : null,
  );
  const conversation = mode === 'conversation' ? storeConversation || fetchedConversation : fetchedConversation;
  const conversationId = conversation?.id || '';
  const messages = useAppStore((state) =>
    conversationId ? state.messages[conversationId] || EMPTY_MESSAGES : EMPTY_MESSAGES,
  );
  const meta = useAppStore((state) =>
    conversationId ? state.messageMeta[conversationId] || EMPTY_META : EMPTY_META,
  );
  const typingMap = useAppStore((state) =>
    conversationId ? state.typing[conversationId] || EMPTY_TYPING : EMPTY_TYPING,
  );
  const typing = useMemo(
    () => Object.values(typingMap).map((entry) => entry.username),
    [typingMap],
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    setFetchedConversation(null);
    setChannel(null);
    setSpace(null);
    setReplyTo(null);
    setFocusId(null);
    setSearchOpen(false);
    setSearchQuery('');
    setSearchResults([]);
    setPinsOpen(false);
    setInfoOpen(false);
    setMenuOpen(false);

    (async () => {
      try {
        if (mode === 'channel') {
          if (!channelParam) throw new Error('Canal inválido');
          const channelData = await api.get<{ channel: Channel }>(`/channels/${channelParam}`);
          if (cancelled) return;
          setChannel(channelData.channel);
          const resolvedSpaceId = spaceParam || channelData.channel.spaceId;
          const spaceData = await api.get<SpaceDetails>(`/spaces/${resolvedSpaceId}`);
          if (cancelled) return;
          setSpace(spaceData);
          if (!channelData.channel.conversationId) {
            throw new Error('Este canal ainda não possui uma conversa.');
          }
          const conversationData = await api.get<{ conversation: Conversation }>(
            `/conversations/${channelData.channel.conversationId}`,
          );
          if (cancelled) return;
          setFetchedConversation(conversationData.conversation);
        } else {
          if (!conversationParam) throw new Error('Conversa inválida');
          const data = await api.get<{ conversation: Conversation }>(
            `/conversations/${conversationParam}`,
          );
          if (cancelled) return;
          setFetchedConversation(data.conversation);
        }
      } catch (requestError) {
        if (cancelled) return;
        setError(
          requestError instanceof ApiError
            ? requestError.message
            : requestError instanceof Error
              ? requestError.message
              : 'Não foi possível abrir esta conversa.',
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [mode, conversationParam, channelParam, spaceParam, spaceVersion]);

  useEffect(() => {
    if (!conversationId) return;
    setActiveConversationId(conversationId);
    setReplyTo(null);
    useAppStore
      .getState()
      .loadMessages(conversationId)
      .catch((requestError) => {
        toast.error(
          'Mensagens não carregadas',
          requestError instanceof ApiError ? requestError.message : undefined,
        );
      });
    return () => {
      useAppStore.getState().setActiveConversation(null);
    };
  }, [conversationId]);

  useEffect(() => {
    if (!conversationId || messages.length === 0) return;
    useAppStore.getState().markConversationRead(conversationId);
  }, [conversationId, messages.length]);

  useEffect(() => {
    if (!conversationId) return;
    const markVisible = () => {
      if (document.visibilityState === 'visible') {
        useAppStore.getState().markConversationRead(conversationId);
      }
    };
    document.addEventListener('visibilitychange', markVisible);
    return () => document.removeEventListener('visibilitychange', markVisible);
  }, [conversationId]);

  useEffect(() => {
    if (!searchOpen || !conversationId) return;
    const term = searchQuery.trim();
    if (term.length < 2) {
      setSearchResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const timer = window.setTimeout(async () => {
      try {
        const data = await api.get<SearchResult>(
          `/conversations/${conversationId}/search${queryString({ q: term, limit: 30 })}`,
        );
        setSearchResults(data.messages);
      } catch {
        setSearchResults([]);
      } finally {
        setSearching(false);
      }
    }, 320);
    return () => window.clearTimeout(timer);
  }, [searchOpen, searchQuery, conversationId]);

  useEffect(() => {
    if (!pinsOpen || !conversationId) return;
    setPinsLoading(true);
    api
      .get<{ messages: Message[] }>(`/conversations/${conversationId}/pins`)
      .then((data) => setPins(data.messages))
      .catch(() => setPins([]))
      .finally(() => setPinsLoading(false));
  }, [pinsOpen, conversationId]);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [menuOpen]);

  useEffect(
    () => () => {
      if (focusTimerRef.current) window.clearTimeout(focusTimerRef.current);
    },
    [],
  );

  const canSend = useMemo(() => {
    if (!conversation) return false;
    if (conversation.type === 'channel') {
      if (!space) return false;
      return space.myMember.permissions.includes('send_messages');
    }
    return true;
  }, [conversation, space]);

  const canModerate = useMemo(() => {
    if (!conversation) return false;
    if (conversation.type === 'group') return conversation.myRole !== 'member';
    if (conversation.type === 'channel') {
      return Boolean(space?.myMember.permissions.includes('manage_messages'));
    }
    return false;
  }, [conversation, space]);

  const canPin = useMemo(() => {
    if (!conversation) return false;
    if (conversation.type === 'group') return conversation.myRole !== 'member';
    if (conversation.type === 'channel') {
      return Boolean(space?.myMember.permissions.includes('manage_messages'));
    }
    return false;
  }, [conversation, space]);

  async function loadOlder() {
    if (!conversationId || !meta.nextCursor) return;
    try {
      await useAppStore.getState().loadMessages(conversationId, meta.nextCursor);
    } catch (requestError) {
      toast.error(
        'Não foi possível carregar',
        requestError instanceof ApiError ? requestError.message : undefined,
      );
    }
  }

  function focusMessage(id: string) {
    setFocusId(id);
    if (focusTimerRef.current) window.clearTimeout(focusTimerRef.current);
    focusTimerRef.current = window.setTimeout(() => setFocusId(null), 2800);
  }

  async function jumpToMessage(id: string) {
    if (!conversationId) return;
    const store = useAppStore.getState();
    let cached = store.messages[conversationId] || [];
    let guard = 0;
    while (!cached.some((message) => message.id === id) && guard < 40) {
      const currentMeta = useAppStore.getState().messageMeta[conversationId];
      if (!currentMeta?.hasMore || !currentMeta.nextCursor) break;
      try {
        await useAppStore.getState().loadMessages(conversationId, currentMeta.nextCursor);
      } catch {
        break;
      }
      cached = useAppStore.getState().messages[conversationId] || [];
      guard += 1;
    }
    if (!cached.some((message) => message.id === id)) {
      toast.info('Mensagem fora do trecho carregado', 'Role o histórico para encontrá-la.');
      return;
    }
    setSearchOpen(false);
    setPinsOpen(false);
    focusMessage(id);
  }

  async function toggleMute() {
    if (!conversation) return;
    setMenuOpen(false);
    try {
      const data = await api.patch<{ muted: boolean }>(
        `/conversations/${conversation.id}/mute`,
        { muted: !conversation.muted },
      );
      const updated = { ...conversation, muted: data.muted };
      setFetchedConversation(updated);
      if (conversation.type !== 'channel') {
        useAppStore.getState().upsertConversation(updated);
      }
      toast.success(data.muted ? 'Conversa silenciada' : 'Notificações reativadas');
    } catch (requestError) {
      toast.error(
        'Não foi possível alterar',
        requestError instanceof ApiError ? requestError.message : undefined,
      );
    }
  }

  async function hideConversation() {
    if (!conversation) return;
    setMenuOpen(false);
    const ok = await confirmDialog({
      title: 'Ocultar conversa?',
      message:
        'A conversa sai da sua lista. Se alguém enviar uma nova mensagem, ela volta a aparecer.',
      confirmLabel: 'Ocultar',
    });
    if (!ok) return;
    try {
      await api.post(`/conversations/${conversation.id}/hide`);
      useAppStore.getState().removeConversation(conversation.id);
      toast.success('Conversa ocultada');
      navigate('/app');
    } catch (requestError) {
      toast.error(
        'Não foi possível ocultar',
        requestError instanceof ApiError ? requestError.message : undefined,
      );
    }
  }

  async function leaveGroup() {
    if (!conversation) return;
    setMenuOpen(false);
    const ok = await confirmDialog({
      title: 'Sair do grupo?',
      message:
        conversation.myRole === 'owner'
          ? 'A liderança passará para outro participante. Você deixará de receber mensagens.'
          : 'Você deixará de receber mensagens deste grupo.',
      confirmLabel: 'Sair do grupo',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.post(`/conversations/${conversation.id}/leave`);
      useAppStore.getState().removeConversation(conversation.id);
      toast.success('Você saiu do grupo');
      navigate('/app');
    } catch (requestError) {
      toast.error(
        'Não foi possível sair',
        requestError instanceof ApiError ? requestError.message : undefined,
      );
    }
  }

  if (loading) {
    return (
      <div className="chat-view chat-loading">
        <Spinner size={28} />
        <p>Abrindo conversa…</p>
      </div>
    );
  }

  if (error || !conversation) {
    return (
      <div className="chat-view chat-loading">
        <EmptyState
          icon={<AlertCircle size={28} />}
          title="Conversa indisponível"
          message={error || 'Você pode não ter acesso a esta conversa.'}
          action={
            <button type="button" className="btn btn-secondary" onClick={() => navigate('/app')}>
              <ArrowLeft size={16} /> Voltar
            </button>
          }
        />
      </div>
    );
  }

  const title =
    conversation.type === 'dm'
      ? conversation.otherUser?.displayName || conversation.title || 'Conversa'
      : conversation.type === 'channel'
        ? `#${channel?.name || conversation.title?.replace(/^#/, '') || 'canal'}`
        : conversation.title || 'Grupo';
  const subtitle =
    conversation.type === 'dm'
      ? lastSeenLabel(conversation.otherUser?.lastSeen || null, conversation.otherUser?.presence || 'offline')
      : conversation.type === 'channel'
        ? channel?.topic || 'Canal do espaço'
        : `${conversation.memberCount} participantes`;
  const activeCallHere = call.activeCall?.conversationId === conversation.id;
  const callBusy = Boolean(call.activeCall) || call.connecting;

  return (
    <div className={classNames('chat-view', infoOpen && 'with-info')}>
      <div className="chat-main">
        <header className="chat-header">
          <button
            type="button"
            className="icon-btn ghost chat-back"
            onClick={() => navigate(conversation.type === 'channel' ? `/app/spaces/${space?.space.id || spaceParam}` : '/app')}
            aria-label="Voltar"
          >
            <ArrowLeft size={18} />
          </button>

          <div className="chat-title">
            {conversation.type === 'channel' ? (
              <span className="chat-channel-icon">
                <Hash size={20} />
              </span>
            ) : (
              <Avatar
                name={title}
                src={conversation.avatarUrl}
                size={38}
                presence={conversation.type === 'dm' ? conversation.otherUser?.presence : null}
                rounded={conversation.type !== 'group'}
              />
            )}
            <div>
              <h1>{title}</h1>
              <p>{subtitle}</p>
            </div>
          </div>

          <div className="chat-actions">
            {conversation.type !== 'channel' && (
              <>
                <button
                  type="button"
                  className="icon-btn ghost"
                  onClick={() => void call.startCall(conversation.id, 'audio')}
                  disabled={callBusy}
                  aria-label="Chamada de áudio"
                  title="Chamada de áudio"
                >
                  <Phone size={18} />
                </button>
                <button
                  type="button"
                  className="icon-btn ghost"
                  onClick={() => void call.startCall(conversation.id, 'video')}
                  disabled={callBusy}
                  aria-label="Chamada de vídeo"
                  title="Chamada de vídeo"
                >
                  <Video size={18} />
                </button>
              </>
            )}
            <button
              type="button"
              className={classNames('icon-btn ghost', searchOpen && 'active')}
              onClick={() => {
                setSearchOpen((value) => !value);
                setPinsOpen(false);
                setMenuOpen(false);
              }}
              aria-label="Buscar mensagens"
              title="Buscar mensagens"
            >
              <Search size={18} />
            </button>
            <button
              type="button"
              className={classNames('icon-btn ghost', pinsOpen && 'active')}
              onClick={() => {
                setPinsOpen((value) => !value);
                setSearchOpen(false);
                setMenuOpen(false);
              }}
              aria-label="Mensagens fixadas"
              title="Mensagens fixadas"
            >
              <Pin size={18} />
            </button>
            <button
              type="button"
              className={classNames('icon-btn ghost', infoOpen && 'active')}
              onClick={() => {
                setInfoOpen((value) => !value);
                setMenuOpen(false);
              }}
              aria-label="Detalhes da conversa"
              title="Detalhes"
            >
              <Info size={18} />
            </button>
            <div className="chat-menu-wrap" ref={menuRef}>
              <button
                type="button"
                className="icon-btn ghost"
                onClick={() => setMenuOpen((value) => !value)}
                aria-label="Mais opções"
                title="Mais opções"
              >
                <Menu size={18} />
              </button>
              {menuOpen && (
                <div className="chat-menu">
                  <button
                    type="button"
                    onClick={() => {
                      setInfoOpen(true);
                      setMenuOpen(false);
                    }}
                  >
                    <Info size={15} /> Ver detalhes
                  </button>
                  <button type="button" onClick={() => void toggleMute()}>
                    {conversation.muted ? <Bell size={15} /> : <BellOff size={15} />}
                    {conversation.muted ? 'Reativar notificações' : 'Silenciar conversa'}
                  </button>
                  {conversation.type === 'group' && conversation.myRole !== 'member' && (
                    <button
                      type="button"
                      onClick={() => {
                        setGroupSettingsOpen(true);
                        setMenuOpen(false);
                      }}
                    >
                      <Settings2 size={15} /> Configurações do grupo
                    </button>
                  )}
                  {conversation.type === 'channel' && (
                    <Link to={`/app/spaces/${space?.space.id || spaceParam}`} onClick={() => setMenuOpen(false)}>
                      <MessageSquareText size={15} /> Abrir espaço
                    </Link>
                  )}
                  {conversation.type !== 'channel' && (
                    <button type="button" onClick={() => void hideConversation()}>
                      <EyeOff size={15} /> Ocultar conversa
                    </button>
                  )}
                  {conversation.type === 'group' && (
                    <button type="button" className="danger" onClick={() => void leaveGroup()}>
                      <LogOut size={15} /> Sair do grupo
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        </header>

        {searchOpen && (
          <div className="chat-search">
            <Search size={16} />
            <input
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Buscar nesta conversa…"
              autoFocus
            />
            {searching && <Spinner size={15} />}
            <button
              type="button"
              className="icon-btn ghost"
              onClick={() => {
                setSearchOpen(false);
                setSearchQuery('');
              }}
              aria-label="Fechar busca"
            >
              <X size={16} />
            </button>
          </div>
        )}

        {searchOpen && searchQuery.trim().length >= 2 && (
          <div className="chat-search-results">
            <header>
              <strong>Resultados</strong>
              <span>{searchResults.length} encontrada(s)</span>
            </header>
            {searchResults.length === 0 && !searching && (
              <p className="muted-label">Nenhuma mensagem corresponde à busca.</p>
            )}
            {searchResults.map((result) => (
              <button
                key={result.id}
                type="button"
                className="search-result"
                onClick={() => void jumpToMessage(result.id)}
              >
                <div className="search-result-head">
                  <strong>{safeName(result.sender)}</strong>
                  <span>{relativeTime(result.createdAt)}</span>
                </div>
                <p>{truncate(result.content || 'Anexo', 140)}</p>
                <ChevronRight size={15} />
              </button>
            ))}
          </div>
        )}

        {pinsOpen && (
          <div className="chat-pins-panel">
            <header>
              <div>
                <strong>Mensagens fixadas</strong>
                <span>{pins.length}</span>
              </div>
              <button
                type="button"
                className="icon-btn ghost"
                onClick={() => setPinsOpen(false)}
                aria-label="Fechar mensagens fixadas"
              >
                <X size={16} />
              </button>
            </header>
            {pinsLoading ? (
              <div className="pins-loading">
                <Spinner size={18} /> Carregando…
              </div>
            ) : pins.length === 0 ? (
              <div className="pins-empty">
                <PinOff size={20} />
                <p>Nenhuma mensagem fixada ainda.</p>
                {canPin && <small>Use o menu de uma mensagem para fixá-la.</small>}
              </div>
            ) : (
              <div className="pins-list">
                {pins.map((pinned) => (
                  <button
                    key={pinned.id}
                    type="button"
                    className="pin-row"
                    onClick={() => void jumpToMessage(pinned.id)}
                  >
                    <Pin size={14} />
                    <div>
                      <strong>{safeName(pinned.sender)}</strong>
                      <p>{truncate(pinned.content || 'Anexo', 110)}</p>
                      <span>{relativeTime(pinned.createdAt)}</span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <MessageList
          conversation={conversation}
          messages={messages}
          hasMore={Boolean(meta.hasMore)}
          loading={Boolean(meta.loading)}
          typing={typing.filter((name) => name !== user?.username)}
          canModerate={canModerate}
          canPin={canPin}
          focusId={focusId}
          onLoadOlder={() => void loadOlder()}
          onReply={setReplyTo}
          onJump={(id) => void jumpToMessage(id)}
        />

        <Composer
          conversation={conversation}
          canSend={canSend}
          disabledReason={
            conversation.type === 'channel'
              ? 'Seu cargo neste espaço não permite enviar mensagens.'
              : undefined
          }
          replyTo={replyTo}
          onCancelReply={() => setReplyTo(null)}
        />
      </div>

      {infoOpen && (
        <InfoPanel
          conversation={conversation}
          channel={channel}
          onClose={() => setInfoOpen(false)}
          onOpenGroupSettings={
            conversation.type === 'group' && conversation.myRole !== 'member'
              ? () => setGroupSettingsOpen(true)
              : undefined
          }
        />
      )}

      {activeCallHere && (
        <div className="call-here-banner">
          <Phone size={14} /> Chamada em andamento nesta conversa
        </div>
      )}

      {conversation.type === 'group' && groupSettingsOpen && (
        <GroupSettingsModal
          open={groupSettingsOpen}
          conversation={conversation}
          onClose={() => setGroupSettingsOpen(false)}
          onChanged={(updated) => {
            setFetchedConversation(updated);
            useAppStore.getState().upsertConversation(updated);
          }}
        />
      )}
    </div>
  );
}

function setActiveConversationId(conversationId: string) {
  useAppStore.getState().setActiveConversation(conversationId);
}
