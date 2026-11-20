# Testes e validação

## Como executar

### Backend

```bash
cd server
npm test
```

Runner: `node:test`, concorrência 1, banco SQLite em memória, uploads em pasta temporária. Rate limits são desativados em `NODE_ENV=test`.

### Frontend

```bash
cd client
npm test          # execução única
npm run test:watch
```

Runner: Vitest + jsdom + Testing Library.

### Qualidade e build

```bash
cd server
npm run lint

cd ../client
npm run lint
npm run typecheck
npm run build
```

### Aplicativo desktop (Windows)

```powershell
cd client
npm run build

cd ..\desktop
npm ci
npm run check
npm run pack

$env:UNISON_USER_DATA = "$env:TEMP\unison-smoke"
.\release\win-unpacked\UNISON.exe --smoke-test
Get-Content "$env:UNISON_USER_DATA\smoke-result.json"
```

Para gerar instalador e portátil: `cmd /c "npm run dist"`. O smoke test também pode ser executado no portátil e no app instalado. Detalhes e caminhos em [DESKTOP.md](DESKTOP.md).

## Resultado da última execução

Data: **19/11/2026** (horário local).

| Verificação | Resultado |
| --- | --- |
| Backend — lint | ✅ sem erros |
| Backend — testes | ✅ 20/20 |
| Frontend — lint | ✅ sem erros |
| Frontend — typecheck | ✅ sem erros |
| Frontend — testes | ✅ 15/15 |
| Frontend — build | ✅ concluído |
| Desktop — checagem sintática | ✅ sem erros |
| Desktop — smoke 1.2.0 empacotado e portátil | ✅ execuções anteriores |
| Desktop — `smoke:voice` | ✅ dock/HUD com mídia falsa |
| Desktop — modo remoto | ✅ (contra backend local) |
| `npm audit --omit=dev` server | ✅ 0 vulnerabilidades |
| `npm audit` client | ⚠️ 12 alertas dev-only de `picomatch` (CVE-2026-112366, sem patch publicado) |
| `npm audit` desktop | ⚠️ 9 alertas dev-only de `picomatch` (CVE-2026-112366, sem patch publicado) |

Build de produção observado em 1.2.0:

- JS: ~577 kB (163 kB gzip)
- CSS: ~131 kB (23 kB gzip)
- Aviso não fatal do Vite sobre chunk > 500 kB

## Validação do pacote alwaysdata (registro histórico)

O pacote **1.1.0** foi gerado, testado localmente e publicado na conta `telawork` em 18/11/2026. O novo `client/dist` já está no ar; os arquivos do servidor foram trocados e a migration `003_voice_channels.sql` está presente. Este trecho registra aquela execução.

Em **19/11/2026**, o bundle e o backend **1.2.0** foram publicados com backup, o site foi reiniciado, `/health` passou a responder `1.2.0`, o transporte ativo ficou `sendmail:/usr/sbin/sendmail` e a entrega externa de email foi validada (mail.tm + Mail-Tester 6/10). Consulte [KNOWN_LIMITATIONS.md](KNOWN_LIMITATIONS.md).

```powershell
# gera deploy/UNISON-alwaysdata-1.1.0.zip
powershell -ExecutionPolicy Bypass -File .\scripts\prepare-alwaysdata.ps1

# extrai o zip, sobe o servidor em NODE_ENV=production e testa os fluxos
powershell -ExecutionPolicy Bypass -File .\scripts\smoke-alwaysdata.ps1 -ZipPath .\deploy\UNISON-alwaysdata-1.1.0.zip
```

| Verificação | Resultado |
| --- | --- |
| Backend — testes | ✅ 17/17 |
| Frontend — testes | ✅ 13/13 |
| Pacote `server/ + client/dist/` | ✅ 0,97 MiB (1.019.282 bytes) |
| SHA-256 do zip | `61a96f7ef354910c6e9b41197176eaf1a0e560d21e4abf71423e8c358039d9c4` |
| Layout de produção (`NODE_ENV=production`) | ✅ |
| `/health` com SQLite | ✅ `status: ok` |
| SPA, service worker e assets 1.1.0 | ✅ HTTP 200 |
| Registro, login, refresh e `/me` | ✅ |
| Cookie `Secure`/`HttpOnly`/`SameSite=Lax` | ✅ verificado com `COOKIE_SECURE=true` |
| Migration 003 de canais de voz | ✅ presente e aplicada na inicialização |
| Backup remoto antes do deploy | ✅ `~/backups/unison-20261118-204148.tgz` |

O smoke test usa um banco temporário e não toca em `server/data` nem em `server/uploads`. A conta real da alwaysdata já existe, mas a validação em produção (upload, site Node.js, Let's Encrypt e `https://telawork.alwaysdata.net`) ainda não foi executada neste ambiente; o site Apache padrão continua ativo.

## Cobertura do backend (20 testes)

### API (`server/test/api.test.js` — 15 testes)

1. Healthcheck, headers de segurança e formato de resposta.
2. Registro rejeita senha fraca, duplicidade e nomes reservados.
3. Login resiste a injeção SQL e rejeita credenciais inválidas.
4. Endpoints protegidos exigem sessão viva.
5. Verificação de email consome token de uso único.
6. Reenvio com falha de transporte preserva o token anterior e descarta o novo.
7. Toggles de configuração persistem e retornam booleanos normalizados.
8. Refresh rotaciona cookie opaco e valida origem.
9. Logout revoga o access token imediatamente.
10. Troca de senha revoga outras sessões e rotaciona credenciais.
11. Reset de senha usa token de uso único e revoga sessões.
12. Pedidos de amizade podem ser aceitos e geram notificações.
13. DMs suportam edição, reações, fixação, busca e recibos de leitura.
14. Spaces aplicam papéis, canais privados, convites (inclusive link personalizado), canais de voz e banimentos.
15. Uploads rejeitam tipos perigosos e neutralizam nomes com traversal.

### Realtime (`server/test/realtime.test.js` — 5 testes)

1. Mensagem em tempo real, digitação e isolamento de salas.
2. Atualização de perfil chega a conversas compartilhadas sem `lastSeen` e sem alcançar usuários não relacionados.
3. Sinalização de chamada chega aos participantes e encerra na ordem correta.
4. Canais de voz expõem presença (entrar, segundo participante, sair e encerrar).
5. Logout revoga o socket ativo e bloqueia reutilização do token.

## Cobertura do frontend (15 testes)

### `src/lib/utils.test.ts` — 9 testes

- Iniciais, tamanho de arquivo, duração de chamada.
- Detecção de imagem/vídeo/áudio por MIME.
- Rótulos/cores de presença.
- Fallback de nome, truncamento e classes condicionais.
- Agrupamento de reações preservando contagem e usuários.

### `src/components/chat/MessageItem.test.tsx` — 4 testes

- Autor, texto escapado, links e menções.
- Reações agrupadas com contagem e estado do viewer.
- Recibo de leitura apenas para o remetente.
- Ausência de controles de remetente em mensagem de terceiros.

### `src/store/app.test.ts` — 1 teste

- Sincronização de nome/avatar atualizados em amigos, membros de conversa e mensagens já carregadas.

### `src/components/calls/CallOverlay.test.tsx` — 1 teste

- O sink de áudio remoto permanece montado no dock compacto e após expandir a chamada, sem duplicar o elemento de áudio.

## Smoke test de produção

Executado com `NODE_ENV=production` em porta isolada, banco temporário e build real:

| Verificação | Resultado |
| --- | --- |
| `GET /health` | 200, banco `ok` |
| `GET /` | 200, HTML pt-BR |
| Fallback de SPA (`/app/friends`) | 200, entrega `index.html` |
| `GET /sw.js` | 200, `Cache-Control: no-cache`, `Service-Worker-Allowed: /` |
| `GET /manifest.webmanifest` | 200, `application/manifest+json` |
| Asset com hash | 200, `max-age=31536000, immutable` |
| Rota de API inexistente | 404 JSON |
| Registro e login | 201/200 |
| `/api/auth/me` autenticado | 200 |
| Cookie de refresh | `HttpOnly; Secure; SameSite=Lax; Path=/api/auth` |
| Token de verificação em produção | não exposto |

## Validação do aplicativo desktop (Windows)

Data: **17/11/2026** (horário local). Ambiente: Windows 10 22H2 x64, Node 26.13.0 no host, Electron 45.3.3 com Node 24.22.3 embutido e `node:sqlite` funcional.

| Cenário | Resultado |
| --- | --- |
| Electron em desenvolvimento (`--smoke-test`) | ✅ backend embutido, tela de login, registro e `/me` |
| Build `win-unpacked` empacotado | ✅ |
| Executável portátil | ✅ |
| Instalador NSIS com `/S /D=...` | ✅ instalação silenciosa, `exit 0` |
| App instalado | ✅ smoke completo, `exit 0` |
| Migração automática de `%APPDATA%\Telawork` | ✅ banco, config e uploads copiados sem alterar a pasta antiga |
| Migração 002 (`#C5F812` → `#C9A0DC`) | ✅ accent e cor de papel convertidos |
| Duas inicializações com o mesmo perfil | ✅ 4 usuários e 4 sessões preservados; JWT de 64 caracteres mantido |
| Desinstalação silenciosa | ✅ pasta e atalhos removidos |
| Modo remoto contra `http://127.0.0.1:60000` | ✅ interface + `/health`; `desktop-config.json` com BOM aceito |
| Captura real da tela de login | ✅ `smoke-screenshot.png` conferido visualmente |
| `npm audit` desktop | ⚠️ 9 alertas dev-only de `picomatch` sem patch; não incluído no `.exe` |

O smoke do build empacotado validou, dentro do renderer:

- registro via `fetch` no contexto da janela: HTTP 201;
- `POST /api/auth/refresh`: HTTP 200;
- `GET /api/auth/me`: HTTP 200;
- cookie `unison_refresh` com `HttpOnly=true`, `Secure=false` (loopback), `SameSite=Lax`, `Path=/api/auth`;
- interface React na rota `/login`, com o layout escuro/neon renderizado.

O modo local foi validado com banco temporário. O modo remoto foi validado apenas contra backend local em HTTP; não houve teste com DNS/TLS públicos nem entre dois computadores.

Artefatos da versão 1.1.0:

| Arquivo | Tamanho | SHA-256 |
| --- | --- | --- |
| `UNISON-Setup-1.1.0.exe` | 118.480.712 bytes | `ffac10ae75b31da3742b6329280adf5cad4bcdecd587ec4865f1df080fdf5fef` |
| `UNISON-Portable-1.1.0.exe` | 105.956.579 bytes | `9f43e8e0f596116fa1dbddb2fd6a27b011bc6b0c32294f43c85344967ac5ff4a` |

No smoke do `win-unpacked` e do portátil 1.1.0, além dos itens acima, `getDisplayMedia({ video: true, audio: true })` retornou 1 faixa de vídeo e 1 faixa de áudio com rótulo `System audio` (loopback do Electron).

Os executáveis estão **`NotSigned`**: assinatura Authenticode, reputação de SmartScreen, upgrade e Windows 11/ARM64 não foram validados.

## O que **não** está coberto por automação

- Chamadas com mídia real, permissões de câmera/microfone e transmissão de tela entre participantes; o áudio remoto no dock foi corrigido, mas ainda não validado com duas contas/dispositivos.
- Compatibilidade entre navegadores reais e sistemas operacionais.
- Entrega em caixa de entrada do Gmail/Outlook e reputação de longo prazo; a entrega externa em mail.tm e o relatório Mail-Tester 6/10 foram validados.
- Instalação/execução da PWA em Android/iOS; no desktop, a distribuição validada é o `.exe`, não a instalação PWA.
- Assinatura de código, reputação de SmartScreen, upgrade/downgrade e auto-update do aplicativo Windows.
- Windows 11, Windows ARM64, macOS e Linux.
- Uso simultâneo entre dois computadores no servidor remoto; o deploy HTTPS e os fluxos HTTP foram validados.
- Mídia real e notificações nativas dentro do Electron.
- Testes end-to-end de UI em navegador (Playwright/Cypress).
- Carga, estresse, soak test e múltiplas instâncias.
- Testes de acessibilidade formais (WCAG).
- Antivírus/varredura de uploads.
- Matriz de dispositivos móveis.

Esses itens estão nas [limitações conhecidas](KNOWN_LIMITATIONS.md).

## Sugestão de CI

```yaml
name: ci
on: [push, pull_request]
jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
      - run: npm ci
        working-directory: server
      - run: npm run lint
        working-directory: server
      - run: npm test
        working-directory: server
      - run: npm ci
        working-directory: client
      - run: npm run lint
        working-directory: client
      - run: npm run typecheck
        working-directory: client
      - run: npm test
        working-directory: client
      - run: npm run build
        working-directory: client
```

Use Node ≥ 22.5; o exemplo acima usa 24. Adicione `npm audit --omit=dev` e um smoke test com o build em passos separados.

Para o desktop, adicione um job em `windows-latest` que gere `client/dist`, execute `npm ci` e `npm run dist` em `desktop/`, rode o smoke no `win-unpacked`, publique os `.exe` e gere o `SHA256SUMS.txt`. Assinatura Authenticode exige um certificado em segredo de CI e não está configurada.

## Critérios de aprovação antes de release

1. Lint, typecheck, testes e build verdes.
2. `npm audit --omit=dev` sem vulnerabilidades de runtime; advisories dev-only documentados.
3. Smoke test de produção em HTTPS.
4. Transporte real e entrega externa validados; alinhamento SPF/DKIM e caixas Gmail/Outlook pendentes.
5. TURN validado entre duas redes.
6. Chamada de áudio/vídeo testada em pelo menos dois dispositivos reais.
7. Backup e restauração testados.
8. Revisão de headers, CORS e cookies no domínio final.
9. Smoke test do desktop no build empacotado, portátil e instalado, com checksums publicados.
10. Aviso de SmartScreen comunicado aos usuários ou binários assinados com certificado Authenticode.
