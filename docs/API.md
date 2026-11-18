# API

Base URL em desenvolvimento: `http://localhost:60000`

Em produção, o servidor pode servir o frontend e a API no mesmo domínio. Nesse caso use caminhos relativos (`/api/...`). Para deploy separado, habilite a origem do frontend em `CORS_ORIGINS`.

## Convenções

- Formato: JSON UTF-8.
- Autenticação: `Authorization: Bearer <accessToken>`.
- Refresh: cookie `unison_refresh` enviado com `credentials: include`.
- Timestamps: ISO 8601 nas respostas; epoch em ms no banco.
- IDs: UUID v4.
- Erros:

```json
{
  "error": {
    "code": "NOT_A_MEMBER",
    "message": "Você não faz parte desta conversa",
    "details": [],
    "requestId": "2f1c..."
  }
}
```

- Todo request recebe `X-Request-Id`.
- Healthcheck público: `GET /health` e `GET /api/health` (redirect 307 para `/health`).

## Rate limits

| Área | Janela | Limite |
| --- | --- | --- |
| API geral | 60 s | 240 requisições |
| Autenticação e recuperação | 15 min | 25 tentativas |
| Envio de mensagens | 60 s | 90 mensagens |
| Uploads | 60 min | 60 uploads |
| Busca | 60 s | 60 buscas |

Os limites são por IP (ou IP do proxy quando `TRUST_PROXY=true`) e ficam em memória. Em testes automatizados os limites são desativados.

## Autenticação — `/api/auth`

| Método | Caminho | Auth | Descrição |
| --- | --- | --- | --- |
| POST | `/register` | não | Cria conta e sessão. Corpo: `username`, `email`, `password`, `displayName?` |
| POST | `/login` | não | Corpo: `identifier` (usuário ou email), `password` |
| POST | `/refresh` | cookie | Rotaciona o refresh token e emite novo access token |
| POST | `/logout` | sim | Revoga a sessão atual e desconecta sockets |
| GET | `/me` | sim | Usuário atual + settings |
| GET | `/sessions` | sim | Sessões ativas do usuário |
| DELETE | `/sessions/:sessionId` | sim | Revoga uma sessão específica |
| POST | `/sessions/revoke-others` | sim | Revoga todas as outras sessões |
| POST | `/change-password` | sim | Corpo: `currentPassword`, `newPassword` |
| POST | `/forgot-password` | não | Corpo: `email`. Resposta genérica para evitar enumeração |
| POST | `/reset-password` | não | Corpo: `token`, `password` |
| POST | `/verify-email` | não | Corpo: `token` |
| POST | `/resend-verification` | sim | Reenvia verificação (rate limited) |

Exemplo de login:

```bash
curl -i -c cookies.txt \
  -H "Content-Type: application/json" \
  -d '{"identifier":"alice","password":"Password123"}' \
  http://localhost:60000/api/auth/login
```

```json
{
  "user": { "id": "...", "username": "alice", "displayName": "Alice", "settings": {} },
  "accessToken": "eyJ..."
}
```

O cookie de refresh tem `HttpOnly`, `SameSite=Lax`, `Path=/api/auth` e `Secure` em produção.

## Usuários — `/api/users`

| Método | Caminho | Descrição |
| --- | --- | --- |
| GET | `/me` | Perfil próprio |
| PATCH | `/me` | Atualiza `displayName`, `username`, `bio`, `customStatus`, `avatarUrl`, `bannerUrl` |
| PUT | `/me/settings` | Atualiza tema, accent, compacto, redução de movimento, notificações e privacidade |
| POST | `/me/presence` | Define presença (`online`, `away`, `dnd`, `offline`) |
| DELETE | `/me` | Exclui a conta. Corpo: `password` |
| GET | `/search?q=` | Busca usuários por nome/usuário |
| GET | `/:userId` | Perfil público + relação (amizade, bloqueio, pedido) |

## Amigos — `/api/friends`

| Método | Caminho | Descrição |
| --- | --- | --- |
| GET | `/` | Lista de amigos |
| GET | `/requests` | Pedidos recebidos e enviados |
| POST | `/requests` | Envia pedido. Corpo: `username` |
| POST | `/requests/:requestId/accept` | Aceita pedido |
| POST | `/requests/:requestId/reject` | Recusa pedido |
| DELETE | `/:userId` | Remove amizade |
| GET | `/blocks/list` | Lista bloqueados |
| POST | `/blocks/:userId` | Bloqueia usuário |
| DELETE | `/blocks/:userId` | Desbloqueia usuário |

## Conversas — `/api/conversations`

| Método | Caminho | Descrição |
| --- | --- | --- |
| GET | `/` | Lista conversas com última mensagem, não lidas, silêncio e papel |
| POST | `/dm` | Abre/cria DM. Corpo: `userId` |
| POST | `/group` | Cria grupo. Corpo: `title`, `memberIds[]` |
| GET | `/:conversationId` | Detalhes + membros |
| PATCH | `/:conversationId` | Atualiza título/avatar (admins do grupo) |
| POST | `/:conversationId/members` | Adiciona membro (admin do grupo) |
| DELETE | `/:conversationId/members/:userId` | Remove membro (admin do grupo) |
| POST | `/:conversationId/leave` | Sai/hide a conversa conforme o tipo |
| POST | `/:conversationId/hide` | Oculta DM |
| PATCH | `/:conversationId/mute` | Silencia/retoma notificações |

## Mensagens — `/api`

| Método | Caminho | Descrição |
| --- | --- | --- |
| GET | `/conversations/:id/messages?before=&limit=&q=` | Histórico paginado; `q` busca no conteúdo |
| POST | `/conversations/:id/messages` | Envia mensagem. Corpo: `content?`, `replyToId?`, `attachmentIds?[]` |
| POST | `/conversations/:id/read` | Marca leitura. Corpo: `messageId?` |
| GET | `/conversations/:id/pins` | Mensagens fixadas |
| GET | `/conversations/:id/search?q=` | Busca na conversa |
| PATCH | `/messages/:messageId` | Edita o próprio conteúdo |
| DELETE | `/messages/:messageId` | Apaga (autor ou moderador do espaço) |
| POST | `/messages/:messageId/reactions` | Alterna reação. Corpo: `emoji` |
| POST | `/messages/:messageId/pin` | Fixa/desafixa. Corpo: `pinned` |

Resposta de listagem:

```json
{
  "messages": [
    {
      "id": "...",
      "conversationId": "...",
      "content": "Olá",
      "sender": { "id": "...", "displayName": "Alice" },
      "attachments": [],
      "reactions": [{ "emoji": "🔥", "count": 1, "me": true }],
      "pinned": false,
      "createdAt": "2026-11-16T12:00:00.000Z"
    }
  ],
  "hasMore": true,
  "nextCursor": 1763294400000
}
```

## Notificações — `/api/notifications`

| Método | Caminho | Descrição |
| --- | --- | --- |
| GET | `/?limit=` | Lista notificações + contador de não lidas |
| GET | `/unread-count` | Apenas contador |
| POST | `/read-all` | Marca todas como lidas |
| POST | `/:notificationId/read` | Marca uma como lida |
| DELETE | `/:notificationId` | Remove uma |
| DELETE | `/` | Limpa todas |

## Spaces — `/api/spaces`

| Método | Caminho | Descrição |
| --- | --- | --- |
| GET | `/` | Espaços do usuário |
| GET | `/discover?q=` | Espaços públicos |
| POST | `/` | Cria espaço. Corpo: `name`, `description?`, `visibility` |
| GET | `/:spaceId` | Detalhes, canais, membros e permissões efetivas |
| PATCH | `/:spaceId` | Atualiza espaço |
| DELETE | `/:spaceId` | Exclui (somente proprietário) |
| POST | `/:spaceId/join` | Entra em espaço público |
| POST | `/:spaceId/leave` | Sai do espaço |
| GET | `/:spaceId/members?q=` | Lista membros |
| PATCH | `/:spaceId/members/:userId` | Apelido e funções do membro |
| DELETE | `/:spaceId/members/:userId` | Remove membro |
| POST | `/:spaceId/bans/:userId` | Bane. Corpo: `reason?` |
| DELETE | `/:spaceId/bans/:userId` | Remove banimento |
| GET | `/:spaceId/bans` | Lista banimentos |
| GET | `/:spaceId/roles` | Lista funções |
| POST | `/:spaceId/roles` | Cria função |
| PATCH | `/:spaceId/roles/:roleId` | Atualiza função |
| DELETE | `/:spaceId/roles/:roleId` | Exclui função |
| POST | `/:spaceId/channels` | Cria canal |
| POST | `/:spaceId/invites` | Cria convite |
| GET | `/:spaceId/invites` | Lista convites |
| DELETE | `/:spaceId/invites/:inviteId` | Revoga convite |
| GET | `/:spaceId/audit` | Auditoria (permissão `view_audit`) |

Permissões disponíveis: `manage_space`, `manage_channels`, `manage_roles`, `manage_members`, `kick_members`, `ban_members`, `manage_messages`, `send_messages`, `create_invites`, `view_audit`.

## Canais — `/api/channels`

| Método | Caminho | Descrição |
| --- | --- | --- |
| GET | `/:channelId` | Detalhes do canal |
| PATCH | `/:channelId` | Atualiza nome/tópico/categoria/posição |
| DELETE | `/:channelId` | Exclui canal |
| GET | `/:channelId/members` | Membros com acesso |
| POST | `/:channelId/members` | Adiciona membro. Corpo: `userId` |
| DELETE | `/:channelId/members/:userId` | Remove membro |
| POST | `/:channelId/join` | Entra em canal público |

## Convites — `/api/invites`

| Método | Caminho | Descrição |
| --- | --- | --- |
| GET | `/:code` | Detalhes/validade do convite |
| POST | `/:code/join` | Entra no espaço pelo convite |

## Uploads — `/api/uploads`

| Método | Caminho | Descrição |
| --- | --- | --- |
| POST | `/` | Multipart `file`. Retorna `attachment` com `id`, `url`, `mimeType`, `size` |

Tipos aceitos: PNG, JPEG, GIF, WebP, MP4, WebM, MOV, MP3, WAV, OGG, M4A, PDF, TXT, CSV, ZIP, DOC, DOCX, XLSX, PPTX. Limite padrão: 25 MB.

## Chamadas — `/api/calls`

| Método | Caminho | Descrição |
| --- | --- | --- |
| GET | `/?limit=` | Histórico de chamadas do usuário |
| GET | `/:callId` | Detalhes de uma chamada da qual participa |

## Socket.IO

### Conexão

```js
import { io } from 'socket.io-client';

const socket = io('http://localhost:60000', {
  auth: { token: accessToken },
  transports: ['websocket', 'polling'],
});
```

O servidor valida JWT e sessão no handshake. Token revogado ou sessão expirada recebe `connect_error`.

### Eventos cliente → servidor

| Evento | Payload | Descrição |
| --- | --- | --- |
| `presence:set` | `{ presence }` | Define presença |
| `typing:start` | `{ conversationId }` | Inicia digitação |
| `typing:stop` | `{ conversationId }` | Encerra digitação |
| `conversation:read` | `{ conversationId, messageId? }` | Marca leitura |
| `call:start` | `{ conversationId, kind: 'audio' \| 'video' }` | Inicia chamada |
| `call:accept` | `{ callId }` | Aceita |
| `call:reject` | `{ callId }` | Recusa |
| `call:leave` | `{ callId }` | Sai da chamada |
| `call:end` | `{ callId }` | Encerra a chamada para todos (qualquer participante) |
| `webrtc:signal` | `{ callId, targetUserId, signal }` | Oferta/answer/ICE |
| `call:media-state` | `{ callId, audio, video, screen? }` | Estado de mídia |
| `space:sync` | `{ spaceId }` | Entra nas salas do espaço |

Eventos com resposta usam acknowledgement do Socket.IO e retornam `{ ok: true, ... }` ou `{ error: { code, message } }`.

### Eventos servidor → cliente

| Evento | Descrição |
| --- | --- |
| `socket:ready` | Handshake autenticado, com usuário e salas |
| `presence:update` | Presença de contatos |
| `typing:update` | Digitação em conversa |
| `message:new` | Nova mensagem |
| `message:updated` | Mensagem editada ou reação/fix alterados |
| `message:deleted` | Mensagem apagada |
| `conversation:new` | Nova conversa |
| `conversation:updated` | Título/avatar/última mensagem |
| `conversation:member-added` | Membro adicionado |
| `conversation:member-removed` | Membro removido |
| `conversation:removed` | Conversa removida/oculta |
| `conversation:hidden` | DM ocultada |
| `conversation:read` | Recibo de leitura |
| `friend:request` | Pedido recebido |
| `friend:accepted` | Pedido aceito |
| `friend:removed` | Amizade removida |
| `friend:request-rejected` | Pedido recusado |
| `user:blocked` / `user:unblocked` | Bloqueio alterado |
| `notification:new` | Nova notificação |
| `space:updated` | Espaço atualizado |
| `space:member-joined` | Novo membro |
| `space:member-left` | Membro saiu |
| `space:banned` | Usuário banido |
| `space:removed` | Usuário removido do espaço |
| `space:deleted` | Espaço excluído |
| `channel:added` | Canal criado |
| `call:incoming` | Chamada recebida |
| `call:participant-joined` | Participante aceitou |
| `call:participant-declined` | Participante recusou |
| `call:participant-left` | Participante saiu |
| `call:ended` | Chamada encerrada |
| `call:media-state` | Estado de mídia de participante |
| `webrtc:signal` | Sinal WebRTC direcionado |
| `session:revoked` | Sessão revogada; cliente deve sair |

## Códigos de erro comuns

| Código | HTTP | Significado |
| --- | --- | --- |
| `VALIDATION_ERROR` | 400 | Payload inválido |
| `UNAUTHORIZED` | 401 | Token ausente/inválido |
| `SESSION_EXPIRED` | 401 | Sessão expirada ou revogada |
| `INVALID_CREDENTIALS` | 401 | Login inválido |
| `FORBIDDEN` | 403 | Sem permissão |
| `BAD_ORIGIN` | 403 | Origem não permitida no refresh |
| `NOT_FOUND` | 404 | Recurso/rota inexistente |
| `CONFLICT` | 409 | Duplicidade |
| `RATE_LIMITED` | 429 | Limite excedido |
| `FILE_TOO_LARGE` | 413 | Upload acima do limite |
| `UNSUPPORTED_FILE` | 400 | MIME não permitido |
| `INTERNAL` | 500 | Erro inesperado |

Erros de autorização de domínio incluem `NOT_A_MEMBER`, `MISSING_PERMISSION`, `BANNED`, `PRIVATE_CHANNEL`, `ROLE_HIERARCHY`, `SESSION_REVOKED`, `CALL_ACTIVE`, `CALL_NOT_FOUND`, entre outros.
