# UNISON

Plataforma de comunicação em tempo real para conversas diretas, grupos, comunidades (Spaces), canais e chamadas de áudio/vídeo. Interface web responsiva, preparada para instalação como PWA, com identidade escura e neon `#C9A0DC`, disponível em desktop, tablet e celular pelo navegador. Também é distribuída como aplicativo Windows (`.exe`) com backend e banco local embutidos.

A marca do UNISON combina o mascote de headset com o wordmark em caixa alta e o accent lilás `#C9A0DC`; os ícones do Windows e da PWA são gerados a partir de `assets/branding/unison-logo.png` por `scripts/make-brand-icons.ps1`.

Este repositório contém a reconstrução de produção do protótipo original: o backend monolítico em NeDB foi substituído por uma API Express modular com SQLite, e o frontend React foi implementado do zero. O protótipo original permanece preservado em `server/legacy/`.

## Estado atual

- **Backend:** API REST + Socket.IO implementados, com autenticação, sessões, mensagens, comunidades, moderação, uploads, notificações e chamadas.
- **Frontend:** aplicação React completa, responsiva, com tema escuro/neon, PWA e fluxos reais ligados à API.
- **Aplicativo Windows:** instalador NSIS e executável portátil x64 com Electron, backend e SQLite embutidos; dados em `%APPDATA%\UNISON`; modo local isolado e modo servidor remoto opcional.
- **Testes automatizados:** 16 testes de API/realtime no servidor e 13 testes de frontend, todos passando.
- **Qualidade:** lint e typecheck limpos nos dois projetos; build de produção concluído; `npm audit --omit=dev` do servidor com 0 vulnerabilidades. O cliente e o desktop reportam um advisory **dev-only** de `picomatch` (ReDoS, CVE-2026-112366) sem versão corrigida publicada; o pacote não entra no runtime do servidor nem nos `.exe`.
- **Smoke test de produção:** SPA, service worker, manifest, cache de assets, Cookie de refresh seguro, registro/login e 404 JSON validados.
- **Smoke test do desktop:** build empacotado, portátil e instalado validados com interface real, registro, sessão, refresh cookie e captura de tela; modo remoto testado contra backend local.

O escopo validado neste ambiente, as limitações reais e o que depende de infraestrutura externa estão detalhados em [Limitações conhecidas](docs/KNOWN_LIMITATIONS.md).

## Funcionalidades

### Conta e segurança
- Registro, login por usuário ou email, logout.
- Sessões por dispositivo com lista, revogação individual e revogação das outras sessões.
- Access token JWT curto (15 min) e refresh token opaco com rotação (30 dias).
- Troca de senha, redefinição por email e verificação de email com tokens de uso único.
- Perfil, bio, status personalizado, avatar, banner, presença e exclusão de conta.
- Bloqueio de usuários, configurações de privacidade e preferências de notificação.

### Conversas
- Mensagens diretas e grupos.
- Histórico paginado por cursor, busca por texto, edição e exclusão.
- Anexos de imagem, áudio, vídeo, PDF, texto, zip e documentos do Office.
- Reações com emoji, respostas, mensagens fixadas e menções.
- Recibos de leitura, indicador de digitação, presença em tempo real e notificações.
- Silenciar, ocultar e sair de conversas; gerenciamento de membros e papéis de grupo.

### Comunidades (Spaces)
- Criação de espaços públicos ou privados, descoberta e entrada por convite.
- Canais públicos e privados, categorias, tópicos e ordenação.
- Funções com permissões granulares, herança e hierarquia.
- Convites com expiração e limite de uso, banimentos, remoção de membros e auditoria.
- Sincronização em tempo real de espaços, canais e permissões.

### Chamadas
- Chamadas de áudio e vídeo em DMs e grupos de até 9 participantes.
- Compartilhamento de tela, mudo, câmera e estado de mídia por participante.
- Sinalização WebRTC via Socket.IO com STUN público padrão e TURN opcional por variáveis de ambiente.
- Reconexão de socket e `restartIce` para recuperação de conexão.

> A sinalização e o ciclo de chamada são cobertos por testes automatizados. A validação com mídia real (duas câmeras/microfones e redes distintas) depende de dispositivos e infraestrutura externa e está descrita nas limitações.

### Interface
- Layout responsivo para desktop, tablet e celular.
- Tema escuro, tema meia-noite, cor de destaque configurável, modo compacto e redução de movimento.
- Componentes acessíveis (foco em modais, rótulos, navegação por teclado).
- PWA com manifest, ícones, instalação e shell offline.

## Stack

| Camada | Tecnologia |
| --- | --- |
| Backend | Node.js ≥ 22.5, Express 5, Socket.IO 4 |
| Banco | SQLite via `node:sqlite` (built-in), migrations SQL |
| Autenticação | bcryptjs (cost 12), JWT, refresh token opaco com hash SHA-256 |
| Validação | Zod 4 |
| Upload | Multer 2 com allowlist de MIME e limite de tamanho |
| Email | Nodemailer 10 (SMTP opcional) |
| Frontend | React 19, TypeScript 5.9, Vite 8, React Router 7, Zustand 5 |
| Desktop | Electron 45.3.3, electron-builder 26.18.0 (Windows x64) |
| Estilo | CSS próprio com design tokens |
| Testes | `node:test` + Socket.IO client / Vitest + Testing Library |
| Qualidade | ESLint 10 + typescript-eslint, TypeScript strict |

## Início rápido

Pré-requisitos: **Node.js 22.5 ou superior** (validado com Node 26.13) e npm 11.

### 1. Servidor

```bash
cd server
npm install
cp .env.example .env      # no Windows: copy .env.example .env
npm run dev
```

O servidor inicia em `http://localhost:60000` e cria o SQLite e a pasta de uploads automaticamente.

### 2. Cliente

Em outro terminal:

```bash
cd client
npm install
npm run dev
```

Abra `http://localhost:5173`. O Vite faz proxy de `/api`, `/uploads` e `/socket.io` para o servidor na porta 60000.

### 3. Primeira conta

Crie uma conta pela tela de registro. Com SMTP desconfigurado, o link de verificação é gravado no log do servidor e, em desenvolvimento, o token também pode ser exposto pela API (`EXPOSE_DEV_TOKENS=true`). Em produção essa exposição é sempre desativada.

## Produção

```bash
# build do frontend
cd client
npm ci
npm run build

# servidor servindo o build e a API
cd ../server
npm ci
NODE_ENV=production \
JWT_SECRET="<segredo-aleatorio-com-32-ou-mais-caracteres>" \
CORS_ORIGINS="https://seu-dominio.example" \
APP_URL="https://seu-dominio.example" \
npm start
```

No PowerShell, defina as variáveis com `$env:NODE_ENV='production'` etc. O servidor serve `client/dist` com fallback de SPA, cabeçalhos de cache para assets e `Service-Worker-Allowed` para o PWA.

Checklist completo, proxy reverso, TLS, systemd, SMTP, TURN e backup: [Deploy](docs/DEPLOYMENT.md).

### Hospedagem gratuita (sem cartão e sem CNPJ)

- **Instalador para download:** o `.exe` é um arquivo estático e não precisa de servidor. O guia [Publicar no GitHub Releases](docs/PUBLISH_GITHUB.md) usa o plano gratuito do GitHub, sem CNPJ, com até 2 GiB por arquivo e sem limite de banda.
- **Web/backend multiusuário:** o guia [Deploy gratuito na alwaysdata](docs/DEPLOY_ALWAYSDATA.md) publica frontend, API, Socket.IO, SQLite e uploads em `https://<conta>.alwaysdata.net`, com Node.js 24 e HTTPS, sem cartão. O plano Free é para uso pessoal/não comercial e tem 1 GB de disco e 256 MB de RAM.
- **Alternativas:** Suga Free (container, sem cartão), Oracle Always Free (VPS, exige cartão/CPF para verificação) e PC próprio com Tailscale Funnel. Comparativo e limitações em [Limitações conhecidas](docs/KNOWN_LIMITATIONS.md).

## Aplicativo Windows (.exe)

Artefatos da versão **1.0.0** em `desktop/release/`:

| Arquivo | Tamanho | Uso |
| --- | --- | --- |
| `UNISON-Setup-1.0.0.exe` | 112,99 MiB | Instalador por usuário, com atalhos e desinstalador |
| `UNISON-Portable-1.0.0.exe` | 101,05 MiB | Executável portátil, sem instalação |

Checksums SHA-256:

```text
5b5e307a8031c50bb7a8045a8e9476e3cc3dedc91a5f4bf141be8dda2e06f6db  UNISON-Setup-1.0.0.exe
2f9902194efd55990c0c46067955d31b322c89fd0afbae355d5f538b31b2ceca  UNISON-Portable-1.0.0.exe
```

- **Instalador:** execute e siga o assistente. Instala sem exigir Node.js e cria atalhos na área de trabalho e no menu Iniciar.
- **Portátil:** execute diretamente. Ele se extrai para temporários a cada abertura, mas os dados continuam em `%APPDATA%\UNISON`.
- **Dados:** banco SQLite, uploads e logs em `%APPDATA%\UNISON`. Desinstalar não apaga essa pasta.
- **Modo local (padrão):** backend embutido em `127.0.0.1`, sem acesso pela rede. Contas e conversas ficam somente naquela máquina.
- **Vários computadores:** publique o backend com HTTPS e defina `serverUrl` em `%APPDATA%\UNISON\desktop-config.json`. O banco local não é sincronizado.
- **SmartScreen:** os executáveis não têm assinatura Authenticode, então o Windows pode exibir aviso de publicador desconhecido. Confira o SHA-256 antes de executar.

Build, configuração remota, segurança, testes e limitações: [Aplicativo desktop](docs/DESKTOP.md).

## Comandos

### Servidor (`server/`)

| Comando | Descrição |
| --- | --- |
| `npm run dev` | Servidor com `node --watch` |
| `npm start` | Servidor em modo normal |
| `npm run lint` | ESLint |
| `npm test` | Testes de API e realtime |
| `npm run import:legacy` | Importa usuários do NeDB legado |

### Cliente (`client/`)

| Comando | Descrição |
| --- | --- |
| `npm run dev` | Vite em `http://localhost:5173` |
| `npm run build` | Typecheck + build de produção |
| `npm run typecheck` | TypeScript sem emitir |
| `npm run lint` | ESLint |
| `npm test` | Vitest (execução única) |
| `npm run preview` | Preview do build |

### Desktop (`desktop/`)

| Comando | Descrição |
| --- | --- |
| `npm ci` | Instala Electron e electron-builder |
| `npm run icon` | Gera o ícone `.ico` multi-resolução |
| `npm run check` | Checagem sintática do processo principal e scripts |
| `npm run pack` | Gera `release/win-unpacked` para teste |
| `npm run dist` | Gera instalador NSIS e portátil em `release/` |
| `npm run smoke` | Smoke test do Electron em desenvolvimento |

O build desktop exige `client/dist` gerado antes e Node.js apenas na máquina de build.

A marca é gerada de forma reproduzível a partir de `assets/branding/unison-logo.png`:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\make-brand-icons.ps1
```

Isso atualiza os ícones da PWA, favicon, logo da interface e `desktop/build/icon.ico`.

## Estrutura do repositório

```
client/                 Frontend React + Vite + PWA
  public/               Manifest, ícones e service worker
  src/
    components/         UI, layout, chat, espaços, chamadas
    pages/              Rotas da aplicação
    store/              Zustand (auth, app, toasts, diálogos)
    lib/                API, socket, tipos e utilitários
    styles/             Tokens e CSS por área
server/                 Backend Express + Socket.IO
  index.js              Entrada
  src/
    routes/             Endpoints REST
    services/           Regras de negócio
    realtime/           Socket.IO, presença e eventos
    db/migrations/      Schema SQLite
    middleware/         Auth, validação, limites e headers
    utils/              Schemas, erros e helpers
  test/                 Testes de API e realtime
  legacy/               Protótipo original preservado
desktop/                Aplicativo Electron para Windows
  main.js               Processo principal, backend embutido e modo remoto
  scripts/              Staging, pós-empacotamento e ícone
  build/                Ícone .ico gerado
  release/              Instalador, portátil e win-unpacked (não versionado)
docs/                   Documentação técnica
```

`mobile/`, `packages/` e `shared/` são resquícios do esqueleto original. O empacotamento nativo móvel (Capacitor/React Native) **não** está implementado; a estratégia móvel validada é a PWA responsiva. O desktop Windows é o único app nativo distribuído.

## Documentação

- [Instalação e configuração](docs/SETUP.md)
- [Aplicativo desktop Windows](docs/DESKTOP.md)
- [Arquitetura](docs/ARCHITECTURE.md)
- [API REST e eventos realtime](docs/API.md)
- [Banco de dados e migrations](docs/DATABASE.md)
- [Testes e validação](docs/TESTS.md)
- [Deploy em produção](docs/DEPLOYMENT.md)
- [Deploy gratuito na alwaysdata](docs/DEPLOY_ALWAYSDATA.md)
- [Publicar no GitHub Releases](docs/PUBLISH_GITHUB.md)
- [Segurança](docs/SECURITY.md)
- [Limitações conhecidas](docs/KNOWN_LIMITATIONS.md)
- [Migração do protótipo legado](docs/MIGRATION.md)

## Segurança

Controles implementados incluem bcrypt cost 12, tokens de sessão revogáveis, rotação de refresh token, cookies `HttpOnly`/`SameSite=Lax` (`Secure` por padrão em produção), proteção de origem no refresh, CORS por allowlist, rate limiting, validação Zod, SQL parametrizado, Helmet/CSP, allowlist de uploads e auditoria de comunidades. No modo local do desktop, o cookie não usa `Secure` porque o Chromium não o envia por HTTP em loopback; o servidor escuta apenas em `127.0.0.1`. Detalhes, riscos residuais e recomendações operacionais estão em [SECURITY.md](docs/SECURITY.md).

## Licença

Nenhuma licença foi definida no repositório original. Antes de distribuir o projeto, defina uma licença com os responsáveis.
