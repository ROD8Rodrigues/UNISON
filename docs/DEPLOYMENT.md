# Deploy em produção

## Arquitetura de referência

```
Internet
  │ HTTPS/WSS (443)
  ▼
Proxy reverso (Nginx/Caddy/Traefik)
  │ HTTP 127.0.0.1:60000
  ▼
Node.js (Express + Socket.IO)
  ├─ SQLite (volume persistente)
  ├─ uploads (volume persistente)
  ├─ SMTP externo
  └─ STUN/TURN externos
```

O servidor Express pode servir o build do frontend. Para deploys separados, sirva `client/dist` em um CDN/host estático e aponte `VITE_API_URL` para o domínio da API, ajustando `CORS_ORIGINS`.

> Para uma opção gratuita, sem cartão e sem CNPJ, siga o guia [Deploy gratuito na alwaysdata](DEPLOY_ALWAYSDATA.md). O restante deste documento cobre VPS/proxy próprio, systemd e TURN.

## Checklist antes do deploy

- [ ] Node ≥ 22.5 no host.
- [ ] `client/dist` gerado com a URL/TURN corretos.
- [ ] `NODE_ENV=production`.
- [ ] `JWT_SECRET` aleatório com ≥ 32 caracteres, fora do repositório.
- [ ] `CORS_ORIGINS` e `APP_URL` com o domínio HTTPS final.
- [ ] `DATABASE_PATH` e `UPLOAD_DIR` em volumes persistentes.
- [ ] SMTP configurado e testado.
- [ ] TURN configurado se chamadas precisarem atravessar NAT restritivo.
- [ ] TLS terminado no proxy; porta do Node acessível apenas localmente.
- [ ] Backup do banco e uploads configurado.
- [ ] Healthcheck e logs monitorados.
- [ ] `npm audit` e testes verdes.

## Build

```bash
cd client
npm ci
npm run build
```

Variáveis do build (quando aplicável):

```bash
VITE_API_URL=/api \
VITE_STUN_URLS="stun:stun.l.google.com:19302" \
VITE_TURN_URL="turn:turn.exemplo.com:3478" \
VITE_TURN_USERNAME="usuario" \
VITE_TURN_CREDENTIAL="segredo" \
npm run build
```

Instale dependências de produção do servidor:

```bash
cd server
npm ci --omit=dev
```

O servidor resolve `client/dist` a partir de `server/src/app.js` (`../../client/dist`). Mantenha a estrutura do monorepo ou ajuste o caminho no código se optar por outro layout.

## Cliente desktop

O `.exe` Windows pode ser usado em dois modos:

- **local:** backend e SQLite embutidos, isolados por computador; não serve para conversas entre máquinas;
- **remoto:** o aplicativo carrega este backend publicado. Para isso, o servidor precisa servir o frontend na raiz, a API em `/api`, Socket.IO e `/health`, com HTTPS válido. No cliente, configure `serverUrl` em `%APPDATA%\UNISON\desktop-config.json`:

```json
{
  "jwtSecret": "<gerado automaticamente>",
  "serverUrl": "https://app.exemplo.com"
}
```

Se o app for usado apenas no modo remoto, `jwtSecret` pode ser omitido. O `serverUrl` deve ser apenas a origem, sem caminho. Não há fallback para o banco local se o servidor estiver indisponível. Detalhes, build e limitações: [DESKTOP.md](DESKTOP.md).

## Variáveis

Use um arquivo protegido, por exemplo `/etc/unison/unison.env`:

```dotenv
NODE_ENV=production
PORT=60000
HOST=127.0.0.1
JWT_SECRET=...
DATABASE_PATH=/var/lib/unison/unison.db
UPLOAD_DIR=/var/lib/unison/uploads
CORS_ORIGINS=https://app.exemplo.com
APP_URL=https://app.exemplo.com
MAX_UPLOAD_MB=25
SMTP_HOST=smtp.exemplo.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=...
SMTP_PASS=...
MAIL_FROM="UNISON <no-reply@exemplo.com>"
EXPOSE_DEV_TOKENS=false
TRUST_PROXY=true
```

```bash
chmod 600 /etc/unison/unison.env
```

`TRUST_PROXY=true` só deve ser usado atrás de um proxy confiável, pois o rate limit usa o IP encaminhado.

## Nginx

```nginx
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}

server {
    listen 443 ssl http2;
    server_name app.exemplo.com;

    ssl_certificate     /etc/letsencrypt/live/app.exemplo.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/app.exemplo.com/privkey.pem;

    client_max_body_size 30m;

    location / {
        proxy_pass http://127.0.0.1:60000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }
}

server {
    listen 80;
    server_name app.exemplo.com;
    return 301 https://$host$request_uri;
}
```

Observações:

- `client_max_body_size` deve ser maior que `MAX_UPLOAD_MB`.
- WebSocket precisa de `Upgrade`/`Connection` e timeout longo.
- Não remova os headers de segurança do Express; se o proxy adicionar CSP/HSTS, evite duplicação conflitante.
- Restrinja o acesso à porta 60000 com firewall; escute em `127.0.0.1` atrás do proxy.

## systemd

`/etc/systemd/system/unison.service`:

```ini
[Unit]
Description=UNISON
After=network.target

[Service]
Type=simple
User=unison
Group=unison
WorkingDirectory=/opt/unison/server
EnvironmentFile=/etc/unison/unison.env
ExecStart=/usr/bin/node index.js
Restart=on-failure
RestartSec=5
TimeoutStopSec=15
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/unison
LimitNOFILE=65535

[Install]
WantedBy=multi-user.target
```

```bash
sudo useradd --system --home /opt/unison unison
sudo mkdir -p /var/lib/unison/uploads
sudo chown -R unison:unison /var/lib/unison
sudo systemctl daemon-reload
sudo systemctl enable --now unison
sudo systemctl status unison
```

Ajuste `ExecStart` para o caminho real do Node (`which node`). `ProtectSystem=strict` exige que banco/uploads estejam em `ReadWritePaths`.

## Windows

Opções:

- Serviço com [NSSM](https://nssm.cc/) apontando para `node.exe index.js`.
- Task Scheduler no boot.
- Process manager equivalente ao PM2.

Defina as variáveis no ambiente do serviço e garanta que a conta tenha escrita em `DATABASE_PATH` e `UPLOAD_DIR`. Use IIS ou Caddy como proxy TLS.

## Healthcheck e monitoramento

```bash
curl -fsS https://app.exemplo.com/health
```

Resposta esperada:

```json
{"status":"ok","service":"unison-server","version":"1.0.0","database":"ok","timestamp":"..."}
```

Monitore:

- status HTTP e latência de `/health`;
- taxa de erros 5xx e 429;
- conexões Socket.IO e reconexões;
- espaço em disco (uploads e WAL);
- tamanho e tempo de backup;
- entrega de email e falhas SMTP;
- qualidade de chamadas (TURN/relay) quando aplicável.

Logs são JSON em stdout/stderr. Use journald, Docker logs ou um coletor central.

## Banco e uploads

- Use volume persistente com backup.
- O SQLite cria `-wal` e `-shm`; backup com servidor parado deve incluir os três arquivos.
- A pasta `UPLOAD_DIR` cresce indefinidamente; monitore e defina retenção.
- Nunca sirva uploads por outro caminho sem os headers de segurança do Express.
- Considere antivírus/scan assíncrono antes de liberar arquivos publicamente.

Procedimento de backup em [DATABASE.md](DATABASE.md).

## Atualização

```bash
git pull
cd client && npm ci && npm run build
cd ../server && npm ci --omit=dev
sudo systemctl restart unison
curl -fsS https://app.exemplo.com/health
```

Antes de atualizar:

1. Faça backup do banco e uploads.
2. Leia as migrations novas.
3. Teste em staging.
4. Tenha um plano de rollback (release anterior + backup).

Migrations são aplicadas no boot. Não há rollback automático de schema; restaure o backup se uma migration precisar ser desfeita.

## SMTP

Configure SPF, DKIM e DMARC no domínio de envio. Teste:

1. Registro → email de verificação.
2. Recuperação de senha → email de reset.
3. Verifique expiração (24 h / 30 min) e uso único.

Sem SMTP, o servidor registra o conteúdo no log e retorna `delivered: false`; em produção não expõe tokens.

## TURN (coturn)

Exemplo mínimo de `/etc/turnserver.conf`:

```conf
listening-port=3478
tls-listening-port=5349
fingerprint
lt-cred-mech
realm=turn.exemplo.com
user=unison:senha-forte
min-port=49152
max-port=65535
```

Libere 3478/5349 (TCP/UDP) e a faixa de relay UDP. Prefira credenciais temporárias (`use-auth-secret`) em produção e um endpoint que as emita; a implementação atual aceita credenciais estáticas no build.

## Escalabilidade

O deploy atual é **single-node**:

- SQLite local;
- presença, digitação e rate limit em memória;
- Socket.IO sem adapter;
- uploads em disco local.

Para múltiplas instâncias, migre para PostgreSQL, Redis (rate limit/presença/Socket.IO adapter), storage de objetos e um SFU para chamadas maiores. Não execute duas instâncias sobre o mesmo arquivo SQLite.

## Segurança operacional

- Mantenha Node e dependências atualizados.
- Rode `npm audit --omit=dev` a cada release.
- Use TLS moderno e HSTS no proxy.
- Restrinja SSH e portas internas.
- Rotacione `JWT_SECRET` apenas com plano de invalidação de sessões (trocar o segredo invalida todos os access tokens imediatamente; refresh tokens continuam válidos até serem usados, pois são opacos).
- Rotacione credenciais SMTP/TURN.
- Não registre tokens, senhas ou conteúdo sensível em logs de produção.
