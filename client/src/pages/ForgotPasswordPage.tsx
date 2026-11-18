import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, Mail } from 'lucide-react';
import { AuthShell } from '../components/auth/AuthShell';
import { Spinner } from '../components/ui/Spinner';
import { api, ApiError } from '../lib/api';

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [devToken, setDevToken] = useState('');
  const [error, setError] = useState('');

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) {
      setError('Informe um email válido.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const data = await api.post<{ ok: boolean; devToken?: string }>(
        '/auth/forgot-password',
        { email: email.trim() },
        { auth: false, retry: false },
      );
      setSent(true);
      if (data.devToken) setDevToken(data.devToken);
    } catch (requestError) {
      setError(
        requestError instanceof ApiError
          ? requestError.message
          : 'Não foi possível enviar as instruções.',
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell
      title="Recuperar acesso"
      subtitle="Enviaremos um link seguro para redefinir sua senha."
      compact
      footer={
        <p>
          <Link to="/login" className="inline-link">
            <ArrowLeft size={14} /> Voltar para o login
          </Link>
        </p>
      }
    >
      {sent ? (
        <div className="auth-success">
          <span className="success-icon">
            <CheckCircle2 size={30} />
          </span>
          <h3>Confira seu email</h3>
          <p>
            Se houver uma conta associada a <strong>{email}</strong>, o link de
            redefinição chegará em instantes. O link expira em 30 minutos.
          </p>
          {devToken && (
            <div className="dev-box">
              <strong>Ambiente de desenvolvimento</strong>
              <p>O envio de email não está configurado. Use o link abaixo:</p>
              <Link
                className="btn btn-secondary btn-sm"
                to={`/reset-password?token=${encodeURIComponent(devToken)}`}
              >
                Redefinir senha agora
              </Link>
            </div>
          )}
        </div>
      ) : (
        <form className="auth-form" onSubmit={handleSubmit} noValidate>
          <label className="field">
            <span>Email da conta</span>
            <div className={`input-shell${error ? ' invalid' : ''}`}>
              <Mail size={17} />
              <input
                type="email"
                value={email}
                onChange={(event) => {
                  setEmail(event.target.value);
                  setError('');
                }}
                placeholder="você@email.com"
                autoComplete="email"
                autoFocus
              />
            </div>
            {error && <small className="field-error">{error}</small>}
          </label>
          <button type="submit" className="btn btn-primary btn-lg auth-submit" disabled={loading}>
            {loading && <Spinner size={18} />}
            Enviar link de redefinição
          </button>
        </form>
      )}
    </AuthShell>
  );
}
