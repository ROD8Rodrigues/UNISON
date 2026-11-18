# Arquitetura

## Visão geral

```
┌────────────────────────────────────────────────────────────┐
│ Navegador / PWA                                            │
│ React 19 · React Router · Zustand · Socket.IO client       │
│ WebRTC (getUserMedia / getDisplayMedia / RTCPeerConnection)│
└───────────────┬───────────────────────────┬────────────────┘
                │ HTTPS /api               │ WSS /socket.io
                ▼                          ▼
┌────────────────────────────────────────────────────────────┐
│ Express 5 + Socket.IO 4                                    │
│ middleware → rotas → serviços → SQLite (node:sqlite)       │
│ uploads em disco · emails via SMTP · sinalização WebRTC    │
└────────────────────────────────────────────────────────────┘
```

O deploy suportado é um único processo Node servindo API, Socket.IO e, opcionalmente, o build do frontend. O banco é SQLite local; não há dependência de serviços externos obrigatórios.

## Aplicativo desktop (Windows)

```text
┌─────────────────────────────────────────────────────┐
│ UNISON.exe (Electron 45.3.3)                      │
│ BrowserWindow sandbox · sem Node no renderer        │
└───────────────┬──────────────────────────┬──────────┘
                │ HTTP loopback            │ HTTPS (modo remoto)
                ▼                          ▼
┌──────────────────────────────┐   ┌──────────────────────────┐
│ backend embutido (fork com   │   │ backend UNISON         │
│ ELECTRON_RUN_AS_NODE=1)      │   │ publicado                │
│ Express + Socket.IO + SQLite │   │ Express + Socket.IO + DB │
└──────────────────────────────┘   └──────────────────────────┘
```

- **Modo local:** o processo principal escolhe uma porta livre em `127.0.0.1`, inicia o backend empacotado, aguarda `/health`, abre a janela e encerra o filho por IPC ao sair. Banco, uploads e logs ficam em `%APPDATA%\UNISON`.
- **Modo remoto:** `serverUrl` aponta para a origem pública; a janela carrega o frontend servido pelo backend remoto. Não há fallback para o banco local.
- **Empacotamento:** `prepare.js` copia servidor e `client/dist` para `staging`; `after-pack.js` injeta os `node_modules` de produção que o electron-builder omite em `extraResources`.
- **Renderer:** contexto isolado, `sandbox`, sem integração Node, navegação externa bloqueada e permissões restritas à origem do app. O service worker não é registrado dentro do Electron.

Detalhes de operação, dados, segurança e build: [DESKTOP.md](DESKTOP.md).

## Backend

### Entrada e composição

- `server/index.js` → chama `main()` em `server/src/server.js`.
- `server/src/server.js` → abre o SQLite, cria o app Express, anexa o Socket.IO, inicia limpeza periódica de uploads órfãos, registra shutdown gracioso e handlers de processo.
- `server/src/app.js` → monta middleware global, rotas `/api`, static do frontend, fallback SPA, 404 e tratamento de erros.
- `server/src/config.js` → carrega `.env`, valida segredo e CORS de produção, resolve caminhos.
- `server/src/logger.js` → logs JSON com timestamp, nível e contexto.

### Camadas

| Pasta | Responsabilidade |
| --- | --- |
| `routes/` | Contrato HTTP: autenticação, validação, status code e serialização |
| `services/` | Regras de negócio, autorização, transações e consultas |
| `middleware/` | Auth, validação Zod, rate limit, request ID, headers e same-origin |
| `db/` | Abertura do SQLite e migrations |
| `realtime/` | Autenticação do socket, presença, salas e eventos |
| `utils/` | Schemas, erros, helpers de ID/tempo/SQL |
| `test/` | Testes de API e realtime |

Fluxo de uma requisição:

```
request
  → requestContext (requestId + log)
  → helmet / securityHeaders / CORS
  → body parsers / cookie parser
  → rate limiter da área
  → authenticate (quando protegido)
  → validate (Zod)
  → handler da rota
  → service (autorização + SQL + eventos)
  → resposta JSON
  → errorHandler (contrato de erro)
```

### Contrato de erro

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Alguns campos são inválidos",
    "details": [{ "field": "password", "message": "A senha deve conter um número" }],
    "requestId": "uuid"
  }
}
```

Erros de aplicação usam `AppError`; erros inesperados viram `500 INTERNAL` sem vazar stack trace. Erros de Zod são convertidos para `400 VALIDATION_ERROR` com mensagens em português. O `requestId` também é devolvido no header `X-Request-Id` e aparece nos logs.

### SQLite

- Driver nativo `node:sqlite`, sem dependência externa.
- WAL habilitado; foreign keys habilitadas.
- IDs são UUID v4 em texto; timestamps são epoch em milissegundos.
- Campos JSON são serializados em texto (`settings`, `permissions`, `metadata`).
- Toda entrada de usuário é vinculada por parâmetros `?`. Trechos SQL dinâmicos só usam listas fixas de colunas e placeholders.
- Migrations em `server/src/db/migrations/`, aplicadas em ordem e registradas em `schema_migrations`.

Detalhes do schema em [DATABASE.md](DATABASE.md).

## Autenticação e sessões

1. **Registro** cria usuário, settings padrão, token de verificação de email e sessão.
2. **Login** valida bcrypt (cost 12) e cria uma sessão.
3. Cada sessão tem:
   - access token JWT de 15 minutos com `sub`, `sid` e `typ=access`;
   - refresh token opaco de 48 bytes, retornado apenas no cookie `unison_refresh`;
   - hash SHA-256 do refresh token no banco;
   - user agent, IP, rótulo do dispositivo, criação, último uso e expiração.
4. O access token é enviado no header `Authorization: Bearer`.
5. `resolveSessionUser` verifica o JWT **e** consulta a sessão a cada requisição. Assim, revogar uma sessão invalida o access token imediatamente, sem esperar os 15 minutos.
6. `POST /api/auth/refresh` lê o cookie, valida hash/expiração/revogação, **rotaciona** o refresh token e emite novo access token.
7. O refresh exige mesma origem (`Origin` igual ao host ou presente em `CORS_ORIGINS`). O cookie é `HttpOnly`, `Secure` em produção, `SameSite=Lax` e `Path=/api/auth`.
8. Logout revoga a sessão, limpa o cookie e desconecta os sockets daquela sessão.
9. Troca/reset de senha revogam sessões conforme a regra do fluxo.

O access token fica apenas em memória no frontend; não é gravado em `localStorage`.

## Frontend

### Bootstrap

`main.tsx` monta o React e registra o service worker em produção fora do Electron. `App.tsx` define rotas, guards (`RequireAuth`, `GuestRoute`), sincronização de tema e error boundary.

Na inicialização:

1. `useAuthStore.bootstrap()` chama `POST /api/auth/refresh` com `credentials: include`.
2. Em sucesso, guarda o access token em memória e carrega `/auth/me`.
3. `RealtimeBridge` conecta o Socket.IO e carrega conversas, notificações e espaços.
4. Guest é redirecionado para `/login`.

### Estado

| Store | Conteúdo |
| --- | --- |
| `store/auth.ts` | usuário, status de boot, login/registro/logout, settings |
| `store/app.ts` | conversas, mensagens, presença, digitação, notificações, espaços, canais |
| `store/toast.ts` | notificações efêmeras de UI |
| `store/dialog.ts` | confirmações imperativas |

`lib/api.ts` centraliza fetch, injeção do bearer, refresh automático em 401, tratamento de erros e upload multipart. `lib/socket.ts` mantém uma conexão singleton com reconexão infinita e atualização do token.

### UI

- `components/layout/` — shell, sidebar, rail de espaços, central de notificações, banner de email.
- `components/chat/` — lista, composer, mensagens, reações, painel de informações e configurações de grupo.
- `components/spaces/` — criação/edição de espaço, canais e moderação.
- `components/calls/` — provider de chamadas, overlay e contexto.
- `components/ui/` — avatar, modal, spinner, toasts, confirmação, logo.
- `styles/` — tokens e CSS por área, importados por `global.css`.

O visual usa variáveis CSS (`--accent`, superfícies, bordas, raios, sombras), tema escuro/meia-noite, modo compacto e `reduce-motion`.

## Realtime

O Socket.IO usa o mesmo servidor HTTP. A autenticação ocorre no handshake com `auth.token` (access token). O servidor valida JWT + sessão e rejeita token revogado.

- Cada usuário entra na sala `user:<id>`.
- Cada conversa tem sala `conversation:<id>`.
- Cada espaço tem sala `space:<id>`.
- Presença e digitação são mantidas em memória em `realtime/presence.js`.
- Eventos de domínio são emitidos pelo `realtime/bus.js` a partir das rotas/serviços, mantendo HTTP e Socket.IO consistentes.

O cliente reconecta automaticamente com backoff (800 ms a 5 s, tentativas infinitas). Ao reconectar, recarrega o estado inicial e reemite a autenticação.

Lista completa de eventos em [API.md](API.md).

## Chamadas e WebRTC

Topologia **mesh**: cada participante abre uma `RTCPeerConnection` para cada outro participante. O servidor não transporta mídia; apenas sinaliza.

Fluxo:

1. `call:start` cria a chamada no banco e convida os membros da conversa.
2. Convidados recebem `call:incoming`.
3. `call:accept` marca o participante como ativo e avisa os demais.
4. O cliente cria ofertas/answers e envia `webrtc:signal` para cada par.
5. O servidor valida se remetente e destinatário pertencem à chamada e encaminha o sinal.
6. `call:media-state` propaga mudo/câmera/tela.
7. `call:leave`, `call:reject`, `call:end` e desconexão encerram a participação; quando não há ninguém ativo, a chamada termina e uma mensagem de sistema é criada.
8. `pc.restartIce()` é usado em falha de conexão; o socket reconecta automaticamente.

Limites: 1:1 e grupos de até 9 participantes. Bandwidth e CPU crescem com o número de pares; não há SFU. STUN público é o padrão; TURN é configurável no build do cliente.

## Uploads

1. `POST /api/uploads` autenticado, multipart, campo `file`.
2. Multer valida tamanho e MIME contra uma allowlist.
3. O nome em disco é um UUID + extensão derivada do MIME (nunca do nome original).
4. Metadados são gravados em `attachments` com `message_id = NULL`.
5. Ao enviar mensagem, `attachmentIds` são vinculados; anexos não usados são removidos após 24 horas por limpeza periódica.
6. Arquivos são servidos em `/uploads` com `X-Content-Type-Options: nosniff`, CSP `sandbox`, `Cross-Origin-Resource-Policy: cross-origin` e cache imutável.

Não há antivírus, re-encoding de imagens ou storage externo. Veja [SECURITY.md](SECURITY.md).

## Comunidades e autorização

- `spaces` representa a comunidade; `space_members` guarda vínculo e apelido.
- `space_roles` define funções com posição e lista JSON de permissões.
- `space_member_roles` permite múltiplas funções por membro.
- O proprietário tem posição 100 e permissões totais.
- `requirePermission` verifica a permissão efetiva; regras adicionais impedem escalonamento, alteração do proprietário e gerenciamento de membros de rank igual/superior.
- Canais são `conversations` do tipo `channel` ligadas a um espaço, com `is_private` e ACL em `conversation_members`.
- Convites têm código aleatório, expiração e limite de uso; banimentos impedem entrada.
- Ações administrativas relevantes geram registros em `space_audit`.

## Decisões e trade-offs

| Decisão | Motivo | Consequência |
| --- | --- | --- |
| SQLite em vez de NeDB | Transações, índices, integridade e SQL | Escala vertical; não é multi-nó |
| `node:sqlite` em vez de Prisma | Sem dependência nativa/binária extra; Node já fornece | Exige Node ≥ 22.5 |
| Express + React preservados | Menor risco e continuidade do stack | Sem SSR |
| Tokens de sessão revogáveis | Segurança e controle por dispositivo | Uma consulta ao banco por requisição |
| PWA em vez de apps nativos | Entrega multiplataforma validável no escopo | Sem APIs nativas/push em background |
| Mesh WebRTC | Simplicidade e custo zero de mídia | Limite prático de participantes |
| Rate limit em memória | Sem dependência externa | Não compartilhado entre instâncias |
