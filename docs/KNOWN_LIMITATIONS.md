# Limitações conhecidas

Este documento separa o que foi validado do que depende de ambiente externo. A classificação é intencionalmente conservadora.

## Validação de mídia e chamadas

**Status: parcialmente validado.**

- A API de chamadas, o ciclo de participantes, a autorização e a sinalização WebRTC ponta a ponta via Socket.IO estão cobertos por testes automatizados.
- A versão 1.0.1 passou a solicitar a faixa de áudio no compartilhamento de tela (`audio: true`) e o app desktop usa captura **loopback** do Windows; a janela da chamada virou flutuante e minimizável, liberando o chat. Essas correções foram compiladas e publicadas, mas ainda não foram validadas com áudio real entre dois dispositivos.
- Não foi possível validar áudio/vídeo real, permissões de câmera/microfone, compartilhamento de tela e qualidade de rede neste ambiente, pois isso exige dois navegadores/dispositivos com mídia.
- A topologia é **mesh**, limitada a 9 participantes. Não há SFU; CPU, banda e número de conexões crescem quadraticamente.
- O padrão usa STUN público do Google. Sem TURN, chamadas podem falhar em NAT simétrico, redes corporativas e algumas operadoras móveis.
- TURN é configurável no build com credenciais estáticas. Credenciais temporárias (`use-auth-secret`) não estão implementadas.
- `restartIce` e reconexão de socket estão implementados, mas não foram testados em cenários reais de troca de rede.

**Para validar:** dois dispositivos reais, redes distintas, HTTPS, permissões de mídia, TURN configurado, teste de áudio, vídeo, tela, mute, entrada/saída, queda de rede e reconexão.

## Email e SMTP

**Status: implementado, entrega externa não validada.**

- SMTP é opcional. Sem `SMTP_HOST`, o email não é entregue; em desenvolvimento o token aparece na API/log.
- Em produção, tokens não são expostos pela API e o log não inclui o link/token.
- Entrega real, reputação de domínio, SPF/DKIM/DMARC, bounce e limites do provedor não foram testados.
- Não há fila de email, retentativa, template i18n ou tracking.

**Para validar:** configurar SMTP real e testar verificação, reset, expiração, uso único e caixa de spam.

## Aplicativos nativos

**Status: desktop Windows implementado e validado; mobile não implementado.**

### Desktop Windows

- Electron 45.3.3 + electron-builder 26.18.0, Windows x64, instalador NSIS e executável portátil.
- Validado em Windows 10 22H2 x64. Windows 11, Windows ARM64, macOS e Linux não foram testados nem empacotados.
- Os `.exe` **não são assinados** (`NotSigned`). SmartScreen e “publicador desconhecido” podem aparecer; não há como eliminar sem certificado de code signing. Não há auto-update, canal beta, rollback ou telemetria.
- **Modo local (padrão):** backend embutido escutando apenas em `127.0.0.1`, porta aleatória, banco e uploads em `%APPDATA%\UNISON`. Contas e conversas são isoladas por máquina/usuário; não há comunicação entre computadores.
- **Modo remoto:** exige backend UNISON publicado, servindo o frontend na raiz, API em `/api`, Socket.IO e `/health`, com HTTPS fora de loopback. Sem fallback para o banco local se o servidor cair; sem sincronização/offline.
- Banco, uploads e `jwtSecret` ficam **sem criptografia** no perfil do Windows. A proteção é a conta/ACL do Windows; não há DPAPI, cofre de credenciais ou E2E.
- SMTP no modo local é limitado: sem SMTP não há entrega de verificação/reset; com SMTP, os links usam `http://127.0.0.1:<porta aleatória>` e podem deixar de funcionar ao reiniciar. Para email real, use o modo remoto.
- O portátil se extrai para temporários a cada execução, mas **não é portátil em dados**: ainda grava em `%APPDATA%\UNISON` (salvo `UNISON_USER_DATA`).
- Instalação/desinstalação, duas inicializações e modo remoto em loopback foram testados. Upgrade/downgrade, assinatura, Windows 11/ARM64 e uso real entre dois computadores não foram.
- Mídia real (câmera/microfone/tela) e notificações nativas dentro do Electron não foram validadas em chamadas. A partir da 1.0.1 o app pede áudio de tela com `audio: 'loopback'`; o smoke test do build 1.0.1 confirmou a captura com 1 faixa de vídeo e 1 faixa de áudio (`System audio`). O áudio ouvido por outro participante ainda não foi validado.
- O build instalado ocupa aproximadamente 328 MB; o instalador tem ~113 MiB e o portátil ~101 MiB.

Documentação operacional: [DESKTOP.md](DESKTOP.md).

### Mobile e PWA

- A estratégia móvel validada é a **PWA responsiva**; não há Capacitor, React Native, app Android/iOS nem builds de loja.
- Os diretórios `mobile/`, `packages/` e `shared/` são resquícios do esqueleto original.
- Não há publicação em App Store/Play Store, notificações push nativas, deep links universais, biometria ou integração com contatos do sistema.
- Instalação real da PWA em Android/iOS não foi executada neste ambiente, embora manifest, ícones, service worker e headers tenham sido validados em produção.

## Notificações

**Status: parcial.**

- Notificações persistentes e central in-app estão implementadas.
- Notificações desktop usam a API do navegador ou a permissão do Electron enquanto o app está aberto; não há push em background.
- No Electron, a permissão de notificação é concedida para a origem do app, mas o comportamento nativo no Windows não foi validado.
- Não há Web Push (VAPID), push em background, email de resumo ou notificações nativas em app fechado.
- iOS impõe restrições adicionais a PWA e background.

## Uploads e mídia

**Status: funcional, com riscos residuais.**

- Allowlist de MIME, limite de tamanho, nome aleatório e headers seguros estão implementados.
- Não há validação de magic bytes, antivírus, sandbox de renderização, re-encoding de imagens, remoção de EXIF ou moderação automática.
- Arquivos ficam em disco local. Não há S3/object storage, CDN, quota por usuário ou retenção configurável.
- A limpeza remove apenas anexos nunca vinculados após 24 horas; arquivos de mensagens apagadas permanecem no disco.

## Escalabilidade e alta disponibilidade

**Status: single-node.**

- SQLite local, sem replicação.
- Presença, digitação e rate limit em memória.
- Socket.IO sem adapter Redis; eventos não cruzam processos.
- Uploads locais.
- Não há fila, cache distribuído, circuit breaker ou tracing.
- Não execute múltiplas instâncias sobre o mesmo arquivo SQLite.
- Não há testes de carga, soak test ou capacidade documentada.

**Para escalar:** PostgreSQL, Redis, storage de objetos, adapter Socket.IO, busca dedicada e SFU.

## Segurança

**Status: controles implementados, sem pentest externo.**

- Não há 2FA/passkeys, lockout de conta, captcha ou detecção de fraude.
- Enumeração de conta é possível no registro (email/usuário já existe).
- Não há criptografia ponta a ponta; o servidor lê mensagens.
- Não há política formal de retenção, exportação ou exclusão de dados além da exclusão de conta.
- Não há auditoria de segurança independente, SAST/DAST contínuo ou bug bounty.
- CSP permite `style-src 'unsafe-inline'`; scripts permanecem restritos a `'self'`.
- Backups não são criptografados por padrão.
- Logs podem conter IP, user agent, email e assunto; defina retenção e acesso.

Consulte [SECURITY.md](SECURITY.md).

## Funcionalidades de produto ausentes

- Alteração de email com reverificação.
- 2FA, passkeys e códigos de recuperação.
- Mensagens temporárias/autodestrutivas.
- Threads, fóruns e enquetes.
- Tradução de interface (i18n); a UI é pt-BR.
- Busca global avançada e busca full-text indexada.
- Gravação de chamadas, legendas e transcrição.
- Integrações (webhooks, bots, calendário).
- Federação/SSO/SAML.
- Aplicativos móveis nativos e push.
- Painel administrativo global.
- Exportação de dados do usuário.
- Moderação automática de conteúdo.

## Qualidade e testes

**Status: bom para o escopo, não exaustivo.**

- 16 testes de backend e 13 de frontend passam.
- O desktop tem smoke test real no build empacotado, portátil e instalado, mas não há suíte E2E de UI, testes de upgrade ou automação de assinatura.
- Não há testes E2E em navegador, testes de contrato, mutation testing ou testes de acessibilidade formais.
- Não há testes em múltiplos navegadores/SOs, dispositivos móveis reais ou leitores de tela.
- O build emite aviso não fatal de chunk JS > 500 kB; não há code splitting por rota.
- Cobertura de código não foi medida nem imposta.
- O smoke test de produção foi manual/automatizado via HTTP, não com um navegador real.

## Compatibilidade e operação

- Backend/web e build exigem Node ≥ 22.5 por causa de `node:sqlite`; o aplicativo desktop usa o Node 24.22.3 embutido no Electron e não exige Node no cliente.
- O desktop é distribuído apenas para Windows x64 (Windows 10 validado; Windows 11 esperado, não testado).
- Requer navegador moderno com WebRTC, `getDisplayMedia` e service worker para recursos completos.
- Desenvolvimento usa proxy do Vite; produção espera o build em `client/dist` ou configuração equivalente.
- O modo remoto do desktop exige servidor público com HTTPS, `/health`, API, Socket.IO e o frontend servido na raiz. Não há descoberta automática, fallback ou sincronização offline.
- Dados locais do desktop ficam em `%APPDATA%\UNISON` sem criptografia; o portátil também grava nessa pasta por padrão.
- Não há Dockerfile, Helm chart, Terraform ou pipeline de CI incluídos.
- Logs do servidor são JSON em stdout; o desktop grava `desktop.log`/`server.log` com uma rotação para `.old` em 5 MB.
- Não há migrations com rollback automático.
- Não há suporte oficial a Windows Server/IIS além das orientações gerais.
- Não há auto-update, assinatura de código, instalador MSI ou deployment corporativo (Intune/SCCM) pronto.
- O deploy gratuito está ativo na conta alwaysdata Free `telawork`: single-node, 1 GB de disco, 256 MB de RAM, sem domínio próprio e restrito a uso pessoal/não comercial. O `Force HTTPS` do painel ainda não foi ativado; use sempre `https://telawork.alwaysdata.net`.
- O download via GitHub Releases exige conta GitHub e repositório público para acesso anônimo; o instalador continua sem assinatura digital e sujeito ao aviso do SmartScreen.
- Não há migração automática do banco local do desktop (modo standalone) para o servidor remoto; o modo remoto começa com os dados do servidor.

## Itens bloqueados por dependência externa

| Item | Dependência |
| --- | --- |
| Validação real de áudio/vídeo/tela | Dois dispositivos/navegadores com mídia e HTTPS |
| Chamadas confiáveis atrás de NAT restritivo | Servidor TURN (coturn/provedor) |
| Entrega de email | Servidor SMTP e domínio configurado (SPF/DKIM/DMARC) |
| Instalação/publicação mobile | Empacotamento nativo e contas de loja |
| Push em background | Web Push/VAPID ou app nativo |
| Validação de produção em domínio real | DNS, TLS e proxy reverso |
| Assinatura e reputação SmartScreen | Certificado Authenticode e processo de assinatura |
| Auto-update seguro | Servidor de updates, assinatura e política de canais |
| Desktop em Windows 11/ARM64/macOS/Linux | Builds, assinatura e validação nesses alvos |
| Teste de carga realista | Infraestrutura de teste e perfil de tráfego |
| Pentest | Equipe/fornecedor independente |

## O que foi validado de fato

- Backend: lint, 16 testes automatizados, auditoria de dependências, inicialização e smoke test em `NODE_ENV=production`.
- Frontend: lint, typecheck, 13 testes, build de produção, assets PWA servidos com headers corretos.
- Fluxos HTTP: registro, login, refresh com cookie seguro, `/me`, 404 JSON, SPA fallback, manifest e service worker.
- Banco: migrations aplicadas em banco vazio em memória e em arquivo temporário.
- Segurança: headers, CORS, autorização, validação, uploads, revogação de sessão e isolamento de salas cobertos por testes.
- Desktop: smoke no Electron, no `win-unpacked`, no portátil e no app instalado; instalação/desinstalação silenciosa; duas inicializações com o mesmo perfil; modo remoto em loopback com BOM; captura real da tela de login; `npm audit --omit=dev` do servidor com 0 vulnerabilidades. O client/desktop mantêm o advisory dev-only de `picomatch` sem patch publicado. No build 1.0.1, o smoke do `win-unpacked` e do portátil também confirmou `getDisplayMedia` com 1 faixa de vídeo e 1 faixa de áudio loopback (`System audio`).
- Desktop, controles observados: backend em `127.0.0.1`, `contextIsolation`/`sandbox`, cookie de refresh `HttpOnly`/`SameSite=Lax`/`Path=/api/auth`, `Secure=false` apenas em loopback e `serverUrl` remoto restrito a HTTPS.
- Deploy remoto alwaysdata: `/health`, SPA, service worker, manifest, registro, login, cookie `Secure`, refresh, `/me`, DM, mensagem, upload/download, Socket.IO e sinalização de chamada (`call:start`, `call:incoming`, `call:accept`, `webrtc:signal`, `call:leave`, `call:ended`) validados em 18/11/2026. O desktop empacotado abriu a interface remota via HTTPS com `health: ok`. Em 18/11/2026 o bundle 1.0.1 com as correções de chamada foi publicado e servido pela alwaysdata (`/health` e assets com HTTP 200). A captura de tela com áudio loopback foi confirmada no Electron, mas a transmissão de áudio de tela entre duas máquinas ainda não foi testada.

Tudo além disso deve ser tratado como **não validado** até execução em ambiente real.
