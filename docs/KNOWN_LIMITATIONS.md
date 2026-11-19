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
- **Canais de voz (1.1.0):** entrada, saída e presença são cobertas por teste automatizado de Socket.IO e API. A chamada do canal usa a mesma topologia **mesh** das demais chamadas, então o limite de 9 participantes e a dependência de STUN/TURN se aplicam. A entrada em um canal com duas contas reais, em navegadores/dispositivos distintos, ainda não foi executada neste ambiente.
- **Canais de voz (1.2.0):** o dock compacto, a expansão/recolhimento, o HUD ao minimizar, o mute e a saída pelo próprio HUD são cobertos por `npm run smoke:voice` no Electron com dispositivo de mídia falso. A recuperação de microfone (track encerrada, `devicechange`, `restartIce`, renegociação) é coberta por código defensivo e smoke, mas **não** por um teste real de remoção de dispositivo ou troca de rede.
- **HUD do desktop (1.2.0):** o overlay é uma janela transparente, always-on-top e click-through validada no smoke (`focusable: false`, `setIgnoreMouseEvents(true, { forward: true })`). `Ctrl+Shift+U` alterna a interação. Ele cobre jogos em modo janela/borderless; **jogos em fullscreen exclusivo** podem ficar por cima e esconder o HUD, pois o Windows não compõe overlays sobre esse modo. O HUD não captura mouse enquanto passivo, mas a janela do jogo precisa permitir overlay do sistema.
- **PiP do navegador (1.2.0):** o botão de flutuar usa Document Picture-in-Picture em Chrome/Edge. A janela PiP **não é click-through** (limitação da plataforma) e pode ficar atrás de jogos em fullscreen. Em navegadores sem a API, o botão fica desabilitado. O Electron não expõe Document PiP, então esse caminho não é exercitado pelo smoke automatizado.

**Para validar:** dois dispositivos reais, redes distintas, HTTPS, permissões de mídia, TURN configurado, teste de áudio, vídeo, tela, mute, entrada/saída, queda de rede e reconexão.

## Email e SMTP

**Status: implementado, entrega externa não validada.**

- SMTP é opcional. A partir da 1.2.0, `MAIL_TRANSPORT=auto` usa SMTP quando `SMTP_HOST` existe e, sem ele, tenta o `sendmail` local; sem nenhum dos dois, o email não é entregue e o token aparece apenas no log/API de desenvolvimento.
- Em produção, tokens não são expostos pela API e o log não inclui o link/token.
- Na alwaysdata, `/usr/sbin/sendmail` (msmtp) aceitou uma mensagem de teste com `250 OK`. Isso valida o transporte local, **não** a entrega final: Gmail/Outlook, spam, SPF/DKIM/DMARC do subdomínio, bounce e limites não foram testados.
- Não há fila de email, retentativa, template i18n ou tracking.

**Para validar:** após reiniciar o backend 1.2.0, solicitar verificação/recuperação para uma caixa Gmail e uma Outlook, conferir caixa de entrada/spam, expiração, uso único e o log `mail` do servidor.

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
- O HUD de voz da 1.2.0 roda em janela separada com `contextIsolation`, `sandbox`, `setIgnoreMouseEvents(true, { forward: true })` e atalho global. Ele só aparece com canal de voz ativo e com o app minimizado/desfocado, ou quando fixado no dock. A interação por mouse exige `Ctrl+Shift+U` (ou fixar); fora do HUD, o mouse volta ao modo passivo por `mouseleave`. Fullscreen exclusivo, múltiplos monitores com DPI mista e Windows 11 não foram testados manualmente.
- O build instalado ocupa aproximadamente 328 MB; o instalador tem ~113 MiB e o portátil ~101 MiB (valores da 1.1.0; a 1.2.0 pode variar alguns MiB).

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
- A 1.2.0 adicionou **Testar notificação** nas configurações: o botão pede permissão quando necessário, exibe uma notificação de teste e toca o som atual (se `notificationSounds` estiver ligado). O comportamento visual ainda depende do Windows/navegador e não foi validado em todos os alvos.
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

- 17 testes de backend e 13 de frontend passam.
- O desktop tem smoke test real no build empacotado, portátil e instalado, além de `smoke:voice` para o dock/HUD com mídia falsa, mas não há suíte E2E de UI, testes de upgrade ou automação de assinatura.
- O PiP do navegador não é coberto por teste automatizado; a API Document PiP não existe no Electron.
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
- O deploy gratuito está ativo na conta alwaysdata Free `telawork`: single-node, 1 GB de disco, 256 MB de RAM, sem domínio próprio e restrito a uso pessoal/não comercial. Em 19/11/2026 o frontend e os arquivos do servidor **1.2.0** foram publicados, com backup em `~/backups/unison-20261119-015244.tgz`; como o restart do site Node.js depende do painel, `/health` ainda responde `1.0.0` até a reinicialização. O `.env` remoto usa `sendmail` para email. O `Force HTTPS` do painel ainda não foi ativado; use sempre `https://telawork.alwaysdata.net`.
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

- Backend: lint, 17 testes automatizados, auditoria de dependências, inicialização e smoke test em `NODE_ENV=production`.
- Frontend: lint, typecheck, 13 testes, build de produção, assets PWA servidos com headers corretos.
- Fluxos HTTP: registro, login, refresh com cookie seguro, `/me`, 404 JSON, SPA fallback, manifest e service worker.
- Banco: migrations aplicadas em banco vazio em memória e em arquivo temporário.
- Segurança: headers, CORS, autorização, validação, uploads, revogação de sessão e isolamento de salas cobertos por testes.
- Desktop: smoke no Electron, no `win-unpacked`, no portátil e no app instalado; instalação/desinstalação silenciosa; duas inicializações com o mesmo perfil; modo remoto em loopback com BOM; captura real da tela de login; `npm audit --omit=dev` do servidor com 0 vulnerabilidades. O client/desktop mantêm o advisory dev-only de `picomatch` sem patch publicado. No build 1.1.0, o smoke do `win-unpacked` e do portátil também confirmou `getDisplayMedia` com 1 faixa de vídeo e 1 faixa de áudio loopback (`System audio`). Em 1.2.0, o `smoke:voice` validou dock com 1 participante, expansão, recolhimento, HUD visível/always-on-top/`focusable:false`, modo interativo, mute e saída pelo HUD (capturas salvas em `%TEMP%\unison-smoke-*`).
- Voz (1.2.0): `CallProvider` recupera o microfone quando a track termina, em `devicechange` e após `restartIce`/renegociação; o servidor emite `call:participant-left` quando um socket cai. Esses caminhos foram exercitados por typecheck/lint/smoke, mas a perda real de voz do tester só pode ser confirmada com duas contas e dispositivos reais.
- Desktop, controles observados: backend em `127.0.0.1`, `contextIsolation`/`sandbox`, cookie de refresh `HttpOnly`/`SameSite=Lax`/`Path=/api/auth`, `Secure=false` apenas em loopback e `serverUrl` remoto restrito a HTTPS.
- Deploy remoto alwaysdata: `/health`, SPA, service worker, manifest, registro, login, cookie `Secure`, refresh, `/me`, DM, mensagem, upload/download, Socket.IO e sinalização de chamada (`call:start`, `call:incoming`, `call:accept`, `webrtc:signal`, `call:leave`, `call:ended`) validados em 18/11/2026. O desktop empacotado abriu a interface remota via HTTPS com `health: ok`. Em 18/11/2026 o bundle e os arquivos do servidor 1.1.0 (canais de voz, convite personalizado e toggles) foram publicados. Em 19/11/2026 o bundle 1.2.0 (`assets/index-BPx4Ru7T.js` e `assets/index-D88E7iwP.css`) e os arquivos do servidor 1.2.0 (dock/HUD, avatar, cargos, notificações e `sendmail`) foram publicados, com backup. O backend novo depende do restart do site no painel; canais de voz com duas contas reais e entrega de email ainda não foram testados em produção.

Tudo além disso deve ser tratado como **não validado** até execução em ambiente real.
