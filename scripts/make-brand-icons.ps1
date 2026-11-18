#requires -Version 5.1
<#
.SYNOPSIS
  Gera os ícones do UNISON a partir da arte original.

.DESCRIPTION
  Fonte: assets/branding/unison-logo.png (PNG com fundo transparente).
  Saídas:
    client/public/logo-mark.png          marca transparente para a interface
    client/public/icon-192.png           ícone PWA 192x192
    client/public/icon-512.png           ícone PWA 512x512
    client/public/icon-maskable-512.png  ícone maskable com área segura
    client/public/apple-touch-icon.png   ícone iOS 180x180
    client/public/favicon-32.png         favicon 32x32
    client/public/favicon.svg            favicon SVG com o PNG embutido
    desktop/build/icon.ico               ícone multi-resolução do Windows

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\scripts\make-brand-icons.ps1
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$repoRoot = Split-Path -Parent $PSScriptRoot
$source = Join-Path $repoRoot 'assets\branding\unison-logo.png'
$publicDir = Join-Path $repoRoot 'client\public'
$desktopBuild = Join-Path $repoRoot 'desktop\build'
$temp = Join-Path ([System.IO.Path]::GetTempPath()) ("unison-icons-" + [guid]::NewGuid().ToString('N'))

if (-not (Test-Path -LiteralPath $source)) {
  throw "Arte original não encontrada: $source"
}
New-Item -ItemType Directory -Force -Path $publicDir, $desktopBuild, $temp | Out-Null

$dark = [System.Drawing.Color]::FromArgb(255, 10, 8, 13) # #0A080D
$image = [System.Drawing.Image]::FromFile($source)

function New-Icon {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][int]$Size,
    [Parameter(Mandatory = $true)][ValidateSet('transparent', 'dark')][string]$Background,
    [Parameter(Mandatory = $true)][double]$Scale
  )

  $bitmap = New-Object System.Drawing.Bitmap($Size, $Size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  try {
    if ($Background -eq 'transparent') {
      $graphics.Clear([System.Drawing.Color]::Transparent)
    } else {
      $graphics.Clear($dark)
    }
    $graphics.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceOver
    $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality

    $drawSize = [int][Math]::Round($Size * $Scale)
    $offset = [int][Math]::Floor(($Size - $drawSize) / 2)
    $graphics.DrawImage($image, $offset, $offset, $drawSize, $drawSize)
  } finally {
    $graphics.Dispose()
  }

  try {
    $bitmap.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
  } finally {
    $bitmap.Dispose()
  }
  Write-Host "  $([System.IO.Path]::GetFileName($Path)) ($Size x $Size)"
}

try {
  Write-Host '==> Gerando ícones do UNISON'
  New-Icon -Path (Join-Path $publicDir 'logo-mark.png') -Size 256 -Background transparent -Scale 1.0
  New-Icon -Path (Join-Path $publicDir 'icon-512.png') -Size 512 -Background dark -Scale 0.94
  New-Icon -Path (Join-Path $publicDir 'icon-192.png') -Size 192 -Background dark -Scale 0.94
  New-Icon -Path (Join-Path $publicDir 'icon-maskable-512.png') -Size 512 -Background dark -Scale 0.80
  New-Icon -Path (Join-Path $publicDir 'apple-touch-icon.png') -Size 180 -Background dark -Scale 0.94
  New-Icon -Path (Join-Path $publicDir 'favicon-32.png') -Size 32 -Background dark -Scale 0.94

  $faviconPng = Join-Path $temp 'favicon-128.png'
  New-Icon -Path $faviconPng -Size 128 -Background dark -Scale 0.94
  $base64 = [Convert]::ToBase64String([System.IO.File]::ReadAllBytes($faviconPng))
  $svg = @"
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" role="img" aria-label="UNISON">
  <image width="128" height="128" href="data:image/png;base64,$base64"/>
</svg>
"@
  $utf8 = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText((Join-Path $publicDir 'favicon.svg'), $svg, $utf8)
  Write-Host '  favicon.svg'
} finally {
  $image.Dispose()
  if (Test-Path -LiteralPath $temp) {
    Remove-Item -LiteralPath $temp -Recurse -Force -ErrorAction SilentlyContinue
  }
}

Write-Host '==> Gerando desktop/build/icon.ico'
& (Join-Path $repoRoot 'desktop\scripts\make-icon.ps1')
Write-Host ''
Write-Host 'Ícones gerados com sucesso.'
