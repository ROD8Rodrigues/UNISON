import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowDown, ChevronUp, MessageSquareDashed } from 'lucide-react';
import type { Conversation, Message } from '../../lib/types';
import { formatDate } from '../../lib/utils';
import { EmptyState } from '../ui/EmptyState';
import { Spinner } from '../ui/Spinner';
import { MessageItem } from './MessageItem';

interface MessageListProps {
  conversation: Conversation;
  messages: Message[];
  hasMore: boolean;
  loading: boolean;
  typing: string[];
  canModerate: boolean;
  canPin: boolean;
  focusId: string | null;
  onLoadOlder: () => void;
  onReply: (message: Message) => void;
  onJump: (messageId: string) => void;
}

function shouldShowAuthor(previous: Message | undefined, message: Message) {
  if (message.kind === 'system') return false;
  if (!previous || previous.kind === 'system') return true;
  if (previous.senderId !== message.senderId) return true;
  return new Date(message.createdAt).getTime() - new Date(previous.createdAt).getTime() > 5 * 60_000;
}

export function MessageList({
  conversation,
  messages,
  hasMore,
  loading,
  typing,
  canModerate,
  canPin,
  focusId,
  onLoadOlder,
  onReply,
  onJump,
}: MessageListProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const conversationRef = useRef(conversation.id);
  const lastMessageRef = useRef<string | null>(null);
  const restoreHeightRef = useRef<number | null>(null);
  const previousLoadingRef = useRef(loading);
  const initialisedRef = useRef(false);
  const [showJump, setShowJump] = useState(false);

  const nearBottom = () => {
    const element = scrollRef.current;
    if (!element) return true;
    return element.scrollHeight - element.scrollTop - element.clientHeight < 140;
  };

  const scrollToBottom = (behavior: ScrollBehavior = 'auto') => {
    bottomRef.current?.scrollIntoView({ block: 'end', behavior });
  };

  useEffect(() => {
    initialisedRef.current = false;
    conversationRef.current = conversation.id;
    lastMessageRef.current = null;
  }, [conversation.id]);

  useEffect(() => {
    const last = messages[messages.length - 1];
    if (!last) return;
    const changedConversation = conversationRef.current !== conversation.id;
    const lastId = lastMessageRef.current;
    if (changedConversation || !initialisedRef.current) {
      conversationRef.current = conversation.id;
      lastMessageRef.current = last.id;
      initialisedRef.current = true;
      window.requestAnimationFrame(() => scrollToBottom('auto'));
      return;
    }
    if (last.id !== lastId) {
      const stick = nearBottom();
      lastMessageRef.current = last.id;
      if (stick) {
        window.requestAnimationFrame(() => scrollToBottom('smooth'));
      }
    }
  }, [messages, conversation.id]);

  useEffect(() => {
    if (!focusId) return;
    const element = document.getElementById(`message-${focusId}`);
    if (element) {
      element.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }, [focusId, messages.length]);

  useLayoutEffect(() => {
    if (
      previousLoadingRef.current &&
      !loading &&
      restoreHeightRef.current !== null &&
      scrollRef.current
    ) {
      const delta = scrollRef.current.scrollHeight - restoreHeightRef.current;
      scrollRef.current.scrollTop += delta;
      restoreHeightRef.current = null;
    }
    previousLoadingRef.current = loading;
  }, [loading]);

  function handleScroll() {
    const element = scrollRef.current;
    if (!element) return;
    setShowJump(!nearBottom());
    if (element.scrollTop < 60 && hasMore && !loading) {
      restoreHeightRef.current = element.scrollHeight;
      onLoadOlder();
    }
  }

  function loadOlder() {
    if (loading || !hasMore) return;
    restoreHeightRef.current = scrollRef.current?.scrollHeight || null;
    onLoadOlder();
  }

  return (
    <div className="message-scroll" ref={scrollRef} onScroll={handleScroll}>
      <div className="message-list">
        {hasMore && (
          <div className="load-older-wrap">
            <button
              type="button"
              className="load-older"
              onClick={loadOlder}
              disabled={loading}
            >
              {loading ? <Spinner size={14} /> : <ChevronUp size={14} />}
              {loading ? 'Carregando…' : 'Mensagens anteriores'}
            </button>
          </div>
        )}

        {!hasMore && messages.length > 0 && (
          <div className="conversation-start">
            <span className="conversation-start-icon">
              {conversation.type === 'channel' ? '#' : conversation.type === 'group' ? '◈' : '@'}
            </span>
            <h3>{conversation.title || conversation.otherUser?.displayName || 'Conversa'}</h3>
            <p>
              {conversation.type === 'dm'
                ? `Este é o início da sua conversa com ${conversation.otherUser?.displayName || 'esta pessoa'}.`
                : conversation.type === 'channel'
                  ? 'Este é o começo do canal. Dê as boas-vindas.'
                  : 'Este é o começo do grupo. Organize o próximo passo.'}
            </p>
          </div>
        )}

        {messages.length === 0 && !loading && (
          <EmptyState
            icon={<MessageSquareDashed size={26} />}
            title="Nenhuma mensagem ainda"
            message="Envie a primeira mensagem para começar a conversa."
          />
        )}

        {messages.map((message, index) => {
          const previous = messages[index - 1];
          const dayChanged =
            !previous ||
            new Date(previous.createdAt).toDateString() !==
              new Date(message.createdAt).toDateString();
          return (
            <div key={message.id} className="message-block">
              {dayChanged && (
                <div className="date-separator">
                  <span>{formatDate(message.createdAt)}</span>
                </div>
              )}
              <MessageItem
                message={message}
                showAuthor={shouldShowAuthor(previous, message)}
                canModerate={canModerate}
                canPin={canPin}
                highlight={focusId === message.id}
                onReply={onReply}
                onJump={onJump}
              />
            </div>
          );
        })}

        {typing.length > 0 && (
          <div className="typing-row">
            <span className="typing-dots">
              <i />
              <i />
              <i />
            </span>
            <span>
              {typing.length === 1
                ? `${typing[0]} está digitando`
                : `${typing.slice(0, 2).join(', ')}${typing.length > 2 ? ` e +${typing.length - 2}` : ''} estão digitando`}
            </span>
          </div>
        )}

        <div ref={bottomRef} className="message-bottom-anchor" />
      </div>

      {showJump && messages.length > 0 && (
        <button
          type="button"
          className="scroll-bottom"
          onClick={() => scrollToBottom('smooth')}
          aria-label="Ir para as mensagens mais recentes"
        >
          <ArrowDown size={17} />
        </button>
      )}
    </div>
  );
}
