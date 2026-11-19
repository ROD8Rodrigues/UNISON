import { useEffect, useState, type CSSProperties } from 'react';
import { resolveMediaUrl } from '../../lib/api';
import { classNames, initials, presenceColor } from '../../lib/utils';
import type { Presence } from '../../lib/types';

const PALETTE = [
  ['#2b2035', '#d7b3ea'],
  ['#1f2a3a', '#9fc8ff'],
  ['#34261f', '#ffc48a'],
  ['#32203a', '#e3a6ff'],
  ['#36242f', '#ffa9c9'],
  ['#382029', '#ffa9bf'],
  ['#2f2438', '#d9c2ff'],
  ['#252536', '#b7b8ff'],
];

function paletteFor(name: string) {
  let hash = 0;
  for (let index = 0; index < name.length; index += 1) {
    hash = (hash * 31 + name.charCodeAt(index)) >>> 0;
  }
  return PALETTE[hash % PALETTE.length];
}

interface AvatarProps {
  name: string;
  src?: string | null;
  size?: number;
  presence?: Presence | null;
  className?: string;
  rounded?: boolean;
}

export function Avatar({
  name,
  src,
  size = 40,
  presence,
  className,
  rounded = true,
}: AvatarProps) {
  const [failed, setFailed] = useState(false);
  const [background, color] = paletteFor(name || '?');
  const source = resolveMediaUrl(src || '');
  const style = {
    '--avatar-size': `${size}px`,
    '--avatar-bg': background,
    '--avatar-color': color,
  } as CSSProperties;
  const showImage = Boolean(source) && !failed;

  useEffect(() => {
    setFailed(false);
  }, [source]);

  return (
    <span
      className={classNames('avatar', rounded ? 'avatar-round' : 'avatar-square', className)}
      style={style}
      title={name}
    >
      {showImage ? (
        <span className="avatar-media">
          <img src={source} alt={name} onError={() => setFailed(true)} draggable={false} />
        </span>
      ) : (
        <span className="avatar-initials" aria-hidden="true">
          {initials(name)}
        </span>
      )}
      {presence && (
        <span
          className={classNames('presence-dot', `presence-${presence}`)}
          style={{ background: presenceColor(presence) }}
          aria-label={presence}
        />
      )}
    </span>
  );
}
