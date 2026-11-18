import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Bell,
  Check,
  ChevronRight,
  ImagePlus,
  KeyRound,
  Laptop,
  Lock,
  LogOut,
  MailCheck,
  MonitorSmartphone,
  Palette,
  Save,
  Shield,
  ShieldAlert,
  Smartphone,
  Sparkles,
  Trash2,
  UserRound,
  Volume2,
} from 'lucide-react';
import { api, ApiError, resolveMediaUrl } from '../lib/api';
import type { Session, User, UserSettings } from '../lib/types';
import { classNames, formatDate, relativeTime } from '../lib/utils';
import { useAppStore } from '../store/app';
import { useAuthStore } from '../store/auth';
import { confirmDialog } from '../store/dialog';
import { toast } from '../store/toast';
import { Avatar } from '../components/ui/Avatar';
import { Spinner } from '../components/ui/Spinner';
import { Switch } from '../components/ui/Switch';

type TabId = 'profile' | 'appearance' | 'notifications' | 'privacy' | 'security' | 'sessions' | 'account';

const TABS: { id: TabId; label: string; icon: typeof UserRound; hint: string }[] = [
  { id: 'profile', label: 'Perfil', icon: UserRound, hint: 'Identidade e apresentação' },
  { id: 'appearance', label: 'Aparência', icon: Palette, hint: 'Tema, cor e movimento' },
  { id: 'notifications', label: 'Notificações', icon: Bell, hint: 'Alertas e sons' },
  { id: 'privacy', label: 'Privacidade', icon: Lock, hint: 'Visibilidade e recibos' },
  { id: 'security', label: 'Segurança', icon: Shield, hint: 'Senha e email' },
  { id: 'sessions', label: 'Sessões', icon: MonitorSmartphone, hint: 'Dispositivos conectados' },
  { id: 'account', label: 'Conta', icon: ShieldAlert, hint: 'Zona de risco' },
];

const DEFAULT_SETTINGS: UserSettings = {
  theme: 'dark',
  accent: '#C9A0DC',
  compactMode: false,
  reduceMotion: false,
  desktopNotifications: false,
  notificationSounds: true,
  messagePreviews: true,
  privacyLastSeen: 'everyone',
  privacyReadReceipts: true,
  privacyTyping: true,
};

const ACCENT_PRESETS = ['#C9A0DC', '#7DD3FC', '#FFB86B', '#F472B6', '#A78BFA', '#22D3EE'];

function messageFor(error: unknown, fallback: string) {
  return error instanceof ApiError ? error.message : fallback;
}

function deviceIcon(device: string) {
  if (/mobile|android|iphone|ipad/i.test(device)) return Smartphone;
  return Laptop;
}

export function SettingsPage() {
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
  const setUser = useAuthStore((state) => state.setUser);
  const updateSettings = useAuthStore((state) => state.updateSettings);
  const sessionLost = useAuthStore((state) => state.sessionLost);
  const [tab, setTab] = useState<TabId>('profile');

  const [displayName, setDisplayName] = useState(user?.displayName || '');
  const [username, setUsername] = useState(user?.username || '');
  const [bio, setBio] = useState(user?.bio || '');
  const [customStatus, setCustomStatus] = useState(user?.customStatus || '');
  const [avatarUrl, setAvatarUrl] = useState(user?.avatarUrl || '');
  const [bannerUrl, setBannerUrl] = useState(user?.bannerUrl || '');
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileError, setProfileError] = useState('');
  const [profileFieldErrors, setProfileFieldErrors] = useState<Record<string, string>>({});
  const [uploading, setUploading] = useState<'avatar' | 'banner' | null>(null);

  const [settings, setSettings] = useState<UserSettings>(user?.settings || DEFAULT_SETTINGS);
  const [settingsSaving, setSettingsSaving] = useState(false);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordError, setPasswordError] = useState('');
  const [verificationToken, setVerificationToken] = useState<string | null>(null);
  const [resending, setResending] = useState(false);

  const [sessions, setSessions] = useState<Session[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [sessionBusy, setSessionBusy] = useState<string | null>(null);

  const [deletePassword, setDeletePassword] = useState('');
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!user) return;
    setDisplayName(user.displayName);
    setUsername(user.username);
    setBio(user.bio || '');
    setCustomStatus(user.customStatus || '');
    setAvatarUrl(user.avatarUrl || '');
    setBannerUrl(user.bannerUrl || '');
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setSettings(user?.settings || DEFAULT_SETTINGS);
  }, [user?.settings]);

  useEffect(() => {
    if (tab !== 'sessions') return;
    let cancelled = false;
    setLoadingSessions(true);
    api
      .get<{ sessions: Session[] }>('/auth/sessions')
      .then((data) => {
        if (!cancelled) setSessions(data.sessions);
      })
      .catch(() => {
        if (!cancelled) setSessions([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingSessions(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tab]);

  const initials = useMemo(
    () => (user?.displayName || 'Você').trim().charAt(0).toUpperCase() || 'T',
    [user?.displayName],
  );

  async function saveProfile() {
    if (!displayName.trim()) {
      setProfileFieldErrors({ displayName: 'Informe um nome de exibição.' });
      return;
    }
    setProfileSaving(true);
    setProfileError('');
    setProfileFieldErrors({});
    try {
      const data = await api.patch<{ user: User }>('/users/me', {
        displayName: displayName.trim(),
        username: username.trim().toLowerCase(),
        bio: bio.trim(),
        customStatus: customStatus.trim(),
        avatarUrl: avatarUrl || null,
        bannerUrl: bannerUrl || null,
      });
      setUser(data.user);
      toast.success('Perfil atualizado');
    } catch (error) {
      if (error instanceof ApiError) {
        const map: Record<string, string> = {};
        for (const detail of error.details || []) {
          const key = detail.field.split('.').pop() || detail.field;
          if (!map[key]) map[key] = detail.message;
        }
        setProfileFieldErrors(map);
      }
      setProfileError(messageFor(error, 'Não foi possível salvar o perfil.'));
    } finally {
      setProfileSaving(false);
    }
  }

  async function uploadImage(kind: 'avatar' | 'banner', file: File) {
    setUploading(kind);
    try {
      const data = await api.upload<{ attachment: { url: string } }>('/uploads', file);
      if (kind === 'avatar') setAvatarUrl(data.attachment.url);
      else setBannerUrl(data.attachment.url);
      toast.success('Imagem carregada', 'Salve o perfil para aplicar.');
    } catch (error) {
      toast.error('Falha no upload', messageFor(error, 'Tente outra imagem.'));
    } finally {
      setUploading(null);
    }
  }

  async function saveSettings(section: 'appearance' | 'notifications' | 'privacy') {
    setSettingsSaving(true);
    try {
      const patch: Partial<UserSettings> =
        section === 'appearance'
          ? {
              theme: settings.theme,
              accent: settings.accent,
              compactMode: settings.compactMode,
              reduceMotion: settings.reduceMotion,
            }
          : section === 'notifications'
            ? {
                desktopNotifications: settings.desktopNotifications,
                notificationSounds: settings.notificationSounds,
                messagePreviews: settings.messagePreviews,
              }
            : {
                privacyLastSeen: settings.privacyLastSeen,
                privacyReadReceipts: settings.privacyReadReceipts,
                privacyTyping: settings.privacyTyping,
              };
      const updated = await updateSettings(patch);
      setSettings(updated);
      toast.success('Preferências salvas');
    } catch (error) {
      toast.error('Não foi possível salvar', messageFor(error, 'Tente novamente.'));
    } finally {
      setSettingsSaving(false);
    }
  }

  async function toggleDesktopNotifications(enabled: boolean) {
    if (!enabled) {
      setSettings((current) => ({ ...current, desktopNotifications: false }));
      return;
    }
    if (typeof Notification === 'undefined') {
      toast.error('Notificações não são suportadas neste navegador');
      return;
    }
    try {
      const permission = await Notification.requestPermission();
      if (permission === 'granted') {
        setSettings((current) => ({ ...current, desktopNotifications: true }));
        toast.success('Notificações permitidas');
      } else {
        toast.error('Permissão de notificação negada', 'Habilite nas configurações do navegador.');
      }
    } catch {
      toast.error('Não foi possível solicitar permissão');
    }
  }

  async function changePassword() {
    setPasswordError('');
    if (!currentPassword || !newPassword) {
      setPasswordError('Preencha a senha atual e a nova senha.');
      return;
    }
    if (newPassword.length < 8 || !/[A-Za-z]/.test(newPassword) || !/[0-9]/.test(newPassword)) {
      setPasswordError('A nova senha precisa de 8+ caracteres, com letras e números.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError('A confirmação não coincide com a nova senha.');
      return;
    }
    setPasswordSaving(true);
    try {
      await api.post('/auth/change-password', { currentPassword, newPassword });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      toast.success('Senha alterada', 'As outras sessões foram encerradas.');
    } catch (error) {
      setPasswordError(messageFor(error, 'Não foi possível alterar a senha.'));
    } finally {
      setPasswordSaving(false);
    }
  }

  async function resendVerification() {
    setResending(true);
    try {
      const data = await api.post<{ delivered: boolean; token?: string }>('/auth/resend-verification');
      if (data.token) setVerificationToken(data.token);
      toast.success(
        data.delivered ? 'Email enviado' : 'Link de verificação gerado',
        data.delivered
          ? 'Confira sua caixa de entrada.'
          : 'SMTP não está configurado neste ambiente. Use o link abaixo.',
      );
    } catch (error) {
      toast.error('Não foi possível reenviar', messageFor(error, 'Tente novamente.'));
    } finally {
      setResending(false);
    }
  }

  async function revokeSession(session: Session) {
    const ok = await confirmDialog({
      title: session.current ? 'Encerrar sua sessão atual?' : `Encerrar sessão de ${session.device}?`,
      message: session.current
        ? 'Você será desconectado deste dispositivo.'
        : 'O dispositivo precisará entrar novamente.',
      confirmLabel: 'Encerrar sessão',
      danger: true,
    });
    if (!ok) return;
    setSessionBusy(session.id);
    try {
      const data = await api.delete<{ ok: boolean; current: boolean }>(`/auth/sessions/${session.id}`);
      if (data.current) {
        sessionLost();
        useAppStore.getState().reset();
        navigate('/login', { replace: true });
        return;
      }
      setSessions((current) => current.filter((item) => item.id !== session.id));
      toast.success('Sessão encerrada');
    } catch (error) {
      toast.error('Não foi possível encerrar', messageFor(error, 'Tente novamente.'));
    } finally {
      setSessionBusy(null);
    }
  }

  async function revokeOthers() {
    const ok = await confirmDialog({
      title: 'Encerrar todas as outras sessões?',
      message: 'Todos os outros dispositivos perderão o acesso imediatamente.',
      confirmLabel: 'Encerrar outras sessões',
      danger: true,
    });
    if (!ok) return;
    setSessionBusy('others');
    try {
      await api.post('/auth/sessions/revoke-others');
      const data = await api.get<{ sessions: Session[] }>('/auth/sessions');
      setSessions(data.sessions);
      toast.success('Outras sessões encerradas');
    } catch (error) {
      toast.error('Não foi possível encerrar', messageFor(error, 'Tente novamente.'));
    } finally {
      setSessionBusy(null);
    }
  }

  async function logout() {
    const ok = await confirmDialog({
      title: 'Sair da conta?',
      message: 'Você poderá entrar novamente quando quiser.',
      confirmLabel: 'Sair',
    });
    if (!ok) return;
    await useAuthStore.getState().logout();
    useAppStore.getState().reset();
    navigate('/login', { replace: true });
  }

  async function deleteAccount() {
    if (!deletePassword) {
      toast.info('Informe sua senha para confirmar');
      return;
    }
    const ok = await confirmDialog({
      title: 'Excluir sua conta?',
      message:
        'Sua conta, conversas, mensagens e participações serão removidas permanentemente. Esta ação não pode ser desfeita.',
      confirmLabel: 'Excluir minha conta',
      danger: true,
    });
    if (!ok) return;
    setDeleting(true);
    try {
      await api.delete('/users/me', { body: { password: deletePassword } });
      sessionLost();
      useAppStore.getState().reset();
      toast.success('Conta excluída');
      navigate('/login', { replace: true });
    } catch (error) {
      toast.error('Não foi possível excluir', messageFor(error, 'Verifique sua senha.'));
    } finally {
      setDeleting(false);
    }
  }

  if (!user) return null;

  const currentTab = TABS.find((item) => item.id === tab) || TABS[0];

  return (
    <div className="page settings-page">
      <header className="page-head">
        <div>
          <span className="eyebrow">
            <Sparkles size={14} /> Seu jeito de usar
          </span>
          <h1>Configurações</h1>
          <p>Personalize o UNISON, proteja sua conta e gerencie dispositivos.</p>
        </div>
        <div className="settings-identity">
          <Avatar name={user.displayName} src={user.avatarUrl} size={44} presence={user.presence} />
          <div>
            <strong>{user.displayName}</strong>
            <span>@{user.username}</span>
          </div>
        </div>
      </header>

      <div className="settings-layout">
        <nav className="settings-nav" aria-label="Seções de configurações">
          {TABS.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                type="button"
                className={classNames('settings-nav-row', tab === item.id && 'active')}
                onClick={() => setTab(item.id)}
              >
                <span className="settings-nav-icon">
                  <Icon size={17} />
                </span>
                <span className="settings-nav-copy">
                  <strong>{item.label}</strong>
                  <small>{item.hint}</small>
                </span>
                <ChevronRight size={15} className="settings-nav-arrow" />
              </button>
            );
          })}
        </nav>

        <div className="settings-panel">
          <header className="settings-panel-head">
            <h2>{currentTab.label}</h2>
            <p>{currentTab.hint}</p>
          </header>

          {tab === 'profile' && (
            <div className="settings-section">
              <div className="profile-banner-editor">
                <div className="profile-banner-preview">
                  {bannerUrl ? (
                    <img src={resolveMediaUrl(bannerUrl)} alt="Banner do perfil" />
                  ) : (
                    <span className="banner-placeholder">{initials}</span>
                  )}
                </div>
                <div className="profile-banner-actions">
                  <label className="btn btn-secondary btn-sm">
                    {uploading === 'banner' ? <Spinner size={14} /> : <ImagePlus size={14} />}
                    Alterar banner
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp,image/gif"
                      hidden
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (file) void uploadImage('banner', file);
                        event.target.value = '';
                      }}
                    />
                  </label>
                  {bannerUrl && (
                    <button type="button" className="mini-link danger-text" onClick={() => setBannerUrl('')}>
                      Remover
                    </button>
                  )}
                </div>
              </div>

              <div className="profile-avatar-editor">
                <Avatar name={displayName || 'Você'} src={resolveMediaUrl(avatarUrl)} size={96} presence={user.presence} />
                <label className="avatar-upload-btn" title="Trocar foto de perfil">
                  {uploading === 'avatar' ? <Spinner size={16} /> : <ImagePlus size={16} />}
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif"
                    hidden
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) void uploadImage('avatar', file);
                      event.target.value = '';
                    }}
                  />
                </label>
                <div>
                  <strong>Foto de perfil</strong>
                  <span>PNG, JPG, WebP ou GIF até 5 MB.</span>
                </div>
              </div>

              <div className="form-grid">
                <label className="field">
                  <span>Nome de exibição</span>
                  <div className={classNames('input-shell', profileFieldErrors.displayName && 'invalid')}>
                    <UserRound size={16} />
                    <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} maxLength={40} />
                  </div>
                  {profileFieldErrors.displayName && (
                    <small className="field-error">{profileFieldErrors.displayName}</small>
                  )}
                </label>
                <label className="field">
                  <span>Nome de usuário</span>
                  <div className={classNames('input-shell', (profileFieldErrors.username || profileError.includes('username')) && 'invalid')}>
                    <span className="input-prefix">@</span>
                    <input
                      value={username}
                      onChange={(event) => setUsername(event.target.value.toLowerCase())}
                      maxLength={24}
                    />
                  </div>
                  {profileFieldErrors.username && (
                    <small className="field-error">{profileFieldErrors.username}</small>
                  )}
                </label>
              </div>
              <label className="field">
                <span>Email</span>
                <div className="input-shell readonly">
                  <MailCheck size={16} />
                  <input value={user.email || 'Email não disponível'} readOnly />
                  {user.emailVerified ? (
                    <span className="verified-pill">
                      <Check size={12} /> verificado
                    </span>
                  ) : (
                    <span className="unverified-pill">não verificado</span>
                  )}
                </div>
              </label>
              <label className="field">
                <span>Status personalizado</span>
                <div className="input-shell">
                  <input
                    value={customStatus}
                    onChange={(event) => setCustomStatus(event.target.value)}
                    placeholder="Ex.: focado em lançamento"
                    maxLength={80}
                  />
                </div>
              </label>
              <label className="field">
                <span>Sobre você</span>
                <textarea
                  className="textarea"
                  value={bio}
                  onChange={(event) => setBio(event.target.value)}
                  placeholder="Conte um pouco sobre o seu trabalho."
                  rows={3}
                  maxLength={280}
                />
                <small className="field-hint">{bio.length}/280</small>
              </label>

              {profileError && <div className="form-error">{profileError}</div>}

              <div className="settings-actions">
                <button type="button" className="btn btn-primary" onClick={() => void saveProfile()} disabled={profileSaving}>
                  {profileSaving ? <Spinner size={16} /> : <Save size={16} />}
                  Salvar perfil
                </button>
              </div>
            </div>
          )}

          {tab === 'appearance' && (
            <div className="settings-section">
              <div className="field">
                <span>Tema</span>
                <div className="radio-cards">
                  <button
                    type="button"
                    className={classNames('radio-card theme-card dark', settings.theme === 'dark' && 'selected')}
                    onClick={() => setSettings((current) => ({ ...current, theme: 'dark' }))}
                  >
                    <span className="theme-swatch theme-dark" />
                    <div>
                      <strong>Escuro</strong>
                      <p>Preto profundo com toque lilás.</p>
                    </div>
                  </button>
                  <button
                    type="button"
                    className={classNames('radio-card theme-card midnight', settings.theme === 'midnight' && 'selected')}
                    onClick={() => setSettings((current) => ({ ...current, theme: 'midnight' }))}
                  >
                    <span className="theme-swatch theme-midnight" />
                    <div>
                      <strong>Meia-noite</strong>
                      <p>Grafite azulado e contraste suave.</p>
                    </div>
                  </button>
                </div>
              </div>

              <div className="field">
                <span>Cor de destaque</span>
                <div className="accent-picker">
                  {ACCENT_PRESETS.map((color) => (
                    <button
                      key={color}
                      type="button"
                      className={classNames('accent-swatch', settings.accent.toLowerCase() === color.toLowerCase() && 'active')}
                      style={{ background: color }}
                      onClick={() => setSettings((current) => ({ ...current, accent: color }))}
                      aria-label={`Usar cor ${color}`}
                    />
                  ))}
                  <label className="accent-custom" title="Cor personalizada">
                    <input
                      type="color"
                      value={settings.accent}
                      onChange={(event) =>
                        setSettings((current) => ({ ...current, accent: event.target.value.toUpperCase() }))
                      }
                    />
                    <span style={{ background: settings.accent }} />
                  </label>
                </div>
              </div>

              <div className="toggle-list">
                <label className="toggle-row">
                  <div>
                    <strong>Modo compacto</strong>
                    <span>Menos espaçamento entre mensagens e itens.</span>
                  </div>
                  <Switch
                    checked={settings.compactMode}
                    onChange={(checked) =>
                      setSettings((current) => ({ ...current, compactMode: checked }))
                    }
                    label="Modo compacto"
                  />
                </label>
                <label className="toggle-row">
                  <div>
                    <strong>Reduzir movimento</strong>
                    <span>Minimiza animações e transições.</span>
                  </div>
                  <Switch
                    checked={settings.reduceMotion}
                    onChange={(checked) =>
                      setSettings((current) => ({ ...current, reduceMotion: checked }))
                    }
                    label="Reduzir movimento"
                  />
                </label>
              </div>

              <div className="settings-actions">
                <button type="button" className="btn btn-primary" onClick={() => void saveSettings('appearance')} disabled={settingsSaving}>
                  {settingsSaving ? <Spinner size={16} /> : <Save size={16} />}
                  Salvar aparência
                </button>
              </div>
            </div>
          )}

          {tab === 'notifications' && (
            <div className="settings-section">
              <div className="toggle-list">
                <label className="toggle-row">
                  <div>
                    <strong>Notificações na área de trabalho</strong>
                    <span>Receba avisos no navegador quando o UNISON estiver em segundo plano.</span>
                  </div>
                  <Switch
                    checked={settings.desktopNotifications}
                    onChange={(checked) => void toggleDesktopNotifications(checked)}
                    label="Notificações na área de trabalho"
                  />
                </label>
                <label className="toggle-row">
                  <div>
                    <strong>
                      <Volume2 size={15} /> Sons de mensagem
                    </strong>
                    <span>Um sinal sonoro curto ao receber mensagens.</span>
                  </div>
                  <Switch
                    checked={settings.notificationSounds}
                    onChange={(checked) =>
                      setSettings((current) => ({ ...current, notificationSounds: checked }))
                    }
                    label="Sons de mensagem"
                  />
                </label>
                <label className="toggle-row">
                  <div>
                    <strong>Prévia do conteúdo</strong>
                    <span>Mostrar o texto da mensagem nas notificações.</span>
                  </div>
                  <Switch
                    checked={settings.messagePreviews}
                    onChange={(checked) =>
                      setSettings((current) => ({ ...current, messagePreviews: checked }))
                    }
                    label="Prévia do conteúdo"
                  />
                </label>
              </div>
              <p className="settings-note">
                As notificações do navegador exigem permissão do sistema. Em iOS, instale o UNISON na tela
                inicial para receber avisos.
              </p>
              <div className="settings-actions">
                <button type="button" className="btn btn-primary" onClick={() => void saveSettings('notifications')} disabled={settingsSaving}>
                  {settingsSaving ? <Spinner size={16} /> : <Save size={16} />}
                  Salvar notificações
                </button>
              </div>
            </div>
          )}

          {tab === 'privacy' && (
            <div className="settings-section">
              <div className="field">
                <span>Quem pode ver seu status e último acesso</span>
                <div className="radio-cards three">
                  {(
                    [
                      ['everyone', 'Todos', 'Qualquer pessoa do UNISON.'],
                      ['friends', 'Amigos', 'Somente pessoas da sua rede.'],
                      ['nobody', 'Ninguém', 'Ocultar completamente.'],
                    ] as const
                  ).map(([value, label, hint]) => (
                    <button
                      key={value}
                      type="button"
                      className={classNames('radio-card', settings.privacyLastSeen === value && 'selected')}
                      onClick={() => setSettings((current) => ({ ...current, privacyLastSeen: value }))}
                    >
                      <div>
                        <strong>{label}</strong>
                        <p>{hint}</p>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
              <div className="toggle-list">
                <label className="toggle-row">
                  <div>
                    <strong>Recibos de leitura</strong>
                    <span>Compartilhar quando você leu as mensagens.</span>
                  </div>
                  <Switch
                    checked={settings.privacyReadReceipts}
                    onChange={(checked) =>
                      setSettings((current) => ({ ...current, privacyReadReceipts: checked }))
                    }
                    label="Recibos de leitura"
                  />
                </label>
                <label className="toggle-row">
                  <div>
                    <strong>Indicador de digitação</strong>
                    <span>Mostrar aos outros quando você está digitando.</span>
                  </div>
                  <Switch
                    checked={settings.privacyTyping}
                    onChange={(checked) =>
                      setSettings((current) => ({ ...current, privacyTyping: checked }))
                    }
                    label="Indicador de digitação"
                  />
                </label>
              </div>
              <div className="settings-actions">
                <button type="button" className="btn btn-primary" onClick={() => void saveSettings('privacy')} disabled={settingsSaving}>
                  {settingsSaving ? <Spinner size={16} /> : <Save size={16} />}
                  Salvar privacidade
                </button>
              </div>
            </div>
          )}

          {tab === 'security' && (
            <div className="settings-section">
              <section className="security-block">
                <header>
                  <KeyRound size={18} />
                  <div>
                    <h3>Alterar senha</h3>
                    <p>Use uma senha forte e diferente de outros serviços.</p>
                  </div>
                </header>
                <div className="form-grid">
                  <label className="field">
                    <span>Senha atual</span>
                    <div className="input-shell">
                      <Lock size={16} />
                      <input
                        type="password"
                        value={currentPassword}
                        onChange={(event) => setCurrentPassword(event.target.value)}
                        autoComplete="current-password"
                      />
                    </div>
                  </label>
                  <label className="field">
                    <span>Nova senha</span>
                    <div className="input-shell">
                      <KeyRound size={16} />
                      <input
                        type="password"
                        value={newPassword}
                        onChange={(event) => setNewPassword(event.target.value)}
                        autoComplete="new-password"
                      />
                    </div>
                  </label>
                  <label className="field">
                    <span>Confirmar nova senha</span>
                    <div className="input-shell">
                      <KeyRound size={16} />
                      <input
                        type="password"
                        value={confirmPassword}
                        onChange={(event) => setConfirmPassword(event.target.value)}
                        autoComplete="new-password"
                      />
                    </div>
                  </label>
                </div>
                {passwordError && <div className="form-error">{passwordError}</div>}
                <div className="settings-actions">
                  <button type="button" className="btn btn-primary" onClick={() => void changePassword()} disabled={passwordSaving}>
                    {passwordSaving ? <Spinner size={16} /> : <KeyRound size={16} />}
                    Alterar senha
                  </button>
                </div>
              </section>

              <section className="security-block">
                <header>
                  <MailCheck size={18} />
                  <div>
                    <h3>Verificação de email</h3>
                    <p>
                      {user.emailVerified
                        ? 'Seu email está verificado.'
                        : 'Verifique seu email para proteger a recuperação da conta.'}
                    </p>
                  </div>
                </header>
                <div className="email-verification-row">
                  <span>{user.email}</span>
                  {user.emailVerified ? (
                    <span className="verified-pill">
                      <Check size={12} /> verificado
                    </span>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => void resendVerification()}
                      disabled={resending}
                    >
                      {resending ? <Spinner size={14} /> : <MailCheck size={14} />}
                      Reenviar verificação
                    </button>
                  )}
                </div>
                {verificationToken && (
                  <div className="dev-token">
                    <p>Ambiente sem SMTP: use este link de verificação.</p>
                    <a
                      href={`/verify-email?token=${encodeURIComponent(verificationToken)}`}
                      className="btn btn-ghost btn-sm"
                    >
                      Abrir link de verificação <ChevronRight size={14} />
                    </a>
                  </div>
                )}
              </section>

              <section className="security-block">
                <header>
                  <LogOut size={18} />
                  <div>
                    <h3>Sessão deste dispositivo</h3>
                    <p>Encerre a sessão atual para sair com segurança.</p>
                  </div>
                </header>
                <button type="button" className="btn btn-secondary" onClick={() => void logout()}>
                  <LogOut size={16} /> Sair da conta
                </button>
              </section>
            </div>
          )}

          {tab === 'sessions' && (
            <div className="settings-section">
              <header className="section-head">
                <div>
                  <h3>Dispositivos conectados</h3>
                  <p>Sessões ativas na sua conta.</p>
                </div>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm danger-text"
                  onClick={() => void revokeOthers()}
                  disabled={sessionBusy === 'others'}
                >
                  {sessionBusy === 'others' ? <Spinner size={14} /> : <LogOut size={14} />}
                  Encerrar outras
                </button>
              </header>
              {loadingSessions ? (
                <div className="loading-row">
                  <Spinner size={20} /> Carregando sessões…
                </div>
              ) : sessions.length === 0 ? (
                <p className="muted-label">Nenhuma sessão ativa encontrada.</p>
              ) : (
                <div className="session-list">
                  {sessions.map((session) => {
                    const Icon = deviceIcon(session.device);
                    return (
                      <div className={classNames('session-row', session.current && 'current')} key={session.id}>
                        <span className="session-icon">
                          <Icon size={20} />
                        </span>
                        <div className="session-copy">
                          <strong>
                            {session.device}
                            {session.current && <span className="current-pill">este dispositivo</span>}
                          </strong>
                          <span>
                            {session.ip || 'IP desconhecido'} · criada {formatDate(session.createdAt)} · vista{' '}
                            {relativeTime(session.lastUsedAt)}
                          </span>
                          <small>{session.userAgent}</small>
                        </div>
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm danger-text"
                          onClick={() => void revokeSession(session)}
                          disabled={sessionBusy === session.id}
                        >
                          {sessionBusy === session.id ? <Spinner size={14} /> : 'Encerrar'}
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
              <p className="settings-note">
                Ao alterar a senha, todas as outras sessões são encerradas automaticamente.
              </p>
            </div>
          )}

          {tab === 'account' && (
            <div className="settings-section">
              <section className="account-summary">
                <Avatar name={user.displayName} src={user.avatarUrl} size={64} presence={user.presence} />
                <div>
                  <h3>{user.displayName}</h3>
                  <span>@{user.username}</span>
                  <small>Conta criada em {formatDate(user.createdAt)}</small>
                </div>
              </section>

              <section className="security-block">
                <header>
                  <LogOut size={18} />
                  <div>
                    <h3>Encerrar sessão</h3>
                    <p>Saia deste dispositivo sem apagar sua conta.</p>
                  </div>
                </header>
                <button type="button" className="btn btn-secondary" onClick={() => void logout()}>
                  <LogOut size={16} /> Sair da conta
                </button>
              </section>

              <section className="danger-zone">
                <header>
                  <Trash2 size={18} />
                  <div>
                    <h4>Excluir conta</h4>
                    <p>
                      A exclusão remove permanentemente seu perfil, mensagens, amizades e participações em
                      espaços. Não é possível recuperar depois.
                    </p>
                  </div>
                </header>
                <label className="field">
                  <span>Confirme com sua senha</span>
                  <div className="input-shell">
                    <Lock size={16} />
                    <input
                      type="password"
                      value={deletePassword}
                      onChange={(event) => setDeletePassword(event.target.value)}
                      placeholder="Sua senha atual"
                      autoComplete="current-password"
                    />
                  </div>
                </label>
                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={() => void deleteAccount()}
                  disabled={deleting}
                >
                  {deleting ? <Spinner size={16} /> : <Trash2 size={16} />}
                  Excluir minha conta
                </button>
              </section>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
