# Aplicativo desktop (Windows)

O UNISON é distribuído para Windows x64 como aplicativo Electron com o backend e o frontend embutidos. O usuário não precisa instalar Node.js, npm ou SQLite: o runtime Node 24.22.3 do Electron executa a API, o `node:sqlite` e o Socket.IO localmente.

> **Escopo validado:** Windows 10 22H2 x64. O aplicativo também deve abrir em Windows 11 x64, mas essa combinação não foi testada neste ambiente. Não há build para ARM64, macOS ou Linux.

## Artefatos gerados

Versão **1.0.1**, em `desktop/release/`:

| Arquivo | Tamanho | Finalidade |
| --- | --- | --- |
| `UNISON-Setup-1.0.1.exe` | 112,99 MiB (118.477.793 bytes) | Instalador NSIS por usuário, com atalhos e desinstalador |
| `UNISON-Portable-1.0.1.exe` | 101,05 MiB (105.957.631 bytes) | Executável portátil, sem instalação |
| `win-unpacked/UNISON.exe` | — | Build não instalado, usado em testes e diagnóstico |
| `SHA256SUMS.txt` | 183 bytes | Checksums SHA-256 dos dois `.exe` |

Checksums da versão 1.0.1:

```text
0aaefa21dcbda1f115e0f89048e322f028cb1277e588c612783fb1f5f10e0286  UNISON-Setup-1.0.1.exe
254d2b90bfb7a96daded31993a65587bbfc98ffcf231870e5fb5ca07e7216056  UNISON-Portable-1.0.1.exe
```

Confira no Windows:

```powershell
Get-FileHash .\UNISON-Setup-1.0.1.exe -Algorithm SHA256
# ou
certutil -hashfile .\UNISON-Setup-1.0.1.exe SHA256
```

Os hashes mudam a cada rebuild, mesmo com o mesmo código. Gere novamente o `SHA256SUMS.txt` após qualquer nova compilação.

O build instalado ocupa aproximadamente **328 MB** em disco (`win-unpacked`). O instalador e o portátil são comprimidos.

## Como usar

### Instalador

1. Execute `UNISON-Setup-1.0.1.exe`.
2. Escolha a pasta (a instalação padrão é por usuário, sem exigir administrador).
3. O instalador cria atalhos na área de trabalho e no menu Iniciar e abre o aplicativo ao final.

Instalação silenciosa, útil em implantação:

```powershell
.\UNISON-Setup-1.0.1.exe /S /D=C:\UNISON
```

O parâmetro `/D` deve ser o último e não é obrigatório. Para desinstalar:

```powershell
& "$env:LOCALAPPDATA\Programs\UNISON\Uninstall UNISON.exe" /S
```

Também é possível desinstalar por **Configurações → Aplicativos → UNISON**. O desinstalador remove a pasta de instalação e os atalhos, mas **não apaga os dados** (`deleteAppDataOnUninstall: false`). Para remover conta, banco e uploads, apague `%APPDATA%\UNISON` com o aplicativo fechado.

### Portátil

Execute `UNISON-Portable-1.0.1.exe` diretamente. Ele se extrai para uma pasta temporária a cada inicialização, então o primeiro início é mais lento que o do aplicativo instalado. Não cria atalhos e não requer instalação.

O portátil **não é portátil em dados**: assim como o instalado, ele grava o banco e os uploads em `%APPDATA%\UNISON`. Para levar os dados em uma pasta removível, defina `UNISON_USER_DATA` antes de abrir:

```powershell
$env:UNISON_USER_DATA = 'E:\UNISONData'
.\UNISON-Portable-1.0.1.exe
```

Isso não criptografa os dados. Use apenas em mídia confiável.

### SmartScreen e assinatura

Os dois executáveis estão **sem assinatura Authenticode** (`NotSigned`). Por isso o Windows pode exibir:

- “O Windows protegeu o computador” (SmartScreen);
- “O Windows não pode verificar o publicador deste software”.

Para prosseguir em uma origem confiável: **Mais informações → Executar assim mesmo**. Não há como eliminar o aviso sem um certificado de code signing reconhecido; a reputação do SmartScreen também depende de volume e tempo. Antes de distribuir, confira o SHA-256 publicado.

## Dados do aplicativo

Caminho padrão: `%APPDATA%\UNISON` (normalmente `C:\Users\<usuário>\AppData\Roaming\UNISON`).

> **Atualização do Telawork:** na primeira execução do aplicativo empacotado, se `%APPDATA%\UNISON\data\unison.db` ainda não existir, o UNISON copia automaticamente `data\telawork.db` (com `-wal`/`-shm`), `uploads` e `desktop-config.json` de `%APPDATA%\Telawork`. A pasta antiga não é alterada. A migração não roda em modo de desenvolvimento, em smoke test nem quando `UNISON_USER_DATA` está definido.

| Caminho | Conteúdo |
| --- | --- |
| `data\unison.db` | Banco SQLite (contas, mensagens, espaços, sessões) e arquivos `-wal`/`-shm` |
| `uploads\` | Anexos enviados |
| `desktop-config.json` | `jwtSecret` gerado no primeiro uso e, opcionalmente, `serverUrl` |
| `logs\desktop.log` | Eventos do processo Electron; rotacionado para `.old` ao passar de 5 MB |
| `logs\server.log` | Saída do backend embutido; mesma rotação |
| `smoke-result.json`, `smoke-screenshot.png` | Apenas quando executado com `--smoke-test` |

O menu **Arquivo** oferece atalhos para abrir as pastas de dados e logs e para abrir o arquivo de configuração. O menu **Ajuda → Sobre** mostra a versão, o modo em uso e os caminhos.

O banco e os uploads **não são criptografados**. A proteção efetiva é a conta do Windows e as permissões NTFS do perfil. Quem tiver acesso ao perfil ou uma cópia da pasta consegue ler os dados. O Chromium também mantém cache, storage e cookies no mesmo perfil; a sessão do app sobrevive a reinícios até logout ou expiração. Em uma conta Windows compartilhada, todos usam o mesmo perfil do UNISON.

### Primeira execução

1. Splash escuro com a marca UNISON.
2. Criação de `%APPDATA%\UNISON`, banco, uploads, logs e `desktop-config.json`.
3. Início do backend embutido em `127.0.0.1` com porta livre aleatória.
4. Abertura da interface.

Tempo observado no ambiente de validação: **4–6 s na primeira execução** e cerca de **1,5 s nas seguintes**. O primeiro início inclui a criação/migração do SQLite e a inicialização do servidor.

## Modos de operação

| Modo | Quando é usado | Onde ficam os dados | Vários computadores? |
| --- | --- | --- | --- |
| **Local (padrão)** | Sem `serverUrl` | `%APPDATA%\UNISON` | Não; isolado por máquina/usuário |
| **Servidor remoto** | `serverUrl` válido em `desktop-config.json` ou `UNISON_SERVER_URL` | No servidor remoto | Sim, se todos apontarem para o mesmo servidor |

### Modo local

- O backend escuta somente em `127.0.0.1`, em porta aleatória; não aceita conexões da rede local.
- Cada conta criada existe apenas naquele perfil do Windows.
- Não há comunicação entre computadores diferentes no modo local.
- O backend roda com `NODE_ENV=production`, mas com `COOKIE_SECURE=false` porque o Chromium não envia cookie `Secure` por HTTP em loopback. O cookie de refresh continua `HttpOnly`, `SameSite=Lax` e restrito a `/api/auth`.
- O segredo JWT é gerado com 48 bytes aleatórios, persistido em `desktop-config.json` e mantém as sessões entre reinicializações.
- Sem SMTP configurado, emails de verificação e redefinição não são entregues. Como `EXPOSE_DEV_TOKENS=false`, o token também não aparece na API. A verificação de email é opcional para usar o app; a redefinição de senha depende de SMTP. Além disso, links de email usariam `http://127.0.0.1:<porta>` e a porta muda a cada execução, então **fluxos por email só são confiáveis no modo remoto**.

### Modo servidor remoto

Para vários usuários conversarem entre computadores diferentes, publique o backend UNISON com HTTPS e aponte o desktop para ele. O servidor precisa:

- servir o build do frontend na raiz (`client/dist`) e a API em `/api` na mesma origem;
- aceitar WebSocket em `/socket.io`;
- responder `GET /health` com `{"status":"ok",...}`;
- usar HTTPS válido fora de loopback (o desktop recusa `http://` para host remoto);
- estar na mesma versão/contrato de API do aplicativo;
- ter banco, uploads e backups no servidor, não no computador do usuário.

Configuração em `%APPDATA%\UNISON\desktop-config.json`:

```json
{
  "jwtSecret": "<gerado automaticamente; não compartilhe>",
  "serverUrl": "https://chat.suaempresa.com"
}
```

Em uma instalação usada somente no modo remoto, `jwtSecret` é ignorado e pode ser omitido; basta `{ "serverUrl": "https://chat.suaempresa.com" }`. O campo é necessário apenas para o backend local.

Regras:

- `serverUrl` deve ser apenas a origem, sem caminho, query ou fragmento.
- HTTP só é aceito para `localhost`, `127.0.0.1` ou `[::1]`.
- Salvar com Bloco de Notas é aceito; BOM UTF-8 é removido na leitura.
- Feche e abra o aplicativo após alterar o arquivo.
- Se o servidor estiver configurado mas indisponível, o app mostra erro e **não** cai silenciosamente para o banco local. Isso evita separar usuários entre dois bancos.
- Ao trocar para remoto, o banco local não é enviado nem migrado. Contas e histórico locais permanecem em `%APPDATA%\UNISON`, separados.

Alternativa por ambiente, útil em testes:

```powershell
$env:UNISON_SERVER_URL = 'https://chat.suaempresa.com'
```

A variável tem precedência sobre `serverUrl`.

Deploy do backend: [DEPLOYMENT.md](DEPLOYMENT.md). O modo remoto foi validado apenas contra um backend local em `http://127.0.0.1:60000`; HTTPS, DNS e TLS reais não foram exercitados neste ambiente.

## Configuração e variáveis do desktop

| Variável | Efeito |
| --- | --- |
| `UNISON_USER_DATA` | Substitui `%APPDATA%\UNISON` como pasta de dados/configuração/logs |
| `UNISON_SERVER_URL` | Força um servidor remoto; precedência sobre `serverUrl` |
| `UNISON_SMOKE_REMOTE` | Com `1`, permite que `--smoke-test` use o servidor remoto configurado |

`UNISON_USER_DATA` não deve apontar para uma pasta compartilhada ou sincronizada por vários computadores: o SQLite não suporta múltiplos processos sobre o mesmo arquivo.

SMTP no modo local é avançado e herdado do ambiente do processo (`SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM`). Como a `APP_URL` é a origem local com porta aleatória, prefira o modo remoto para email real.

## Arquitetura do pacote

```text
UNISON.exe (Electron)
  ├─ processo principal (desktop/main.js)
  │    ├─ cria %APPDATA%\UNISON, carrega/cria jwtSecret
  │    ├─ escolhe porta livre em 127.0.0.1
  │    ├─ fork do backend com ELECTRON_RUN_AS_NODE=1
  │    ├─ health check /health (até 30 s, 3 tentativas)
  │    ├─ BrowserWindow (sandbox, contextIsolation, sem Node)
  │    └─ encerra o backend por IPC antes de sair
  ├─ backend embutido (resources/app/server)
  │    ├─ Express 5 + Socket.IO 4 + node:sqlite
  │    ├─ NODE_ENV=production
  │    ├─ COOKIE_SECURE=false (loopback)
  │    └─ node_modules de produção copiados no afterPack
  └─ frontend (resources/app/client/dist)
       └─ service worker não é registrado dentro do Electron
```

Detalhes operacionais:

- O backend é iniciado com `fork` usando o próprio `UNISON.exe` como executável Node (`ELECTRON_RUN_AS_NODE=1`). Não é necessário Node instalado no cliente.
- O `electron-builder` omitia `node_modules` aninhados em `extraResources`; o hook `desktop/scripts/after-pack.js` copia as dependências de produção após o empacotamento. Sem esse hook o backend falha ao iniciar.
- O app usa instância única: abrir novamente foca a janela existente.
- Fechar a janela encerra o aplicativo e o backend; não há ícone de bandeja nem execução em segundo plano. Notificações não chegam com o app fechado.
- O servidor local usa porta aleatória a cada execução; não é preciso liberar porta no firewall, pois o bind é loopback.
- Logs rotacionam apenas uma vez para `.old`; não há coleta central.
- O processo principal trata exceções com diálogo e registra em `desktop.log`; falha do renderer oferece recarregar ou fechar.

### Segurança do Electron

- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`.
- Navegação para fora da origem do app é bloqueada; links `http`, `https` e `mailto` abrem no navegador padrão.
- `webview` é bloqueada.
- Permissões permitidas apenas para a origem do app: mídia, captura de tela, tela cheia, notificações e escrita de clipboard sanitizada. As demais são negadas.
- Compartilhamento de tela usa o seletor do sistema quando disponível (macOS 15+) ou a primeira tela detectada no Windows; o áudio do sistema é capturado por **loopback** (`audio: 'loopback'`) a partir da 1.0.1. Com vários monitores, o Windows ainda não oferece escolha da tela dentro do app.
- O token de acesso fica em memória no renderer; o refresh continua em cookie `HttpOnly`.
- O `jwtSecret` fica em texto simples em `desktop-config.json`, protegido pelas permissões do perfil do Windows. Não há DPAPI, cofre de credenciais ou criptografia do banco.
- O binário **não é assinado** e não há auto-update/telemetria. Atualizações são feitas instalando uma nova versão sobre a anterior; os dados em `%APPDATA%\UNISON` são preservados.

## Build a partir do código

Pré-requisitos: Windows x64, Node.js ≥ 22.5 e npm. O projeto foi validado com Node 26.13.0 e npm 11.20.0.

```powershell
# 1. Frontend
cd client
npm ci
npm run build

# 2. Desktop
cd ..\desktop
npm ci

# ícone multi-resolução (necessário se desktop\build\icon.ico não existir)
npm run icon

# checagem sintática do processo principal e scripts
npm run check

# instalador NSIS + portátil em desktop\release
cmd /c "npm run dist"
```

Outros comandos:

| Comando | Resultado |
| --- | --- |
| `npm run pack` | Apenas `release\win-unpacked` (mais rápido para testar) |
| `npm run prepare:dist` | Copia servidor/frontend para `desktop/staging` e instala dependências de produção |
| `npm run start` | Abre o Electron em modo desenvolvimento; exige `client\dist` |
| `npm run smoke` | Executa o Electron com `--smoke-test` |
| `npm run icon` | Gera `desktop/build/icon.ico` a partir de `client/public/icon-512.png` |

O `prepare.js` falha de forma explícita se `client/dist/index.html`, `server/package-lock.json` ou o ícone não existirem. O staging não é versionado. O instalador e o portátil são gerados por `electron-builder 26.18.0` com Electron 45.3.3.

Arquivos gerados não devem ser commitados: `desktop/release/`, `desktop/staging/` e `desktop/.dev-data/` estão no `.gitignore`.

## Smoke test

O modo de teste inicia o backend e o renderer reais, oculta a janela, valida a tela inicial (login ou sessão restaurada), registra contas temporárias, testa o cookie de refresh no renderer, captura uma imagem, testa `getDisplayMedia` com áudio e encerra. O resultado fica no diretório de dados:

```powershell
$env:UNISON_USER_DATA = "$env:TEMP\unison-smoke"
Remove-Item -Recurse -Force $env:UNISON_USER_DATA -ErrorAction SilentlyContinue

$p = Start-Process `
  -FilePath 'C:\Users\Chris\Telawork\desktop\release\win-unpacked\UNISON.exe' `
  -ArgumentList '--smoke-test' `
  -Wait -PassThru

"exit=$($p.ExitCode)"
Get-Content "$env:UNISON_USER_DATA\smoke-result.json"
```

Sem `UNISON_USER_DATA`, o smoke usa uma pasta temporária própria e não toca no perfil real.

O resultado contém:

- `mode`: `embedded` ou `remote`;
- `ui`: título, quantidade de nós do React, texto e URL da tela de login;
- `api`: registro e `/api/auth/me` via HTTP;
- `renderer`: registro, refresh e `/me` executados dentro da janela;
- `cookie`: `httpOnly`, `secure`, `sameSite` e `path`;
- `displayMedia`: suporte, quantidade de faixas de vídeo/áudio, rótulo da faixa de áudio ou erro;
- `screenshotBytes` e `smoke-screenshot.png`.

Para testar o modo remoto no smoke:

```powershell
$env:UNISON_USER_DATA = "$env:TEMP\unison-remote-smoke"
$env:UNISON_SMOKE_REMOTE = '1'
# crie desktop-config.json nessa pasta com serverUrl válido
.\UNISON.exe --smoke-test
```

O smoke remoto valida a interface e `/health`; ele não cria contas no banco remoto.

## Validação executada

Data: **17/11/2026** (horário local), Windows 10 22H2 x64.

| Verificação | Resultado |
| --- | --- |
| `server`: lint + 16 testes | ✅ |
| `client`: lint + typecheck + 13 testes + build | ✅ |
| `desktop`: `npm run check` | ✅ |
| Smoke em Electron de desenvolvimento | ✅ |
| Smoke no `win-unpacked` empacotado | ✅ |
| Smoke no portátil | ✅ |
| Instalação silenciosa + smoke do app instalado | ✅ |
| Migração automática de `%APPDATA%\Telawork` | ✅ banco, config e uploads copiados sem alterar a pasta antiga |
| Migração 002 (`#C5F812` → `#C9A0DC`) | ✅ accent e cor de papel convertidos |
| Duas inicializações com o mesmo perfil | ✅ 4 usuários e 4 sessões preservados; JWT de 64 caracteres mantido |
| Desinstalação silenciosa | ✅ pasta e atalhos removidos |
| Smoke remoto (`http://127.0.0.1:60000`) | ✅ interface + `/health`; config com BOM aceito |
| Captura real da tela de login | ✅ conferida visualmente |
| Captura de tela com áudio loopback (1.0.1) | ✅ `win-unpacked`: 1 faixa de vídeo + 1 faixa `System audio` |
| `npm audit` | ⚠️ `server --omit=dev`: 0; `client`/`desktop`: advisory dev-only de `picomatch` sem patch |
| Assinatura Authenticode | ❌ `NotSigned` (sem certificado) |
| Windows 11, ARM64, macOS e Linux | ❌ não testados |
| Servidor remoto com HTTPS/DNS/TLS reais | ❌ não testado (apenas loopback HTTP) |

O teste de duas inicializações confirmou que o banco SQLite e o segredo JWT não são recriados. A desinstalação foi testada com perfil de dados temporário; a preservação do `%APPDATA%\UNISON` real é garantida pela configuração do NSIS, mas não foi exercitada separadamente.

## Limitações e riscos

- **Sem assinatura de código:** SmartScreen e avisos de publicador desconhecido. Não há como remover sem certificado.
- **Somente Windows x64:** não há builds para Windows ARM64, macOS, Linux, Android ou iOS.
- **Sem auto-update:** cada versão precisa ser baixada e instalada manualmente. Não há canal beta, rollback ou verificação criptográfica de update.
- **Modo local é isolado:** contas e conversas existem apenas naquela máquina. Para multiusuário real, use um servidor remoto.
- **Modo remoto sem fallback:** se o servidor cair, o app não usa o banco local. Não há modo offline nem sincronização.
- **Email local limitado:** sem SMTP, verificação e reset não são entregues; com SMTP, links usam porta aleatória e podem expirar ao reiniciar.
- **Dados sem criptografia:** banco, uploads e segredo JWT ficam legíveis no perfil. Não há E2E.
- **Um único processo:** sem suporte a múltiplas instâncias sobre o mesmo SQLite.
- **Mídia real parcialmente validada no desktop:** o smoke do 1.0.1 confirmou captura de tela com faixa de áudio loopback (`System audio`). Permissões de câmera/microfone, chamadas com dois dispositivos e o áudio efetivamente ouvido pelo outro participante ainda não foram exercitados dentro do Electron.
- **Notificações nativas não validadas:** a permissão é concedida, mas o comportamento no Windows e com o app fechado não foi testado.
- **Sem teste em Windows 11/ARM64:** compatibilidade esperada, não comprovada.
- **Instalador NSIS sem testes de upgrade:** instalar por cima deve preservar dados, mas o cenário de downgrade/upgrade não foi automatizado.

Relatório geral: [KNOWN_LIMITATIONS.md](KNOWN_LIMITATIONS.md). Segurança: [SECURITY.md](SECURITY.md).

## Solução de problemas

### O aplicativo não abre e mostra “O servidor local não respondeu”

Abra `%APPDATA%\UNISON\logs\server.log` e `desktop.log`. Causas comuns: pasta de dados sem permissão de escrita, antivírus bloqueando o processo filho, disco cheio ou banco corrompido. Se o banco estiver corrompido, renomeie `data\unison.db` (e os arquivos `-wal`/`-shm`) com o app fechado; isso cria um banco novo, sem os dados antigos.

### SmartScreen bloqueia o instalador

Confira o SHA-256, clique em **Mais informações** e **Executar assim mesmo**. Se o arquivo não vier de uma origem confiável, não execute.

### O modo remoto não conecta

Verifique `serverUrl` (origem sem caminho), HTTPS válido, `/health` acessível no navegador do mesmo computador, WebSocket liberado no proxy e compatibilidade de versão. O app não faz fallback para o modo local.

### Quero apagar todos os dados

Feche o aplicativo e remova `%APPDATA%\UNISON`. Se usou `UNISON_USER_DATA`, remova a pasta indicada.

### O app está lento na primeira abertura

O primeiro início cria/migra o banco e inicia o backend; 4–6 s é o esperado. O portátil também se extrai para temporários a cada execução e pode demorar mais que o instalado.

### Como abrir os logs e a configuração

Menu **Arquivo → Abrir pasta de logs**, **Abrir pasta de dados** ou **Configurar servidor...**. O menu **Ajuda → Sobre** mostra o modo atual e os caminhos.

## Referências

- [Instalação e configuração](SETUP.md)
- [Deploy do backend](DEPLOYMENT.md)
- [Testes e validação](TESTS.md)
- [Segurança](SECURITY.md)
- [Limitações conhecidas](KNOWN_LIMITATIONS.md)
