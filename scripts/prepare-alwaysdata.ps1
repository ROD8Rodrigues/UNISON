#requires -Version 5.1
<#
.SYNOPSIS
  Gera o pacote de deploy do UNISON para a alwaysdata Free.

.DESCRIPTION
  - Opcionalmente roda o build do frontend.
  - Monta uma pasta limpa com server/ e client/dist/.
  - Não inclui node_modules, .env, data, uploads, testes ou o protótipo legado.
  - Gera deploy/UNISON-alwaysdata-<versao>.zip e o SHA-256.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\scripts\prepare-alwaysdata.ps1

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\scripts\prepare-alwaysdata.ps1 -SkipBuild -Version 1.0.1
#>
[CmdletBinding()]
param(
  [string]$Version,
  [switch]$SkipBuild,
  [string]$OutputDir
)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
if (-not (Test-Path (Join-Path $repoRoot 'server\index.js'))) {
  throw "Raiz do projeto não encontrada em $repoRoot. Execute o script a partir de scripts\prepare-alwaysdata.ps1."
}

if (-not $Version) {
  $serverPackage = Get-Content (Join-Path $repoRoot 'server\package.json') -Raw | ConvertFrom-Json
  $Version = $serverPackage.version
  if (-not $Version) {
    throw 'Não foi possível ler a versão de server\package.json. Informe -Version.'
  }
}

if (-not $OutputDir) {
  $OutputDir = Join-Path $repoRoot 'deploy'
}
$OutputDir = [System.IO.Path]::GetFullPath($OutputDir)
$stage = Join-Path $OutputDir 'alwaysdata'
$zip = Join-Path $OutputDir "UNISON-alwaysdata-$Version.zip"

function Invoke-Npm {
  param(
    [Parameter(Mandatory = $true)][string]$WorkingDirectory,
    [Parameter(Mandatory = $true)][string[]]$NpmArguments
  )

  $npm = Get-Command npm.cmd -ErrorAction SilentlyContinue
  if (-not $npm) {
    $npm = Get-Command npm -ErrorAction SilentlyContinue
  }
  if (-not $npm) {
    throw 'npm não encontrado no PATH. Instale Node.js 22.5 ou superior.'
  }

  Push-Location $WorkingDirectory
  try {
    Write-Host "==> npm $($NpmArguments -join ' ') (em $WorkingDirectory)"
    & $npm.Source @NpmArguments
    if ($LASTEXITCODE -ne 0) {
      throw "npm $($NpmArguments -join ' ') falhou com exit code $LASTEXITCODE."
    }
  } finally {
    Pop-Location
  }
}

Write-Host "==> Repositório: $repoRoot"
Write-Host "==> Saída:       $OutputDir"

$clientRoot = Join-Path $repoRoot 'client'
$clientDist = Join-Path $clientRoot 'dist'
$serverRoot = Join-Path $repoRoot 'server'

if (-not $SkipBuild) {
  Invoke-Npm -WorkingDirectory $clientRoot -NpmArguments @('run', 'build')
}

if (-not (Test-Path (Join-Path $clientDist 'index.html'))) {
  throw "client/dist/index.html não encontrado. Rode o build do frontend ou remova -SkipBuild."
}

Write-Host '==> Limpando a pasta de staging'
if (Test-Path $stage) {
  Remove-Item -LiteralPath $stage -Recurse -Force
}
New-Item -ItemType Directory -Path (Join-Path $stage 'server') -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $stage 'client') -Force | Out-Null

Write-Host '==> Copiando servidor'
Copy-Item -LiteralPath (Join-Path $serverRoot 'index.js') -Destination (Join-Path $stage 'server\index.js') -Force
Copy-Item -LiteralPath (Join-Path $serverRoot 'package.json') -Destination (Join-Path $stage 'server\package.json') -Force
Copy-Item -LiteralPath (Join-Path $serverRoot 'package-lock.json') -Destination (Join-Path $stage 'server\package-lock.json') -Force
Copy-Item -LiteralPath (Join-Path $serverRoot '.env.example') -Destination (Join-Path $stage 'server\.env.example') -Force
Copy-Item -LiteralPath (Join-Path $serverRoot 'src') -Destination (Join-Path $stage 'server\src') -Recurse -Force

Write-Host '==> Copiando frontend (client/dist)'
Copy-Item -LiteralPath $clientDist -Destination (Join-Path $stage 'client\dist') -Recurse -Force

$deployText = @'
UNISON — pacote de deploy para alwaysdata Free
=================================================

Conteúdo:
  server/          Backend Express + Socket.IO + migrations
  client/dist/     Frontend/PWA já compilado
  DEPLOY.txt       Este arquivo

Não inclui:
  node_modules/, .env, data/, uploads/, testes e legado.

No servidor:
  1. mkdir -p ~/unison && cd ~/unison
  2. unzip ~/UNISON-alwaysdata-<versao>.zip
  3. cd server && npm ci --omit=dev
  4. mkdir -p data uploads
  5. Configure as variáveis de ambiente do site (veja docs/DEPLOY_ALWAYSDATA.md).

Site Node.js na alwaysdata:
  Comando:           node /home/<conta>/unison/server/index.js
  Diretório:         /home/<conta>/unison/server
  Node.js:           24
  Variáveis:         NODE_ENV=production, JWT_SECRET=..., COOKIE_SECURE=true,
                     TRUST_PROXY=true, CORS_ORIGINS=https://<conta>.alwaysdata.net,
                     APP_URL=https://<conta>.alwaysdata.net,
                     DATABASE_PATH=./data/unison.db, UPLOAD_DIR=./uploads
  Não defina PORT: a alwaysdata injeta a porta correta.

Verificação:
  curl -fsS https://<conta>.alwaysdata.net/health

Guia completo:
  docs/DEPLOY_ALWAYSDATA.md

Versão: <versao>
'@
$deployText = $deployText.Replace('<versao>', $Version)
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText((Join-Path $stage 'DEPLOY.txt'), $deployText, $utf8NoBom)

$required = @(
  'server\index.js',
  'server\package.json',
  'server\package-lock.json',
  'server\src\server.js',
  'server\src\db\migrations\001_init.sql',
  'client\dist\index.html',
  'client\dist\sw.js'
)
foreach ($relative in $required) {
  if (-not (Test-Path (Join-Path $stage $relative))) {
    throw "Arquivo obrigatório ausente no pacote: $relative"
  }
}

if (-not (Test-Path $OutputDir)) {
  New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null
}
if (Test-Path $zip) {
  Remove-Item -LiteralPath $zip -Force
}

Write-Host '==> Compactando'
$tar = Get-Command tar.exe -ErrorAction SilentlyContinue
if (-not $tar) {
  throw 'tar.exe nǜo encontrado. O Windows 10/11 inclui tar.exe; atualize o sistema ou compacte a pasta deploy\alwaysdata manualmente.'
}
& $tar.Source -a -c -f $zip -C $stage .
if ($LASTEXITCODE -ne 0) {
  throw "tar falhou com exit code $LASTEXITCODE."
}

$hash = (Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToLowerInvariant()
$size = (Get-Item -LiteralPath $zip).Length
$sizeMiB = [math]::Round($size / 1MB, 2)
"$hash  $(Split-Path -Leaf $zip)" | Set-Content -LiteralPath "$zip.sha256" -Encoding ASCII

Write-Host ''
Write-Host '==> Pacote pronto'
Write-Host "    Arquivo: $zip"
Write-Host "    Tamanho: $sizeMiB MiB ($size bytes)"
Write-Host "    SHA-256: $hash"
Write-Host "    Checksum: $zip.sha256"
Write-Host ''
Write-Host 'Próximo passo: envie o zip para a alwaysdata e siga docs/DEPLOY_ALWAYSDATA.md'
