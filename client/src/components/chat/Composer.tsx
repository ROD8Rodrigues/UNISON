import { useEffect, useRef, useState, type ChangeEvent, type DragEvent, type KeyboardEvent } from 'react';
import {
  CornerDownLeft,
  File,
  Image as ImageIcon,
  Paperclip,
  Send,
  Smile,
  X,
} from 'lucide-react';
import { api, ApiError, resolveMediaUrl } from '../../lib/api';
import { getSocket } from '../../lib/socket';
import type { Attachment, Conversation, Message } from '../../lib/types';
import { classNames, formatBytes, isImage } from '../../lib/utils';
import { useAppStore } from '../../store/app';
import { toast } from '../../store/toast';
import { EmojiPicker } from './EmojiPicker';
import { Spinner } from '../ui/Spinner';

const MAX_ATTACHMENTS = 10;
const DEFAULT_MAX_MB = Number(import.meta.env.VITE_MAX_UPLOAD_MB || 25);

interface ComposerProps {
  conversation: Conversation;
  canSend: boolean;
  disabledReason?: string;
  replyTo: Message | null;
  onCancelReply: () => void;
  placeholder?: string;
}

export function Composer({
  conversation,
  canSend,
  disabledReason,
  replyTo,
  onCancelReply,
  placeholder,
}: ComposerProps) {
  const [content, setContent] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [sending, setSending] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const lastTypingRef = useRef(0);
  const draggingRef = useRef(false);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = '0px';
    textarea.style.height = `${Math.min(180, Math.max(44, textarea.scrollHeight))}px`;
  }, [content]);

  useEffect(() => {
    if (replyTo) textareaRef.current?.focus();
  }, [replyTo]);

  useEffect(
    () => () => {
      const socket = getSocket();
      if (socket?.connected) {
        socket.emit('typing:stop', { conversationId: conversation.id });
      }
    },
    [conversation.id],
  );

  function stopTyping() {
    const socket = getSocket();
    if (socket?.connected) {
      socket.emit('typing:stop', { conversationId: conversation.id });
    }
    lastTypingRef.current = 0;
  }

  function notifyTyping(next: string) {
    const socket = getSocket();
    if (!socket?.connected) return;
    if (!next.trim()) {
      stopTyping();
      return;
    }
    const timestamp = Date.now();
    if (timestamp - lastTypingRef.current < 1400) return;
    lastTypingRef.current = timestamp;
    socket.emit('typing:start', { conversationId: conversation.id });
  }

  async function uploadFile(file: File) {
    if (attachments.length >= MAX_ATTACHMENTS) {
      toast.info(`Máximo de ${MAX_ATTACHMENTS} anexos por mensagem`);
      return;
    }
    if (file.size > DEFAULT_MAX_MB * 1024 * 1024) {
      toast.error('Arquivo muito grande', `O limite é ${DEFAULT_MAX_MB} MB por arquivo.`);
      return;
    }
    setUploading(true);
    try {
      const data = await api.upload<{ attachment: Attachment }>('/uploads', file);
      setAttachments((current) => [...current, data.attachment].slice(0, MAX_ATTACHMENTS));
    } catch (error) {
      toast.error(
        'Não foi possível anexar',
        error instanceof ApiError ? error.message : 'Tente novamente.',
      );
    } finally {
      setUploading(false);
    }
  }

  async function handleFiles(files: FileList | File[]) {
    for (const file of Array.from(files)) {
      await uploadFile(file);
    }
  }

  function handleFileInput(event: ChangeEvent<HTMLInputElement>) {
    if (event.target.files?.length) {
      void handleFiles(event.target.files);
    }
    event.target.value = '';
  }

  function handleDrop(event: DragEvent) {
    event.preventDefault();
    draggingRef.current = false;
    setDragging(false);
    if (event.dataTransfer.files?.length) {
      void handleFiles(event.dataTransfer.files);
    }
  }

  async function send() {
    if (!canSend || sending || uploading) return;
    const text = content.trim();
    if (!text && attachments.length === 0) return;
    setSending(true);
    try {
      const data = await api.post<{ message: Message }>(
        `/conversations/${conversation.id}/messages`,
        {
          content: text,
          replyToId: replyTo?.id || null,
          attachmentIds: attachments.map((attachment) => attachment.id),
        },
      );
      useAppStore.getState().addMessage(data.message);
      setContent('');
      setAttachments([]);
      setEmojiOpen(false);
      onCancelReply();
      stopTyping();
      window.setTimeout(() => textareaRef.current?.focus(), 20);
    } catch (error) {
      toast.error(
        'Mensagem não enviada',
        error instanceof ApiError ? error.message : 'Verifique sua conexão e tente novamente.',
      );
    } finally {
      setSending(false);
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void send();
    }
  }

  const placeholderText =
    placeholder ||
    (conversation.type === 'channel'
      ? `Mensagem em #${conversation.title?.replace(/^#/, '') || 'canal'}`
      : conversation.type === 'dm'
        ? `Mensagem para ${conversation.otherUser?.displayName || 'a conversa'}`
        : `Mensagem em ${conversation.title || 'grupo'}`);

  if (!canSend) {
    return (
      <div className="composer-disabled">
        {disabledReason || 'Você não tem permissão para enviar mensagens nesta conversa.'}
      </div>
    );
  }

  return (
    <div
      className={classNames('composer-wrap', dragging && 'dragging')}
      onDragOver={(event) => {
        event.preventDefault();
        if (!draggingRef.current) {
          draggingRef.current = true;
          setDragging(true);
        }
      }}
      onDragLeave={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node)) return;
        draggingRef.current = false;
        setDragging(false);
      }}
      onDrop={handleDrop}
    >
      {dragging && (
        <div className="drop-overlay">
          <Paperclip size={24} />
          <strong>Solte para anexar</strong>
        </div>
      )}

      {replyTo && (
        <div className="composer-reply">
          <CornerDownLeft size={15} />
          <div>
            <strong>Respondendo {replyTo.sender?.displayName || 'mensagem'}</strong>
            <p>{replyTo.content || 'Anexo'}</p>
          </div>
          <button type="button" className="icon-btn ghost" onClick={onCancelReply} aria-label="Cancelar resposta">
            <X size={15} />
          </button>
        </div>
      )}

      {attachments.length > 0 && (
        <div className="composer-attachments">
          {attachments.map((attachment) => (
            <div className="composer-attachment" key={attachment.id}>
              {isImage(attachment.mimeType) ? (
                <img src={resolveMediaUrl(attachment.url)} alt={attachment.name} />
              ) : (
                <span className="composer-file-icon">
                  <File size={20} />
                </span>
              )}
              <div>
                <strong>{attachment.name}</strong>
                <small>{formatBytes(attachment.size)}</small>
              </div>
              <button
                type="button"
                className="icon-btn ghost"
                aria-label={`Remover ${attachment.name}`}
                onClick={() =>
                  setAttachments((current) =>
                    current.filter((item) => item.id !== attachment.id),
                  )
                }
              >
                <X size={14} />
              </button>
            </div>
          ))}
          {uploading && (
            <div className="composer-attachment uploading">
              <Spinner size={18} />
              <span>Enviando…</span>
            </div>
          )}
        </div>
      )}

      {emojiOpen && (
        <div className="composer-emoji">
          <EmojiPicker
            onSelect={(emoji) => {
              setContent((current) => current + emoji);
              textareaRef.current?.focus();
            }}
          />
        </div>
      )}

      <div className="composer">
        <button
          type="button"
          className="composer-icon"
          onClick={() => fileRef.current?.click()}
          aria-label="Anexar arquivo"
          title="Anexar arquivo"
          disabled={uploading}
        >
          {uploading ? <Spinner size={18} /> : <Paperclip size={19} />}
        </button>
        <input
          ref={fileRef}
          type="file"
          multiple
          hidden
          onChange={handleFileInput}
          accept="image/png,image/jpeg,image/gif,image/webp,video/mp4,video/webm,video/quicktime,audio/mpeg,audio/wav,audio/ogg,audio/webm,audio/mp4,application/pdf,text/plain,text/csv,application/zip,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.openxmlformats-officedocument.presentationml.presentation"
        />
        <textarea
          ref={textareaRef}
          value={content}
          onChange={(event) => {
            setContent(event.target.value);
            notifyTyping(event.target.value);
          }}
          onKeyDown={onKeyDown}
          placeholder={placeholderText}
          rows={1}
          maxLength={4000}
          aria-label={placeholderText}
        />
        <button
          type="button"
          className={classNames('composer-icon', emojiOpen && 'active')}
          onClick={() => setEmojiOpen((value) => !value)}
          aria-label="Emojis"
          title="Emojis"
        >
          <Smile size={19} />
        </button>
        <button
          type="button"
          className="composer-send"
          onClick={() => void send()}
          disabled={sending || uploading || (!content.trim() && attachments.length === 0)}
          aria-label="Enviar mensagem"
          title="Enviar (Enter)"
        >
          {sending ? <Spinner size={17} /> : <Send size={18} />}
        </button>
      </div>

      <div className="composer-hint">
        <span>
          <ImageIcon size={12} /> Arraste arquivos para anexar
        </span>
        <span>
          <CornerDownLeft size={12} /> Enter envia · Shift+Enter quebra linha
        </span>
      </div>
    </div>
  );
}
