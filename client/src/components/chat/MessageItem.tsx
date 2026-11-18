import { useEffect, useRef, useState } from 'react';
import {
  Check,
  CheckCheck,
  Copy,
  Download,
  File,
  FileText,
  MoreHorizontal,
  Pencil,
  Pin,
  PinOff,
  Reply,
  SmilePlus,
  Trash2,
  X,
} from 'lucide-react';
import { api, ApiError, resolveMediaUrl } from '../../lib/api';
import type { Attachment, Message } from '../../lib/types';
import {
  classNames,
  formatBytes,
  formatTime,
  groupReactions,
  isAudio,
  isImage,
  isVideo,
  safeName,
} from '../../lib/utils';
import { useAppStore } from '../../store/app';
import { useAuthStore } from '../../store/auth';
import { confirmDialog } from '../../store/dialog';
import { toast } from '../../store/toast';
import { Avatar } from '../ui/Avatar';
import { Spinner } from '../ui/Spinner';
import { EmojiPicker } from './EmojiPicker';

interface MessageItemProps {
  message: Message;
  showAuthor: boolean;
  canModerate: boolean;
  canPin: boolean;
  highlight?: boolean;
  onReply: (message: Message) => void;
  onJump: (messageId: string) => void;
}

function linkify(content: string) {
  const tokens = content.split(/(https?:\/\/[^\s<>]+|@[a-z0-9_.]{3,24})/gi);
  return tokens.map((token, index) => {
    if (/^https?:\/\//i.test(token)) {
      return (
        <a
          key={index}
          href={token}
          target="_blank"
          rel="noopener noreferrer"
          className="message-link"
        >
          {token}
        </a>
      );
    }
    if (/^@[a-z0-9_.]{3,24}$/i.test(token)) {
      return (
        <span key={index} className="message-mention">
          {token}
        </span>
      );
    }
    return token;
  });
}

function FileCard({ attachment }: { attachment: Attachment }) {
  const icon = attachment.mimeType.includes('pdf')
    ? <FileText size={21} />
    : <File size={21} />;
  return (
    <a
      className="attachment-file"
      href={resolveMediaUrl(attachment.url)}
      download={attachment.name}
      target="_blank"
      rel="noopener noreferrer"
    >
      <span className="attachment-file-icon">{icon}</span>
      <span className="attachment-file-copy">
        <strong>{attachment.name}</strong>
        <small>
          {formatBytes(attachment.size)} · {attachment.mimeType || 'arquivo'}
        </small>
      </span>
      <Download size={16} />
    </a>
  );
}

function AttachmentView({ attachment }: { attachment: Attachment }) {
  const url = resolveMediaUrl(attachment.url);
  if (isImage(attachment.mimeType)) {
    return (
      <a
        className="attachment-image"
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        title={attachment.name}
      >
        <img src={url} alt={attachment.name} loading="lazy" />
      </a>
    );
  }
  if (isVideo(attachment.mimeType)) {
    return (
      <video className="attachment-video" controls preload="metadata">
        <source src={url} type={attachment.mimeType} />
        Seu navegador não reproduz este vídeo.
      </video>
    );
  }
  if (isAudio(attachment.mimeType)) {
    return (
      <div className="attachment-audio">
        <audio controls preload="metadata">
          <source src={url} type={attachment.mimeType} />
        </audio>
        <span>{attachment.name}</span>
      </div>
    );
  }
  return <FileCard attachment={attachment} />;
}

export function MessageItem({
  message,
  showAuthor,
  canModerate,
  canPin,
  highlight,
  onReply,
  onJump,
}: MessageItemProps) {
  const user = useAuthStore((state) => state.user);
  const [menuOpen, setMenuOpen] = useState(false);
  const [reactionsOpen, setReactionsOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(message.content);
  const [busy, setBusy] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const reactionRef = useRef<HTMLDivElement>(null);
  const editRef = useRef<HTMLTextAreaElement>(null);
  const isMine = Boolean(user && message.senderId === user.id);
  const reactions = groupReactions(message, user?.id || '');
  const authorName = message.sender ? safeName(message.sender) : 'Sistema';

  useEffect(() => {
    if (!menuOpen && !reactionsOpen) return;
    const close = (event: MouseEvent) => {
      if (menuOpen && !menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
      if (reactionsOpen && !reactionRef.current?.contains(event.target as Node)) {
        setReactionsOpen(false);
      }
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [menuOpen, reactionsOpen]);

  useEffect(() => {
    if (editing) {
      editRef.current?.focus();
      editRef.current?.setSelectionRange(draft.length, draft.length);
    }
  }, [editing]); // eslint-disable-line react-hooks/exhaustive-deps

  if (message.kind === 'system') {
    return (
      <div className="system-message">
        <span>{message.content}</span>
        <time>{formatTime(message.createdAt)}</time>
      </div>
    );
  }

  async function react(emoji: string) {
    setReactionsOpen(false);
    try {
      const data = await api.post<{ message: Message }>(`/messages/${message.id}/reactions`, {
        emoji,
      });
      useAppStore.getState().updateMessage(data.message);
    } catch (error) {
      toast.error('Reação não aplicada', error instanceof ApiError ? error.message : undefined);
    }
  }

  async function saveEdit() {
    const content = draft.trim();
    if (!content) {
      toast.info('A mensagem não pode ficar vazia');
      return;
    }
    if (content === message.content) {
      setEditing(false);
      return;
    }
    setBusy(true);
    try {
      const data = await api.patch<{ message: Message }>(`/messages/${message.id}`, { content });
      useAppStore.getState().updateMessage(data.message);
      setEditing(false);
    } catch (error) {
      toast.error('Não foi possível editar', error instanceof ApiError ? error.message : undefined);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setMenuOpen(false);
    const ok = await confirmDialog({
      title: 'Apagar mensagem?',
      message: 'A mensagem será removida para todos os participantes. Essa ação não pode ser desfeita.',
      confirmLabel: 'Apagar',
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      await api.delete(`/messages/${message.id}`);
      useAppStore.getState().removeMessageLocal(message.conversationId, message.id);
    } catch (error) {
      toast.error('Não foi possível apagar', error instanceof ApiError ? error.message : undefined);
    } finally {
      setBusy(false);
    }
  }

  async function togglePin() {
    setMenuOpen(false);
    try {
      const data = await api.post<{ message: Message }>(`/messages/${message.id}/pin`, {
        pinned: !message.pinned,
      });
      useAppStore.getState().updateMessage(data.message);
      toast.success(data.message.pinned ? 'Mensagem fixada' : 'Mensagem desafixada');
    } catch (error) {
      toast.error('Não foi possível fixar', error instanceof ApiError ? error.message : undefined);
    }
  }

  async function copyText() {
    setMenuOpen(false);
    try {
      await navigator.clipboard.writeText(message.content);
      toast.success('Texto copiado');
    } catch {
      toast.error('Não foi possível copiar');
    }
  }

  const canEdit = isMine && !message.deleted && !busy;
  const canDelete = (isMine || canModerate) && !message.deleted;
  const showActions = !message.deleted;

  return (
    <article
      id={`message-${message.id}`}
      className={classNames(
        'message-row',
        isMine && 'mine',
        showAuthor && 'with-author',
        highlight && 'highlight',
        message.pinned && 'pinned',
      )}
    >
      <div className="message-gutter">
        {showAuthor ? (
          <Avatar
            name={authorName}
            src={message.sender?.avatarUrl}
            size={36}
            presence={message.sender?.presence}
          />
        ) : (
          <span className="message-gutter-time">{formatTime(message.createdAt)}</span>
        )}
      </div>

      <div className="message-main">
        {showAuthor && (
          <header className="message-head">
            <strong>{authorName}</strong>
            {message.sender && <span>@{message.sender.username}</span>}
            <time>{formatTime(message.createdAt)}</time>
            {message.pinned && (
              <span className="message-flag" title="Mensagem fixada">
                <Pin size={12} /> fixada
              </span>
            )}
          </header>
        )}

        {message.replyTo && (
          <button
            type="button"
            className="message-reply-quote"
            onClick={() => onJump(message.replyTo!.id)}
          >
            <Reply size={13} />
            <span className="reply-author">{message.replyTo.displayName}</span>
            <span className="reply-content">
              {message.replyTo.deleted ? 'Mensagem apagada' : message.replyTo.content || 'Anexo'}
            </span>
          </button>
        )}

        {message.deleted ? (
          <p className="message-deleted">
            <Trash2 size={14} /> Mensagem apagada
          </p>
        ) : editing ? (
          <div className="message-edit">
            <textarea
              ref={editRef}
              className="textarea"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  void saveEdit();
                }
                if (event.key === 'Escape') {
                  setEditing(false);
                  setDraft(message.content);
                }
              }}
              rows={Math.min(6, Math.max(2, draft.split('\n').length))}
              maxLength={4000}
            />
            <div className="message-edit-actions">
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  setEditing(false);
                  setDraft(message.content);
                }}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => void saveEdit()}
                disabled={busy}
              >
                {busy && <Spinner size={14} />}
                <Check size={14} /> Salvar
              </button>
            </div>
          </div>
        ) : (
          <>
            {message.content && (
              <p className="message-text">{linkify(message.content)}</p>
            )}
            {message.attachments.length > 0 && (
              <div className="message-attachments">
                {message.attachments.map((attachment) => (
                  <AttachmentView key={attachment.id} attachment={attachment} />
                ))}
              </div>
            )}
          </>
        )}

        {reactions.length > 0 && (
          <div className="reaction-row">
            {reactions.map((reaction) => (
              <button
                key={reaction.emoji}
                type="button"
                className={classNames('reaction-chip', reaction.me && 'me')}
                onClick={() => void react(reaction.emoji)}
                title={reaction.users.map((person) => person.displayName).join(', ')}
              >
                <span>{reaction.emoji}</span>
                <strong>{reaction.count}</strong>
              </button>
            ))}
            <button
              type="button"
              className="reaction-add"
              onClick={() => setReactionsOpen((value) => !value)}
              aria-label="Adicionar reação"
            >
              <SmilePlus size={14} />
            </button>
          </div>
        )}

        <footer className="message-meta">
          {message.edited && <span>editada</span>}
          {isMine && !message.deleted && (
            <span
              className={classNames('read-status', message.readByCount > 0 && 'read')}
              title={
                message.readByCount > 0
                  ? `Lida por ${message.readByCount} de ${message.recipientCount}`
                  : 'Enviada'
              }
            >
              {message.readByCount > 0 ? <CheckCheck size={13} /> : <Check size={13} />}
              {message.readByCount > 0 ? 'lida' : 'enviada'}
            </span>
          )}
        </footer>

        {showActions && (
          <div className="message-actions">
            <button
              type="button"
              className="message-action"
              onClick={() => setReactionsOpen((value) => !value)}
              aria-label="Reagir"
              title="Reagir"
            >
              <SmilePlus size={15} />
            </button>
            <button
              type="button"
              className="message-action"
              onClick={() => onReply(message)}
              aria-label="Responder"
              title="Responder"
            >
              <Reply size={15} />
            </button>
            <div className="message-menu-wrap" ref={menuRef}>
              <button
                type="button"
                className="message-action"
                onClick={() => setMenuOpen((value) => !value)}
                aria-label="Mais ações"
                title="Mais ações"
              >
                <MoreHorizontal size={15} />
              </button>
              {menuOpen && (
                <div className="message-menu">
                  <button type="button" onClick={() => void copyText()}>
                    <Copy size={14} /> Copiar texto
                  </button>
                  {canEdit && (
                    <button
                      type="button"
                      onClick={() => {
                        setMenuOpen(false);
                        setEditing(true);
                      }}
                    >
                      <Pencil size={14} /> Editar
                    </button>
                  )}
                  {canPin && (
                    <button type="button" onClick={() => void togglePin()}>
                      {message.pinned ? <PinOff size={14} /> : <Pin size={14} />}
                      {message.pinned ? 'Desafixar' : 'Fixar mensagem'}
                    </button>
                  )}
                  {canDelete && (
                    <button type="button" className="danger" onClick={() => void remove()}>
                      <Trash2 size={14} /> Apagar
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {reactionsOpen && (
          <div className="reaction-popover" ref={reactionRef}>
            <div className="reaction-popover-head">
              <span>Reagir</span>
              <button
                type="button"
                className="icon-btn ghost"
                onClick={() => setReactionsOpen(false)}
                aria-label="Fechar reações"
              >
                <X size={13} />
              </button>
            </div>
            <EmojiPicker quick onSelect={(emoji) => void react(emoji)} />
            <EmojiPicker onSelect={(emoji) => void react(emoji)} />
          </div>
        )}
      </div>
    </article>
  );
}
