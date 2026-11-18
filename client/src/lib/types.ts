export type Presence = 'online' | 'away' | 'dnd' | 'offline';

export interface UserSettings {
  theme: 'dark' | 'midnight';
  accent: string;
  compactMode: boolean;
  reduceMotion: boolean;
  desktopNotifications: boolean;
  notificationSounds: boolean;
  messagePreviews: boolean;
  privacyLastSeen: 'everyone' | 'friends' | 'nobody';
  privacyReadReceipts: boolean;
  privacyTyping: boolean;
}

export interface User {
  id: string;
  username: string;
  displayName: string;
  bio: string;
  avatarUrl: string | null;
  bannerUrl: string | null;
  customStatus: string;
  presence: Presence;
  lastSeen: string | null;
  emailVerified: boolean;
  createdAt: string;
  email?: string;
  settings?: UserSettings;
}

export interface ConversationMember extends User {
  role: 'owner' | 'admin' | 'member';
  joinedAt: string;
  lastReadAt: string | null;
  muted?: boolean;
}

export interface Conversation {
  id: string;
  type: 'dm' | 'group' | 'channel';
  title: string | null;
  avatarUrl: string | null;
  spaceId: string | null;
  channelId: string | null;
  ownerId: string | null;
  createdAt: string;
  updatedAt: string;
  lastMessageAt: string | null;
  lastMessagePreview: string;
  unreadCount: number;
  muted: boolean;
  myRole: 'owner' | 'admin' | 'member';
  memberCount: number;
  members: ConversationMember[];
  otherUser: ConversationMember | null;
}

export interface Attachment {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  url: string;
}

export interface Reaction {
  emoji: string;
  count: number;
  users: { id: string; username: string; displayName: string }[];
}

export interface Message {
  id: string;
  conversationId: string;
  senderId: string | null;
  sender: {
    id: string;
    username: string;
    displayName: string;
    avatarUrl: string | null;
    presence: Presence;
  } | null;
  content: string;
  kind: 'text' | 'system';
  deleted: boolean;
  edited: boolean;
  replyTo: {
    id: string;
    content: string;
    deleted: boolean;
    username: string;
    displayName: string;
  } | null;
  attachments: Attachment[];
  reactions: Reaction[];
  pinned: boolean;
  readByCount: number;
  recipientCount: number;
  createdAt: string;
  editedAt: string | null;
  deletedAt: string | null;
}

export type Permission =
  | 'manage_space'
  | 'manage_channels'
  | 'manage_roles'
  | 'manage_members'
  | 'kick_members'
  | 'ban_members'
  | 'manage_messages'
  | 'send_messages'
  | 'create_invites'
  | 'view_audit';

export interface Role {
  id: string;
  name: string;
  color: string;
  permissions: Permission[];
  position: number;
  isDefault: boolean;
  createdAt: string;
}

export interface SpaceSummary {
  id: string;
  name: string;
  slug: string;
  description: string;
  iconUrl: string | null;
  bannerUrl: string | null;
  ownerId: string;
  visibility: 'public' | 'private';
  createdAt: string;
  myPermissions?: Permission[];
  isOwner?: boolean;
  myRoles?: Role[];
  memberCount: number;
  channelCount: number;
  joined: boolean;
}

export interface Space extends SpaceSummary {
  myPermissions: Permission[];
  isOwner: boolean;
  myRoles: Role[];
}

export interface SpaceDetails {
  space: Space;
  channels: Channel[];
  roles: Role[];
  myMember: { nickname: string | null; joinedAt: string; permissions: Permission[] };
}

export interface Channel {
  id: string;
  spaceId: string;
  name: string;
  topic: string;
  category: string;
  position: number;
  isPrivate: boolean;
  conversationId: string | null;
  unreadCount: number;
  joined?: boolean;
  createdAt: string;
}

export interface SpaceMember extends User {
  nickname: string | null;
  joinedAt: string;
  roles: Role[];
  isOwner: boolean;
  rank: number;
}

export interface FriendRequest {
  id: string;
  direction: 'incoming' | 'outgoing';
  status: 'pending' | 'accepted' | 'rejected' | 'cancelled';
  createdAt: string;
  sender: User;
  receiver: User;
}

export interface AppNotification {
  id: string;
  type: string;
  title: string;
  body: string;
  data: {
    conversationId?: string;
    messageId?: string;
    spaceId?: string;
    channelId?: string;
    userId?: string;
    requestId?: string;
  };
  readAt: string | null;
  createdAt: string;
}

export interface Session {
  id: string;
  device: string;
  userAgent: string;
  ip: string;
  current: boolean;
  createdAt: string;
  lastUsedAt: string;
  expiresAt: string;
}

export interface Invite {
  id: string;
  code: string;
  url: string;
  expiresAt: string | null;
  maxUses: number | null;
  uses: number;
  creatorName?: string;
  createdAt: string;
}

export interface CallParticipant {
  userId: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  presence: Presence;
  status: 'invited' | 'joined' | 'declined' | 'left' | 'missed';
  joinedAt: string | null;
  leftAt: string | null;
}

export interface Call {
  id: string;
  conversationId: string;
  initiatorId: string;
  kind: 'audio' | 'video';
  status: 'ringing' | 'active' | 'ended' | 'declined';
  createdAt: string;
  startedAt: string | null;
  endedAt: string | null;
  participants: CallParticipant[];
}

export interface AuditEntry {
  id: string;
  action: string;
  targetId: string | null;
  details: Record<string, unknown>;
  actor: { id: string; username: string; displayName: string } | null;
  createdAt: string;
}
