# Instalação e configuração

## Pré-requisitos

| Requisito | Versão |
| --- | --- |
| Node.js | ≥ 22.5 (necessário para `node:sqlite`) |
| npm | ≥ 10 |
| Navegador | Chrome/Edge/Firefox/Safari modernos com WebRTC |
| SMTP | Opcional, necessário para entrega real de emails em produção |
| TURN | Opcional, recomendado para chamadas atrás de NAT restritivo |
| Windows x64 | Necessário apenas para gerar/testar o `.exe` desktop |

O projeto foi validado neste ambiente com **Node 26.13.0** e **npm 11.20.0** no Windows. Para backend e frontend, Linux e macOS usam os mesmos comandos; o empacotamento do aplicativo desktop é específico de Windows x64.

## Instalação

### Backend

```bash
cd server
npm install
cp .env.example .env
```

No Windows (PowerShell):

```powershell
cd server
npm install
Copy-Item .env.example .env
```

O arquivo `.env` é ignorado pelo Git. Nunca versione segredos reais.

### Frontend

```bash
cd client
npm install
```

O frontend não precisa de `.env` para desenvolvimento: o Vite usa proxy para `http://127.0.0.1:60000`. As variáveis opcionais estão documentadas em `client/.env.example` e na tabela abaixo.

## Variáveis de ambiente do servidor

Todas são lidas de `server/.env` (ou do ambiente do processo, que tem precedência).

| Variável | Padrão | Descrição |
| --- | --- | --- |
| `NODE_ENV` | `development` | `production` ativa validações rígidas, cookies `Secure` por padrão e desativa tokens de desenvolvimento |
| `PORT` | `60000` | Porta HTTP |
| `HOST` | `0.0.0.0` | Interface de escuta |
| `JWT_SECRET` | fallback derivado em dev | **Obrigatório em produção**, mínimo 32 caracteres e sem `change-me` |
| `ACCESS_TOKEN_TTL` | `15m` | Validade do access token |
| `REFRESH_TOKEN_DAYS` | `30` | Validade do refresh token/sessão |
| `DATABASE_PATH` | `./data/unison.db` | Caminho do SQLite, relativo a `server/` |
| `CORS_ORIGINS` | `http://localhost:5173,http://127.0.0.1:5173` | Origens permitidas, separadas por vírgula. `*` é rejeitado em produção |
| `APP_URL` | `http://localhost:5173` | URL pública usada em links de email |
| `UPLOAD_DIR` | `./uploads` | Pasta de anexos, relativa a `server/` |
| `MAX_UPLOAD_MB` | `25` | Tamanho máximo por arquivo |
| `SMTP_HOST` | vazio | Se vazio, emails são gravados no log e não entregues |
| `SMTP_PORT` | `587` | Porta SMTP |
| `SMTP_SECURE` | `false` | `true` para TLS implícito (normalmente porta 465) |
| `SMTP_USER` | vazio | Usuário SMTP |
| `SMTP_PASS` | vazio | Senha SMTP |
| `MAIL_FROM` | `UNISON <no-reply@unison.local>` | Remetente |
| `EXPOSE_DEV_TOKENS` | `true` fora de produção | Expõe tokens de verificação/recuperação na resposta da API. **Sempre ignorado em produção** |
| `TRUST_PROXY` | `false` | `true` atrás de proxy reverso confiável (usa o primeiro IP do `X-Forwarded-For`) |
| `COOKIE_SECURE` | `true` em produção | Força o atributo `Secure` no cookie de refresh. O desktop embutido usa `false` apenas em loopback local. **Não desative em produção pública.** |

### Exemplo de produção

```dotenv
NODE_ENV=production
PORT=60000
HOST=127.0.0.1
JWT_SECRET=cole-aqui-um-segredo-aleatorio-de-64-caracteres
ACCESS_TOKEN_TTL=15m
REFRESH_TOKEN_DAYS=30
DATABASE_PATH=/var/lib/unison/unison.db
UPLOAD_DIR=/var/lib/unison/uploads
CORS_ORIGINS=https://app.exemplo.com
APP_URL=https://app.exemplo.com
MAX_UPLOAD_MB=25
SMTP_HOST=smtp.exemplo.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=no-reply@exemplo.com
SMTP_PASS=senha-smtp
MAIL_FROM="UNISON <no-reply@exemplo.com>"
EXPOSE_DEV_TOKENS=false
TRUST_PROXY=true
```

Gere o segredo com:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

## Variáveis do frontend

São variáveis de **build** do Vite (precisam ser definidas antes de `npm run build`).

| Variável | Padrão | Descrição |
| --- | --- | --- |
| `VITE_API_URL` | `/api` | URL base da API. Use `/api` quando o servidor serve o frontend; use URL absoluta em deploy separado |
| `VITE_DEV_API_TARGET` | `http://127.0.0.1:60000` | Destino do proxy no `npm run dev` |
| `VITE_STUN_URLS` | STUNs públicos do Google | Lista separada por vírgula |
| `VITE_TURN_URL` | vazio | URL TURN, por exemplo `turn:turn.exemplo.com:3478` |
| `VITE_TURN_USERNAME` | vazio | Usuário TURN |
| `VITE_TURN_CREDENTIAL` | vazio | Credencial TURN |

Exemplo:

```bash
cd client
VITE_TURN_URL="turn:turn.exemplo.com:3478" \
VITE_TURN_USERNAME="unison" \
VITE_TURN_CREDENTIAL="segredo" \
npm run build
```

No Windows, use `$env:VITE_TURN_URL='...'` antes do build.

> Credenciais TURN embutidas no bundle são visíveis para qualquer usuário. Em produção, prefira credenciais temporárias emitidas por um serviço de TURN (coturn com `use-auth-secret`), o que exigiria um endpoint adicional. O suporte atual cobre credenciais estáticas.

## Desenvolvimento

Terminal 1:

```bash
cd server
npm run dev
```

Terminal 2:

```bash
cd client
npm run dev
```

Acesse `http://localhost:5173`.

- API: `http://localhost:60000/api`
- Healthcheck: `http://localhost:60000/health`
- Uploads: `http://localhost:60000/uploads/...`
- Socket.IO: mesmo host/porta da API

O servidor cria automaticamente as tabelas e a pasta de uploads. O banco de desenvolvimento fica em `server/data/unison.db`.

## Produção em um único host

```bash
cd client
npm ci
npm run build

cd ../server
npm ci --omit=dev
npm start
```

Com `NODE_ENV=production`, o Express serve `client/dist`, aplica fallback de SPA e envia `sw.js` com `Service-Worker-Allowed: /`. A API continua em `/api`.

Acesse `https://seu-dominio.example` via proxy reverso com TLS. **Não exponha a porta 60000 diretamente à internet sem TLS**, porque cookies `Secure` e WebRTC dependem de contexto seguro.

## SMTP

Com SMTP configurado:

- Emails de verificação têm validade de 24 horas.
- Emails de redefinição têm validade de 30 minutos.
- Tokens são de uso único e armazenados apenas como hash SHA-256.

Sem SMTP:

- O conteúdo do email é registrado no log (`Email not sent (SMTP not configured)`).
- Em desenvolvimento, `EXPOSE_DEV_TOKENS=true` devolve o token na resposta para testes.
- Em produção, tokens não são expostos; configure SMTP antes de permitir recuperação de senha real.

Teste de entrega recomendado: crie uma conta, solicite redefinição e confirme o recebimento no email antes de abrir o serviço ao público.

## TURN para chamadas

Sem TURN, chamadas funcionam em muitas redes domésticas, mas podem falhar em NAT simétrico, redes corporativas ou algumas operadoras móveis. Para produção:

1. Instale coturn ou use um provedor TURN.
2. Configure `VITE_TURN_URL`, `VITE_TURN_USERNAME` e `VITE_TURN_CREDENTIAL` no build do cliente.
3. Libere UDP/TCP 3478 e a faixa de relays UDP no firewall.
4. Valide uma chamada entre duas redes diferentes.

## PWA

O build gera:

- `manifest.webmanifest`
- `sw.js`
- ícones 192/512/maskable, apple-touch e favicon

O service worker só é registrado em produção (`import.meta.env.PROD`), e não é registrado dentro do aplicativo Electron. Para testar:

```bash
cd client
npm run build
cd ../server
NODE_ENV=production JWT_SECRET="..." npm start
```

Abra em `http://localhost:60000` (ou HTTPS). Em Chrome/Edge, use “Instalar aplicativo”. Em iOS/Safari, use “Adicionar à Tela de Início”.

O shell offline é cacheado; mensagens e APIs não são cacheadas. Não há sincronização em background.

## Aplicativo desktop (Windows)

O UNISON também é distribuído como `.exe` Windows x64 com Electron, backend Express e SQLite embutidos. O cliente final **não** precisa de Node.js. Para gerar os artefatos:

```powershell
cd client
npm ci
npm run build

cd ..\desktop
npm ci
npm run icon          # se desktop\build\icon.ico não existir
npm run check
cmd /c "npm run dist"
```

Saídas em `desktop\release\`:

- `UNISON-Setup-1.0.1.exe` — instalador NSIS por usuário;
- `UNISON-Portable-1.0.1.exe` — executável portátil;
- `win-unpacked\` — build para teste;
- `SHA256SUMS.txt` — checksums.

No modo padrão, o app inicia o backend em `127.0.0.1` com porta aleatória e grava banco/uploads/logs em `%APPDATA%\UNISON`. Esse modo é **isolado por computador**: contas criadas nele não conversam com outras máquinas. Para multiusuário, publique o backend com HTTPS e configure `serverUrl` em `%APPDATA%\UNISON\desktop-config.json`:

```json
{
  "jwtSecret": "<gerado automaticamente>",
  "serverUrl": "https://chat.suaempresa.com"
}
```

Se o app for usado apenas no modo remoto, `jwtSecret` pode ser omitido. O servidor remoto precisa servir o frontend na raiz, a API em `/api`, Socket.IO em `/socket.io` e responder `/health`. Detalhes de arquitetura, dados, segurança, smoke test, solução de problemas e limitações: [DESKTOP.md](DESKTOP.md).

> Os executáveis não são assinados. O SmartScreen pode avisar sobre publicador desconhecido; confira o SHA-256 publicado. Desinstalar não remove `%APPDATA%\UNISON`.

## Migração do protótipo

O importador copia usuários do NeDB antigo, preservando hashes bcrypt:

```bash
cd server
npm run import:legacy
```

Ele lê `server/data/users.db` e grava no banco configurado em `DATABASE_PATH`. Amigos, conversas e mensagens antigas não são importados. Veja [MIGRATION.md](MIGRATION.md).

## Solução de problemas

### `node:sqlite` indisponível

Atualize para Node ≥ 22.5. Verifique com `node -v`.

### PowerShell bloqueia `npm` (`npm.ps1 cannot be loaded`)

Use `cmd /c "npm run dev"` ou ajuste a Execution Policy. Este projeto foi validado com `cmd /c`.

### Porta em uso

Altere `PORT` no servidor e `VITE_DEV_API_TARGET` no cliente. O Vite usa `strictPort: true` na porta 5173; libere a porta ou ajuste `vite.config.ts`.

### `SQLITE_BUSY` ou banco bloqueado

Execute apenas uma instância do servidor por arquivo SQLite. Encerre processos antigos antes de reiniciar. Em produção, use um único processo (ou migre para PostgreSQL antes de escalar horizontalmente).

### Service worker servindo build antigo

O `sw.js` usa cache versionado e `skipWaiting`, mas o navegador pode manter o controller antigo. Recarregue com DevTools aberto (“Update on reload”) ou limpe o storage do site. Em produção, o `index.html` e o `sw.js` são servidos com `no-cache`.

### Uploads não aparecem

Confirme que `UPLOAD_DIR` existe e tem permissão de escrita, e que o proxy reverso não bloqueia `/uploads`. O servidor cria a pasta automaticamente.

### Chamadas sem áudio/vídeo

- O navegador exige HTTPS (ou `localhost`) para `getUserMedia`.
- Verifique permissões de câmera/microfone.
- Sem TURN, algumas redes falham.
- Teste com duas contas em janelas/dispositivos diferentes.

### Emails não chegam

Sem `SMTP_HOST`, nenhum email é enviado. Verifique logs, credenciais, porta/TLS e reputação do domínio. Use `MAIL_FROM` com domínio válido e SPF/DKIM/DMARC configurados.

### SmartScreen bloqueia o `.exe` do UNISON

O instalador e o portátil não têm assinatura Authenticode. Confira o SHA-256 em `desktop/release/SHA256SUMS.txt` e use **Mais informações → Executar assim mesmo** apenas se a origem for confiável. Detalhes em [DESKTOP.md](DESKTOP.md).

### O aplicativo desktop não inicia

Abra `%APPDATA%\UNISON\logs\desktop.log` e `server.log`. Verifique permissão de escrita, antivírus e espaço em disco. O app não faz fallback silencioso quando `serverUrl` aponta para um servidor indisponível.

### Apagar dados do aplicativo desktop

Feche o app e remova `%APPDATA%\UNISON` (ou a pasta definida em `UNISON_USER_DATA`). Desinstalar o aplicativo não remove esses dados.
