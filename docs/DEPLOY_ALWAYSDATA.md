# Deploy gratuito na alwaysdata (sem cartão e sem CNPJ)

Este guia publica o UNISON — frontend/PWA, API, Socket.IO, SQLite e uploads — em uma conta **alwaysdata Free**. É uma opção para uso pessoal/pequeno time, sem cartão de crédito e sem CNPJ.

## O que você terá

- URL HTTPS: `https://<conta>.alwaysdata.net`
- Node.js 24 com `node:sqlite`
- 1 GB de disco SSD persistente (banco + uploads)
- 256 MB de RAM e 1/4 de CPU
- Certificado Let's Encrypt gratuito
- Backups da alwaysdata com 3 dias de retenção

## Limitações reais do plano Free

- **Uso pessoal/não comercial.** Para uso comercial, contrate o plano Plus ou use outro provedor.
- **Sem domínio próprio.** A URL é sempre `https://<conta>.alwaysdata.net`.
- **256 MB de RAM e 1/4 de CPU.** Suficiente para um time pequeno, mas não para carga alta.
- **1 GB de disco.** Inclui banco, uploads e qualquer outro arquivo da conta. Monitore o espaço.
- **Backup de 3 dias.** Faça backups externos do banco e dos uploads.
- **Conta ociosa pode ser suspensa.** Entre no painel pelo menos a cada 120 dias no primeiro ano.
- **Single-node.** SQLite, presença e Socket.IO em memória; não rode duas instâncias sobre o mesmo banco.
- **Sem TURN próprio.** Chamadas de áudio/vídeo podem falhar atrás de NAT restritivo; configure um TURN externo se precisar.
- **Sem root.** É hospedagem gerenciada; você usa SSH/SFTP, não `sudo`.

## Pré-requisitos

- Node.js 22.5 ou superior na sua máquina para gerar o build (validado com Node 26.13).
- Uma conta alwaysdata Free: [alwaysdata.com](https://www.alwaysdata.com/en/).
- Cliente SSH/SCP no Windows (o OpenSSH já vem no Windows 10/11) ou um cliente SFTP como WinSCP/FileZilla.
- O código do UNISON nesta pasta.

## Passo 1 — Criar a conta

1. Acesse [alwaysdata.com](https://www.alwaysdata.com/en/) e escolha o plano **Free**.
2. Cadastre-se como pessoa física. Não é pedido cartão nem CNPJ.
3. Escolha o nome da conta; ele será o subdomínio `https://<conta>.alwaysdata.net`.
4. Confirme o email e entre no painel: [admin.alwaysdata.com](https://admin.alwaysdata.com).

> **Conta já criada neste ambiente:** `telawork`, usuário SSH `telawork`, host `ssh-telawork.alwaysdata.net:22`. A URL pública é `https://telawork.alwaysdata.net`. O site Apache padrão dessa conta ainda responde e precisa ser removido ou substituído pelo site Node.js do UNISON. Nos comandos abaixo, substitua `<conta>` por `telawork`.

## Passo 2 — Preparar o pacote de deploy

Na raiz do projeto:

```powershell
cd C:\Users\Chris\Telawork

# gera client/dist e o pacote deploy/UNISON-alwaysdata-1.0.1.zip
powershell -ExecutionPolicy Bypass -File .\scripts\prepare-alwaysdata.ps1
```

O script:

- roda o build do frontend (a menos que você use `-SkipBuild`);
- copia `server/` (sem `node_modules`, `data`, `uploads`, `.env`, testes e legado);
- copia `client/dist/`;
- cria `DEPLOY.txt` com o resumo;
- gera `deploy/UNISON-alwaysdata-1.0.1.zip` e mostra o SHA-256.

Build atual do pacote: **0,96 MiB (1.009.881 bytes)**, SHA-256 `04704d4a463c1e8f8fc7dc0a819fd1a42b1b5abf8bb1d3d14b6059fd207cf47e` (o mesmo valor fica em `deploy/UNISON-alwaysdata-1.0.1.zip.sha256`).

O zip deve conter, na raiz:

```text
server/
  index.js
  package.json
  package-lock.json
  .env.example
  src/
client/
  dist/
DEPLOY.txt
```

Opcional: valide o pacote localmente antes de enviar. O script extrai o zip em uma pasta temporária, sobe o servidor em `NODE_ENV=production` e testa health, SPA, service worker, registro, login, refresh e `/me`:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\smoke-alwaysdata.ps1
```

## Passo 3 — Habilitar SSH e enviar o pacote

1. No painel, abra **Remote access → SSH/SFTP**.
2. Crie um usuário SSH (ou use o usuário principal, se já estiver habilitado) com shell `bash`.
3. Anote o usuário e a senha (ou cadastre sua chave pública).
4. O host é `ssh-<conta>.alwaysdata.net`, porta 22.

No PowerShell, na raiz do projeto:

```powershell
# teste a conexão
ssh <usuario-ssh>@ssh-<conta>.alwaysdata.net

# envie o zip
scp .\deploy\UNISON-alwaysdata-1.0.1.zip <usuario-ssh>@ssh-<conta>.alwaysdata.net:~/
```

Se preferir interface gráfica, use WinSCP/FileZilla no mesmo host e porta 22, modo SFTP.

No servidor:

```bash
mkdir -p ~/unison
cd ~/unison
unzip ~/UNISON-alwaysdata-1.0.1.zip
ls -la
```

Se `unzip` não estiver disponível, extraia pelo gerenciador de arquivos da alwaysdata ou use:

```bash
python3 -m zipfile -e ~/UNISON-alwaysdata-1.0.1.zip ~/unison
```

A estrutura final precisa ser:

```text
/home/<conta>/unison/server/
/home/<conta>/unison/client/dist/
```

O servidor resolve o frontend em `server/src/app.js` como `../../client/dist`; por isso as duas pastas precisam ser irmãs dentro de `~/unison`.

## Passo 4 — Instalar dependências e criar as pastas de dados

```bash
cd ~/unison/server
npm ci --omit=dev
mkdir -p data uploads
```

Gere um segredo JWT aleatório:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Guarde o valor; ele será usado em `JWT_SECRET`. Não coloque esse segredo no Git.

## Passo 5 — Selecionar o Node.js 24

No painel:

1. Abra **Environment → Node.js**.
2. Selecione a versão **24** como padrão.
3. Salve.

Alternativa: defina `NODEJS_VERSION=24` nas variáveis de ambiente do site (Passo 6).

## Passo 6 — Criar o site Node.js

No painel, abra **Web → Sites → Add a site** e configure:

| Campo | Valor |
| --- | --- |
| Nome | `UNISON` (livre) |
| Tipo | **Node.js** |
| Endereço | `<conta>.alwaysdata.net` (o endereço padrão da conta) |
| Comando | `node /home/<conta>/unison/server/index.js` |
| Diretório de trabalho | `/home/<conta>/unison/server` |
| Versão do Node.js | **24** |
| Idle time | **0** (se o campo existir; evita parar a conexão WebSocket) |

Se a conta já tiver um site padrão em `<conta>.alwaysdata.net`, edite ou remova esse site antes de criar o UNISON no mesmo endereço. O painel mostra o **IP** e a **porta** atribuídos ao site. O UNISON lê `PORT` e `IP`/`HOST` automaticamente; **não fixe** esses valores no código nem no `.env`.

### Variáveis de ambiente

Na seção **Environment** do site, adicione:

```dotenv
NODE_ENV=production
NODEJS_VERSION=24
JWT_SECRET=<segredo-gerado-no-passo-4>
DATABASE_PATH=./data/unison.db
UPLOAD_DIR=./uploads
CORS_ORIGINS=https://<conta>.alwaysdata.net
APP_URL=https://<conta>.alwaysdata.net
COOKIE_SECURE=true
TRUST_PROXY=true
EXPOSE_DEV_TOKENS=false
MAX_UPLOAD_MB=10
```

Se a sua interface não tiver a seção **Environment**, crie o arquivo `server/.env` por SSH:

```bash
cd ~/unison/server
cp .env.example .env
nano .env
chmod 600 .env
```

Nesse caso, ajuste os valores no `.env` e **não defina `PORT`**; a alwaysdata injeta a porta correta. O `dotenv` não sobrescreve variáveis já definidas pelo ambiente do site, então as variáveis do painel têm prioridade.

### SMTP (opcional)

Sem SMTP, o cadastro e o login funcionam, mas os links de verificação de email e recuperação de senha ficam no log do servidor. Para enviar emails de verdade, configure:

```dotenv
SMTP_HOST=...
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=...
SMTP_PASS=...
MAIL_FROM="UNISON <no-reply@<conta>.alwaysdata.net>"
```

Use um provedor SMTP confiável e configure SPF/DKIM/DMARC se for usar um domínio próprio de email. A alwaysdata oferece caixas de email; consulte o painel para o host SMTP correto da sua conta.

## Passo 7 — Ativar HTTPS

1. No painel, abra o site → **SSL/TLS**.
2. Ative o certificado **Let's Encrypt** para `<conta>.alwaysdata.net`.
3. Ative **Force HTTPS** (redirecionar HTTP para HTTPS).
4. Aguarde a emissão do certificado.

Teste:

```bash
curl -fsS https://<conta>.alwaysdata.net/health
```

Resposta esperada:

```json
{"status":"ok","service":"unison-server","version":"1.0.0","database":"ok","timestamp":"..."}
```

Se retornar 502/503, veja os logs do site no painel e confira o comando, o diretório de trabalho, a versão do Node e o `npm ci`.

## Passo 8 — Primeiro acesso e teste de persistência

1. Abra `https://<conta>.alwaysdata.net`.
2. Crie a primeira conta.
3. Crie um Space/canal, envie uma mensagem e anexe um arquivo pequeno.
4. Recarregue a página e confirme que os dados continuam.
5. No painel, reinicie o site (**Web → Sites → Restart**).
6. Abra de novo e confirme que conta, mensagens e upload continuam.

Se o anexo falhar, verifique:

- espaço livre na conta (`df -h`);
- permissão de escrita em `~/unison/server/uploads`;
- `MAX_UPLOAD_MB` e o limite do proxy da alwaysdata.

## Passo 9 — Conectar o aplicativo Windows

No computador do usuário, edite:

```text
%APPDATA%\UNISON\desktop-config.json
```

Adicione `serverUrl` mantendo o `jwtSecret` existente:

```json
{
  "jwtSecret": "<valor-que-já-existe>",
  "serverUrl": "https://<conta>.alwaysdata.net"
}
```

Reinicie o UNISON. O app passa a carregar o servidor remoto. **Não há fallback para o banco local**: se o servidor estiver fora do ar, o app não abre uma cópia local.

Teste com duas máquinas/contas diferentes:

1. Crie uma conta na máquina A.
2. Entre com a mesma conta na máquina B.
3. Envie uma mensagem em uma conversa e confirme que aparece nos dois lados.

> O banco local de quem já usava o modo standalone **não é migrado automaticamente** para o servidor. O modo remoto começa com as contas e conversas do servidor. Se precisar migrar dados locais, isso exige um procedimento manual de exportação/importação que não está implementado nesta versão.

### Smoke test opcional do desktop

O executável aceita smoke test remoto:

```powershell
$env:UNISON_SMOKE_REMOTE = "1"
$env:UNISON_SERVER_URL = "https://<conta>.alwaysdata.net"
$env:UNISON_USER_DATA = "$env:TEMP\unison-alwaysdata-smoke"
& "C:\Program Files\UNISON\UNISON.exe" --smoke-test
Get-Content "$env:UNISON_USER_DATA\smoke-result.json"
```

Atenção: o smoke test cria um usuário de teste no banco de produção. Use um banco de staging ou remova o usuário depois.

## Atualizações

1. Faça backup do banco e dos uploads.
2. Gere um pacote novo com `scripts/prepare-alwaysdata.ps1`.
3. Envie o zip novo por `scp`.
4. No servidor, extraia **sobre** a pasta existente, sem apagar `data`, `uploads` e `.env`:

```bash
cd ~/unison
unzip -o ~/UNISON-alwaysdata-<versao>.zip
cd server
npm ci --omit=dev
```

5. Reinicie o site no painel.
6. Verifique `/health`, login e uma conversa.

As migrations são aplicadas no boot. Leia as migrations novas e faça backup antes de atualizar. Não use `rm -rf ~/unison` em uma atualização.

## Backup e restauração

A alwaysdata mantém 3 dias de backup, mas mantenha uma cópia externa.

Com o site **parado** no painel, baixe o banco e os uploads:

```powershell
scp <usuario-ssh>@ssh-<conta>.alwaysdata.net:~/unison/server/data/unison.db* .\backup\
scp -r <usuario-ssh>@ssh-<conta>.alwaysdata.net:~/unison/server/uploads .\backup\
```

Com o site rodando, use o backup consistente do SQLite, se o `sqlite3` estiver disponível:

```bash
sqlite3 ~/unison/server/data/unison.db ".backup '$HOME/backups/unison-$(date +%F).db'"
```

Depois baixe o arquivo gerado. Para restaurar:

1. Pare o site.
2. Preserve o banco atual.
3. Copie o backup para `~/unison/server/data/unison.db`.
4. Garanta que `uploads/` corresponde ao backup.
5. Inicie o site e valide `/health`, login e uma conversa.

Detalhes adicionais: [DATABASE.md](DATABASE.md).

## Solução de problemas

### 502 Bad Gateway / site não sobe

- Confirme o comando: `node /home/<conta>/unison/server/index.js`.
- Confirme o diretório de trabalho: `/home/<conta>/unison/server`.
- Confirme `NODE_ENV=production`, `JWT_SECRET` com 32+ caracteres e `npm ci --omit=dev` concluído.
- Veja os logs do site no painel.
- Teste o processo manualmente por SSH:

```bash
cd ~/unison/server
NODE_ENV=production JWT_SECRET="<segredo>" DATABASE_PATH=./data/unison.db UPLOAD_DIR=./uploads node index.js
```

### Página em branco

- Confirme `~/unison/client/dist/index.html`.
- Rode o build novamente e reenvie o pacote.
- Verifique se o site está servindo a raiz e não um diretório estático separado.

### Login não persiste / loop de login

- `COOKIE_SECURE=true` exige HTTPS; acesse pela URL `https://`, não por HTTP.
- `CORS_ORIGINS` e `APP_URL` devem ser exatamente `https://<conta>.alwaysdata.net`, sem barra no final.
- `TRUST_PROXY=true` é necessário atrás do proxy da alwaysdata.
- Limpe cookies antigos do domínio e tente novamente.

### Upload falha

- Verifique espaço em disco e permissões de `uploads/`.
- Reduza `MAX_UPLOAD_MB` se necessário.
- Confirme que o proxy da alwaysdata aceita o tamanho do arquivo.

### WebSocket não conecta

A alwaysdata documenta suporte a WebSocket, mas o Socket.IO também funciona com fallback para HTTP long-polling. Se o tempo real estiver estranho, verifique os logs e a aba Network do navegador. Para muitas conexões simultâneas, o plano Free de 256 MB pode ser o limitante.

### Aviso do `node:sqlite`

O Node 24 pode emitir um aviso de módulo experimental. Isso é esperado e não impede o funcionamento.

### Conta suspensa por inatividade

Entre no painel da alwaysdata periodicamente. No plano Free, contas inativas podem ser suspensas (a cada 120 dias no primeiro ano, depois em intervalos maiores). Basta fazer login para reativar.

## Segurança

- `JWT_SECRET` aleatório, com 32+ caracteres, fora do Git.
- `COOKIE_SECURE=true`, `TRUST_PROXY=true`, `CORS_ORIGINS` e `APP_URL` exatos.
- `EXPOSE_DEV_TOKENS=false` em produção.
- `chmod 600` no `.env`, se usar arquivo.
- Mantenha Node e dependências atualizados; rode `npm audit --omit=dev`.
- Não sirva o banco nem a pasta `data/` publicamente.
- Faça backups externos e teste a restauração.
- Se o UNISON for comercial, não use o plano Free: contrate o Plus ou migre para Oracle/VPS.

## Quando crescer

O plano Free é para validação e times pequenos. Se precisar de mais RAM, CPU, disco ou domínio próprio:

- **alwaysdata Plus:** a partir de €5/mês (sem IVA), com mais disco/RAM e domínio próprio.
- **Oracle Always Free:** VPS com até 2 OCPU ARM/12 GB, mas exige cartão/CPF para verificação e administração de Linux.
- **VPS pago:** mais controle, mas com custo mensal.

O código é single-node; para escala horizontal, migre para PostgreSQL + Redis + storage de objetos, conforme [DEPLOYMENT.md](DEPLOYMENT.md).

## Status desta validação

O pacote de deploy, a estrutura `server/ + client/dist/` e o servidor em `NODE_ENV=production` foram validados localmente com `scripts/smoke-alwaysdata.ps1`: `/health`, SPA, service worker, registro, login, refresh cookie, `/me`, SQLite e uploads passaram. O cookie `Secure`/`HttpOnly`/`SameSite=Lax` também foi verificado com `COOKIE_SECURE=true`.

**Deploy executado em 18/11/2026:**

- chave `unison_deploy` cadastrada; SSH por chave validado;
- `UNISON-alwaysdata-1.0.0.zip` enviado e extraído em `~/unison`;
- `npm ci --omit=dev` concluído (117 pacotes, 0 vulnerabilidades);
- `server/.env` criado com `NODE_ENV=production`, `JWT_SECRET` de 96 caracteres, `COOKIE_SECURE=true`, `TRUST_PROXY=true`, `APP_URL`/`CORS_ORIGINS` em `https://telawork.alwaysdata.net`;
- pastas `data/` e `uploads/` criadas com permissão `700`;
- site Node.js 24 ativo, servindo `https://telawork.alwaysdata.net` (substituiu o Apache padrão);
- desktop configurado com `serverUrl: https://telawork.alwaysdata.net` (backup local em `desktop-config.json.bak-local`).

**Smoke test remoto aprovado:** `/health`, SPA, service worker, manifest, asset JS, registro de dois usuários, login, cookie `Secure`/`HttpOnly`/`SameSite=Lax`, refresh, `/me`, DM, mensagem entre usuários, Socket.IO com dois clientes, `call:start`/`call:incoming`, `call:accept`, `webrtc:signal`, `call:leave`, `call:ended` e upload/download de arquivo. Os usuários e o arquivo de teste foram removidos depois.

**Atualização do frontend 1.0.1 (18/11/2026):** o novo `client/dist`, com áudio no compartilhamento de tela e janela de chamada flutuante/minimizável, foi enviado por `tar`/`scp` e trocado atomicamente em `~/unison/client/dist`. O diretório anterior ficou em `~/unison/client/dist.old-20261118202035` para rollback. A raiz passou a servir `assets/index-CdvLNs3a.js` e `assets/index-BINJmH_D.css`; `/health`, o JS novo e o CSS responderam HTTP 200. Nenhum arquivo de `server/data` ou `server/uploads` foi alterado.

**Pendências reais:**

- O campo **Working directory** do site está com o caminho duplicado (`/home/telawork/home/telawork/unison/server`). O site está funcionando por um symlink temporário criado em `~/home/telawork/unison/server`. Corrija o campo para `unison/server` e depois remova o symlink.
- **Force HTTPS** ainda não está ativado: `http://telawork.alwaysdata.net/health` responde `200` em vez de redirecionar. Ative em **Web → Sites → Modificar site → SSL → Force HTTPS**.
- A sinalização de chamadas foi validada, mas **mídia real** (câmera/microfone, duas máquinas, NAT) ainda não foi testada.
- SMTP não configurado: emails de verificação/recuperação ficam apenas no log do servidor.
- Backup externo e teste com duas máquinas ainda pendentes.

O GitHub também está publicado: código em `main` e release [v1.0.1](https://github.com/ROD8Rodrigues/UNISON/releases/tag/v1.0.1) com instalador, portátil e checksums. A [v1.0.0](https://github.com/ROD8Rodrigues/UNISON/releases/tag/v1.0.0) permanece disponível como versão anterior.

### Chave SSH de deploy

A chave pública `unison_deploy` já está cadastrada em **Remote access → SSH/SFTP → Chaves SSH** e a conexão por chave foi validada:

```text
ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIIJ9VIXMpBW9IWk26KI4H0RNS1HrrTjOoUsqFawnyFrY unison-deploy
```

Fingerprint: `SHA256:OSa2y/A+kqAY95l0ynjeb6vAKVRbOugNkXk/fVAEWCo`. A chave privada fica em `C:\Users\Chris\.ssh\unison_deploy` e nunca deve ser versionada.

### Se o prompt SSH não aceitar a senha

O terminal do OpenSSH no Windows pode não exibir a senha enquanto você digita (isso é normal), mas se a autenticação falhar:

1. use o **terminal web** da alwaysdata em **Remote access → SSH/SFTP → Terminal**;
2. envie o zip por **WinSCP/FileZilla** em SFTP (host `ssh-telawork.alwaysdata.net`, porta 22) e execute `npm ci` pelo terminal web;
3. ou cadastre uma **chave SSH pública** no painel e conecte sem senha;
4. como última alternativa, use o gerenciador de arquivos do painel para enviar o zip e editar `server/.env`.

Nunca envie a senha em arquivos, issues ou commits.

## Checklist

- [x] Conta alwaysdata Free criada (`telawork`).
- [x] Pacote gerado com `scripts/prepare-alwaysdata.ps1`.
- [x] Usuário SSH criado (`telawork`).
- [x] Chave pública `unison_deploy` cadastrada no painel alwaysdata.
- [x] Conexão SSH por chave validada.
- [x] Zip enviado e extraído em `~/unison`.
- [x] `npm ci --omit=dev` concluído em `~/unison/server`.
- [x] Pastas `data/` e `uploads/` criadas.
- [x] Node.js 24 selecionado.
- [x] Site Apache padrão removido/substituído.
- [x] Site Node.js criado e respondendo.
- [ ] Working directory corrigido para `unison/server` no painel.
- [x] Variáveis de ambiente configuradas.
- [x] HTTPS/Let's Encrypt ativo.
- [ ] Force HTTPS ativo.
- [x] `/health` retorna `status: ok`.
- [x] Registro, login, cookie seguro, refresh e `/me` testados.
- [x] Mensagem e upload testados.
- [x] Sinalização de chamada testada (`call:start`, `accept`, `webrtc:signal`, `ended`).
- [ ] Chamada real com câmera/microfone validada.
- [x] Captura de tela com áudio loopback confirmada no smoke do desktop 1.0.1.
- [x] `serverUrl` configurado no desktop.
- [x] Desktop reiniciado e conectado ao servidor remoto.
- [ ] Duas máquinas conectadas à mesma conta.
- [ ] Backup externo configurado.
- [x] Link do instalador publicado no GitHub Releases.
