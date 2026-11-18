# Publicar o UNISON no GitHub

O código e os executáveis do UNISON ficam no mesmo repositório público:

```text
https://github.com/ROD8Rodrigues/UNISON
```

Os binários são distribuídos pelo **GitHub Releases**, que:

- não exige CNPJ nem cartão;
- aceita arquivos de até **2 GiB por asset**;
- não tem limite documentado de banda;
- permite download público sem login, desde que o repositório seja público.

O instalador atual tem 112,99 MiB e o portátil 101,05 MiB, então ambos cabem com folga.

## Estado do repositório

- Código publicado em `main`; a release atual é **v1.1.0**.
- Release **v1.0.0** em `https://github.com/ROD8Rodrigues/UNISON/releases/tag/v1.0.0`.
- Release **v1.0.1** em `https://github.com/ROD8Rodrigues/UNISON/releases/tag/v1.0.1` (correções de áudio no compartilhamento de tela e chat durante chamadas).
- Release **v1.1.0** em `https://github.com/ROD8Rodrigues/UNISON/releases/tag/v1.1.0` (canais de voz, convite personalizado, toggles e editor de cargos).
- Assets da v1.1.0 verificados por SHA-256:
  - `UNISON-Setup-1.1.0.exe` — 118.480.712 bytes
  - `UNISON-Portable-1.1.0.exe` — 105.956.579 bytes
  - `SHA256SUMS.txt` — 183 bytes
- O push foi feito via HTTPS com a credencial do Windows Credential Manager. A chave SSH `unison_deploy` continua **não** cadastrada no GitHub.

## 1. Enviar o código

### Opção A — HTTPS (usada na publicação)

```powershell
git branch -m main
git remote set-url origin https://github.com/ROD8Rodrigues/UNISON.git
git push -u origin main
```

### Opção B — SSH (requer cadastrar a chave)

Cadastre a chave pública em [github.com/settings/ssh/new](https://github.com/settings/ssh/new):

```text
ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIIJ9VIXMpBW9IWk26KI4H0RNS1HrrTjOoUsqFawnyFrY unison-deploy
```

Depois:

```powershell
git branch -m main
git config core.sshCommand "ssh -i C:/Users/Chris/.ssh/unison_deploy -o IdentitiesOnly=yes"
git push -u origin main
```

> A mesma chave pode ser usada na alwaysdata, mas cada serviço precisa da chave cadastrada separadamente.

## 2. Criar o release pela interface web

1. Abra `https://github.com/ROD8Rodrigues/UNISON/releases/new`.
2. Preencha:
   - **Choose a tag:** `v1.1.0` → **Create new tag on publish**.
   - **Target:** `main`.
   - **Release title:** `UNISON 1.1.0`.
   - **Describe this release:** cole o conteúdo de [`docs/releases/v1.1.0.md`](releases/v1.1.0.md).
3. Em **Attach binaries**, anexe os três arquivos de `desktop/release/`:
   - `UNISON-Setup-1.1.0.exe`
   - `UNISON-Portable-1.1.0.exe`
   - `SHA256SUMS.txt`
4. Clique em **Publish release**.
5. Abra o link em uma janela anônima para confirmar que o download funciona sem login:

```text
https://github.com/ROD8Rodrigues/UNISON/releases/latest
```

> Não envie a pasta `win-unpacked` nem arquivos `.blockmap`. Anexe apenas o instalador, o portátil e os checksums. Os `.exe` **não** devem ser commitados: `desktop/release/` está no `.gitignore` e cada arquivo passa do limite de 100 MiB do Git.

## 3. GitHub CLI (opcional)

O `gh` não está instalado nesta máquina. Se quiser usar a linha de comando:

```powershell
winget install --id GitHub.cli -e
gh auth login

gh release create v1.1.0 `
  "desktop/release/UNISON-Setup-1.1.0.exe" `
  "desktop/release/UNISON-Portable-1.1.0.exe" `
  "desktop/release/SHA256SUMS.txt" `
  --repo ROD8Rodrigues/UNISON `
  --title "UNISON 1.1.0" `
  --notes-file docs/releases/v1.1.0.md
```

Para abrir o release publicado:

```powershell
gh release view v1.1.0 --repo ROD8Rodrigues/UNISON --web
```

## 4. Verificar os arquivos antes de publicar

```powershell
Get-FileHash .\desktop\release\UNISON-Setup-1.1.0.exe -Algorithm SHA256
Get-FileHash .\desktop\release\UNISON-Portable-1.1.0.exe -Algorithm SHA256
Get-Content .\desktop\release\SHA256SUMS.txt
```

Hashes desta versão:

```text
ffac10ae75b31da3742b6329280adf5cad4bcdecd587ec4865f1df080fdf5fef  UNISON-Setup-1.1.0.exe
9f43e8e0f596116fa1dbddb2fd6a27b011bc6b0c32294f43c85344967ac5ff4a  UNISON-Portable-1.1.0.exe
```

## 5. Antes de commitar

Confirme que estas pastas/arquivos **não** entram no Git:

- `.env` e variantes locais;
- `key.txt` (segredo de deploy);
- `server/data/` e `server/uploads/`;
- `desktop/release/` e `desktop/staging/`;
- `deploy/` (pacote de deploy da alwaysdata);
- `node_modules/`, `dist/` e logs.

O `.gitignore` já cobre esses caminhos. Nunca publique `JWT_SECRET`, senhas SMTP ou bancos de produção.

## 6. Atualizações futuras

Para cada nova versão:

1. Gere novamente os artefatos com `cmd /c "npm run dist"` em `desktop/`.
2. Atualize os tamanhos e hashes em `docs/releases/`.
3. Crie uma tag nova (`v1.1.0`, `v1.2.0`, ...) e um release novo.
4. Anexe os novos executáveis e o novo `SHA256SUMS.txt`.
5. Mantenha os releases antigos disponíveis para rollback.

Não substitua os arquivos de um release já publicado: quem baixou antes pode ter um hash diferente. Prefira uma versão nova.

## Limitações e avisos

- O SmartScreen do Windows vai avisar que o aplicativo não tem assinatura digital. Isso não muda com o GitHub Releases; só um certificado de code signing elimina o aviso.
- O GitHub Releases é destinado aos binários do próprio projeto. Não use o serviço como CDN genérica ou para conteúdo não relacionado.
- O download público depende de o repositório ser público. Em repositório privado, o GitHub exige login.
- Não há auto-update implementado nesta versão; o usuário precisa baixar a versão nova manualmente.

## Checklist

- [x] Branch local renomeada para `main`.
- [x] Código enviado para `ROD8Rodrigues/UNISON`.
- [x] Tags `v1.0.0`, `v1.0.1` e `v1.1.0` criadas.
- [x] Release notes coladas de `docs/releases/v1.1.0.md`.
- [x] Setup, Portátil e `SHA256SUMS.txt` anexados.
- [x] Release publicado.
- [x] Download anônimo verificado (HTTP 200 nos três assets) e digest SHA-256 conferido.
- [x] Hashes conferidos com `Get-FileHash` e com o digest da API do GitHub.
- [ ] Link do release divulgado.
