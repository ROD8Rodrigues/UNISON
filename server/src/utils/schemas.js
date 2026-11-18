'use strict';

const { z } = require('zod');

const username = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, 'O nome de usuário deve ter pelo menos 3 caracteres')
  .max(24, 'O nome de usuário deve ter no máximo 24 caracteres')
  .regex(/^[a-z0-9_.]+$/, 'Use apenas letras, números, pontos e sublinhados');

const password = z
  .string()
  .min(8, 'A senha deve ter pelo menos 8 caracteres')
  .max(128, 'A senha é muito longa')
  .regex(/[A-Za-z]/, 'A senha deve conter uma letra')
  .regex(/[0-9]/, 'A senha deve conter um número');

const email = z.string().trim().toLowerCase().email('Informe um email válido').max(254);

const displayName = z.string().trim().min(1, 'Name is required').max(40, 'O nome é muito longo');
const bio = z.string().max(280, 'A bio deve ter no máximo 280 caracteres');
const customStatus = z.string().max(80, 'O status deve ter no máximo 80 caracteres');

const presence = z.enum(['online', 'away', 'dnd', 'offline']);

const registerSchema = z.object({
  username,
  email,
  password,
  displayName: displayName.optional(),
});

const loginSchema = z.object({
  identifier: z.string().trim().min(1).max(254),
  password: z.string().min(1).max(128),
});

const forgotPasswordSchema = z.object({ email });
const resetPasswordSchema = z.object({ token: z.string().min(10).max(200), password });
const changePasswordSchema = z.object({ currentPassword: z.string().min(1), newPassword: password });
const verifyEmailSchema = z.object({ token: z.string().min(10).max(200) });

const updateProfileSchema = z.object({
  displayName: displayName.optional(),
  username: username.optional(),
  bio: bio.optional(),
  customStatus: customStatus.optional(),
  avatarUrl: z.string().max(500).nullable().optional(),
  bannerUrl: z.string().max(500).nullable().optional(),
});

const deleteAccountSchema = z.object({ password: z.string().min(1).max(128) });
const updatePresenceSchema = z.object({ presence });

const updateSettingsSchema = z.object({
  theme: z.enum(['dark', 'midnight']).optional(),
  accent: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/, 'A cor de destaque deve ser um hexadecimal válido')
    .optional(),
  compactMode: z.boolean().optional(),
  reduceMotion: z.boolean().optional(),
  desktopNotifications: z.boolean().optional(),
  notificationSounds: z.boolean().optional(),
  messagePreviews: z.boolean().optional(),
  privacyLastSeen: z.enum(['everyone', 'friends', 'nobody']).optional(),
  privacyReadReceipts: z.boolean().optional(),
  privacyTyping: z.boolean().optional(),
});

const friendRequestSchema = z.object({ username });
const friendRequestIdSchema = z.object({ requestId: z.string().uuid() });
const blockSchema = z.object({ userId: z.string().uuid() });

const messageContent = z.string().trim().min(1, 'A mensagem não pode ficar vazia').max(4000, 'A mensagem é muito longa');
const sendMessageSchema = z.object({
  content: z.string().max(4000).default(''),
  replyToId: z.string().uuid().nullable().optional(),
  attachmentIds: z.array(z.string().uuid()).max(10).optional(),
});
const editMessageSchema = z.object({ content: messageContent });
const reactionSchema = z.object({ emoji: z.string().trim().min(1).max(16) });
const markReadSchema = z.object({ messageId: z.string().uuid().optional() });

const dmSchema = z.object({ userId: z.string().uuid() });
const groupSchema = z.object({
  title: z.string().trim().min(1).max(60),
  memberIds: z.array(z.string().uuid()).min(1).max(50),
});
const updateConversationSchema = z.object({
  title: z.string().trim().min(1).max(60).optional(),
  avatarUrl: z.string().max(500).nullable().optional(),
});

const channelName = z
  .string()
  .trim()
  .toLowerCase()
  .min(1)
  .max(32)
  .regex(/^[a-z0-9][a-z0-9-]*$/, 'Use letras minúsculas, números e hífens');

const createSpaceSchema = z.object({
  name: z.string().trim().min(2, 'O nome é muito curto').max(48, 'O nome é muito longo'),
  description: z.string().trim().max(300).optional().default(''),
  visibility: z.enum(['public', 'private']).default('private'),
  iconUrl: z.string().max(500).nullable().optional(),
});
const updateSpaceSchema = z.object({
  name: z.string().trim().min(2).max(48).optional(),
  description: z.string().trim().max(300).optional(),
  visibility: z.enum(['public', 'private']).optional(),
  iconUrl: z.string().max(500).nullable().optional(),
  bannerUrl: z.string().max(500).nullable().optional(),
});

const createChannelSchema = z.object({
  name: channelName,
  topic: z.string().trim().max(200).optional().default(''),
  category: z.string().trim().max(40).optional().default('General'),
  isPrivate: z.boolean().optional().default(false),
  type: z.enum(['text', 'voice']).optional().default('text'),
});
const updateChannelSchema = z.object({
  name: channelName.optional(),
  topic: z.string().trim().max(200).optional(),
  category: z.string().trim().max(40).optional(),
  position: z.number().int().min(0).max(1000).optional(),
});

const createRoleSchema = z.object({
  name: z.string().trim().min(1).max(32),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).default('#C9A0DC'),
  permissions: z
    .array(
      z.enum([
        'manage_space',
        'manage_channels',
        'manage_roles',
        'manage_members',
        'kick_members',
        'ban_members',
        'manage_messages',
        'send_messages',
        'create_invites',
        'view_audit',
      ]),
    )
    .max(20)
    .optional(),
});
const updateRoleSchema = createRoleSchema.partial();

const createInviteSchema = z.object({
  expiresInHours: z.number().int().min(1).max(24 * 30).nullable().optional(),
  maxUses: z.number().int().min(1).max(1000).nullable().optional(),
  code: z
    .string()
    .trim()
    .min(3)
    .max(32)
    .regex(/^[a-z0-9][a-z0-9-]*$/, 'Use letras minúsculas, números e hífens')
    .optional(),
});
const joinInviteSchema = z.object({ code: z.string().trim().min(4).max(64) });

const updateMemberSchema = z.object({
  nickname: z.string().trim().max(32).nullable().optional(),
  roleIds: z.array(z.string().uuid()).max(20).optional(),
});
const banMemberSchema = z.object({ reason: z.string().trim().max(200).optional().default('') });

const uploadIdsSchema = z.array(z.string().uuid()).max(10);

const startCallSchema = z.object({
  conversationId: z.string().uuid(),
  kind: z.enum(['audio', 'video']),
});

const searchQuery = z.string().trim().min(1).max(100);

module.exports = {
  registerSchema,
  loginSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  changePasswordSchema,
  verifyEmailSchema,
  updateProfileSchema,
  deleteAccountSchema,
  updatePresenceSchema,
  updateSettingsSchema,
  friendRequestSchema,
  friendRequestIdSchema,
  blockSchema,
  sendMessageSchema,
  editMessageSchema,
  reactionSchema,
  markReadSchema,
  dmSchema,
  groupSchema,
  updateConversationSchema,
  createSpaceSchema,
  updateSpaceSchema,
  createChannelSchema,
  updateChannelSchema,
  createRoleSchema,
  updateRoleSchema,
  createInviteSchema,
  joinInviteSchema,
  updateMemberSchema,
  banMemberSchema,
  uploadIdsSchema,
  startCallSchema,
  searchQuery,
};
