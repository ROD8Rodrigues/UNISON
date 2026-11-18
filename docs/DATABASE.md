# Banco de dados e migrations

## Tecnologia

- SQLite nativo do Node (`node:sqlite`), disponível a partir do Node 22.5.
- Arquivo padrão: `server/data/unison.db`.
- Configurável por `DATABASE_PATH` (relativo a `server/` ou absoluto).
- PRAGMAs aplicados na abertura:
  - `foreign_keys = ON`
  - `journal_mode = WAL`
  - `busy_timeout = 5000`

WAL permite leituras concorrentes com uma escrita, mas **não torne o arquivo um banco multi-instância**. Execute um único processo do servidor por arquivo.

## Migrations

Arquivos em `server/src/db/migrations/`, aplicados em ordem lexicográfica.

- A tabela `schema_migrations` registra nome e timestamp de cada migration aplicada.
- Cada migration roda em `BEGIN IMMEDIATE` / `COMMIT`; em erro, há `ROLLBACK`.
- Na inicialização, migrations pendentes são aplicadas automaticamente.
- `001_init.sql` é a base canônica atual.

### Criar uma migration

1. Crie `002_descricao.sql`.
2. Use SQL compatível com SQLite.
3. Evite alterar migrations já aplicadas em produção.
4. Teste em um banco vazio e em uma cópia de produção.
5. Reinicie o servidor; a migration será aplicada.

Exemplo:

```sql
ALTER TABLE users ADD COLUMN timezone TEXT NOT NULL DEFAULT 'UTC';
CREATE INDEX idx_users_timezone ON users(timezone);
```

## Modelo de dados

### Conta e autenticação

| Tabela | Função |
| --- | --- |
| `users` | Conta, perfil, presença, verificação de email |
| `user_settings` | Tema, accent, privacidade, notificações |
| `sessions` | Refresh token hasheado, dispositivo, IP, expiração, revogação |
| `password_resets` | Tokens de reset com hash, expiração e uso único |
| `email_verifications` | Tokens de verificação com hash, expiração e uso único |

### Relações sociais

| Tabela | Função |
| --- | --- |
| `friendships` | Pares de amizade |
| `friend_requests` | Pedidos pendentes/aceitos/recusados |
| `blocks` | Bloqueios entre usuários |

Há índice único parcial para impedir dois pedidos pendentes entre o mesmo par.

### Comunidades

| Tabela | Função |
| --- | --- |
| `spaces` | Comunidade, slug, visibilidade, proprietário |
| `space_members` | Vínculo, apelido e data de entrada |
| `space_roles` | Funções, cor, permissões JSON, posição e função padrão |
| `space_member_roles` | Atribuição N:N de funções |
| `space_bans` | Banimentos e motivo |
| `channels` | Metadados de canais (nome, tópico, categoria, privacidade) |
| `space_invites` | Código, expiração, limite e contador de usos |
| `space_audit` | Trilha de ações administrativas |

### Conversas e mensagens

| Tabela | Função |
| --- | --- |
| `conversations` | DM, grupo ou canal; dono, espaço, `dm_key`, última mensagem |
| `conversation_members` | Papel, leitura, silêncio e ocultação por usuário |
| `messages` | Conteúdo, tipo, resposta, edição e exclusão lógica |
| `reactions` | Emoji por usuário/mensagem |
| `attachments` | Metadados de arquivo; `message_id` nulo até vinculação |
| `pins` | Mensagens fixadas por conversa |

`conversations.channel_id` liga um canal do espaço à conversa que armazena mensagens. `dm_key` normaliza o par de usuários para impedir DMs duplicadas.

### Chamadas e notificações

| Tabela | Função |
| --- | --- |
| `calls` | Tipo, status, início e fim |
| `call_participants` | Convite, entrada, saída e recusa |
| `notifications` | Notificações persistentes com payload JSON |

## Relacionamentos principais

```
users 1─1 user_settings
users 1─N sessions
users 1─N password_resets / email_verifications
users N─N users (friendships)
users 1─N spaces (owner)
spaces 1─N space_members / channels / invites / audit
spaces 1─N space_roles 1─N space_member_roles
spaces 1─1 channel conversation (via channels.id)
conversations 1─N conversation_members / messages
messages 1─N reactions / attachments
messages N─1 messages (reply_to_id)
conversations 1─N calls 1─N call_participants
```

## Integridade

- Chaves estrangeiras com `ON DELETE CASCADE` na maioria das relações de domínio.
- `users` referenciados por mensagens usam `ON DELETE SET NULL` para preservar histórico quando a conta é excluída.
- `email`, `username`, `spaces.slug`, `space_invites.code`, `conversations.dm_key` e `conversations.channel_id` são únicos.
- Checks restringem presença, visibilidade, papéis, tipos de conversa, status de chamada e tipo de mensagem.
- Timestamps são `INTEGER` (epoch ms).

## Backup

Com o servidor parado, copie o arquivo `.db` e, se existirem, `-wal` e `-shm`:

```bash
# Linux/macOS
systemctl stop unison
cp /var/lib/unison/unison.db* /backup/unison-$(date +%F)/
systemctl start unison
```

Com o servidor rodando, use o comando de backup do SQLite (se disponível):

```bash
sqlite3 /var/lib/unison/unison.db ".backup '/backup/unison.db'"
```

Teste a restauração periodicamente. O backup não inclui a pasta de uploads; copie `UPLOAD_DIR` junto para preservar anexos.

## Restauração

1. Pare o servidor.
2. Preserve o banco atual.
3. Copie o backup para `DATABASE_PATH`.
4. Garanta que `UPLOAD_DIR` corresponde aos anexos do backup.
5. Inicie o servidor e valide `/health`, login e leitura de uma conversa.

## Reset em desenvolvimento

```bash
# com o servidor parado
rm server/data/unison.db server/data/unison.db-wal server/data/unison.db-shm
npm --prefix server run dev
```

No Windows:

```powershell
Remove-Item server\data\unison.db* -Force
```

O banco e as tabelas são recriados na inicialização. Uploads antigos permanecem em `server/uploads`; remova-os manualmente se necessário.

## Consultas úteis

```sql
-- sessões ativas
SELECT id, user_id, device_label, last_used_at, expires_at
FROM sessions
WHERE revoked_at IS NULL AND expires_at > (strftime('%s','now') * 1000);

-- anexos órfãos
SELECT id, filename, created_at FROM attachments WHERE message_id IS NULL;

-- migrations aplicadas
SELECT * FROM schema_migrations ORDER BY name;
```

## Limitações de escala

- SQLite não oferece replicação nativa para múltiplos nós.
- `busy_timeout` de 5 s suaviza contenção, mas não elimina bloqueios sob escrita intensa.
- Busca de mensagens usa `LIKE`, sem índice FTS.
- Presença, digitação e rate limits ficam em memória.
- Socket.IO não usa adapter Redis; eventos não são propagados entre processos.

Para escala horizontal, o caminho é migrar para PostgreSQL, adicionar Redis (presença/rate limit/Socket.IO adapter), storage de objetos para uploads, busca dedicada e um SFU para chamadas maiores.
