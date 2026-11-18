import { Link, useLocation } from 'react-router-dom';
import { Compass, Plus, Settings } from 'lucide-react';
import { useAppStore } from '../../store/app';
import { useAuthStore } from '../../store/auth';
import { Avatar } from '../ui/Avatar';
import { Logo } from '../ui/Logo';

export function SpaceRail({ onCreateSpace }: { onCreateSpace: () => void }) {
  const location = useLocation();
  const spaces = useAppStore((state) => state.spaces);
  const user = useAuthStore((state) => state.user);
  const activeSpaceId = location.pathname.match(/^\/app\/spaces\/([^/]+)/)?.[1];

  return (
    <aside className="space-rail" aria-label="Espaços">
      <Link to="/app" className="rail-item rail-home" aria-label="Início" data-label="Início">
        <Logo size={38} />
      </Link>
      <span className="rail-divider" />
      <div className="rail-scroll">
        {spaces.map((space) => (
          <Link
            key={space.id}
            to={`/app/spaces/${space.id}`}
            className={`rail-item rail-space${activeSpaceId === space.id ? ' active' : ''}`}
            aria-label={space.name}
            data-label={space.name}
          >
            {space.iconUrl ? (
              <Avatar name={space.name} src={space.iconUrl} size={40} rounded={false} />
            ) : (
              <span className="rail-initials">{space.name.slice(0, 2).toUpperCase()}</span>
            )}
            {space.joined && <span className="rail-marker" />}
          </Link>
        ))}
        <button
          type="button"
          className="rail-item rail-action"
          onClick={onCreateSpace}
          aria-label="Criar espaço"
          data-label="Criar espaço"
        >
          <Plus size={20} />
        </button>
        <Link
          to="/app/spaces"
          className={`rail-item rail-action${location.pathname === '/app/spaces' ? ' active' : ''}`}
          aria-label="Descobrir espaços"
          data-label="Descobrir espaços"
        >
          <Compass size={20} />
        </Link>
      </div>
      <div className="rail-bottom">
        <Link
          to="/app/settings"
          className="rail-item rail-user"
          aria-label="Configurações"
          data-label={user?.displayName || 'Configurações'}
        >
          <Avatar name={user?.displayName || 'Você'} src={user?.avatarUrl} size={36} presence={user?.presence} />
        </Link>
        <Link to="/app/settings" className="rail-gear" aria-label="Ajustes">
          <Settings size={17} />
        </Link>
      </div>
    </aside>
  );
}
