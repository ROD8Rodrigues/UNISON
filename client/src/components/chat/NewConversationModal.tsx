import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { MessageCircle, Plus, Search, UserPlus, Users } from 'lucide-react';
import { api, ApiError, queryString } from '../../lib/api';
import type { Conversation, User } from '../../lib/types';
import { useAppStore } from '../../store/app';
import { toast } from '../../store/toast';
import { Avatar } from '../ui/Avatar';
import { EmptyState } from '../ui/EmptyState';
import { Modal } from '../ui/Modal';
import { Spinner } from '../ui/Spinner';

export function NewConversationModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const friends = useAppStore((state) => state.friends);
  const upsertConversation = useAppStore((state) => state.upsertConversation);
  const [mode, setMode] = useState<'direct' | 'group'>('direct');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<User[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const requestId = useRef(0);

  useEffect(() => {
    if (!open) return;
    setMode('direct');
    setQuery('');
    setResults([]);
    setSelected([]);
    setTitle('');
  }, [open]);

  useEffect(() => {
    if (!open || mode !== 'direct' || query.trim().length < 2) {
      setResults([]);
      return;
    }
    const current = ++requestId.current;
    setSearching(true);
    const timer = window.setTimeout(async () => {
      try {
        const data = await api.get<{ users: User[] }>(`/users/search${queryString({ q: query.trim() })}`);
        if (current === requestId.current) setResults(data.users);
      } catch {
        if (current === requestId.current) setResults([]);
      } finally {
        if (current === requestId.current) setSearching(false);
      }
    }, 280);
    return () => window.clearTimeout(timer);
  }, [open, mode, query]);

  const directList = useMemo(() => {
    if (query.trim().length >= 2) return results;
    return friends;
  }, [friends, query, results]);

  const friendIds = useMemo(() => new Set(friends.map((friend) => friend.id)), [friends]);

  async function openDirect(user: User) {
    setBusy(true);
    try {
      const data = await api.post<{ conversation: Conversation }>('/conversations/dm', {
        userId: user.id,
      });
      upsertConversation(data.conversation);
      onClose();
      navigate(`/app/dm/${data.conversation.id}`);
    } catch (error) {
      toast.error('Não foi possível abrir a conversa', error instanceof ApiError ? error.message : undefined);
    } finally {
      setBusy(false);
    }
  }

  async function addFriend(user: User) {
    try {
      await api.post('/friends/requests', { username: user.username });
      toast.success('Pedido enviado', `Convite enviado para @${user.username}.`);
    } catch (error) {
      toast.error('Não foi possível enviar o pedido', error instanceof ApiError ? error.message : undefined);
    }
  }

  async function createGroup() {
    if (!title.trim()) {
      toast.info('Dê um nome ao grupo');
      return;
    }
    if (selected.length === 0) {
      toast.info('Escolha pelo menos uma pessoa');
      return;
    }
    setBusy(true);
    try {
      const data = await api.post<{ conversation: Conversation }>('/conversations/group', {
        title: title.trim(),
        memberIds: selected,
      });
      upsertConversation(data.conversation);
      toast.success('Grupo criado', data.conversation.title || title.trim());
      onClose();
      navigate(`/app/dm/${data.conversation.id}`);
    } catch (error) {
      toast.error('Não foi possível criar o grupo', error instanceof ApiError ? error.message : undefined);
    } finally {
      setBusy(false);
    }
  }

  function toggleSelected(userId: string) {
    setSelected((current) =>
      current.includes(userId) ? current.filter((id) => id !== userId) : [...current, userId],
    );
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Nova conversa"
      description="Converse diretamente ou reúna pessoas em um grupo."
      size="md"
    >
      <div className="segmented">
        <button
          type="button"
          className={mode === 'direct' ? 'active' : ''}
          onClick={() => setMode('direct')}
        >
          <MessageCircle size={16} /> Direta
        </button>
        <button
          type="button"
          className={mode === 'group' ? 'active' : ''}
          onClick={() => setMode('group')}
        >
          <Users size={16} /> Grupo
        </button>
      </div>

      {mode === 'group' && (
        <label className="field">
          <span>Nome do grupo</span>
          <div className="input-shell">
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Ex.: Produto · Sprint 12"
              maxLength={60}
              autoFocus
            />
          </div>
        </label>
      )}

      <label className="field">
        <span>{mode === 'direct' ? 'Buscar pessoa' : 'Adicionar amigos'}</span>
        <div className="input-shell">
          <Search size={16} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Nome ou @usuário"
          />
          {searching && <Spinner size={16} />}
        </div>
      </label>

      <div className="picker-list">
        {directList.length === 0 && !searching && (
          <EmptyState
            compact
            icon={mode === 'direct' ? <UserPlus size={20} /> : <Users size={20} />}
            title={query ? 'Nenhuma pessoa encontrada' : 'Sua lista de amigos está vazia'}
            message={
              query
                ? 'Tente outro nome ou nome de usuário.'
                : 'Adicione amigos na aba Amigos para começar.'
            }
          />
        )}
        {directList.map((person) => {
          const isFriend = friendIds.has(person.id);
          const choosable = mode === 'group' && isFriend;
          const isSelected = selected.includes(person.id);
          return (
            <div
              key={person.id}
              className={`picker-row${isSelected ? ' selected' : ''}`}
              onClick={() => (choosable ? toggleSelected(person.id) : undefined)}
              role={choosable ? 'checkbox' : undefined}
              aria-checked={choosable ? isSelected : undefined}
              tabIndex={choosable ? 0 : undefined}
              onKeyDown={(event) => {
                if (choosable && (event.key === 'Enter' || event.key === ' ')) {
                  event.preventDefault();
                  toggleSelected(person.id);
                }
              }}
            >
              <Avatar name={person.displayName} src={person.avatarUrl} presence={person.presence} size={38} />
              <div className="picker-copy">
                <strong>{person.displayName}</strong>
                <span>
                  @{person.username}
                  {!isFriend && mode === 'direct' ? ' · fora dos amigos' : ''}
                </span>
              </div>
              {mode === 'group' ? (
                isFriend ? (
                  <span className={`check-pill${isSelected ? ' on' : ''}`}>
                    {isSelected ? 'Selecionado' : 'Selecionar'}
                  </span>
                ) : (
                  <span className="muted-label">Adicione como amigo</span>
                )
              ) : (
                <div className="picker-actions">
                  {!isFriend && (
                    <button
                      type="button"
                      className="icon-btn ghost"
                      title="Enviar pedido de amizade"
                      aria-label={`Adicionar ${person.displayName} como amigo`}
                      onClick={(event) => {
                        event.stopPropagation();
                        void addFriend(person);
                      }}
                    >
                      <UserPlus size={17} />
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    disabled={busy}
                    onClick={(event) => {
                      event.stopPropagation();
                      void openDirect(person);
                    }}
                  >
                    <MessageCircle size={15} /> Conversar
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {mode === 'group' && (
        <div className="modal-inline-footer">
          <span className="muted-label">
            {selected.length === 0
              ? 'Nenhum membro selecionado'
              : `${selected.length} ${selected.length === 1 ? 'membro' : 'membros'} selecionado(s)`}
          </span>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void createGroup()}
            disabled={busy || !title.trim() || selected.length === 0}
          >
            {busy ? <Spinner size={16} /> : <Plus size={16} />}
            Criar grupo
          </button>
        </div>
      )}
    </Modal>
  );
}
