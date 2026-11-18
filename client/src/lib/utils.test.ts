import { describe, expect, it } from 'vitest';
import {
  classNames,
  formatBytes,
  formatDuration,
  groupReactions,
  initials,
  isAudio,
  isImage,
  isVideo,
  presenceColor,
  presenceLabel,
  safeName,
  truncate,
} from './utils';

describe('formatting helpers', () => {
  it('builds initials from the first two words', () => {
    expect(initials('Ana Maria Silva')).toBe('AM');
    expect(initials('  unison  ')).toBe('U');
    expect(initials('')).toBe('');
  });

  it('formats file sizes', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2.0 KB');
    expect(formatBytes(3 * 1024 * 1024)).toBe('3.0 MB');
  });

  it('formats call durations', () => {
    expect(formatDuration(9)).toBe('0:09');
    expect(formatDuration(125)).toBe('2:05');
    expect(formatDuration(3725)).toBe('1h 2min');
  });

  it('detects media families from MIME types', () => {
    expect(isImage('image/webp')).toBe(true);
    expect(isVideo('video/mp4')).toBe(true);
    expect(isAudio('audio/ogg')).toBe(true);
    expect(isImage('application/pdf')).toBe(false);
  });

  it('maps presence labels and colors', () => {
    expect(presenceLabel('online')).toBe('Online');
    expect(presenceLabel('dnd')).toBe('Não perturbe');
    expect(presenceLabel('offline')).toBe('Offline');
    expect(presenceColor('online')).toBe('#C9A0DC');
  });

  it('falls back safely for missing users', () => {
    expect(safeName({ displayName: 'Ana', username: 'ana' })).toBe('Ana');
    expect(safeName({ displayName: '', username: 'ana' })).toBe('ana');
    expect(safeName(null)).toBe('Alguém');
  });

  it('truncates without exceeding the requested length', () => {
    expect(truncate('curta', 10)).toBe('curta');
    const result = truncate('uma mensagem bastante longa', 10);
    expect(result).toBe('uma mensa…');
    expect(result.length).toBe(10);
  });

  it('joins only truthy class names', () => {
    expect(classNames('a', false, undefined, 'b', null, 'c')).toBe('a b c');
  });
});

describe('groupReactions', () => {
  it('adds the current viewer flag while preserving count and user data', () => {
    const reactions = groupReactions(
      {
        reactions: [
          {
            emoji: '🔥',
            count: 2,
            users: [
              { id: 'user-1', username: 'ana', displayName: 'Ana' },
              { id: 'user-2', username: 'bia', displayName: 'Bia' },
            ],
          },
          {
            emoji: '👍',
            count: 1,
            users: [{ id: 'user-2', username: 'bia', displayName: 'Bia' }],
          },
        ],
      },
      'user-1',
    );

    expect(reactions).toHaveLength(2);
    expect(reactions[0]).toMatchObject({ emoji: '🔥', count: 2, me: true });
    expect(reactions[0].users[0].displayName).toBe('Ana');
    expect(reactions[1]).toMatchObject({ emoji: '👍', count: 1, me: false });
  });
});
