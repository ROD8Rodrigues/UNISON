import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ArrowRight, Eye, EyeOff, KeyRound, Mail, UserRound } from 'lucide-react';
import { AuthShell } from '../components/auth/AuthShell';
import { Spinner } from '../components/ui/Spinner';
import { ApiError } from '../lib/api';
import { useAuthStore } from '../store/auth';
import { toast } from '../store/toast';

type Mode = 'login' | 'register';

function fieldErrors(error: unknown) {
  if (!(error instanceof ApiError)) return {};
  const map: Record<string, string> = {};
  for (const detail of error.details || []) {
    const key = detail.field.split('.').pop() || detail.field;
    if (!map[key]) map[key] = detail.message;
  }
  return map;
}

function errorMessage(error: unknown) {
  if (error instanceof ApiError) return error.message;
  return error instanceof Error ? error.message : 'Não foi possível concluir. Tente novamente.';
}

export function AuthPage({ mode }: { mode: Mode }) {
  const navigate = useNavigate();
  const location = useLocation();
  const login = useAuthStore((state) => state.login);
  const register = useAuthStore((state) => state.register);
  const [loading, setLoading] = useState(false);
  const [formError, setFormError] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [showPassword, setShowPassword] = useState(false);
  const [form, setForm] = useState({
    identifier: '',
    displayName: '',
    username: '',
    email: '',
    password: '',
  });

  const from = (location.state as { from?: string } | null)?.from;
  const target = from && !from.startsWith('/login') && !from.startsWith('/register') ? from : '/app';

  function update(key: keyof typeof form, value: string) {
    setForm((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: '' }));
    setFormError('');
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (loading) return;
    const nextErrors: Record<string, string> = {};
    if (mode === 'login') {
      if (!form.identifier.trim()) nextErrors.identifier = 'Informe seu usuário ou email.';
      if (!form.password) nextErrors.password = 'Informe sua senha.';
    } else {
      if (form.username.trim().length < 3) nextErrors.username = 'Use pelo menos 3 caracteres.';
      if (!/^[a-z0-9_.]+$/i.test(form.username.trim())) {
        nextErrors.username = 'Use apenas letras, números, pontos e sublinhados.';
      }
      if (!/^\S+@\S+\.\S+$/.test(form.email.trim())) nextErrors.email = 'Informe um email válido.';
      if (form.password.length < 8 || !/[A-Za-z]/.test(form.password) || !/[0-9]/.test(form.password)) {
        nextErrors.password = 'Use 8+ caracteres, com letras e números.';
      }
    }
    if (Object.keys(nextErrors).length) {
      setErrors(nextErrors);
      return;
    }
    setLoading(true);
    setFormError('');
    try {
      if (mode === 'login') {
        const user = await login(form.identifier.trim(), form.password);
        toast.success(`Bem-vindo, ${user.displayName.split(' ')[0]}`);
        navigate(target, { replace: true });
      } else {
        const result = await register({
          username: form.username.trim().toLowerCase(),
          email: form.email.trim(),
          password: form.password,
          displayName: form.displayName.trim() || undefined,
        });
        toast.success('Conta criada', 'Você já está conectado ao UNISON.');
        if (result.emailVerification?.token) {
          sessionStorage.setItem('tw:dev-verify-token', result.emailVerification.token);
        }
        navigate(target, { replace: true });
      }
    } catch (error) {
      setErrors(fieldErrors(error));
      setFormError(errorMessage(error));
    } finally {
      setLoading(false);
    }
  }

  const isLogin = mode === 'login';

  return (
    <AuthShell
      title={isLogin ? 'Bem-vindo de volta' : 'Crie sua conta'}
      subtitle={
        isLogin
          ? 'Entre para retomar suas conversas, comunidades e chamadas.'
          : 'Um único espaço para tudo o que a sua equipe precisa.'
      }
      footer={
        isLogin ? (
          <p>
            Ainda não tem conta? <Link to="/register">Criar conta</Link>
          </p>
        ) : (
          <p>
            Já tem uma conta? <Link to="/login">Entrar</Link>
          </p>
        )
      }
    >
      <form className="auth-form" onSubmit={handleSubmit} noValidate>
        {!isLogin && (
          <label className="field">
            <span>Nome de exibição</span>
            <div className={`input-shell${errors.displayName ? ' invalid' : ''}`}>
              <UserRound size={17} />
              <input
                value={form.displayName}
                onChange={(event) => update('displayName', event.target.value)}
                placeholder="Como devemos chamar você?"
                autoComplete="name"
                maxLength={40}
              />
            </div>
            {errors.displayName && <small className="field-error">{errors.displayName}</small>}
          </label>
        )}

        {isLogin ? (
          <label className="field">
            <span>Usuário ou email</span>
            <div className={`input-shell${errors.identifier ? ' invalid' : ''}`}>
              <UserRound size={17} />
              <input
                value={form.identifier}
                onChange={(event) => update('identifier', event.target.value)}
                placeholder="seu.usuario ou você@email.com"
                autoComplete="username"
                autoFocus
              />
            </div>
            {errors.identifier && <small className="field-error">{errors.identifier}</small>}
          </label>
        ) : (
          <>
            <label className="field">
              <span>Nome de usuário</span>
              <div className={`input-shell${errors.username ? ' invalid' : ''}`}>
                <span className="input-prefix">@</span>
                <input
                  value={form.username}
                  onChange={(event) => update('username', event.target.value)}
                  placeholder="seu.usuario"
                  autoComplete="username"
                  maxLength={24}
                  autoCapitalize="none"
                  autoFocus
                />
              </div>
              {errors.username ? (
                <small className="field-error">{errors.username}</small>
              ) : (
                <small className="field-hint">Letras minúsculas, números, ponto e _</small>
              )}
            </label>
            <label className="field">
              <span>Email</span>
              <div className={`input-shell${errors.email ? ' invalid' : ''}`}>
                <Mail size={17} />
                <input
                  type="email"
                  value={form.email}
                  onChange={(event) => update('email', event.target.value)}
                  placeholder="você@email.com"
                  autoComplete="email"
                  maxLength={254}
                />
              </div>
              {errors.email && <small className="field-error">{errors.email}</small>}
            </label>
          </>
        )}

        <label className="field">
          <span className="field-row">
            Senha
            {isLogin && <Link to="/forgot-password">Esqueci a senha</Link>}
          </span>
          <div className={`input-shell${errors.password ? ' invalid' : ''}`}>
            <KeyRound size={17} />
            <input
              type={showPassword ? 'text' : 'password'}
              value={form.password}
              onChange={(event) => update('password', event.target.value)}
              placeholder={isLogin ? 'Sua senha' : 'Mínimo de 8 caracteres'}
              autoComplete={isLogin ? 'current-password' : 'new-password'}
              maxLength={128}
            />
            <button
              type="button"
              className="input-action"
              onClick={() => setShowPassword((value) => !value)}
              aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
            >
              {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
            </button>
          </div>
          {errors.password ? (
            <small className="field-error">{errors.password}</small>
          ) : !isLogin ? (
            <small className="field-hint">Use letras e números.</small>
          ) : null}
        </label>

        {formError && (
          <div className="form-error" role="alert">
            {formError}
          </div>
        )}

        <button type="submit" className="btn btn-primary btn-lg auth-submit" disabled={loading}>
          {loading ? <Spinner size={18} /> : null}
          {isLogin ? 'Entrar no UNISON' : 'Criar minha conta'}
          {!loading && <ArrowRight size={17} />}
        </button>

        {!isLogin && (
          <p className="auth-legal">
            Ao criar uma conta você concorda com o uso responsável do serviço. Seus dados
            ficam sob seu controle.
          </p>
        )}
      </form>
    </AuthShell>
  );
}
