import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowUpRight,
  Building2,
  Compass,
  Globe,
  Lock,
  Plus,
  Search,
  Users,
} from 'lucide-react';
import { api, ApiError, queryString } from '../lib/api';
import type { Space, SpaceSummary } from '../lib/types';
import { classNames, truncate } from '../lib/utils';
import { useAppStore } from '../store/app';
import { toast } from '../store/toast';
import { Avatar } from '../components/ui/Avatar';
import { EmptyState } from '../components/ui/EmptyState';
import { Spinner } from '../components/ui/Spinner';
import { CreateSpaceModal } from '../components/spaces/CreateSpaceModal';

export function SpacesDirectoryPage() {
  const navigate = useNavigate();
  const spaces = useAppStore((state) => state.spaces);
  const refreshSpaces = useAppStore((state) => state.refreshSpaces);
  const [createOpen, setCreateOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [discover, setDiscover] = useState<SpaceSummary[]>([]);
  const [loadingDiscover, setLoadingDiscover] = useState(true);
  const [joining, setJoining] = useState<string | null>(null);
  const [tab, setTab] = useState<'mine' | 'discover'>('mine');

  useEffect(() => {
    void refreshSpaces();
  }, [refreshSpaces]);

  useEffect(() => {
    let cancelled = false;
    setLoadingDiscover(true);
    const timer = window.setTimeout(async () => {
      try {
        const data = await api.get<{ spaces: SpaceSummary[] }>(
          `/spaces/discover${queryString({ q: query.trim() || undefined })}`,
        );
        if (!cancelled) setDiscover(data.spaces);
      } catch {
        if (!cancelled) setDiscover([]);
      } finally {
        if (!cancelled) setLoadingDiscover(false);
      }
    }, query.trim() ? 300 : 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query]);

  const joinedIds = useMemo(() => new Set(spaces.map((space) => space.id)), [spaces]);
  const visibleDiscover = useMemo(
    () => discover.filter((space) => !joinedIds.has(space.id)),
    [discover, joinedIds],
  );

  async function joinSpace(space: SpaceSummary) {
    setJoining(space.id);
    try {
      const data = await api.post<{ space: Space }>(`/spaces/${space.id}/join`);
      await refreshSpaces();
      toast.success('Bem-vindo ao espaço', data.space.name);
      navigate(`/app/spaces/${space.id}`);
    } catch (error) {
      toast.error(
        'Não foi possível entrar',
        error instanceof ApiError ? error.message : undefined,
      );
    } finally {
      setJoining(null);
    }
  }

  return (
    <div className="page spaces-directory">
      <header className="page-head">
        <div>
          <span className="eyebrow">
            <Compass size={14} /> Comunidades
          </span>
          <h1>Espaços</h1>
          <p>Reúna sua equipe em canais, cargos e conversas organizadas.</p>
        </div>
        <button type="button" className="btn btn-primary btn-lg" onClick={() => setCreateOpen(true)}>
          <Plus size={18} /> Criar espaço
        </button>
      </header>

      <div className="compact-tabs" role="tablist" aria-label="Espaços">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'mine'}
          className={classNames('compact-tab', tab === 'mine' && 'active')}
          onClick={() => setTab('mine')}
        >
          <Building2 size={16} /> Meus espaços
          {spaces.length > 0 && <span className="nav-badge neutral">{spaces.length}</span>}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'discover'}
          className={classNames('compact-tab', tab === 'discover' && 'active')}
          onClick={() => setTab('discover')}
        >
          <Compass size={16} /> Descobrir
        </button>
      </div>

      {tab === 'mine' && (
        <section className="page-panel">
          <header className="section-title-row">
            <div>
              <h2>Seus espaços</h2>
              <p>Comunidades das quais você já participa.</p>
            </div>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setCreateOpen(true)}>
              <Plus size={15} /> Novo
            </button>
          </header>
          {spaces.length === 0 ? (
            <EmptyState
              icon={<Building2 size={28} />}
              title="Nenhum espaço ainda"
              message="Crie um espaço para organizar canais, cargos e a sua equipe, ou descubra comunidades públicas."
              action={
                <div className="empty-actions">
                  <button type="button" className="btn btn-primary" onClick={() => setCreateOpen(true)}>
                    <Plus size={16} /> Criar espaço
                  </button>
                  <button type="button" className="btn btn-secondary" onClick={() => setTab('discover')}>
                    <Compass size={16} /> Descobrir
                  </button>
                </div>
              }
            />
          ) : (
            <div className="space-grid">
              {spaces.map((space) => (
                <Link to={`/app/spaces/${space.id}`} className="space-card" key={space.id}>
                  <div className="space-card-top">
                    <Avatar name={space.name} src={space.iconUrl} size={54} rounded={false} />
                    <span className={classNames('space-badge', space.visibility)}>
                      {space.visibility === 'public' ? <Globe size={12} /> : <Lock size={12} />}
                      {space.visibility === 'public' ? 'Público' : 'Privado'}
                    </span>
                  </div>
                  <div className="space-card-copy">
                    <h3>{truncate(space.name, 34)}</h3>
                    <p>{space.description || 'Sem descrição por enquanto.'}</p>
                  </div>
                  <div className="space-card-meta">
                    <span>
                      <Users size={13} /> {space.memberCount} membros
                    </span>
                    <span>{space.channelCount} canais</span>
                    <ArrowUpRight size={16} className="space-card-arrow" />
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>
      )}

      {tab === 'discover' && (
        <section className="page-panel">
          <header className="section-title-row">
            <div>
              <h2>Descobrir comunidades</h2>
              <p>Espaços públicos que você ainda não participa.</p>
            </div>
          </header>
          <div className="input-shell discover-search">
            <Search size={18} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Buscar espaços públicos…"
              aria-label="Buscar espaços públicos"
            />
            {loadingDiscover && visibleDiscover.length > 0 && <Spinner size={16} />}
          </div>

          {loadingDiscover && visibleDiscover.length === 0 ? (
            <div className="loading-row">
              <Spinner size={22} /> Carregando espaços…
            </div>
          ) : visibleDiscover.length === 0 ? (
            <EmptyState
              icon={<Compass size={28} />}
              title={query ? 'Nenhum espaço encontrado' : 'Nenhum espaço público disponível'}
              message={
                query
                  ? 'Tente outro termo de busca.'
                  : 'Crie o primeiro espaço público da sua comunidade ou peça um convite para um espaço privado.'
              }
              action={
                <button type="button" className="btn btn-primary" onClick={() => setCreateOpen(true)}>
                  <Plus size={16} /> Criar espaço
                </button>
              }
            />
          ) : (
            <div className="space-grid">
              {visibleDiscover.map((space) => (
                <article className="space-card discover-card" key={space.id}>
                  <div className="space-card-top">
                    <Avatar name={space.name} src={space.iconUrl} size={54} rounded={false} />
                    <span className="space-badge public">
                      <Globe size={12} /> Público
                    </span>
                  </div>
                  <div className="space-card-copy">
                    <h3>{truncate(space.name, 34)}</h3>
                    <p>{space.description || 'Sem descrição por enquanto.'}</p>
                  </div>
                  <div className="space-card-meta">
                    <span>
                      <Users size={13} /> {space.memberCount} membros
                    </span>
                    <span>{space.channelCount} canais</span>
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      onClick={() => void joinSpace(space)}
                      disabled={joining === space.id}
                    >
                      {joining === space.id ? <Spinner size={14} /> : <Plus size={14} />}
                      Entrar
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      )}

      <CreateSpaceModal open={createOpen} onClose={() => setCreateOpen(false)} />
    </div>
  );
}
