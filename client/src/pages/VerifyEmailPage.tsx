import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AlertCircle, CheckCircle2, MailCheck } from 'lucide-react';
import { AuthShell } from '../components/auth/AuthShell';
import { Spinner } from '../components/ui/Spinner';
import { api, ApiError } from '../lib/api';
import { useAuthStore } from '../store/auth';
import { toast } from '../store/toast';

type State = 'verifying' | 'success' | 'error' | 'missing';

export function VerifyEmailPage() {
  const [params] = useSearchParams();
  const token = params.get('token') || '';
  const user = useAuthStore((state) => state.user);
  const refreshUser = useAuthStore((state) => state.refreshUser);
  const [state, setState] = useState<State>(token ? 'verifying' : 'missing');
  const [message, setMessage] = useState('');
  const [resending, setResending] = useState(false);
  const [devToken, setDevToken] = useState('');
  const started = useRef(false);

  useEffect(() => {
    if (!token || started.current) return;
    started.current = true;
    (async () => {
      try {
        await api.post('/auth/verify-email', { token }, { auth: false, retry: false });
        setState('success');
        if (useAuthStore.getState().user) {
          await refreshUser().catch(() => undefined);
        }
      } catch (error) {
        setState('error');
        setMessage(
          error instanceof ApiError ? error.message : 'Não foi possível verificar o email.',
        );
      }
    })();
  }, [token, refreshUser]);

  async function resend() {
    setResending(true);
    try {
      const data = await api.post<{ delivered: boolean; token?: string }>(
        '/auth/resend-verification',
      );
      if (data.token) setDevToken(data.token);
      toast.success(
        data.delivered ? 'Email reenviado' : 'Link de verificação gerado',
        data.delivered ? 'Confira sua caixa de entrada.' : 'O SMTP não está configurado.',
      );
    } catch (error) {
      toast.error(
        'Não foi possível reenviar',
        error instanceof ApiError ? error.message : undefined,
      );
    } finally {
      setResending(false);
    }
  }

  return (
    <AuthShell
      title="Verificação de email"
      subtitle="Confirme que este endereço pertence a você."
      compact
      footer={
        <p>
          <Link to={user ? '/app/settings' : '/login'}>
            {user ? 'Ir para configurações' : 'Voltar para o login'}
          </Link>
        </p>
      }
    >
      <div className="auth-success">
        {state === 'verifying' && (
          <>
            <Spinner size={30} />
            <h3>Verificando seu email…</h3>
            <p>Isso leva apenas um instante.</p>
          </>
        )}
        {state === 'success' && (
          <>
            <span className="success-icon">
              <CheckCircle2 size={30} />
            </span>
            <h3>Email verificado</h3>
            <p>Sua conta está confirmada. Aproveite o UNISON em qualquer dispositivo.</p>
            <Link to={user ? '/app' : '/login'} className="btn btn-primary">
              Continuar
            </Link>
          </>
        )}
        {state === 'error' && (
          <>
            <span className="error-icon">
              <AlertCircle size={30} />
            </span>
            <h3>Link inválido ou expirado</h3>
            <p>{message}</p>
            {user && (
              <button type="button" className="btn btn-secondary" onClick={resend} disabled={resending}>
                {resending && <Spinner size={16} />}
                Reenviar verificação
              </button>
            )}
          </>
        )}
        {state === 'missing' && (
          <>
            <span className="success-icon">
              <MailCheck size={30} />
            </span>
            <h3>Informe o link recebido</h3>
            <p>
              Abra o link enviado para o seu email. Se você ainda não recebeu, solicite um
              novo envio nas configurações da conta.
            </p>
            {user ? (
              <button type="button" className="btn btn-secondary" onClick={resend} disabled={resending}>
                {resending && <Spinner size={16} />}
                Reenviar verificação
              </button>
            ) : (
              <Link to="/login" className="btn btn-secondary">
                Entrar
              </Link>
            )}
          </>
        )}
        {devToken && (
          <div className="dev-box">
            <strong>Ambiente de desenvolvimento</strong>
            <p>Use este link para concluir a verificação:</p>
            <Link
              className="btn btn-secondary btn-sm"
              to={`/verify-email?token=${encodeURIComponent(devToken)}`}
            >
              Verificar agora
            </Link>
          </div>
        )}
      </div>
    </AuthShell>
  );
}
