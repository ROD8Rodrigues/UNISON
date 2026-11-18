# Segurança

## Escopo

Este documento cobre os controles implementados, os problemas corrigidos na reconstrução e os riscos residuais. **Não houve pentest independente nem auditoria externa.** As afirmações abaixo refletem código, testes automatizados e smoke test realizados neste repositório.

## Problemas corrigidos na reconstrução

O protótipo original era um monolito Express + NeDB sem validação sistemática, sem rotação/revogação de sessão e sem limites de abuso. A reconstrução corrigiu:

| Área | Situação anterior | Situação atual |
| --- | --- | --- |
| Validação | Payloads usados diretamente | Zod em rotas e schemas, mensagens em português |
| Sessões | JWT sem ciclo de refresh nem revogação | Access token + refresh opaco revogável, com rotação |
| Senhas | Hash bcrypt sem padrão explícito | bcrypt cost 12, política mínima, limite de tamanho |
| Força bruta | Sem limite | Rate limits por área, inclusive autenticação |
| Erros | Páginas HTML/stack traces | JSON padronizado, 500 genérico, request ID |
| CORS/CSRF | Origem permissiva | Allowlist, same-origin no refresh, cookies SameSite |
| Uploads | Sem allowlist clara | MIME allowlist, nome aleatório, limite de tamanho e headers seguros |
| Autorização | Verificações pontuais | Membership, papéis, hierarquia e permissões em serviços |
| Headers | Não configurados | Helmet + CSP + headers específicos |
| Segredos | Fallback fraco | Produção exige `JWT_SECRET` forte e rejeita CORS `*` |
| Tokens em produção | Podiam ser expostos | `EXPOSE_DEV_TOKENS` sempre desativado em produção |
| Tokens em logs | Conteúdo completo do email | Produção registra apenas remetente/assunto, sem link/token |

Um bug crítico também foi encontrado pelos testes: o módulo central de erros importava um logger inexistente, transformando erros tratados em HTML 500. A importação foi corrigida e o contrato JSON passou a ser coberto pelos testes.

## Controles implementados

### Senhas

- bcryptjs com custo **12**.
- Mínimo de 8 caracteres, pelo menos uma letra e um número; máximo de 128.
- Senha nunca é registrada em logs nem retornada pela API.
- Login compara com um hash fictício quando o usuário não existe, reduzindo diferença de tempo para enumeração.
- Troca de senha exige senha atual.
- Reset usa token aleatório de 32 bytes, armazenado apenas como SHA-256, válido por 30 minutos e de uso único.
- Verificação de email usa token de 32 bytes, hash SHA-256, validade de 24 horas e uso único.

### Tokens e sessões

- Access token JWT **HS256 explícito**, emissor `unison`, audiência `unison-client`, validade padrão de 15 minutos.
- Claims incluem `sub` (usuário), `sid` (sessão) e `typ=access`.
- Verificação do algoritmo restrita a HS256.
- Refresh token opaco de 48 bytes (`randomBytes`), nunca reutilizado; apenas o hash SHA-256 fica no banco.
- Rotação a cada refresh; sessão revogada ou expirada é rejeitada.
- Access token é validado contra a sessão em toda requisição, então revogação é imediata no HTTP.
- Cookie de refresh: `HttpOnly`, `SameSite=Lax`, `Path=/api/auth`, expiração alinhada à sessão; `Secure` por padrão em produção.
- No desktop embutido, `COOKIE_SECURE=false` apenas porque o servidor escuta exclusivamente `127.0.0.1` e o Chromium não envia cookie `Secure` por HTTP em loopback. O cookie continua `HttpOnly` e restrito a `/api/auth`. Em modo remoto, vale a política HTTPS do servidor.
- Logout revoga a sessão e desconecta sockets daquela sessão.
- Revogação de sessão emite `session:revoked` e derruba o socket correspondente.
- Access token fica somente em memória no frontend.

### CSRF e CORS

- A API usa `Authorization: Bearer`, que não é enviado automaticamente pelo navegador em requisições cross-site.
- O refresh usa cookie, mas exige mesma origem: `Origin` igual ao host ou presente em `CORS_ORIGINS`.
- `SameSite=Lax` impede envio do cookie em POST cross-site.
- CORS usa allowlist explícita; `*` é rejeitado em produção.
- `credentials: true` é combinado com origens específicas, nunca com wildcard.
- Socket.IO usa a mesma allowlist de origem.

### Autorização

- Rotas protegidas exigem sessão ativa.
- Conversas validam membership e tipo antes de qualquer operação.
- DMs verificam bloqueio entre usuários.
- Canais privados validam ACL.
- Spaces validam permissão efetiva, hierarquia de funções, propriedade e banimento.
- Não é possível alterar o proprietário, remover o dono do grupo, atribuir função acima do próprio rank, conceder permissões que não possui ou remover a si mesmo quando a regra exige.
- Ações administrativas relevantes vão para `space_audit`.
- Exclusão/edição de mensagens valida autor ou permissão de moderação.

### Entrada e saída

- Validação Zod em body, query e params, com limites de tamanho.
- IDs validados como UUID onde aplicável.
- SQL sempre parametrizado. Trechos dinâmicos de `UPDATE` usam apenas listas fixas de colunas; nenhum valor de usuário é interpolado.
- React escapa conteúdo por padrão; não há `dangerouslySetInnerHTML` no código de produção.
- Teste cobre tentativa de injeção de `<script>` em mensagem.
- JSON limitado a 1 MB; formulários limitados a 100 kB.
- Upload limitado por tipo e tamanho; nome em disco é UUID com extensão derivada do MIME.

### Headers e transporte

- Helmet com CSP:
  - `default-src 'self'`
  - `script-src 'self'`
  - `style-src 'self' 'unsafe-inline'` (necessário para estilos inline do app)
  - `img-src 'self' data: blob:`
  - `media-src 'self' blob:`
  - `connect-src 'self'` + origens configuradas + `ws:`/`wss:`
  - `object-src 'none'`, `frame-ancestors 'none'`, `base-uri 'self'`, `form-action 'self'`
- `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy` para câmera/microfone/display-capture.
- Uploads servidos com CSP `sandbox`, `nosniff` e `Cross-Origin-Resource-Policy: cross-origin`.
- HSTS é emitido pelo Helmet; em produção, TLS deve ser terminado no proxy.
- `X-Powered-By` desativado.

### Abuso e disponibilidade

- Rate limits: 240 req/min geral, 25 tentativas de auth/15 min, 90 mensagens/min, 60 uploads/h, 60 buscas/min.
- Limites em memória; não compartilhados entre instâncias.
- Timeouts de socket, limites de payload e limite de arquivo.
- Uploads órfãos são removidos após 24 horas, com limpeza a cada 6 horas.
- Shutdown gracioso em SIGINT/SIGTERM e tratamento de exceções não capturadas.

### Dependências

- Dependências atualizadas para versões corrigidas.
- `overrides` de `minimatch` para resolver vulnerabilidades transitivas.
- Última execução de `npm audit`: **0 vulnerabilidades de runtime** em `server/` (`--omit=dev`). Em `client/` e `desktop/`, o `npm audit` reporta o advisory **dev-only** `picomatch` (CVE-2026-112366, ReDoS em globs, sem versão corrigida publicada). Ele é usado apenas por Vite/ESLint/electron-builder durante o build e não é incluído no backend de produção nem nos executáveis.

## Riscos residuais e recomendações

| Risco | Impacto | Mitigação recomendada |
| --- | --- | --- |
| Sem 2FA/passkeys | Conta comprometida por senha vazada | Adicionar TOTP/WebAuthn |
| Enumeração por registro | Confirma se email/usuário existe | Respostas genéricas e verificação assíncrona |
| Sem lockout de conta | Força bruta distribuída | Captcha, lockout progressivo e monitoramento |
| Rate limit em memória | Burla com múltiplas instâncias | Redis ou gateway com rate limit |
| Sem scan de malware | Upload malicioso armazenado | Antivírus assíncrono, sandbox, re-encoding de imagens |
| MIME declarado pelo cliente | Polyglot/MIME spoofing | Validar magic bytes, processar mídia server-side |
| Sem criptografia E2E | Servidor e backup leem mensagens | E2E por dispositivo, se requisito real |
| Access token em memória | XSS no app pode exfiltrar | CSP já restringe scripts; revisar qualquer HTML não confiável |
| Dados sensíveis em backups | Vazamento de backup | Criptografia em repouso e controle de acesso |
| Logs com PII | Privacidade | Redigir emails, limitar retenção e acesso |
| STUN público padrão | Dependência de terceiros | STUN/TURN próprios e política de privacidade |
| Credenciais TURN estáticas no bundle | Uso indevido do TURN | Credenciais temporárias via coturn `use-auth-secret` |
| Sem auditoria de segurança externa | Falhas desconhecidas | Pentest antes de produção |
| Sem política de retenção/exportação | Conformidade LGPD/GDPR | Definir retenção, exclusão e exportação de dados |
| Binário desktop sem assinatura | SmartScreen e substituição por malware | Certificado Authenticode, checksums e distribuição por HTTPS |
| Dados desktop sem criptografia | Acesso ao perfil lê banco, uploads e JWT | BitLocker/ACL, limpeza ao descartar a máquina e E2E se necessário |
| Sem auto-update no desktop | Versões com falhas continuam em uso | Processo de atualização, aviso de versão e instalador assinado |

## Boas práticas operacionais

1. Use HTTPS em todo o domínio; nunca exponha a porta do Node diretamente.
2. Mantenha `JWT_SECRET` em cofre de segredos, com pelo menos 32 caracteres aleatórios.
3. Rotacione segredos e credenciais SMTP/TURN periodicamente.
4. Restrinja o acesso ao SQLite, à pasta de uploads e, no desktop, ao perfil do Windows.
5. Faça backup criptografado e teste a restauração.
6. Monitore 401/403/429/5xx, picos de upload e falhas SMTP.
7. Rode `npm audit --omit=dev` e atualize dependências a cada release.
8. Não habilite `EXPOSE_DEV_TOKENS` em produção; a configuração ignora a variável nesse ambiente.
9. Configure `TRUST_PROXY` apenas atrás de proxy confiável.
10. Não desative `COOKIE_SECURE` em produção pública; a exceção é somente o loopback do desktop.
11. Distribua o `.exe` com checksum, avalie assinatura Authenticode e oriente os usuários sobre o SmartScreen.
12. Faça revisão de privacidade antes de uso corporativo real.

## Reportar vulnerabilidades

Não abra issue pública com detalhes exploráveis. Envie um relato privado ao responsável pelo projeto com:

- versão/commit;
- passos de reprodução;
- impacto;
- prova de conceito, se aplicável;
- sugestão de correção.

Defina um contato de segurança e um SLA antes de disponibilizar o serviço publicamente.
