# Downscale data/brand/face.jpg for multimodal identity APIs (~1024px, q88).
# Keeps original as face.original.jpg on first run.
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$src = Join-Path $root "data\brand\face.jpg"
$bak = Join-Path $root "data\brand\face.original.jpg"

if (-not (Test-Path $src)) {
  Write-Error "Missing $src"
}

Add-Type -AssemblyName System.Drawing

if (-not (Test-Path $bak)) {
  Copy-Item $src $bak
  Write-Host "Backed up original -> face.original.jpg"
}

$img = [System.Drawing.Image]::FromFile($src)
Write-Host ("Original: {0}x{1}" -f $img.Width, $img.Height)

$max = 1024
$scale = [Math]::Min(1.0, $max / [Math]::Max($img.Width, $img.Height))
$nw = [int][Math]::Round($img.Width * $scale)
$nh = [int][Math]::Round($img.Height * $scale)

$bmp = New-Object System.Drawing.Bitmap $nw, $nh
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
$g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
$g.DrawImage($img, 0, 0, $nw, $nh)
$img.Dispose()
$g.Dispose()

$enc = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() |
  Where-Object { $_.MimeType -eq "image/jpeg" }
$ep = New-Object System.Drawing.Imaging.EncoderParameters 1
$ep.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter (
  [System.Drawing.Imaging.Encoder]::Quality,
  [long]88
)

$tmp = Join-Path $root "data\brand\face.tmp.jpg"
$bmp.Save($tmp, $enc, $ep)
$bmp.Dispose()
Move-Item -Force $tmp $src

$newLen = (Get-Item $src).Length
$oldLen = (Get-Item $bak).Length
Write-Host ("Optimized face.jpg: {0}x{1}, {2} -> {3} bytes" -f $nw, $nh, $oldLen, $newLen)
