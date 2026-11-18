import { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Check,
  Copy,
  Globe,
  Hash,
  ImagePlus,
  KeyRound,
  Lock,
  Plus,
  RefreshCw,
  Save,
  Shield,
  ShieldBan,
  ShieldCheck,
  Ticket,
  Trash2,
  UserCog,
  Users,
  X,
} from 'lucide-react';
import { api, ApiError, resolveMediaUrl } from '../../lib/api';
import type {
  Attachment,
  AuditEntry,
  Channel,
  Invite,
  Permission,
  Role,
  SpaceDetails,
  SpaceMember,
} from '../../lib/types';
import { classNames, formatDate, relativeTime } from '../../lib/utils';
import { useAuthStore } from '../../store/auth';
import { confirmDialog } from '../../store/dialog';
import { toast } from '../../store/toast';
import { Avatar } from '../ui/Avatar';
import { EmptyState } from '../ui/EmptyState';
import { Modal } from '../ui/Modal';
import { Spinner } from '../ui/Spinner';

type TabId = 'general' | 'channels' | 'members' | 'roles' | 'invites' | 'bans' | 'audit';

const TAB_META: { id: TabId; label: string; icon: typeof Users; permission: Permission | null }[] = [
  { id: 'general', label: 'Geral', icon: Shield, permission: 'manage_space' },
  { id: 'channels', label: 'Canais', icon: Hash, permission: 'manage_channels' },
  { id: 'members', label: 'Membros', icon: Users, permission: null },
  { id: 'roles', label: 'Cargos', icon: ShieldCheck, permission: 'manage_roles' },
  { id: 'invites', label: 'Convites', icon: Ticket, permission: 'create_invites' },
  { id: 'bans', label: 'Banimentos', icon: ShieldBan, permission: 'ban_members' },
  { id: 'audit', label: 'Auditoria', icon: Activity, permission: 'view_audit' },
];

const PERMISSION_OPTIONS: { value: Permission; label: string; description: string }[] = [
  { value: 'manage_space', label: 'Gerenciar espaço', description: 'Editar identidade, descrição e visibilidade.' },
  { value: 'manage_channels', label: 'Gerenciar canais', description: 'Criar, editar e remover canais.' },
  { value: 'manage_roles', label: 'Gerenciar cargos', description: 'Criar cargos e alterar permissões.' },
  { value: 'manage_members', label: 'Gerenciar membros', description: 'Editar apelidos e administrar participantes.' },
  { value: 'kick_members', label: 'Remover membros', description: 'Expulsar membros do espaço.' },
  { value: 'ban_members', label: 'Banir membros', description: 'Impedir que alguém entre novamente.' },
  { value: 'manage_messages', label: 'Moderar mensagens', description: 'Apagar mensagens e fixar conteúdo.' },
  { value: 'send_messages', label: 'Enviar mensagens', description: 'Participar das conversas dos canais.' },
  { value: 'create_invites', label: 'Criar convites', description: 'Gerar links de entrada no espaço.' },
  { value: 'view_audit', label: 'Ver auditoria', description: 'Consultar o histórico administrativo.' },
];

interface BanEntry {
  userId: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  reason: string;
  createdAt: string;
}

interface RoleDraft {
  id: string | null;
  name: string;
  color: string;
  permissions: Permission[];
}

function requestMessage(error: unknown, fallback = 'Ocorreu um erro. Tente novamente.') {
  return error instanceof ApiError ? error.message : fallback;
}

function actionLabel(action: string) {
  const map: Record<string, string> = {
    'space.updated': 'Espaço atualizado',
    'channel.created': 'Canal criado',
    'channel.updated': 'Canal atualizado',
    'channel.deleted': 'Canal removido',
    'member.roles': 'Cargos alterados',
    'member.kicked': 'Membro removido',
    'member.banned': 'Membro banido',
    'member.unbanned': 'Banimento retirado',
    'role.created': 'Cargo criado',
    'role.updated': 'Cargo atualizado',
    'role.deleted': 'Cargo removido',
    'invite.created': 'Convite criado',
    'invite.revoked': 'Convite revogado',
  };
  return map[action] || action;
}

export function SpaceSettingsModal({
  open,
  details,
  initialTab,
  onClose,
  onRefresh,
  onRequestCreateChannel,
  onExit,
  onDeleted,
}: {
  open: boolean;
  details: SpaceDetails;
  initialTab?: string;
  onClose: () => void;
  onRefresh: () => Promise<void>;
  onRequestCreateChannel: () => void;
  onExit: () => void;
  onDeleted: () => void;
}) {
  const currentUser = useAuthStore((state) => state.user);
  const permissions = useMemo(() => new Set(details.myMember.permissions), [details.myMember.permissions]);
  const allowedTabs = useMemo(
    () => TAB_META.filter((tab) => !tab.permission || permissions.has(tab.permission)),
    [permissions],
  );
  const [activeTab, setActiveTab] = useState<TabId>('members');
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const [name, setName] = useState(details.space.name);
  const [description, setDescription] = useState(details.space.description);
  const [visibility, setVisibility] = useState(details.space.visibility);
  const [iconUrl, setIconUrl] = useState(details.space.iconUrl || '');
  const [uploadingIcon, setUploadingIcon] = useState(false);
  const [generalError, setGeneralError] = useState('');

  const [channels, setChannels] = useState<Channel[]>(details.channels);
  const [editingChannel, setEditingChannel] = useState<Channel | null>(null);
  const [channelName, setChannelName] = useState('');
  const [channelTopic, setChannelTopic] = useState('');
  const [channelCategory, setChannelCategory] = useState('');
  const [channelError, setChannelError] = useState('');

  const [members, setMembers] = useState<SpaceMember[]>([]);
  const [memberFilter, setMemberFilter] = useState('');
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [managedMember, setManagedMember] = useState<SpaceMember | null>(null);
  const [managedRoles, setManagedRoles] = useState<string[]>([]);
  const [managedNickname, setManagedNickname] = useState('');
  const [banReason, setBanReason] = useState('');

  const [roles, setRoles] = useState<Role[]>(details.roles);
  const [roleDraft, setRoleDraft] = useState<RoleDraft>({
    id: null,
    name: '',
    color: '#C9A0DC',
    permissions: ['send_messages'],
  });
  const [roleError, setRoleError] = useState('');

  const [invites, setInvites] = useState<Invite[]>([]);
  const [inviteExpiry, setInviteExpiry] = useState('0');
  const [inviteMaxUses, setInviteMaxUses] = useState('');
  const [loadingInvites, setLoadingInvites] = useState(false);

  const [bans, setBans] = useState<BanEntry[]>([]);
  const [loadingBans, setLoadingBans] = useState(false);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [loadingAudit, setLoadingAudit] = useState(false);

  useEffect(() => {
    if (!open) return;
    const desired = TAB_META.find((tab) => tab.id === initialTab);
    const allowed = desired && (!desired.permission || permissions.has(desired.permission));
    const fallback = allowedTabs[0]?.id || 'members';
    setActiveTab(allowed ? (initialTab as TabId) : fallback);
    setName(details.space.name);
    setDescription(details.space.description);
    setVisibility(details.space.visibility);
    setIconUrl(details.space.iconUrl || '');
    setGeneralError('');
    setEditingChannel(null);
    setManagedMember(null);
    setMemberFilter('');
    setRoleError('');
    setChannels(details.channels);
    setRoles(details.roles);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialTab, details.space.id]);

  useEffect(() => {
    setChannels(details.channels);
    setRoles(details.roles);
  }, [details.channels, details.roles]);

  const loadMembers = async () => {
    setLoadingMembers(true);
    try {
      const data = await api.get<{ members: SpaceMember[] }>(`/spaces/${details.space.id}/members?limit=500`);
      setMembers(data.members);
    } catch (error) {
      toast.error('Não foi possível carregar membros', requestMessage(error));
    } finally {
      setLoadingMembers(false);
    }
  };

  const loadRoles = async () => {
    try {
      const data = await api.get<{ roles: Role[] }>(`/spaces/${details.space.id}/roles`);
      setRoles(data.roles);
    } catch {
      // The current role list remains usable.
    }
  };

  const loadInvites = async () => {
    setLoadingInvites(true);
    try {
      const data = await api.get<{ invites: Invite[] }>(`/spaces/${details.space.id}/invites`);
      setInvites(data.invites);
    } catch (error) {
      toast.error('Não foi possível carregar convites', requestMessage(error));
    } finally {
      setLoadingInvites(false);
    }
  };

  const loadBans = async () => {
    setLoadingBans(true);
    try {
      const data = await api.get<{ bans: BanEntry[] }>(`/spaces/${details.space.id}/bans`);
      setBans(data.bans);
    } catch (error) {
      toast.error('Não foi possível carregar banimentos', requestMessage(error));
    } finally {
      setLoadingBans(false);
    }
  };

  const loadAudit = async () => {
    setLoadingAudit(true);
    try {
      const data = await api.get<{ entries: AuditEntry[] }>(`/spaces/${details.space.id}/audit`);
      setAudit(data.entries);
    } catch (error) {
      toast.error('Não foi possível carregar auditoria', requestMessage(error));
    } finally {
      setLoadingAudit(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    if (activeTab === 'members') void loadMembers();
    if (activeTab === 'roles') void loadRoles();
    if (activeTab === 'invites') void loadInvites();
    if (activeTab === 'bans') void loadBans();
    if (activeTab === 'audit') void loadAudit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, activeTab, details.space.id]);

  async function saveGeneral() {
    if (!name.trim()) {
      setGeneralError('O espaço precisa de um nome.');
      return;
    }
    setSaving(true);
    setGeneralError('');
    try {
      await api.patch(`/spaces/${details.space.id}`, {
        name: name.trim(),
        description: description.trim(),
        visibility,
        iconUrl: iconUrl || null,
      });
      await onRefresh();
      toast.success('Espaço atualizado');
    } catch (error) {
      setGeneralError(requestMessage(error, 'Não foi possível salvar o espaço.'));
    } finally {
      setSaving(false);
    }
  }

  async function uploadIcon(file: File) {
    setUploadingIcon(true);
    try {
      const data = await api.upload<{ attachment: Attachment }>('/uploads', file);
      setIconUrl(data.attachment.url);
      toast.success('Imagem carregada', 'Salve para aplicar ao espaço.');
    } catch (error) {
      toast.error('Falha no upload', requestMessage(error, 'Tente outra imagem.'));
    } finally {
      setUploadingIcon(false);
    }
  }

  async function deleteSpace() {
    const ok = await confirmDialog({
      title: `Excluir ${details.space.name}?`,
      message:
        'Todos os canais, mensagens, cargos e convites serão removidos permanentemente. Esta ação não pode ser desfeita.',
      confirmLabel: 'Excluir espaço',
      danger: true,
    });
    if (!ok) return;
    setSaving(true);
    try {
      await api.delete(`/spaces/${details.space.id}`);
      toast.success('Espaço excluído');
      onDeleted();
    } catch (error) {
      toast.error('Não foi possível excluir', requestMessage(error, 'Tente novamente.'));
      setSaving(false);
    }
  }

  async function leaveSpace() {
    const ok = await confirmDialog({
      title: `Sair de ${details.space.name}?`,
      message: 'Você perderá o acesso aos canais e ao histórico deste espaço.',
      confirmLabel: 'Sair do espaço',
      danger: true,
    });
    if (!ok) return;
    setSaving(true);
    try {
      await api.post(`/spaces/${details.space.id}/leave`);
      toast.success('Você saiu do espaço');
      onExit();
    } catch (error) {
      toast.error('Não foi possível sair', requestMessage(error, 'Tente novamente.'));
      setSaving(false);
    }
  }

  function startEditChannel(channel: Channel) {
    setEditingChannel(channel);
    setChannelName(channel.name);
    setChannelTopic(channel.topic);
    setChannelCategory(channel.category);
    setChannelError('');
  }

  async function saveChannel() {
    if (!editingChannel) return;
    setBusy(`channel:${editingChannel.id}`);
    setChannelError('');
    try {
      await api.patch(`/channels/${editingChannel.id}`, {
        name: channelName.trim(),
        topic: channelTopic.trim(),
        category: channelCategory.trim() || 'Geral',
      });
      setEditingChannel(null);
      await onRefresh();
      toast.success('Canal atualizado');
    } catch (error) {
      setChannelError(requestMessage(error, 'Não foi possível salvar o canal.'));
    } finally {
      setBusy(null);
    }
  }

  async function deleteChannel(channel: Channel) {
    const ok = await confirmDialog({
      title: `Excluir #${channel.name}?`,
      message: 'Todas as mensagens deste canal serão removidas permanentemente.',
      confirmLabel: 'Excluir canal',
      danger: true,
    });
    if (!ok) return;
    setBusy(`channel:${channel.id}`);
    try {
      await api.delete(`/channels/${channel.id}`);
      await onRefresh();
      toast.success('Canal removido');
    } catch (error) {
      toast.error('Não foi possível excluir', requestMessage(error, 'Tente novamente.'));
    } finally {
      setBusy(null);
    }
  }

  function startManageMember(member: SpaceMember) {
    setManagedMember(member);
    setManagedRoles(member.roles.filter((role) => !role.isDefault).map((role) => role.id));
    setManagedNickname(member.nickname || '');
    setBanReason('');
  }

  async function saveMember() {
    if (!managedMember) return;
    setBusy(`member:${managedMember.id}`);
    try {
      const body: { nickname?: string | null; roleIds?: string[] } = {};
      if (permissions.has('manage_members')) body.nickname = managedNickname.trim() || null;
      if (permissions.has('manage_roles')) body.roleIds = managedRoles;
      await api.patch(`/spaces/${details.space.id}/members/${managedMember.id}`, body);
      await Promise.all([loadMembers(), onRefresh()]);
      setManagedMember(null);
      toast.success('Membro atualizado');
    } catch (error) {
      toast.error('Não foi possível atualizar', requestMessage(error, 'Tente novamente.'));
    } finally {
      setBusy(null);
    }
  }

  async function kickMember(member: SpaceMember) {
    const ok = await confirmDialog({
      title: `Remover ${member.displayName}?`,
      message: 'A pessoa perderá acesso ao espaço. Ela poderá entrar novamente apenas com outro convite.',
      confirmLabel: 'Remover membro',
      danger: true,
    });
    if (!ok) return;
    setBusy(`member:${member.id}`);
    try {
      await api.delete(`/spaces/${details.space.id}/members/${member.id}`);
      await Promise.all([loadMembers(), onRefresh()]);
      setManagedMember(null);
      toast.success('Membro removido');
    } catch (error) {
      toast.error('Não foi possível remover', requestMessage(error, 'Tente novamente.'));
    } finally {
      setBusy(null);
    }
  }

  async function banMember(member: SpaceMember) {
    const ok = await confirmDialog({
      title: `Banir ${member.displayName}?`,
      message: 'A pessoa será removida e não poderá entrar novamente enquanto o banimento existir.',
      confirmLabel: 'Banir membro',
      danger: true,
    });
    if (!ok) return;
    setBusy(`member:${member.id}`);
    try {
      await api.post(`/spaces/${details.space.id}/bans/${member.id}`, {
        reason: banReason.trim(),
      });
      await Promise.all([loadMembers(), loadBans(), onRefresh()]);
      setManagedMember(null);
      toast.success('Membro banido');
    } catch (error) {
      toast.error('Não foi possível banir', requestMessage(error, 'Tente novamente.'));
    } finally {
      setBusy(null);
    }
  }

  function toggleRolePermission(permission: Permission) {
    setRoleDraft((current) => ({
      ...current,
      permissions: current.permissions.includes(permission)
        ? current.permissions.filter((item) => item !== permission)
        : [...current.permissions, permission],
    }));
  }

  function startCreateRole() {
    setRoleDraft({ id: null, name: '', color: '#C9A0DC', permissions: ['send_messages'] });
    setRoleError('');
  }

  function startEditRole(role: Role) {
    setRoleDraft({
      id: role.id,
      name: role.name,
      color: role.color,
      permissions: [...role.permissions],
    });
    setRoleError('');
  }

  async function saveRole() {
    if (!roleDraft.name.trim()) {
      setRoleError('Dê um nome ao cargo.');
      return;
    }
    setBusy('role');
    setRoleError('');
    try {
      if (roleDraft.id) {
        await api.patch(`/spaces/${details.space.id}/roles/${roleDraft.id}`, {
          name: roleDraft.name.trim(),
          color: roleDraft.color,
          permissions: roleDraft.permissions,
        });
      } else {
        await api.post(`/spaces/${details.space.id}/roles`, {
          name: roleDraft.name.trim(),
          color: roleDraft.color,
          permissions: roleDraft.permissions,
        });
      }
      await Promise.all([loadRoles(), onRefresh()]);
      startCreateRole();
      toast.success(roleDraft.id ? 'Cargo atualizado' : 'Cargo criado');
    } catch (error) {
      setRoleError(requestMessage(error, 'Não foi possível salvar o cargo.'));
    } finally {
      setBusy(null);
    }
  }

  async function deleteRole(role: Role) {
    const ok = await confirmDialog({
      title: `Excluir o cargo ${role.name}?`,
      message: 'Quem tinha este cargo perderá as permissões associadas.',
      confirmLabel: 'Excluir cargo',
      danger: true,
    });
    if (!ok) return;
    setBusy(`role:${role.id}`);
    try {
      await api.delete(`/spaces/${details.space.id}/roles/${role.id}`);
      await Promise.all([loadRoles(), onRefresh()]);
      if (roleDraft.id === role.id) startCreateRole();
      toast.success('Cargo removido');
    } catch (error) {
      toast.error('Não foi possível excluir', requestMessage(error, 'Tente novamente.'));
    } finally {
      setBusy(null);
    }
  }

  async function createInvite() {
    setBusy('invite');
    try {
      const hours = Number(inviteExpiry);
      const maxUses = inviteMaxUses.trim() ? Number(inviteMaxUses) : null;
      await api.post(`/spaces/${details.space.id}/invites`, {
        expiresInHours: hours > 0 ? hours : null,
        maxUses,
      });
      await loadInvites();
      toast.success('Convite criado');
    } catch (error) {
      toast.error('Não foi possível criar o convite', requestMessage(error, 'Tente novamente.'));
    } finally {
      setBusy(null);
    }
  }

  async function revokeInvite(invite: Invite) {
    const ok = await confirmDialog({
      title: 'Revogar convite?',
      message: 'O link deixará de funcionar imediatamente.',
      confirmLabel: 'Revogar',
      danger: true,
    });
    if (!ok) return;
    setBusy(`invite:${invite.id}`);
    try {
      await api.delete(`/spaces/${details.space.id}/invites/${invite.id}`);
      await loadInvites();
      toast.success('Convite revogado');
    } catch (error) {
      toast.error('Não foi possível revogar', requestMessage(error, 'Tente novamente.'));
    } finally {
      setBusy(null);
    }
  }

  async function copyInvite(invite: Invite) {
    try {
      await navigator.clipboard.writeText(invite.url);
      toast.success('Link copiado');
    } catch {
      toast.info('Copie o link manualmente', invite.url);
    }
  }

  async function unban(entry: BanEntry) {
    const ok = await confirmDialog({
      title: `Remover banimento de ${entry.displayName}?`,
      message: 'A pessoa poderá entrar novamente se tiver um convite válido.',
      confirmLabel: 'Desbanir',
    });
    if (!ok) return;
    setBusy(`ban:${entry.userId}`);
    try {
      await api.delete(`/spaces/${details.space.id}/bans/${entry.userId}`);
      await loadBans();
      toast.success('Banimento removido');
    } catch (error) {
      toast.error('Não foi possível remover', requestMessage(error, 'Tente novamente.'));
    } finally {
      setBusy(null);
    }
  }

  const filteredMembers = useMemo(() => {
    const term = memberFilter.trim().toLowerCase();
    if (!term) return members;
    return members.filter(
      (member) =>
        member.displayName.toLowerCase().includes(term) ||
        member.username.toLowerCase().includes(term),
    );
  }, [members, memberFilter]);

  const manageableRoles = roles.filter((role) => role.position < 100);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Configurações · ${details.space.name}`}
      description="Identidade, canais, pessoas, cargos e segurança do espaço."
      size="xl"
      className="space-settings-modal"
    >
      <div className="space-settings">
        <nav className="settings-nav" aria-label="Seções das configurações do espaço">
          {allowedTabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                type="button"
                className={classNames('settings-nav-row', activeTab === tab.id && 'active')}
                onClick={() => setActiveTab(tab.id)}
              >
                <Icon size={16} /> {tab.label}
              </button>
            );
          })}
        </nav>

        <div className="settings-content">
          {activeTab === 'general' && (
            <section className="settings-section">
              <header className="section-head">
                <div>
                  <h3>Identidade do espaço</h3>
                  <p>Como as pessoas encontram e reconhecem esta comunidade.</p>
                </div>
              </header>
              <div className="space-identity-editor">
                <div className="space-icon-upload">
                  <Avatar name={name || 'Espaço'} src={resolveMediaUrl(iconUrl)} size={78} rounded={false} />
                  <label className="avatar-upload-btn" title="Trocar imagem do espaço">
                    {uploadingIcon ? <Spinner size={16} /> : <ImagePlus size={16} />}
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp,image/gif"
                      hidden
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (file) void uploadIcon(file);
                        event.target.value = '';
                      }}
                    />
                  </label>
                  {iconUrl && (
                    <button type="button" className="mini-link danger-text" onClick={() => setIconUrl('')}>
                      Remover imagem
                    </button>
                  )}
                </div>
                <div className="space-identity-fields">
                  <label className="field">
                    <span>Nome</span>
                    <div className="input-shell">
                      <input value={name} onChange={(event) => setName(event.target.value)} maxLength={48} />
                    </div>
                  </label>
                  <label className="field">
                    <span>Descrição</span>
                    <textarea
                      className="textarea"
                      value={description}
                      onChange={(event) => setDescription(event.target.value)}
                      rows={3}
                      maxLength={300}
                    />
                    <small className="field-hint">{description.length}/300</small>
                  </label>
                </div>
              </div>

              <div className="field">
                <span>Visibilidade</span>
                <div className="radio-cards">
                  <button
                    type="button"
                    className={classNames('radio-card', visibility === 'private' && 'selected')}
                    onClick={() => setVisibility('private')}
                  >
                    <Lock size={18} />
                    <div>
                      <strong>Privado</strong>
                      <p>Só entra quem receber um convite.</p>
                    </div>
                  </button>
                  <button
                    type="button"
                    className={classNames('radio-card', visibility === 'public' && 'selected')}
                    onClick={() => setVisibility('public')}
                  >
                    <Globe size={18} />
                    <div>
                      <strong>Público</strong>
                      <p>Aparece na descoberta e qualquer pessoa pode entrar.</p>
                    </div>
                  </button>
                </div>
              </div>

              {generalError && (
                <div className="form-error" role="alert">
                  {generalError}
                </div>
              )}

              <div className="settings-actions">
                <button type="button" className="btn btn-primary" onClick={() => void saveGeneral()} disabled={saving}>
                  {saving ? <Spinner size={16} /> : <Save size={16} />}
                  Salvar alterações
                </button>
              </div>

              <section className="danger-zone">
                <header>
                  <AlertTriangle size={17} />
                  <div>
                    <h4>Zona de risco</h4>
                    <p>Estas ações afetam permanentemente o espaço.</p>
                  </div>
                </header>
                {details.space.isOwner ? (
                  <div className="danger-row">
                    <div>
                      <strong>Excluir este espaço</strong>
                      <span>Canais, mensagens, cargos e convites serão apagados.</span>
                    </div>
                    <button
                      type="button"
                      className="btn btn-danger"
                      onClick={() => void deleteSpace()}
                      disabled={saving}
                    >
                      <Trash2 size={15} /> Excluir espaço
                    </button>
                  </div>
                ) : (
                  <div className="danger-row">
                    <div>
                      <strong>Sair do espaço</strong>
                      <span>Você perderá o acesso aos canais deste espaço.</span>
                    </div>
                    <button
                      type="button"
                      className="btn btn-danger"
                      onClick={() => void leaveSpace()}
                      disabled={saving}
                    >
                      Sair do espaço
                    </button>
                  </div>
                )}
              </section>
            </section>
          )}

          {activeTab === 'channels' && (
            <section className="settings-section">
              <header className="section-head">
                <div>
                  <h3>Canais</h3>
                  <p>{channels.length} canal(is) no espaço. Organize por categoria e assunto.</p>
                </div>
                <button type="button" className="btn btn-primary btn-sm" onClick={onRequestCreateChannel}>
                  <Plus size={15} /> Novo canal
                </button>
              </header>

              {editingChannel && (
                <div className="inline-editor">
                  <header>
                    <strong>Editar #{editingChannel.name}</strong>
                    <button type="button" className="icon-btn ghost" onClick={() => setEditingChannel(null)}>
                      <X size={16} />
                    </button>
                  </header>
                  <div className="inline-editor-grid">
                    <label className="field">
                      <span>Nome</span>
                      <div className={`input-shell${channelError ? ' invalid' : ''}`}>
                        <Hash size={15} />
                        <input
                          value={channelName}
                          onChange={(event) => setChannelName(event.target.value)}
                          maxLength={32}
                        />
                      </div>
                    </label>
                    <label className="field">
                      <span>Categoria</span>
                      <div className="input-shell">
                        <input
                          value={channelCategory}
                          onChange={(event) => setChannelCategory(event.target.value)}
                          maxLength={40}
                        />
                      </div>
                    </label>
                  </div>
                  <label className="field">
                    <span>Tópico</span>
                    <div className="input-shell">
                      <input
                        value={channelTopic}
                        onChange={(event) => setChannelTopic(event.target.value)}
                        maxLength={200}
                      />
                    </div>
                  </label>
                  {channelError && <div className="form-error">{channelError}</div>}
                  <div className="settings-actions">
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      onClick={() => void saveChannel()}
                      disabled={busy === `channel:${editingChannel.id}`}
                    >
                      {busy === `channel:${editingChannel.id}` ? <Spinner size={14} /> : <Save size={14} />}
                      Salvar canal
                    </button>
                  </div>
                </div>
              )}

              <div className="admin-list">
                {channels.map((channel) => (
                  <div className="admin-row" key={channel.id}>
                    <span className="admin-row-icon">
                      {channel.isPrivate ? <Lock size={16} /> : <Hash size={16} />}
                    </span>
                    <div className="admin-row-copy">
                      <strong>
                        #{channel.name}
                        {channel.isPrivate && <span className="type-tag">privado</span>}
                      </strong>
                      <span>
                        {channel.category} · {channel.topic || 'Sem tópico'}
                      </span>
                    </div>
                    <div className="admin-row-actions">
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => startEditChannel(channel)}
                      >
                        Editar
                      </button>
                      <button
                        type="button"
                        className="icon-btn ghost danger-text"
                        onClick={() => void deleteChannel(channel)}
                        disabled={busy === `channel:${channel.id}`}
                        aria-label={`Excluir #${channel.name}`}
                      >
                        {busy === `channel:${channel.id}` ? <Spinner size={14} /> : <Trash2 size={15} />}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {activeTab === 'members' && (
            <section className="settings-section">
              <header className="section-head">
                <div>
                  <h3>Membros ({members.length || details.space.memberCount})</h3>
                  <p>Consulte participantes, apelidos e cargos.</p>
                </div>
              </header>
              <div className="input-shell">
                <Users size={16} />
                <input
                  value={memberFilter}
                  onChange={(event) => setMemberFilter(event.target.value)}
                  placeholder="Filtrar por nome ou @usuário"
                  aria-label="Filtrar membros"
                />
                {loadingMembers && <Spinner size={15} />}
              </div>

              {managedMember && (
                <div className="inline-editor member-editor">
                  <header>
                    <div className="inline-editor-person">
                      <Avatar
                        name={managedMember.displayName}
                        src={managedMember.avatarUrl}
                        size={34}
                        presence={managedMember.presence}
                      />
                      <div>
                        <strong>{managedMember.displayName}</strong>
                        <span>@{managedMember.username}</span>
                      </div>
                    </div>
                    <button
                      type="button"
                      className="icon-btn ghost"
                      onClick={() => setManagedMember(null)}
                      aria-label="Fechar gerenciamento"
                    >
                      <X size={16} />
                    </button>
                  </header>

                  {permissions.has('manage_members') && (
                    <label className="field">
                      <span>Apelido no espaço</span>
                      <div className="input-shell">
                        <input
                          value={managedNickname}
                          onChange={(event) => setManagedNickname(event.target.value)}
                          placeholder="Opcional"
                          maxLength={32}
                        />
                      </div>
                    </label>
                  )}

                  {permissions.has('manage_roles') && (
                    <div className="field">
                      <span>Cargos</span>
                      <div className="role-check-list">
                        {manageableRoles.map((role) => (
                          <label className="check-row" key={role.id}>
                            <input
                              type="checkbox"
                              checked={managedRoles.includes(role.id)}
                              onChange={(event) =>
                                setManagedRoles((current) =>
                                  event.target.checked
                                    ? [...current, role.id]
                                    : current.filter((id) => id !== role.id),
                                )
                              }
                            />
                            <span className="role-swatch" style={{ background: role.color }} />
                            <span>{role.name}</span>
                          </label>
                        ))}
                      </div>
                      <small className="field-hint">O cargo padrão é mantido automaticamente.</small>
                    </div>
                  )}

                  <div className="settings-actions wrap">
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      onClick={() => void saveMember()}
                      disabled={busy === `member:${managedMember.id}`}
                    >
                      {busy === `member:${managedMember.id}` ? <Spinner size={14} /> : <Save size={14} />}
                      Salvar
                    </button>
                    {permissions.has('kick_members') && (
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm danger-text"
                        onClick={() => void kickMember(managedMember)}
                      >
                        Remover do espaço
                      </button>
                    )}
                    {permissions.has('ban_members') && (
                      <button
                        type="button"
                        className="btn btn-danger btn-sm"
                        onClick={() => void banMember(managedMember)}
                      >
                        Banir
                      </button>
                    )}
                  </div>
                  {permissions.has('ban_members') && (
                    <label className="field">
                      <span>Motivo do banimento (opcional)</span>
                      <div className="input-shell">
                        <input
                          value={banReason}
                          onChange={(event) => setBanReason(event.target.value)}
                          maxLength={200}
                          placeholder="Visível para a administração"
                        />
                      </div>
                    </label>
                  )}
                </div>
              )}

              {loadingMembers && members.length === 0 ? (
                <div className="loading-row">
                  <Spinner size={20} /> Carregando membros…
                </div>
              ) : filteredMembers.length === 0 ? (
                <EmptyState
                  compact
                  icon={<Users size={20} />}
                  title="Nenhum membro encontrado"
                  message={memberFilter ? 'Tente outro termo.' : 'Este espaço ainda não tem membros.'}
                />
              ) : (
                <div className="admin-list">
                  {filteredMembers.map((member) => {
                    const canManage =
                      member.id !== currentUser?.id &&
                      !member.isOwner &&
                      (permissions.has('manage_members') ||
                        permissions.has('manage_roles') ||
                        permissions.has('kick_members') ||
                        permissions.has('ban_members'));
                    return (
                      <div className="admin-row member-admin-row" key={member.id}>
                        <Avatar
                          name={member.displayName}
                          src={member.avatarUrl}
                          size={38}
                          presence={member.presence}
                        />
                        <div className="admin-row-copy">
                          <strong>
                            {member.displayName}
                            {member.isOwner && (
                              <span className="role-chip role-owner">
                                <ShieldCheck size={11} /> Dono
                              </span>
                            )}
                          </strong>
                          <span>
                            @{member.username}
                            {member.nickname ? ` · ${member.nickname}` : ''}
                          </span>
                          {member.roles.length > 0 && (
                            <div className="member-role-chips">
                              {member.roles
                                .filter((role) => !role.isDefault)
                                .map((role) => (
                                  <span
                                    key={role.id}
                                    className="role-chip"
                                    style={{ color: role.color, borderColor: `${role.color}55` }}
                                  >
                                    {role.name}
                                  </span>
                                ))}
                            </div>
                          )}
                        </div>
                        {canManage ? (
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            onClick={() => startManageMember(member)}
                          >
                            <UserCog size={14} /> Gerenciar
                          </button>
                        ) : (
                          <span className="muted-label">Membro desde {formatDate(member.joinedAt)}</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          )}

          {activeTab === 'roles' && (
            <section className="settings-section">
              <header className="section-head">
                <div>
                  <h3>Cargos e permissões</h3>
                  <p>Defina o que cada grupo de membros pode fazer.</p>
                </div>
                <button type="button" className="btn btn-secondary btn-sm" onClick={startCreateRole}>
                  <Plus size={15} /> Novo cargo
                </button>
              </header>

              <div className="roles-layout">
                <div className="admin-list">
                  {roles.map((role) => (
                    <div className="admin-row role-admin-row" key={role.id}>
                      <span className="role-swatch large" style={{ background: role.color }} />
                      <div className="admin-row-copy">
                        <strong>
                          {role.name}
                          {role.isDefault && <span className="type-tag">padrão</span>}
                          {role.position >= 100 && <span className="type-tag">dono</span>}
                        </strong>
                        <span>{role.permissions.length} permissões · posição {role.position}</span>
                      </div>
                      {role.position < 100 && (
                        <div className="admin-row-actions">
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            onClick={() => startEditRole(role)}
                          >
                            Editar
                          </button>
                          {!role.isDefault && (
                            <button
                              type="button"
                              className="icon-btn ghost danger-text"
                              onClick={() => void deleteRole(role)}
                              disabled={busy === `role:${role.id}`}
                              aria-label={`Excluir cargo ${role.name}`}
                            >
                              {busy === `role:${role.id}` ? <Spinner size={14} /> : <Trash2 size={15} />}
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                <div className="role-editor">
                  <header>
                    <h4>{roleDraft.id ? 'Editar cargo' : 'Criar cargo'}</h4>
                    {roleDraft.id && (
                      <button type="button" className="mini-link" onClick={startCreateRole}>
                        Cancelar edição
                      </button>
                    )}
                  </header>
                  <label className="field">
                    <span>Nome</span>
                    <div className={`input-shell${roleError ? ' invalid' : ''}`}>
                      <KeyRound size={15} />
                      <input
                        value={roleDraft.name}
                        onChange={(event) => setRoleDraft((current) => ({ ...current, name: event.target.value }))}
                        maxLength={32}
                        placeholder="Ex.: Moderador"
                      />
                    </div>
                  </label>
                  <label className="field">
                    <span>Cor</span>
                    <div className="color-field">
                      <input
                        type="color"
                        value={roleDraft.color}
                        onChange={(event) =>
                          setRoleDraft((current) => ({ ...current, color: event.target.value }))
                        }
                        aria-label="Cor do cargo"
                      />
                      <div className="input-shell">
                        <input
                          value={roleDraft.color}
                          onChange={(event) =>
                            setRoleDraft((current) => ({ ...current, color: event.target.value }))
                          }
                          maxLength={7}
                        />
                      </div>
                    </div>
                  </label>
                  <div className="field">
                    <span>Permissões</span>
                    <div className="permission-list">
                      {PERMISSION_OPTIONS.map((option) => (
                        <label className="check-row" key={option.value}>
                          <input
                            type="checkbox"
                            checked={roleDraft.permissions.includes(option.value)}
                            onChange={() => toggleRolePermission(option.value)}
                          />
                          <span>
                            <strong>{option.label}</strong>
                            <small>{option.description}</small>
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>
                  {roleError && <div className="form-error">{roleError}</div>}
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => void saveRole()}
                    disabled={busy === 'role' || roleDraft.name.trim().length === 0}
                  >
                    {busy === 'role' ? <Spinner size={15} /> : <Save size={15} />}
                    {roleDraft.id ? 'Salvar cargo' : 'Criar cargo'}
                  </button>
                </div>
              </div>
            </section>
          )}

          {activeTab === 'invites' && (
            <section className="settings-section">
              <header className="section-head">
                <div>
                  <h3>Convites</h3>
                  <p>Links de entrada para este espaço. Revogue quando necessário.</p>
                </div>
              </header>
              <div className="invite-create-card">
                <label className="field">
                  <span>Expiração</span>
                  <select
                    className="select"
                    value={inviteExpiry}
                    onChange={(event) => setInviteExpiry(event.target.value)}
                  >
                    <option value="0">Nunca</option>
                    <option value="1">1 hora</option>
                    <option value="24">24 horas</option>
                    <option value="168">7 dias</option>
                    <option value="720">30 dias</option>
                  </select>
                </label>
                <label className="field">
                  <span>Limite de usos</span>
                  <div className="input-shell">
                    <input
                      type="number"
                      min={1}
                      max={1000}
                      value={inviteMaxUses}
                      onChange={(event) => setInviteMaxUses(event.target.value)}
                      placeholder="Ilimitado"
                    />
                  </div>
                </label>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => void createInvite()}
                  disabled={busy === 'invite'}
                >
                  {busy === 'invite' ? <Spinner size={15} /> : <Plus size={15} />}
                  Gerar convite
                </button>
              </div>

              {loadingInvites ? (
                <div className="loading-row">
                  <Spinner size={20} /> Carregando convites…
                </div>
              ) : invites.length === 0 ? (
                <EmptyState
                  compact
                  icon={<Ticket size={20} />}
                  title="Nenhum convite ativo"
                  message="Gere um link para convidar novas pessoas."
                />
              ) : (
                <div className="admin-list">
                  {invites.map((invite) => (
                    <div className="admin-row" key={invite.id}>
                      <span className="admin-row-icon">
                        <Ticket size={16} />
                      </span>
                      <div className="admin-row-copy">
                        <strong className="invite-code">{invite.code}</strong>
                        <span>
                          {invite.creatorName ? `Criado por ${invite.creatorName} · ` : ''}
                          {invite.uses} uso(s)
                          {invite.maxUses ? ` de ${invite.maxUses}` : ''}
                          {invite.expiresAt ? ` · expira ${relativeTime(invite.expiresAt)}` : ' · sem expiração'}
                        </span>
                      </div>
                      <div className="admin-row-actions">
                        <button type="button" className="icon-btn ghost" onClick={() => void copyInvite(invite)} title="Copiar link">
                          <Copy size={15} />
                        </button>
                        <button
                          type="button"
                          className="icon-btn ghost danger-text"
                          onClick={() => void revokeInvite(invite)}
                          disabled={busy === `invite:${invite.id}`}
                          aria-label="Revogar convite"
                        >
                          {busy === `invite:${invite.id}` ? <Spinner size={14} /> : <X size={16} />}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}

          {activeTab === 'bans' && (
            <section className="settings-section">
              <header className="section-head">
                <div>
                  <h3>Banimentos</h3>
                  <p>Pessoas impedidas de entrar neste espaço.</p>
                </div>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => void loadBans()}>
                  <RefreshCw size={14} /> Atualizar
                </button>
              </header>
              {loadingBans ? (
                <div className="loading-row">
                  <Spinner size={20} /> Carregando banimentos…
                </div>
              ) : bans.length === 0 ? (
                <EmptyState
                  compact
                  icon={<ShieldBan size={20} />}
                  title="Nenhum banimento"
                  message="Ninguém está impedido de entrar neste espaço."
                />
              ) : (
                <div className="admin-list">
                  {bans.map((entry) => (
                    <div className="admin-row" key={entry.userId}>
                      <Avatar name={entry.displayName} src={entry.avatarUrl} size={36} />
                      <div className="admin-row-copy">
                        <strong>{entry.displayName}</strong>
                        <span>
                          @{entry.username}
                          {entry.reason ? ` · ${entry.reason}` : ' · sem motivo registrado'}
                        </span>
                      </div>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() => void unban(entry)}
                        disabled={busy === `ban:${entry.userId}`}
                      >
                        {busy === `ban:${entry.userId}` ? <Spinner size={14} /> : <Check size={14} />}
                        Desbanir
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}

          {activeTab === 'audit' && (
            <section className="settings-section">
              <header className="section-head">
                <div>
                  <h3>Auditoria</h3>
                  <p>Últimas 100 ações administrativas deste espaço.</p>
                </div>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => void loadAudit()}>
                  <RefreshCw size={14} /> Atualizar
                </button>
              </header>
              {loadingAudit ? (
                <div className="loading-row">
                  <Spinner size={20} /> Carregando auditoria…
                </div>
              ) : audit.length === 0 ? (
                <EmptyState
                  compact
                  icon={<Activity size={20} />}
                  title="Nenhuma ação registrada"
                  message="Alterações administrativas aparecerão aqui."
                />
              ) : (
                <div className="audit-list">
                  {audit.map((entry) => (
                    <div className="audit-row" key={entry.id}>
                      <span className="audit-dot" />
                      <div>
                        <strong>{actionLabel(entry.action)}</strong>
                        <p>
                          {entry.actor ? `${entry.actor.displayName} (@${entry.actor.username})` : 'Sistema'}
                          {entry.targetId ? ` · alvo ${entry.targetId.slice(0, 8)}` : ''}
                        </p>
                        {Object.keys(entry.details).length > 0 && (
                          <code>{JSON.stringify(entry.details)}</code>
                        )}
                      </div>
                      <time>{relativeTime(entry.createdAt)}</time>
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}
        </div>
      </div>
    </Modal>
  );
}
