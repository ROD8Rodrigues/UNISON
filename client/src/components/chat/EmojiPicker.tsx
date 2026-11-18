import { classNames } from '../../lib/utils';

export const QUICK_REACTIONS = ['👍', '❤️', '😂', '🎉', '👀', '🔥'];

const EMOJIS = [
  '😀', '😄', '😅', '😂', '🙂', '😉', '😊', '😍', '😘', '😎',
  '🤔', '😐', '😴', '😮', '🥳', '😢', '😭', '😤', '😡', '🤯',
  '👍', '👎', '👏', '🙌', '🤝', '💪', '🙏', '👀', '🫡', '✌️',
  '❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '💔', '💯', '✨',
  '🔥', '🎉', '🎯', '🚀', '⚡', '🌱', '🌙', '☀️', '🍀', '🌟',
  '✅', '⚠️', '📌', '📎', '📝', '💡', '🔒', '🔗', '📅', '⏰',
  '☕', '🍕', '🎵', '🎧', '💻', '📱', '🕹️', '🏆', '🎨', '🧠',
];

export function EmojiPicker({
  onSelect,
  className,
  quick = false,
}: {
  onSelect: (emoji: string) => void;
  className?: string;
  quick?: boolean;
}) {
  const list = quick ? QUICK_REACTIONS : EMOJIS;
  return (
    <div className={classNames('emoji-picker', quick && 'emoji-quick', className)}>
      {list.map((emoji) => (
        <button
          key={emoji}
          type="button"
          className="emoji-btn"
          onClick={() => onSelect(emoji)}
          aria-label={`Inserir ${emoji}`}
        >
          {emoji}
        </button>
      ))}
    </div>
  );
}
