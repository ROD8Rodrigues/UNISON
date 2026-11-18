import { useEffect, useMemo, useState } from 'react';
import { ImagePlus, LogOut, Search, Trash2, UserPlus, Users } from 'lucide-react';
import { api, ApiError, resolveMediaUrl } from '../../lib/api';
import type { Attachment, Conversation } from '../../lib/types';
import { useAppStore } from '../../store/app';
import { confirmDialog } from '../../store/dialog';
import { toast } from '../../store/toast';
import { Avatar } from '../ui/Avatar';
import { Modal } from '../ui/Modal';
import { Spinner } from '../ui/Spinner';

export function GroupSettingsModal({
  open,
  conversation,
  onClose,
  onChanged,
}: {
  open: boolean;
  conversation: Conversation;
  onClose: () => void;
  onChanged: (conversation: Conversation) => void;
}) {
  const friends = useAppStore((state) => state.friends);
  const [title, setTitle] = useState(conversation.title || '');
  const [avatarUrl, setAvatarUrl] = useState(conversation.avatarUrl || '');
  const [query, setQuery] = useState('');
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [busyMember, setBusyMember] = useState<string | null>(null);
  const canManage = ['owner', 'admin'].includes(conversation.myRole);
  const isOwner = conversation.myRole === 'owner';

  useEffect(() => {
    if (!open) return;
    setTitle(conversation.title || '');
    setAvatarUrl(conversation.avatarUrl || '');
    setQuery('');
  }, [open, conversation.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const availableFriends = useMemo(() => {
    const memberIds = new Set(conversation.members.map((member) => member.id));
    const term = query.trim().toLowerCase();
    return friends.filter(
      (friend) =>
        !memberIds.has(friend.id) &&
        (!term ||
          friend.displayName.toLowerCase().includes(term) ||
          friend.username.toLowerCase().includes(term)),
    );
  }, [friends, conversation.members, query]);

  async function refreshConversation() {
    const data = await api.get<{ conversation: Conversation }>(
      `/conversations/${conversation.id}`,
    );
    onChanged(data.conversation);
    if (conversation.type !== 'channel') {
      useAppStore.getState().upsertConversation(data.conversation);
    }
    return data.conversation;
  }

  async function save() {
    if (!canManage) return;
    if (!title.trim()) {
      toast.info('O grupo precisa de um nome');
      return;
    }
    setSaving(true);
    try {
      await api.patch(`/conversations/${conversation.id}`, {
        title: title.trim(),
        avatarUrl: avatarUrl || null,
      });
      await refreshConversation();
      toast.success('Grupo atualizado');
      onClose();
    } catch (error) {
      toast.error('Não foi possível salvar', error instanceof ApiError ? error.message : undefined);
    } finally {
      setSaving(false);
    }
  }

  async function uploadAvatar(file: File) {
    setUploading(true);
    try {
      const data = await api.upload<{ attachment: Attachment }>('/uploads', file);
      setAvatarUrl(data.attachment.url);
      toast.success('Imagem carregada', 'Salve para aplicar ao grupo.');
    } catch (error) {
      toast.error('Falha no upload', error instanceof ApiError ? error.message : undefined);
    } finally {
      setUploading(false);
    }
  }

  async function addMember(userId: string) {
    setBusyMember(userId);
    try {
      await api.post(`/conversations/${conversation.id}/members`, { userId });
      await refreshConversation();
      toast.success('Membro adicionado');
    } catch (error) {
      toast.error('Não foi possível adicionar', error instanceof ApiError ? error.message : undefined);
    } finally {
      setBusyMember(null);
    }
  }

  async function removeMember(userId: string, name: string) {
    const ok = await confirmDialog({
      title: `Remover ${name}?`,
      message: 'A pessoa perderá acesso ao histórico deste grupo.',
      confirmLabel: 'Remover',
      danger: true,
    });
    if (!ok) return;
    setBusyMember(userId);
    try {
      await api.delete(`/conversations/${conversation.id}/members/${userId}`);
      await refreshConversation();
      toast.success('Membro removido');
    } catch (error) {
      toast.error('Não foi possível remover', error instanceof ApiError ? error.message : undefined);
    } finally {
      setBusyMember(null);
    }
  }

  async function leaveGroup() {
    const ok = await confirmDialog({
      title: 'Sair do grupo?',
      message: isOwner
        ? 'Como dono, a liderança passará para outro participante. Você deixará de receber mensagens deste grupo.'
        : 'Você deixará de receber mensagens deste grupo.',
      confirmLabel: 'Sair do grupo',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.post(`/conversations/${conversation.id}/leave`);
      useAppStore.getState().removeConversation(conversation.id);
      toast.success('Você saiu do grupo');
      onClose();
    } catch (error) {
      toast.error('Não foi possível sair', error instanceof ApiError ? error.message : undefined);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Configurações do grupo"
      description="Identidade, participantes e saída do grupo."
      size="lg"
      footer={
        <>
          <button type="button" className="btn btn-ghost danger-text" onClick={() => void leaveGroup()}>
            <LogOut size={16} /> Sair do grupo
          </button>
          <div className="modal-footer-right">
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Cancelar
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void save()}
              disabled={saving || !canManage}
            >
              {saving && <Spinner size={15} />}
              Salvar alterações
            </button>
          </div>
        </>
      }
    >
      <div className="group-settings">
        <div className="group-identity">
          <div className="group-avatar-upload">
            <Avatar name={title || 'Grupo'} src={resolveMediaUrl(avatarUrl)} size={72} rounded={false} />
            {canManage && (
              <label className="avatar-upload-btn" title="Trocar imagem do grupo">
                {uploading ? <Spinner size={15} /> : <ImagePlus size={15} />}
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  hidden
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) void uploadAvatar(file);
                    event.target.value = '';
                  }}
                />
              </label>
            )}
          </div>
          <div className="group-identity-fields">
            <label className="field">
              <span>Nome do grupo</span>
              <div className="input-shell">
                <input
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  maxLength={60}
                  disabled={!canManage}
                />
              </div>
            </label>
            {avatarUrl && canManage && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAvatarUrl('')}>
                Remover imagem
              </button>
            )}
          </div>
        </div>

        <section className="settings-section">
          <header className="section-head">
            <div>
              <h3>
                <Users size={17} /> Participantes ({conversation.members.length})
              </h3>
              <p>Quem participa deste grupo.</p>
            </div>
          </header>
          <div className="member-manage-list">
            {conversation.members.map((member) => (
              <div className="member-manage-row" key={member.id}>
                <Avatar name={member.displayName} src={member.avatarUrl} size={36} presence={member.presence} />
                <div>
                  <strong>{member.displayName}</strong>
                  <span>@{member.username}</span>
                </div>
                {member.role !== 'member' && (
                  <span className="role-chip">{member.role === 'owner' ? 'Dono' : 'Admin'}</span>
                )}
                {canManage && member.role !== 'owner' && (
                  <button
                    type="button"
                    className="icon-btn ghost danger-text"
                    onClick={() => void removeMember(member.id, member.displayName)}
                    disabled={busyMember === member.id}
                    aria-label={`Remover ${member.displayName}`}
                  >
                    {busyMember === member.id ? <Spinner size={14} /> : <Trash2 size={16} />}
                  </button>
                )}
              </div>
            ))}
          </div>
        </section>

        {canManage && (
          <section className="settings-section">
            <header className="section-head">
              <div>
                <h3>
                  <UserPlus size={17} /> Adicionar amigos
                </h3>
                <p>Convide pessoas da sua lista de amigos.</p>
              </div>
            </header>
            <div className="input-shell">
              <Search size={16} />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Buscar nos seus amigos"
              />
            </div>
            <div className="member-manage-list compact-list">
              {availableFriends.length === 0 && (
                <p className="muted-label">
                  {friends.length === 0
                    ? 'Adicione amigos primeiro para incluir novas pessoas.'
                    : 'Todos os seus amigos já estão neste grupo.'}
                </p>
              )}
              {availableFriends.map((friend) => (
                <div className="member-manage-row" key={friend.id}>
                  <Avatar name={friend.displayName} src={friend.avatarUrl} size={32} presence={friend.presence} />
                  <div>
                    <strong>{friend.displayName}</strong>
                    <span>@{friend.username}</span>
                  </div>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => void addMember(friend.id)}
                    disabled={busyMember === friend.id}
                  >
                    {busyMember === friend.id ? <Spinner size={14} /> : <UserPlus size={14} />}
                    Adicionar
                  </button>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </Modal>
  );
}
