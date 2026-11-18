# Gera desktop/build/icon.ico a partir do ícone 512x512 do PWA.
# Uso: powershell -ExecutionPolicy Bypass -File desktop\scripts\make-icon.ps1
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$source = Join-Path $root 'client\public\icon-512.png'
$outputDir = Join-Path $root 'desktop\build'
$output = Join-Path $outputDir 'icon.ico'
$sizes = @(16, 24, 32, 48, 64, 128, 256)

if (-not (Test-Path $source)) { throw "Icone de origem nao encontrado: $source" }
New-Item -ItemType Directory -Force -Path $outputDir | Out-Null

$image = [System.Drawing.Image]::FromFile($source)
$entries = [System.Collections.Generic.List[object]]::new()

try {
  foreach ($size in $sizes) {
    $bitmap = New-Object System.Drawing.Bitmap($size, $size)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    try {
      $graphics.Clear([System.Drawing.Color]::Transparent)
      $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
      $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
      $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
      $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
      $graphics.DrawImage($image, 0, 0, $size, $size)
    } finally {
      $graphics.Dispose()
    }

    $stream = New-Object System.IO.MemoryStream
    try {
      $bitmap.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
      $entries.Add([PSCustomObject]@{
        Size = $size
        Bytes = $stream.ToArray()
      })
    } finally {
      $stream.Dispose()
      $bitmap.Dispose()
    }
  }
} finally {
  $image.Dispose()
}

$file = [System.IO.File]::Create($output)
$writer = New-Object System.IO.BinaryWriter($file)
try {
  $writer.Write([UInt16]0)
  $writer.Write([UInt16]1)
  $writer.Write([UInt16]$entries.Count)

  $offset = 6 + (16 * $entries.Count)
  foreach ($entry in $entries) {
    $dimension = if ($entry.Size -ge 256) { 0 } else { $entry.Size }
    $writer.Write([Byte]$dimension)
    $writer.Write([Byte]$dimension)
    $writer.Write([Byte]0)
    $writer.Write([Byte]0)
    $writer.Write([UInt16]1)
    $writer.Write([UInt16]32)
    $writer.Write([UInt32]$entry.Bytes.Length)
    $writer.Write([UInt32]$offset)
    $offset += $entry.Bytes.Length
  }

  foreach ($entry in $entries) {
    $writer.Write($entry.Bytes)
  }
} finally {
  $writer.Dispose()
  $file.Dispose()
}

Write-Output "Icone gerado: $output ($((Get-Item $output).Length) bytes)"
