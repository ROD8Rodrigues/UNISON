export function formatTime(value: string | null | undefined) {
  if (!value) return '';
  return new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}

export function formatDate(value: string | null | undefined) {
  if (!value) return '';
  const date = new Date(value);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (isSameDay(date, today)) return 'Hoje';
  if (isSameDay(date, yesterday)) return 'Ontem';
  return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'long', year: date.getFullYear() === today.getFullYear() ? undefined : 'numeric' }).format(date);
}

export function relativeTime(value: string | null | undefined) {
  if (!value) return '';
  const date = new Date(value).getTime();
  const diff = Date.now() - date;
  if (diff < 60_000) return 'agora';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} min`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} h`;
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)} d`;
  return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit' }).format(new Date(value));
}

export function isSameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatDuration(seconds: number) {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (mins >= 60) {
    const hours = Math.floor(mins / 60);
    return `${hours}h ${mins % 60}min`;
  }
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

export function isImage(mime: string) {
  return mime.startsWith('image/');
}

export function isVideo(mime: string) {
  return mime.startsWith('video/');
}

export function isAudio(mime: string) {
  return mime.startsWith('audio/');
}

export function presenceLabel(presence: string) {
  switch (presence) {
    case 'online':
      return 'Online';
    case 'away':
      return 'Ausente';
    case 'dnd':
      return 'Não perturbe';
    default:
      return 'Offline';
  }
}

export function presenceColor(presence: string) {
  switch (presence) {
    case 'online':
      return '#C9A0DC';
    case 'away':
      return '#f5b942';
    case 'dnd':
      return '#f05b6b';
    default:
      return '#6f6478';
  }
}

export function lastSeenLabel(value: string | null, presence: string) {
  if (presence === 'online') return 'Online';
  if (presence === 'away') return 'Ausente';
  if (presence === 'dnd') return 'Não perturbe';
  if (!value) return 'Offline';
  return `Visto ${relativeTime(value)} atrás`;
}

export function safeName(user: { displayName: string; username: string } | null | undefined) {
  return user?.displayName || user?.username || 'Alguém';
}

export function truncate(value: string, length = 80) {
  return value.length > length ? `${value.slice(0, length - 1)}…` : value;
}

export function groupReactions<
  T extends { emoji: string; count: number; users: { id: string }[] },
>(message: { reactions: T[] }, userId: string) {
  return message.reactions.map((reaction) => ({
    ...reaction,
    me: reaction.users.some((user) => user.id === userId),
  }));
}

export function classNames(...values: (string | false | null | undefined)[]) {
  return values.filter(Boolean).join(' ');
}

export function playNotificationSound(volume = 0.04) {
  try {
    const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;
    const context = new AudioContextClass();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(880, context.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(1320, context.currentTime + 0.12);
    gain.gain.setValueAtTime(volume, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.25);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.25);
    oscillator.onended = () => context.close();
  } catch {
    // Audio feedback is optional.
  }
}

export function downloadUrl(url: string, name: string) {
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}
