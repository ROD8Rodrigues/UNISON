import { Component, useEffect, type ErrorInfo, type ReactNode } from 'react';
import {
  BrowserRouter,
  Navigate,
  Outlet,
  Route,
  Routes,
  useLocation,
} from 'react-router-dom';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { RealtimeBridge } from './components/RealtimeBridge';
import { AppShell } from './components/layout/AppShell';
import { Logo } from './components/ui/Logo';
import { Spinner } from './components/ui/Spinner';
import { AuthPage } from './pages/AuthPage';
import { ConversationsPage } from './pages/ConversationsPage';
import { ForgotPasswordPage } from './pages/ForgotPasswordPage';
import { FriendsPage } from './pages/FriendsPage';
import { InvitePage } from './pages/InvitePage';
import { ResetPasswordPage } from './pages/ResetPasswordPage';
import { SettingsPage } from './pages/SettingsPage';
import { SpaceOverview, SpacePage } from './pages/SpacePage';
import { SpacesDirectoryPage } from './pages/SpacesDirectoryPage';
import { VerifyEmailPage } from './pages/VerifyEmailPage';
import { ChatView } from './components/chat/ChatView';
import { useAppStore } from './store/app';
import { useAuthStore } from './store/auth';
import { useDialogStore } from './store/dialog';
import { ConfirmHost } from './components/ui/ConfirmHost';
import { Toasts } from './components/ui/Toasts';

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('UNISON UI error', error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="fatal-screen">
        <span className="fatal-icon">
          <AlertTriangle size={30} />
        </span>
        <h1>Algo saiu do esperado</h1>
        <p>A interface encontrou um erro inesperado. Recarregue para continuar.</p>
        <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>
          <RefreshCw size={16} /> Recarregar UNISON
        </button>
      </div>
    );
  }
}

function BootSplash() {
  return (
    <div className="boot-screen">
      <Logo size={54} withWord />
      <div className="boot-loader">
        <Spinner size={22} />
        <span>Sincronizando sua conta…</span>
      </div>
    </div>
  );
}

function ThemeSync() {
  const settings = useAuthStore((state) => state.user?.settings);
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = settings?.theme || 'dark';
    root.classList.toggle('compact', Boolean(settings?.compactMode));
    root.classList.toggle('reduce-motion', Boolean(settings?.reduceMotion));
    root.style.setProperty('--accent', settings?.accent || '#C9A0DC');
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', '#0a080d');
  }, [settings]);
  return null;
}

function RequireAuth() {
  const status = useAuthStore((state) => state.status);
  const location = useLocation();
  if (status === 'booting') return <BootSplash />;
  if (status === 'guest') {
    return (
      <Navigate
        to="/login"
        replace
        state={{ from: `${location.pathname}${location.search}` }}
      />
    );
  }
  return <Outlet />;
}

function GuestRoute() {
  const status = useAuthStore((state) => state.status);
  if (status === 'booting') return <BootSplash />;
  if (status === 'authenticated') return <Navigate to="/app" replace />;
  return <Outlet />;
}

function NotFoundPage() {
  const status = useAuthStore((state) => state.status);
  return (
    <div className="fatal-screen">
      <Logo size={44} withWord />
      <h1>Página não encontrada</h1>
      <p>O endereço acessado não existe ou foi movido.</p>
      <a href={status === 'authenticated' ? '/app' : '/login'} className="btn btn-primary">
        Voltar ao início
      </a>
    </div>
  );
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/app" replace />} />

      <Route element={<GuestRoute />}>
        <Route path="/login" element={<AuthPage mode="login" />} />
        <Route path="/register" element={<AuthPage mode="register" />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
      </Route>

      <Route path="/verify-email" element={<VerifyEmailPage />} />
      <Route path="/invite/:code" element={<InvitePage />} />

      <Route path="/app" element={<RequireAuth />}>
        <Route element={<RealtimeBridge />}>
          <Route element={<AppShell />}>
            <Route index element={<ConversationsPage />} />
            <Route path="friends" element={<FriendsPage />} />
            <Route path="spaces" element={<SpacesDirectoryPage />} />
            <Route path="spaces/:spaceId" element={<SpacePage />}>
              <Route index element={<SpaceOverview />} />
              <Route path="channels/:channelId" element={<ChatView mode="channel" />} />
            </Route>
            <Route path="dm/:conversationId" element={<ChatView mode="conversation" />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="*" element={<Navigate to="/app" replace />} />
          </Route>
        </Route>
      </Route>

      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}

function App() {
  const bootstrap = useAuthStore((state) => state.bootstrap);
  const status = useAuthStore((state) => state.status);
  const sessionLost = useAuthStore((state) => state.sessionLost);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  useEffect(() => {
    if (status === 'guest') {
      useAppStore.getState().reset();
      useDialogStore.getState().close(false);
      sessionLost();
    }
  }, [status, sessionLost]);

  if (status === 'booting') return <BootSplash />;

  return (
    <ErrorBoundary>
      <ThemeSync />
      <BrowserRouter>
        <AppRoutes />
        <Toasts />
        <ConfirmHost />
      </BrowserRouter>
    </ErrorBoundary>
  );
}

export default App;
