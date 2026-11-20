# Progresso da auditoria e desenvolvimento UNISON

**Atualizado em:** 19/11/2026

**Escopo desta rodada:** prioridade por prioridade do `CODEX_TASKS_UNISON.txt`, revisão do código e histórico Git, correções locais e validação automatizada. As capturas fornecidas foram tratadas como contexto visual (configurações, cargos/convites, canais e chamadas), não como prova de funcionamento por si sós.

## Reconhecimento do projeto e do histórico

- Frontend: React 19 + TypeScript + Vite, com PWA responsiva.
- Backend: Node.js + Express 5, SQLite, autenticação por access token e refresh cookie, Socket.IO e Nodemailer.
- Chamadas: WebRTC mesh, ICE/STUN/TURN configurável; canais de voz compartilham a infraestrutura de peer connections.
- Mídia: uploads em disco com URLs de nome aleatório; perfis armazenam `avatar_url` e o app usa `Avatar` para renderizar.
- Histórico: `v1.1.0` trouxe canais de voz, cargos, permissões e convites; `v1.2.0` trouxe recuperação de microfone, dock compacto, HUD Electron e ferramentas de notificação. Os testes já cobriam cargos/convites, voz e verificação com token de uso único.

## Prioridade 1 — bugs existentes

### 1. Áudio em chamadas — causa do dock corrigida; validação real ainda pendente

O código já tentava recuperar tracks encerradas, microfones removidos, conexões WebRTC `failed`/`disconnected` e renegociar após `restartIce`. Nesta rodada, foi encontrado um bug concreto adicional: no modo dock do canal de voz, o `CallOverlay` renderizava apenas o `VoiceDock`, desmontando os tiles remotos que tocavam o áudio. O sintoma é compatível com “ouvir por um tempo e depois parar” quando a chamada é recolhida.

Correções aplicadas:

- `RemoteAudioSinks` mantém um elemento de áudio por participante remoto montado independentemente do dock ou da janela expandida.
- Os tiles de vídeo remotos ficaram `muted`; o áudio remoto agora é tocado apenas pelo sink persistente, evitando duplicação.
- O tile oculto que existia só para manter o áudio foi removido.
- A recuperação de microfone continua: track `muted` por 1,8 s, `devicechange`, `restartIce`/renegociação e aviso quando a recuperação falha.
- O estado de mute é preservado durante a recuperação.

O `smoke:voice` usa mídia falsa e um participante; ele valida o dock, a expansão e o HUD, mas **não prova** áudio remoto entre duas pessoas. Um teste de componente cobre a permanência do sink de áudio no dock e após expandir. A falha original ainda precisa ser reproduzida e revalidada com duas contas/dispositivos reais.

### 2. Verificação de email — fluxo e entrega externa verificados; deliverability parcial

O fluxo cria token aleatório, grava hash, usa expiração de 24 horas e rejeita reutilização. O reenvio foi ajustado para não invalidar o token anterior antes de saber se a nova mensagem foi aceita:

- se o transporte falhar em produção, o token anterior continua válido e o novo token não entregue é descartado;
- se o envio for aceito ou estiver em modo de desenvolvimento com token exposto, os tokens antigos são invalidados;
- o reenvio é limitado a 3 pedidos por IP a cada 15 minutos;
- a UI informa quando a mensagem não foi aceita e diferencia isso de um link local de desenvolvimento.

A validação de produção do backend 1.2.0 confirmou entrega externa em mail.tm/`euploading.com`, DKIM válido `d=alwaysdata.net`, token aceito uma vez e rejeitado no reuso (`INVALID_TOKEN`). O Mail-Tester confirmou **6/10**, com SPF ausente para `telawork.alwaysdata.net`, DKIM válido porém não alinhado, DMARC registrado como `none`, ausência de MX no subdomínio e ausência de `List-Unsubscribe`. O relatório completo está em [email-deliverability-audit.md](email-deliverability-audit.md).

Gmail e Outlook ainda não foram testados diretamente. Nenhum DNS, credencial ou configuração de produção foi alterado nesta rodada.

### 3. Avatar — sincronização e privacidade corrigidas nos caches da aplicação

Uploads têm nomes UUID, então novos uploads não reutilizam o caminho anterior. O problema verificável era estado antigo em listas de amigos, membros e mensagens já carregadas: uma atualização de perfil não propagava a nova identidade a essas cópias. Agora o endpoint emite `user:updated` para sessões da própria conta e usuários que compartilham conversa, amizade ou espaço; os caches do cliente atualizam amigos, pedidos, membros, chamadas, mensagens e dados do usuário autenticado. Espaços recarregam seus detalhes.

O evento amplo **não inclui `lastSeen`**, que é privado e continua filtrado por visualizador nas respostas da API. Um teste de unidade cobre avatar/nome atualizados em amigos, conversas e mensagens; o teste de realtime verifica a ausência de `lastSeen` no broadcast.

### 4. Toggles — persistência verificada; nenhum bug reproduzido

Os switches são controles acessíveis com `role="switch"`; aparência/privacidade/notificações mantêm estado editável e salvam na API. Notificações desktop pedem permissão antes de ligar. Há teste de API que salva e relê valores booleanos normalizados. Os screenshots mostram controles/configurações já existentes; não foi reproduzida falha visual/operacional em navegador real nesta rodada.

## Prioridades posteriores — trabalho já existente

| Área | Estado verificado no código/histórico | Situação |
|---|---|---|
| Cargos, permissões e atribuição | CRUD e verificação de permissões no servidor; testes de criação/atribuição e autorização | **Implementado e coberto por API tests** |
| Convites personalizados | Criação, expiração, limite de uso, revogação e entrada via código | **Implementado e coberto por API tests** |
| Canais de voz | Criação pelo sistema de canais, presença de participantes, join/leave e áudio remoto persistente no dock | **Implementado; áudio real entre dois participantes ainda não validado** |
| Interface compacta de chamada | Dock recolhível/expansível; chamada não desmonta ao recolher; áudio remoto permanece montado | **Implementado; smoke Electron** |
| HUD desktop | Janela Electron transparente, always-on-top, click-through por padrão e interação sob demanda | **Implementado; smoke Electron** |
| Overlay no browser | Document Picture-in-Picture quando suportado; limitado à janela do navegador | **Implementado com limites documentados** |
| Android/iOS nativos | Não há app Capacitor/React Native nem builds de loja; PWA existe | **Pendente** |
| Notificações | Preferências persistentes, central in-app e notificação desktop enquanto app está aberto | **Parcial; sem push em background** |
| Som das notificações | Som atual foi mantido, nenhuma edição nesta rodada | **Preservado** |

Para mobile, a opção inicial mais compatível é avaliar **Capacitor** sobre o frontend React atual, reutilizando UI/API antes de assumir uma reescrita em React Native. Chamadas em background, push e comportamento de áudio exigem plugins e validação nativa; a PWA atual não fornece esses recursos em todos os sistemas. A decisão/build nativo deve ser etapa própria após validar a experiência responsiva e os fluxos prioritários.

## Verificações executadas

- `client`: `npm run typecheck` — passou.
- `client`: `npm run lint` — passou.
- `client`: `npm test` — **15 testes** em 4 arquivos, incluindo sincronização de perfil em cache e regressão do sink de áudio remoto no dock.
- `client`: `npm run build` — passou (TypeScript + Vite). Vite ainda avisa que o bundle principal excede 500 kB minificado.
- `server`: `npm run lint` — passou.
- `server`: `npm test` — **20 testes**, incluindo reenvio com falha preservando o token anterior, persistência de toggles, `user:updated` sem `lastSeen` e isolamento de usuário não relacionado.
- `desktop`: `npm run check` — passou.
- `desktop`: `npm run smoke:voice` — passou: dock recolhido/expandido, saída, overlay visível/always-on-top/não focável por padrão e controles interativos. O teste usa dispositivo de mídia falso; não valida voz entre duas pessoas.

## Próximas ações / pendências reais

1. Reproduzir a queda de áudio com dois dispositivos e confirmar que o sink persistente elimina a perda ao recolher o dock; coletar estados de `MediaStreamTrack`, `RTCPeerConnection` e contadores RTP de forma sanitizada.
2. Testar entrega em Gmail e Outlook, incluindo spam, após decidir entre domínio próprio e ajuste de SPF/DKIM na alwaysdata. Não alterar DNS sem autorização.
3. Validar avatares atualizados em múltiplas sessões reais e o comportamento dos toggles em desktop/browser/mobile.
4. Planejar fundação Capacitor, push, deep links e chamadas nativas depois da verificação dos itens prioritários externos.
5. Publicar uma versão de patch (por exemplo, 1.2.1) somente após autorização, com as correções de áudio do dock, privacidade do `lastSeen` e reenvio de verificação.

**Impacto em produção:** as correções desta rodada estão apenas no workspace local e **não foram implantadas**. A produção continua na 1.2.0. A validação de email de 19/11/2026 ocorreu em produção com contas de teste, que foram removidas; nenhum DNS, credencial ou configuração hospedada foi alterado.
