# Migração do protótipo legado

## O que existia antes

O repositório original continha:

- um backend monolítico em `server/index.js` com Express, NeDB, JWT e Socket.IO;
- três bancos NeDB em `server/data/`: `users.db` (3 usuários de teste), `conversations.db` e `messages.db` vazios;
- `JWT_SECRET` hardcoded como `your_jwt_secret_change_in_production`;
- CORS `origin: "*"` e eventos de socket identificados apenas por `userId` enviado pelo cliente;
- frontend React reduzido a um placeholder de 295 bytes.

O protótipo foi preservado em `server/legacy/index.js` e `server/legacy/friend_request.json`. O commit `ca24065` registra o estado original antes da reconstrução.

## O que mudou

| Área | Legado | Atual |
| --- | --- | --- |
| Banco | NeDB (arquivos JSON) | SQLite com migrations |
| Servidor | Um arquivo de ~39 kB | Módulos `routes/services/realtime/db` |
| Autenticação | JWT sem refresh/revogação | Access + refresh rotativo + sessões revogáveis |
| Validação | Inexistente | Zod |
| CORS | `*` | Allowlist |
| Frontend | Placeholder | React completo + PWA |
| Chamadas | Sinais básicos | WebRTC mesh com ciclo de chamada |
| Comunidades | Ausentes | Spaces, canais, funções, convites, bans, auditoria |

## Importar usuários

O importador lê `server/data/users.db`, no formato newline-delimited JSON do NeDB, e insere no SQLite configurado em `DATABASE_PATH`.

```bash
cd server
npm run import:legacy
```

Saída esperada:

```
Imported @user2 (user2@example.com)
Imported @user3 (user3@example.com)
...
Done. Imported: 3. Skipped: 0.
Legacy passwords were kept intact; users can sign in with their existing credentials.
```

### O que é importado

- `username` (normalizado para minúsculas)
- `email` (normalizado para minúsculas)
- hash bcrypt existente
- `displayName`
- `bio`
- `avatar`
- data de criação
- settings padrão (`dark`, `#C9A0DC`)

### O que não é importado

- amigos e pedidos de amizade;
- conversas, mensagens e anexos;
- presença e sessões;
- IDs internos do NeDB (`_id`).

Esses dados eram vazios ou continham apenas fixtures de teste. Se você tiver dados reais em outro ambiente, escreva um importador específico e valide os relacionamentos antes de migrar.

### Senhas

Os hashes bcrypt do legado (cost 10) continuam válidos. O login usa `bcrypt.compare`; a senha não é re-hasheada automaticamente para cost 12. Se desejar atualizar o custo, implemente rehash no login após verificação bem-sucedida.

## Compatibilidade de configuração

O legado usava `PORT` e um segredo fixo. O novo servidor exige:

```dotenv
NODE_ENV=production
JWT_SECRET=<segredo-forte>
DATABASE_PATH=./data/unison.db
CORS_ORIGINS=https://seu-dominio
APP_URL=https://seu-dominio
```

O arquivo `server/data/users.db` não é apagado pelo importador. Mantenha-o como backup até confirmar o login dos usuários migrados.

## Verificação pós-migração

1. Inicie o servidor.
2. Confirme `/health`.
3. Faça login com um usuário legado.
4. Verifique perfil, email e presença.
5. Confirme que o usuário aparece na busca.
6. Teste recuperação de senha (requer SMTP).
7. Faça backup do SQLite resultante.

## Rollback

O código antigo está em `server/legacy/index.js`, mas depende de NeDB e não deve ser executado em produção. Para rollback de código:

```bash
git checkout ca24065
```

Para rollback de dados, restaure o backup do SQLite. Não há downgrade automático de schema.

## Limpeza

Após validar a migração e manter backups:

- não versione `server/data/users.db` (dados pessoais);
- remova logs antigos (`server.log`, `server.out`, `backend.log`, `frontend.log`) se não forem necessários;
- mantenha `server/legacy/` apenas como referência histórica.
