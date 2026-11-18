import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { AlertCircle, ArrowRight, CheckCircle2, LogIn, Ticket, UserPlus } from 'lucide-react';
import { AuthShell } from '../components/auth/AuthShell';
import { Avatar } from '../components/ui/Avatar';
import { Spinner } from '../components/ui/Spinner';
import { api, ApiError } from '../lib/api';
import type { Space } from '../lib/types';
import { useAppStore } from '../store/app';
import { useAuthStore } from '../store/auth';
import { toast } from '../store/toast';

interface InviteDetails {
  code: string;
  valid: boolean;
  expired: boolean;
  exhausted: boolean;
  space: {
    id: string;
    name: string;
    description: string;
    iconUrl: string | null;
    visibility: 'public' | 'private';
    memberCount: number;
  };
  expiresAt: string | null;
}

export function InvitePage() {
  const { code = '' } = useParams();
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
  const userId = user?.id;
  const [invite, setInvite] = useState<InviteDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [joining, setJoining] = useState(false);

  useEffect(() => {
    if (!userId) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    api
      .get<{ invite: InviteDetails }>(`/invites/${encodeURIComponent(code)}`)
      .then((data) => {
        if (!cancelled) {
          setInvite(data.invite);
          setError('');
        }
      })
      .catch((requestError) => {
        if (!cancelled) {
          setError(
            requestError instanceof ApiError
              ? requestError.message
              : 'Não foi possível abrir este convite.',
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [code, userId]);

  async function join() {
    setJoining(true);
    try {
      const data = await api.post<{ space: Space }>(`/invites/${encodeURIComponent(code)}/join`);
      await useAppStore.getState().refreshSpaces().catch(() => undefined);
      toast.success('Bem-vindo ao espaço', data.space.name);
      navigate(`/app/spaces/${data.space.id}`);
    } catch (requestError) {
      toast.error(
        'Não foi possível entrar',
        requestError instanceof ApiError ? requestError.message : undefined,
      );
    } finally {
      setJoining(false);
    }
  }

  if (!user) {
    return (
      <AuthShell
        title="Você recebeu um convite"
        subtitle="Entre ou crie uma conta para aceitar o convite e participar do espaço."
        compact
        footer={
          <p>
            Já tem uma conta?{' '}
            <Link to="/login" state={{ from: `/invite/${code}` }}>
              Entrar
            </Link>
          </p>
        }
      >
        <div className="invite-landing">
          <span className="invite-icon">
            <Ticket size={30} />
          </span>
          <h3>Convite para um espaço no UNISON</h3>
          <p>
            Código do convite: <code>{code}</code>
          </p>
          <div className="invite-actions">
            <Link
              to="/login"
              state={{ from: `/invite/${code}` }}
              className="btn btn-primary btn-lg"
            >
              <LogIn size={17} /> Entrar para aceitar
            </Link>
            <Link
              to="/register"
              state={{ from: `/invite/${code}` }}
              className="btn btn-secondary btn-lg"
            >
              <UserPlus size={17} /> Criar uma conta
            </Link>
          </div>
          <p className="invite-hint">O convite será aplicado automaticamente após o login.</p>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Convite de espaço"
      subtitle="Confirme a entrada para abrir os canais deste espaço."
      compact
      footer={
        <p>
          <Link to="/app">Voltar ao UNISON</Link>
        </p>
      }
    >
      {loading ? (
        <div className="auth-success">
          <Spinner size={30} />
          <h3>Verificando convite…</h3>
          <p>Um instante.</p>
        </div>
      ) : error ? (
        <div className="auth-success">
          <span className="error-icon">
            <AlertCircle size={30} />
          </span>
          <h3>Convite indisponível</h3>
          <p>{error}</p>
          <Link to="/app/spaces" className="btn btn-secondary">
            Ver espaços
          </Link>
        </div>
      ) : invite ? (
        <div className="invite-landing">
          <Avatar name={invite.space.name} src={invite.space.iconUrl} size={88} rounded={false} />
          <h3>{invite.space.name}</h3>
          <p>{invite.space.description || 'Um espaço da comunidade UNISON.'}</p>
          <span className="invite-code-badge">
            <Ticket size={14} /> {invite.code}
          </span>
          <p className="invite-meta">
            {invite.space.memberCount} membros ·{' '}
            {invite.space.visibility === 'public' ? 'espaço público' : 'espaço privado'}
          </p>
          {invite.valid ? (
            <button
              type="button"
              className="btn btn-primary btn-lg"
              onClick={() => void join()}
              disabled={joining}
            >
              {joining ? <Spinner size={18} /> : <CheckCircle2 size={18} />}
              {joining ? 'Entrando…' : 'Entrar no espaço'}
              {!joining && <ArrowRight size={17} />}
            </button>
          ) : (
            <div className="form-error">
              {invite.expired ? 'Este convite expirou.' : 'Este convite atingiu o limite de usos.'}
              <span>Peça um novo link a um administrador do espaço.</span>
            </div>
          )}
          <p className="invite-hint">
            Você está conectado como <strong>@{user.username}</strong>.
          </p>
        </div>
      ) : null}
    </AuthShell>
  );
}
