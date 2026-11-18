#requires -Version 5.1
<#
.SYNOPSIS
  Smoke test local do pacote de deploy da alwaysdata.

.DESCRIPTION
  Extrai o zip em uma pasta temporária, inicia o servidor em NODE_ENV=production
  (HTTP em loopback), valida health, SPA, service worker, registro, login,
  refresh cookie e /me. Não usa nenhum banco ou upload real do projeto.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\scripts\smoke-alwaysdata.ps1
#>
[CmdletBinding()]
param(
  [string]$ZipPath,
  [int]$Port = 61234
)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
if (-not $ZipPath) {
  $ZipPath = Join-Path $repoRoot 'deploy\UNISON-alwaysdata-1.0.0.zip'
}
if (-not (Test-Path -LiteralPath $ZipPath)) {
  throw "Pacote não encontrado: $ZipPath. Rode scripts\prepare-alwaysdata.ps1 primeiro."
}

$nodeModules = Join-Path $repoRoot 'server\node_modules'
if (-not (Test-Path -LiteralPath $nodeModules)) {
  throw "server\node_modules não encontrado. Rode 'npm install' em server/ antes do smoke test."
}

$node = (Get-Command node -ErrorAction Stop).Source
$temp = Join-Path ([System.IO.Path]::GetTempPath()) ("unison-alwaysdata-smoke-" + [guid]::NewGuid().ToString('N'))
$proc = $null
$junctionPath = $null

function Show-Logs {
  param([string]$Directory)
  foreach ($name in @('stdout.log', 'stderr.log')) {
    $path = Join-Path $Directory $name
    if (Test-Path -LiteralPath $path) {
      Write-Host "--- $name ---"
      Get-Content -LiteralPath $path -Tail 40
    }
  }
}

try {
  New-Item -ItemType Directory -Path $temp -Force | Out-Null
  Expand-Archive -LiteralPath $ZipPath -DestinationPath $temp -Force

  $serverDir = Join-Path $temp 'server'
  if (-not (Test-Path -LiteralPath (Join-Path $serverDir 'index.js'))) {
    throw 'O zip não contém server/index.js.'
  }
  if (-not (Test-Path -LiteralPath (Join-Path $temp 'client\dist\index.html'))) {
    throw 'O zip não contém client/dist/index.html.'
  }

  $junctionPath = Join-Path $serverDir 'node_modules'
  New-Item -ItemType Junction -Path $junctionPath -Target $nodeModules | Out-Null

  $env:NODE_ENV = 'production'
  $env:PORT = [string]$Port
  $env:HOST = '127.0.0.1'
  $env:JWT_SECRET = ([guid]::NewGuid().ToString('N') + [guid]::NewGuid().ToString('N'))
  $env:DATABASE_PATH = './data/unison.db'
  $env:UPLOAD_DIR = './uploads'
  $env:MAX_UPLOAD_MB = '5'
  $env:CORS_ORIGINS = "http://127.0.0.1:$Port"
  $env:APP_URL = "http://127.0.0.1:$Port"
  $env:COOKIE_SECURE = 'false'
  $env:TRUST_PROXY = 'false'
  $env:EXPOSE_DEV_TOKENS = 'false'

  $stdout = Join-Path $temp 'stdout.log'
  $stderr = Join-Path $temp 'stderr.log'
  Write-Host "==> Iniciando servidor de produção em http://127.0.0.1:$Port"
  $proc = Start-Process -FilePath $node -ArgumentList 'index.js' -WorkingDirectory $serverDir `
    -PassThru -RedirectStandardOutput $stdout -RedirectStandardError $stderr

  $base = "http://127.0.0.1:$Port"
  $health = $null
  for ($i = 0; $i -lt 40; $i++) {
    Start-Sleep -Milliseconds 500
    if ($proc.HasExited) { break }
    try {
      $health = Invoke-RestMethod -Uri "$base/health" -TimeoutSec 2
      if ($health.status -eq 'ok') { break }
    } catch {
      # servidor ainda subindo
    }
  }
  if (-not $health -or $health.status -ne 'ok') {
    Show-Logs -Directory $temp
    throw 'Health check falhou: o servidor não respondeu com status ok.'
  }
  Write-Host '    health: ok'

  $index = Invoke-WebRequest -Uri "$base/" -UseBasicParsing -TimeoutSec 10
  if ($index.StatusCode -ne 200 -or $index.Content -notmatch 'id="root"') {
    throw 'A SPA não foi servida na raiz.'
  }
  Write-Host '    SPA: ok'

  $sw = Invoke-WebRequest -Uri "$base/sw.js" -UseBasicParsing -TimeoutSec 10
  if ($sw.StatusCode -ne 200 -or -not $sw.Headers['Service-Worker-Allowed']) {
    throw 'Service worker não foi servido com Service-Worker-Allowed.'
  }
  Write-Host '    service worker: ok'

  $username = 'smoke_' + (Get-Random -Minimum 100000 -Maximum 999999)
  $email = "$username@example.com"
  $password = 'Senha12345'
  $registerBody = @{
    username = $username
    email = $email
    password = $password
    displayName = 'Smoke Test'
  } | ConvertTo-Json

  $register = Invoke-WebRequest -Uri "$base/api/auth/register" -Method Post `
    -ContentType 'application/json' -Body $registerBody -SessionVariable registerSession -UseBasicParsing -TimeoutSec 20
  $registerJson = $register.Content | ConvertFrom-Json
  if (-not $registerJson.accessToken -or -not $registerJson.user.id) {
    throw 'Registro não retornou accessToken/user.'
  }
  Write-Host "    registro: ok ($username)"

  $loginBody = @{ identifier = $username; password = $password } | ConvertTo-Json
  $login = Invoke-WebRequest -Uri "$base/api/auth/login" -Method Post `
    -ContentType 'application/json' -Body $loginBody -SessionVariable loginSession -UseBasicParsing -TimeoutSec 20
  $loginJson = $login.Content | ConvertFrom-Json
  if (-not $loginJson.accessToken) {
    throw 'Login não retornou accessToken.'
  }
  Write-Host '    login: ok'

  $refresh = Invoke-WebRequest -Uri "$base/api/auth/refresh" -Method Post `
    -WebSession $loginSession -Headers @{ Origin = $base } -UseBasicParsing -TimeoutSec 20
  $refreshJson = $refresh.Content | ConvertFrom-Json
  if (-not $refreshJson.accessToken) {
    throw 'Refresh não retornou accessToken.'
  }
  Write-Host '    refresh cookie: ok'

  $me = Invoke-RestMethod -Uri "$base/api/auth/me" `
    -Headers @{ Authorization = "Bearer $($loginJson.accessToken)" } -TimeoutSec 10
  if (-not $me.user -or $me.user.username -ne $username) {
    throw '/me não retornou o usuário esperado.'
  }
  Write-Host '    /me: ok'

  $dbPath = Join-Path $serverDir 'data\unison.db'
  if (-not (Test-Path -LiteralPath $dbPath)) {
    throw 'O banco SQLite não foi criado em server/data.'
  }
  $uploadPath = Join-Path $serverDir 'uploads'
  if (-not (Test-Path -LiteralPath $uploadPath)) {
    throw 'A pasta uploads não foi criada.'
  }
  Write-Host '    SQLite/uploads: ok'

  Write-Host ''
  Write-Host '==> SMOKE TEST PASSOU'
  Write-Host "    Pacote: $ZipPath"
  Write-Host "    Porta:  $Port"
} catch {
  Write-Host ''
  Write-Host "==> SMOKE TEST FALHOU: $($_.Exception.Message)" -ForegroundColor Red
  if ($temp -and (Test-Path -LiteralPath $temp)) {
    Show-Logs -Directory $temp
  }
  throw
} finally {
  if ($proc -and -not $proc.HasExited) {
    Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 500
  }
  if ($junctionPath -and (Test-Path -LiteralPath $junctionPath)) {
    # Remove o junction sem seguir para o node_modules real.
    [System.IO.Directory]::Delete($junctionPath, $false)
  }
  if (Test-Path -LiteralPath $temp) {
    Remove-Item -LiteralPath $temp -Recurse -Force -ErrorAction SilentlyContinue
  }
}
