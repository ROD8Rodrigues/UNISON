import { Link, NavLink } from 'react-router-dom';
import {
  ChevronDown,
  Globe,
  Hash,
  Lock,
  LogOut,
  Plus,
  Settings2,
  Ticket,
  Users,
  Volume2,
} from 'lucide-react';
import type { Channel, Permission, SpaceDetails } from '../../lib/types';
import { classNames } from '../../lib/utils';
import { useCall } from '../calls/call-context';
import { Avatar } from '../ui/Avatar';

interface SpaceSidebarProps {
  details: SpaceDetails;
  activeChannelId: string | null;
  onCreateChannel: () => void;
  onOpenSettings: (tab?: string) => void;
  onOpenInvites: () => void;
  onLeave: () => void;
}

function groupChannels(channels: Channel[]) {
  const groups = new Map<string, Channel[]>();
  for (const channel of channels) {
    const category = channel.category || 'Geral';
    if (!groups.has(category)) groups.set(category, []);
    groups.get(category)!.push(channel);
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b, 'pt-BR'));
}

export function SpaceSidebar({
  details,
  activeChannelId,
  onCreateChannel,
  onOpenSettings,
  onOpenInvites,
  onLeave,
}: SpaceSidebarProps) {
  const call = useCall();
  const { space } = details;
  const voiceStates = new Map((details.voiceStates || []).map((state) => [state.channelId, state]));
  const permissions = new Set<Permission>(details.myMember.permissions);
  const canManageChannels = permissions.has('manage_channels');
  const canCreateInvites = permissions.has('create_invites');
  const canManageSettings = [
    'manage_space',
    'manage_channels',
    'manage_members',
    'manage_roles',
    'kick_members',
    'ban_members',
    'create_invites',
    'view_audit',
  ].some((permission) => permissions.has(permission as Permission));
  const groups = groupChannels(details.channels);
  const totalUnread = details.channels.reduce((sum, channel) => sum + channel.unreadCount, 0);

  return (
    <aside className="space-nav">
      <header className="space-nav-head">
        <div className="space-nav-identity">
          <Avatar name={space.name} src={space.iconUrl} size={42} rounded={false} />
          <div>
            <strong>{space.name}</strong>
            <span>
              {space.visibility === 'public' ? <Globe size={11} /> : <Lock size={11} />}
              {space.memberCount} membros
            </span>
          </div>
          <ChevronDown size={15} />
        </div>
        <div className="space-nav-actions">
          {canCreateInvites && (
            <button
              type="button"
              className="icon-btn ghost"
              onClick={onOpenInvites}
              aria-label="Convidar pessoas"
              title="Convidar pessoas"
            >
              <Ticket size={17} />
            </button>
          )}
          {canManageSettings && (
            <button
              type="button"
              className="icon-btn ghost"
              onClick={() => onOpenSettings()}
              aria-label="Configurações do espaço"
              title="Configurações do espaço"
            >
              <Settings2 size={17} />
            </button>
          )}
        </div>
      </header>

      <div className="space-nav-scroll">
        <div className="space-nav-section-label">
          <span>Canais</span>
          {canManageChannels && (
            <button
              type="button"
              className="mini-action"
              onClick={onCreateChannel}
              aria-label="Criar canal"
              title="Criar canal"
            >
              <Plus size={14} />
            </button>
          )}
        </div>

        {details.channels.length === 0 && (
          <div className="space-nav-empty">
            <Hash size={18} />
            <p>Nenhum canal ainda.</p>
            {canManageChannels && (
              <button type="button" className="btn btn-secondary btn-sm" onClick={onCreateChannel}>
                <Plus size={14} /> Criar canal
              </button>
            )}
          </div>
        )}

        {groups.map(([category, channels]) => (
          <div className="space-channel-group" key={category}>
            <span className="space-channel-category">{category}</span>
            {channels.map((channel) => {
              const voiceState = channel.isVoice ? voiceStates.get(channel.id) : undefined;
              const connected = Boolean(channel.isVoice && call.activeCall?.channelId === channel.id);
              return (
                <div className="space-voice-entry" key={channel.id}>
                  <NavLink
                    to={`/app/spaces/${space.id}/channels/${channel.id}`}
                    onClick={() => {
                      if (channel.isVoice) void call.joinVoice(channel.id);
                    }}
                    className={({ isActive }) =>
                      classNames(
                        'space-channel-link',
                        (isActive || activeChannelId === channel.id) && 'active',
                        channel.unreadCount > 0 && 'unread',
                        connected && 'connected',
                      )
                    }
                  >
                    {channel.isPrivate ? (
                      <Lock size={15} />
                    ) : channel.isVoice ? (
                      <Volume2 size={15} />
                    ) : (
                      <Hash size={15} />
                    )}
                    <span>{channel.name}</span>
                    {connected && <span className="space-voice-live" aria-label="Conectado" />}
                    {!channel.isVoice && channel.unreadCount > 0 && (
                      <span className="space-channel-badge">
                        {channel.unreadCount > 99 ? '99+' : channel.unreadCount}
                      </span>
                    )}
                  </NavLink>
                  {voiceState && voiceState.participants.length > 0 && (
                    <div className="space-voice-members">
                      {voiceState.participants.map((participant) => (
                        <div className="space-voice-member" key={participant.userId}>
                          <Avatar
                            name={participant.displayName}
                            src={participant.avatarUrl}
                            size={17}
                            presence={participant.presence}
                          />
                          <span>{participant.displayName}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ))}

        <div className="space-nav-links">
          <button type="button" className="space-nav-link" onClick={() => onOpenSettings('members')}>
            <Users size={16} /> Membros
            <span>{space.memberCount}</span>
          </button>
          {totalUnread > 0 && (
            <Link to={`/app/spaces/${space.id}`} className="space-nav-link">
              <Hash size={16} /> {totalUnread} não lidas
            </Link>
          )}
        </div>
      </div>

      <footer className="space-nav-footer">
        {space.isOwner ? (
          <span className="space-nav-owner">
            <span className="owner-dot" /> Você é o proprietário
          </span>
        ) : (
          <button type="button" className="space-nav-leave" onClick={onLeave}>
            <LogOut size={15} /> Sair do espaço
          </button>
        )}
      </footer>
    </aside>
  );
}
