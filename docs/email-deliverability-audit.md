# Auditoria de entrega e autenticação de email

**Data da validação em produção:** 19/11/2026

**Revisão deste relatório:** 19/11/2026

**Escopo:** inspeção do código, consultas DNS públicas e análise de evidências arquivadas da validação de produção do backend 1.2.0 (mensagem bruta recebida em mail.tm e relatório do Mail-Tester). Esta revisão não abriu novas conexões autenticadas à hospedagem, ao banco ou a caixas de email.

## Resumo executivo

O UNISON usa Nodemailer e suporta SMTP ou o `sendmail` local. A produção 1.2.0 está documentada com `sendmail:/usr/sbin/sendmail` e remetente `no-reply@telawork.alwaysdata.net`. A mensagem de verificação foi entregue a uma caixa externa (mail.tm/`euploading.com`) e o token foi aceito uma vez; a reutilização foi rejeitada com `INVALID_TOKEN`.

A evidência arquivada confirma:

- DKIM **válido** (`dkim=pass`), assinado como `d=alwaysdata.net`, selector `default`, chave RSA de 1024 bits.
- SPF **ausente/falho** para `telawork.alwaysdata.net` (`Received-SPF: none`); o IP emissor observado foi `188.72.70.3` (`r2.smtpout1.paris1.alwaysdata.com`).
- `From` e `Return-Path` em `telawork.alwaysdata.net`, portanto o DKIM de `alwaysdata.net` **não alinha** com o `From`. O DMARC do domínio pai usa `aspf=s` e `adkim=s`.
- O Mail-Tester registrou **6/10**, com `dmarc=none` para o subdomínio, ausência de MX para `telawork.alwaysdata.net` e ausência de `List-Unsubscribe`.

A entrega externa e o fluxo de token estão **verificados**. A entrega em caixa de entrada do Gmail/Outlook e a reputação de longo prazo **não foram testadas**.

## Checklist de continuidade

| Item | Estado | Evidência / limite |
|---|---|---|
| Email enviado | **VERIFICADO** | Mensagem recebida em mail.tm/`euploading.com`; fonte bruta e detalhe da mensagem arquivados localmente. |
| Token de produção validado | **VERIFICADO na sessão** | Link aceito uma vez e rejeitado no reuso (`INVALID_TOKEN`). O transcript HTTP não foi arquivado. |
| Cabeçalhos brutos inspecionados | **VERIFICADO** | Fonte bruta contém `Return-Path`, `Received`, `DKIM-Signature` e `Message-ID`. |
| Servidor SMTP identificado | **VERIFICADO** | `sendmail` local entregou ao relay Exim `smtpout1.paris1.alwaysdata.com`; primeiro hop externo em `r2.smtpout1.paris1.alwaysdata.com` (`188.72.70.3`). |
| DKIM verificado | **VERIFICADO — PASSA** | `Authentication-Results: dkim=pass ... header.d=alwaysdata.net header.s=default`, chave de 1024 bits. |
| SPF verificado | **VERIFICADO — FALHA** | `Received-SPF: none`; não há TXT/SPF em `telawork.alwaysdata.net`. |
| DMARC verificado | **VERIFICADO** | `_dmarc.alwaysdata.net` publica `p=quarantine; sp=quarantine; aspf=s; adkim=s`; o Mail-Tester registrou `dmarc=none` para o subdomínio. |
| Alinhamento de domínio avaliado | **VERIFICADO — NÃO ALINHADO** | `From` em `telawork.alwaysdata.net`, DKIM em `alwaysdata.net`; `adkim=s` exige igualdade exata. |
| MX verificado | **VERIFICADO — AUSENTE** | Sem MX para `telawork.alwaysdata.net`; o Mail-Tester descontou 3 pontos por isso. |
| Mail-Tester analisado | **VERIFICADO** | Relatório arquivado: 6/10; SpamAssassin `-0.0/5.0` (não spam); não listado nos blocklists verificados. |
| Contas de teste removidas | **VERIFICADO** | As duas contas usadas na validação (mail.tm e Mail-Tester) foram excluídas após o teste. |
| Reenvio com falha de transporte | **VERIFICADO em teste automatizado** | O token anterior continua válido; o novo token não entregue é descartado. Coberto em `server/test/api.test.js`. |
| Achados documentados | **CONCLUÍDO** | Este relatório e `docs/KNOWN_LIMITATIONS.md`. |
| Recomendações estabelecidas | **CONCLUÍDO** | Seção de ações recomendadas; nenhuma alteração de DNS foi aplicada. |

## Projeto e arquitetura de email

- Aplicação Node.js/Express, com backend em `server/` e frontend React/Vite em `client/`.
- `server/src/services/mailer.js` usa Nodemailer. Seleciona SMTP quando `MAIL_TRANSPORT=smtp` ou, em `auto`, quando `SMTP_HOST` existe; também aceita `sendmail`.
- `server/src/config.js` lê configuração do ambiente/`server/.env`. Esta auditoria não exibiu valores de ambiente ou credenciais.
- O `From` é `MAIL_FROM`; o envio não define `envelope` explicitamente, então o transporte escolhe o MAIL FROM/Return-Path a partir do remetente.
- Em produção, a mensagem analisada saiu pelo `sendmail` local e foi relayada pela infraestrutura da alwaysdata, com TLS 1.3 até o destino.
- `delivered: true` no código significa que `sendMail` terminou sem exceção. Nesta validação, a entrega externa foi confirmada adicionalmente pela mensagem recebida.

## Método e evidências

1. Inspecionados `server/src/services/mailer.js`, `server/src/config.js`, rotas de verificação, documentação de deployment e limitações.
2. Analisados artefatos locais da validação de produção: fonte bruta da mensagem (`.eml`), detalhe da mensagem no mail.tm, token usado e relatório do Mail-Tester (`.txt` e `.html`).
3. Consultados registros TXT/MX por DNS público para `telawork.alwaysdata.net`, `_dmarc.telawork.alwaysdata.net`, `alwaysdata.net` e `_dmarc.alwaysdata.net` em 19/11/2026.
4. Os artefatos brutos **não foram versionados** porque contêm token de verificação e endereço do destinatário. Apenas os achados sanitizados estão neste documento.
5. A validação de produção ocorreu na sessão anterior; esta revisão não enviou novo email, não acessou o banco e não alterou DNS, credenciais ou configuração hospedada.

## Resultados de autenticação

### SMTP / transporte

A mensagem analisada contém:

```text
Return-Path: <no-reply@telawork.alwaysdata.net>
Received: from r2.smtpout1.paris1.alwaysdata.com (188.72.70.3)
  by in.mail.tm with ESMTPS ... tls TLS_AES_256_GCM_SHA384
Received: from http7.paris1.alwaysdata.com ... by smtpout1.paris1.alwaysdata.com
  with esmtp (Exim 4.98.2) (envelope-from <no-reply@telawork.alwaysdata.net>)
```

Isso confirma que o app usou o `sendmail` local e que a alwaysdata fez o relay de saída. O host visto no `Received` é o relay, não uma conexão SMTP direta configurada no app.

### SPF

Consulta TXT de `alwaysdata.net` retorna:

```text
v=spf1 include:_spf.alwaysdata.com ~all
```

Não há TXT/SPF em `telawork.alwaysdata.net`. O relatório do Mail-Tester confirma:

```text
Received-SPF: none ... envelope-from=<no-reply@telawork.alwaysdata.net>;
  client-ip=188.72.70.3
```

O SPF do domínio pai não se aplica automaticamente ao subdomínio usado no MAIL FROM. O Mail-Tester sugeriu `v=spf1 a mx ip4:188.72.70.3 ~all`, mas essa sugestão não deve ser copiada sem confirmar a orientação da alwaysdata e sem garantir **um único** registro SPF no domínio correto.

**Recomendação (não aplicada):** publicar um único SPF em `telawork.alwaysdata.net` (se o namespace permitir) incluindo os mecanismos oficiais da alwaysdata, ou migrar o envio para um domínio próprio controlado pelo projeto. Não alterar o SPF de `alwaysdata.net`, que é de terceiros.

### DKIM

O relatório do Mail-Tester confirma:

```text
Authentication-Results: dkim.mail-tester.com;
  dkim=pass (1024-bit key; unprotected)
  header.d=alwaysdata.net header.s=default header.a=rsa-sha256
DKIM-Signature: v=1; a=rsa-sha256; ... d=alwaysdata.net; s=default;
```

A assinatura é criptograficamente válida, mas o domínio assinado (`alwaysdata.net`) é diferente do `From` (`telawork.alwaysdata.net`). Com `adkim=s` no DMARC do pai, isso **não alinha**. A chave de 1024 bits também é considerada fraca por padrões atuais; se o provedor permitir, usar 2048 bits.

**Recomendação (não aplicada):** assinar com `d=` exatamente igual ao domínio do `From`, com selector e chave publicados no DNS desse domínio. Alternativamente, usar um provedor SMTP que assine o domínio próprio do projeto.

### DMARC

DNS público retorna em `_dmarc.alwaysdata.net`:

```text
v=DMARC1; p=quarantine; sp=quarantine; aspf=s; adkim=s;
  ruf=mailto:abuse@alwaysdata.com; fo=1
```

O Mail-Tester registrou `dmarc=none (p=none dis=none) header.from=telawork.alwaysdata.net` e informou que aplicou a política do domínio pai. A leitura correta é: existe política no pai com `sp=quarantine`, mas o resultado observado para o subdomínio foi `none`; o comportamento exato depende da consulta DMARC do receptor. Como o DKIM não alinha e o SPF falha, não há mecanismo alinhado que garanta aprovação DMARC.

**Recomendação (não aplicada):** com domínio próprio, publicar DMARC inicialmente em monitoramento (`p=none`) com `rua` operacional, alinhar SPF/DKIM e só depois elevar a política. Não alterar a política de `alwaysdata.net`.

### MX

Não há MX para `telawork.alwaysdata.net`. MX determina o recebimento de email e não é necessário para enviar, mas o Mail-Tester desconta pontos e alguns receptores podem tratar o domínio de bounce com desconfiança. Se o subdomínio for usado como Return-Path, faz sentido ter MX ou usar um endereço de bounce em domínio que receba email.

### List-Unsubscribe

O relatório aponta ausência de `List-Unsubscribe`. Esse cabeçalho é relevante para mensagens em massa/marketing; emails transacionais de verificação e redefinição não precisam dele para funcionar. Não é prioridade para este fluxo.

## Mail-Tester e entregabilidade

O relatório arquivado confirma **6/10**. Principais achados:

- SPF ausente para o domínio do envelope (`-4` na seção de autenticação).
- DKIM válido, porém não alinhado ao `From`.
- Ausência de MX para o subdomínio (`-3`).
- Ausência de `List-Unsubscribe`.
- SpamAssassin `-0.0/5.0` (não classificado como spam) e IP não listado nos blocklists consultados.

A pontuação não mede diretamente inbox placement. Reputação do IP, conteúdo, histórico de envio e políticas do destinatário também influenciam. Gmail e Outlook não foram testados.

## Riscos prioritários

1. `From` em subdomínio sem SPF e DKIM assinado por domínio diferente, sob alinhamento estrito herdado.
2. Política `sp=quarantine` do domínio pai de terceiros pode afetar mensagens do subdomínio quando nenhum mecanismo alinha.
3. Chave DKIM de 1024 bits.
4. Falta de MX no domínio de retorno, se ele for usado para bounce.
5. Sem teste direto de inbox/spam em Gmail e Outlook.

## Recomendações priorizadas — não aplicadas

1. **Preferível:** migrar o envio para um domínio próprio controlado pelo projeto; alinhar `From`, MAIL FROM/Return-Path e `d=` DKIM; publicar SPF único autorizado pelo provedor e DMARC inicialmente monitorado com `rua` operacional.
2. Se continuar usando alwaysdata, confirmar no painel/DNS se é possível publicar TXT/SPF em `telawork.alwaysdata.net`. O DKIM atual continua assinando `alwaysdata.net`; isso não corrige o alinhamento sozinho. Avaliar um provedor SMTP que assine o domínio do projeto.
3. Usar chave DKIM de 2048 bits, se suportado.
4. Publicar MX apenas se o subdomínio precisar receber respostas/bounces; caso contrário, usar um Return-Path em domínio com MX.
5. Após qualquer mudança autorizada, revalidar SPF/DKIM/DMARC e enviar testes controlados para Gmail e Outlook, conferindo inbox/spam e cabeçalhos.
6. Manter o comportamento de reenvio: se o transporte falhar, preservar o token anterior e descartar o novo; se a entrega for aceita, invalidar os tokens antigos. Coberto por teste automatizado.

## Alterações e limitações

A validação de produção criou duas contas de teste e enviou mensagens reais; as contas foram removidas após o teste. Nenhum registro DNS, credencial ou configuração de produção foi alterado. Os artefatos brutos permanecem apenas em arquivos temporários locais e não devem ser commitados por conterem tokens e endereços.

A entrega em Gmail/Outlook, a reputação de longo prazo e o inbox placement continuam **não verificados**. DNS e políticas podem mudar; este relatório reflete as consultas e evidências de 19/11/2026.
