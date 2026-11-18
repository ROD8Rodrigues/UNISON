import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, Eye, EyeOff, KeyRound } from 'lucide-react';
import { AuthShell } from '../components/auth/AuthShell';
import { Spinner } from '../components/ui/Spinner';
import { api, ApiError } from '../lib/api';
import { toast } from '../store/toast';

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [token, setToken] = useState(params.get('token') || '');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!token.trim()) {
      setError('O token de redefinição está ausente.');
      return;
    }
    if (password.length < 8 || !/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
      setError('A senha precisa ter 8+ caracteres, com letras e números.');
      return;
    }
    if (password !== confirm) {
      setError('As senhas não coincidem.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      await api.post(
        '/auth/reset-password',
        { token: token.trim(), password },
        { auth: false, retry: false },
      );
      setDone(true);
      toast.success('Senha redefinida', 'Entre com sua nova senha.');
    } catch (requestError) {
      setError(
        requestError instanceof ApiError
          ? requestError.message
          : 'Não foi possível redefinir a senha.',
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell
      title="Definir nova senha"
      subtitle="Escolha uma senha forte e exclusiva para sua conta."
      compact
      footer={
        <p>
          <Link to="/login" className="inline-link">
            <ArrowLeft size={14} /> Voltar para o login
          </Link>
        </p>
      }
    >
      {done ? (
        <div className="auth-success">
          <span className="success-icon">
            <CheckCircle2 size={30} />
          </span>
          <h3>Senha atualizada</h3>
          <p>Todas as sessões anteriores foram encerradas por segurança.</p>
          <button type="button" className="btn btn-primary" onClick={() => navigate('/login')}>
            Entrar com a nova senha
          </button>
        </div>
      ) : (
        <form className="auth-form" onSubmit={handleSubmit} noValidate>
          {!params.get('token') && (
            <label className="field">
              <span>Token de redefinição</span>
              <div className="input-shell">
                <KeyRound size={17} />
                <input
                  value={token}
                  onChange={(event) => setToken(event.target.value)}
                  placeholder="Cole o token recebido por email"
                  autoComplete="one-time-code"
                />
              </div>
            </label>
          )}
          <label className="field">
            <span>Nova senha</span>
            <div className="input-shell">
              <KeyRound size={17} />
              <input
                type={show ? 'text' : 'password'}
                value={password}
                onChange={(event) => {
                  setPassword(event.target.value);
                  setError('');
                }}
                placeholder="Mínimo de 8 caracteres"
                autoComplete="new-password"
                autoFocus
              />
              <button
                type="button"
                className="input-action"
                onClick={() => setShow((value) => !value)}
                aria-label={show ? 'Ocultar senha' : 'Mostrar senha'}
              >
                {show ? <EyeOff size={17} /> : <Eye size={17} />}
              </button>
            </div>
            <small className="field-hint">Use letras e números.</small>
          </label>
          <label className="field">
            <span>Confirmar senha</span>
            <div className="input-shell">
              <KeyRound size={17} />
              <input
                type={show ? 'text' : 'password'}
                value={confirm}
                onChange={(event) => {
                  setConfirm(event.target.value);
                  setError('');
                }}
                placeholder="Repita a nova senha"
                autoComplete="new-password"
              />
            </div>
          </label>
          {error && (
            <div className="form-error" role="alert">
              {error}
            </div>
          )}
          <button type="submit" className="btn btn-primary btn-lg auth-submit" disabled={loading}>
            {loading && <Spinner size={18} />}
            Redefinir senha
          </button>
        </form>
      )}
    </AuthShell>
  );
}
