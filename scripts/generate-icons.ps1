# Generate the extension's PNG icon assets from a single script.
#
# Outputs (all under static/):
#   logo.png                  — 256x256 Marketplace listing icon
#   documents-hub-light.png   — 32x32 Documents hub icon (light theme)
#   documents-hub-dark.png    — 32x32 Documents hub icon (dark theme)
#
# Run with PowerShell on Windows (uses System.Drawing.Common, which is the
# Windows-only GDI+ bridge). Re-run after changing the design.
#
#   pwsh -NoProfile -ExecutionPolicy Bypass -File scripts/generate-icons.ps1

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Drawing

$repoRoot = Split-Path -Parent $PSScriptRoot
$staticDir = Join-Path $repoRoot "static"
if (-not (Test-Path $staticDir)) {
    New-Item -ItemType Directory -Path $staticDir -Force | Out-Null
}

# ---------- palette ----------
$BrandBlue  = [System.Drawing.Color]::FromArgb(0,   120, 212)   # #0078D4 — Azure brand
$Accent     = [System.Drawing.Color]::FromArgb(255, 193, 7)     # #FFC107 — review highlight
$Ink        = [System.Drawing.Color]::FromArgb(31,  31,  31)    # #1F1F1F — light-theme ink
$InkInverse = [System.Drawing.Color]::FromArgb(240, 240, 240)   # #F0F0F0 — dark-theme ink
$Paper      = [System.Drawing.Color]::FromArgb(240, 246, 252)   # #F0F6FC — doc fill
$LineGrey   = [System.Drawing.Color]::FromArgb(180, 180, 180)
$Snow       = [System.Drawing.Color]::White

function New-Canvas([int]$w, [int]$h, [System.Drawing.Color]$bg, [bool]$transparent = $false) {
    $bmp = New-Object System.Drawing.Bitmap($w, $h, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode      = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.InterpolationMode  = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.PixelOffsetMode    = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.TextRenderingHint  = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
    if (-not $transparent) {
        $brush = New-Object System.Drawing.SolidBrush($bg)
        $g.FillRectangle($brush, 0, 0, $w, $h)
        $brush.Dispose()
    }
    return [pscustomobject]@{ Bmp = $bmp; G = $g }
}

function Save-Canvas($ctx, [string]$path) {
    $ctx.G.Dispose()
    $ctx.Bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
    $ctx.Bmp.Dispose()
    Write-Host "wrote $path"
}

# Build a "document" path: rectangle with a triangular folded-corner top-right.
function New-DocPath([float]$x, [float]$y, [float]$w, [float]$h, [float]$fold) {
    $p = New-Object System.Drawing.Drawing2D.GraphicsPath
    $p.AddLine($x,               $y,             $x + $w - $fold, $y)
    $p.AddLine($x + $w - $fold,  $y,             $x + $w,         $y + $fold)
    $p.AddLine($x + $w,          $y + $fold,     $x + $w,         $y + $h)
    $p.AddLine($x + $w,          $y + $h,        $x,              $y + $h)
    $p.CloseFigure()
    return $p
}

function Draw-Doc($g, [float]$x, [float]$y, [float]$w, [float]$h, [float]$fold,
                  $fillColor, $strokeColor, [float]$strokeWidth) {
    $path = New-DocPath $x $y $w $h $fold
    if ($null -ne $fillColor) {
        $brush = New-Object System.Drawing.SolidBrush($fillColor)
        $g.FillPath($brush, $path)
        $brush.Dispose()
    }
    if ($null -ne $strokeColor) {
        $pen = New-Object System.Drawing.Pen($strokeColor, $strokeWidth)
        $pen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
        $g.DrawPath($pen, $path)
        # Draw the fold's two interior edges so the corner reads as folded.
        $g.DrawLine($pen, ($x + $w - $fold), $y,             ($x + $w - $fold), ($y + $fold))
        $g.DrawLine($pen, ($x + $w - $fold), ($y + $fold),   ($x + $w),         ($y + $fold))
        $pen.Dispose()
    }
    $path.Dispose()
}

# ============================================================================
# 1) Marketplace logo — 256x256
# ============================================================================
$ctx = New-Canvas 256 256 $Snow

# Document body
Draw-Doc $ctx.G 56 40 124 168 28 $Paper $BrandBlue 6

# Text lines inside the document
$lineBrush  = New-Object System.Drawing.SolidBrush($LineGrey)
$accentBrush = New-Object System.Drawing.SolidBrush($Accent)
$leftX  = 72
$rightX = 164
$lineH  = 6
$lineSpacing = 20
$lineY  = 84
for ($i = 0; $i -lt 5; $i++) {
    $y = $lineY + $i * $lineSpacing
    $w = if ($i -eq 4) { 56 } else { $rightX - $leftX }
    if ($i -eq 2) {
        # Highlighted "selected/reviewed" line
        $ctx.G.FillRectangle($accentBrush, ($leftX - 4), ($y - 4), ($rightX - $leftX + 8), ($lineH + 8))
    }
    $ctx.G.FillRectangle($lineBrush, $leftX, $y, $w, $lineH)
}
$lineBrush.Dispose()
$accentBrush.Dispose()

# Comment bubble (overlapping bottom-right corner of the doc)
$bubbleX = 142
$bubbleY = 150
$bubbleSize = 72
$haloPen = New-Object System.Drawing.Pen($Snow, 8)
$ctx.G.DrawEllipse($haloPen, $bubbleX, $bubbleY, $bubbleSize, $bubbleSize)
$haloPen.Dispose()

$bubbleBrush = New-Object System.Drawing.SolidBrush($BrandBlue)
$ctx.G.FillEllipse($bubbleBrush, $bubbleX, $bubbleY, $bubbleSize, $bubbleSize)
$bubbleBrush.Dispose()

# Three white dots inside the bubble
$dotBrush = New-Object System.Drawing.SolidBrush($Snow)
$dotR  = 5
$cx    = $bubbleX + $bubbleSize / 2
$cy    = $bubbleY + $bubbleSize / 2
foreach ($dx in @(-14, 0, 14)) {
    $ctx.G.FillEllipse($dotBrush, ($cx + $dx - $dotR), ($cy - $dotR), ($dotR * 2), ($dotR * 2))
}
$dotBrush.Dispose()

Save-Canvas $ctx (Join-Path $staticDir "logo.png")

# ============================================================================
# Helper for hub icon — 32x32 stack-of-documents silhouette
# ============================================================================
function New-HubIcon([string]$outPath, $strokeColor, $innerFill) {
    $ctx = New-Canvas 32 32 ([System.Drawing.Color]::Transparent) $true

    # Back document — peeking up and to the right
    Draw-Doc $ctx.G 10 4 18 22 5 $null $strokeColor 1.6

    # Front document — filled with inner-fill color to mask the back doc behind it
    Draw-Doc $ctx.G 4 8 18 22 5 $innerFill $strokeColor 1.6

    # Three text lines inside the front document
    $linePen = New-Object System.Drawing.Pen($strokeColor, 1.4)
    $linePen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $linePen.EndCap   = [System.Drawing.Drawing2D.LineCap]::Round
    $ctx.G.DrawLine($linePen, 8, 15, 18, 15)
    $ctx.G.DrawLine($linePen, 8, 19, 18, 19)
    $ctx.G.DrawLine($linePen, 8, 23, 14, 23)
    $linePen.Dispose()

    Save-Canvas $ctx $outPath
}

# ============================================================================
# 2) Documents hub icon — light theme (dark ink on transparent)
# ============================================================================
New-HubIcon (Join-Path $staticDir "documents-hub-light.png") $Ink ([System.Drawing.Color]::FromArgb(255, 255, 255))

# ============================================================================
# 3) Documents hub icon — dark theme (light ink on transparent)
# ============================================================================
# In ADO dark theme the host bg is ~#1F1F1F; use a near-matching subtle fill
# so the front sheet visibly masks the back sheet without flashing white.
New-HubIcon (Join-Path $staticDir "documents-hub-dark.png") $InkInverse ([System.Drawing.Color]::FromArgb(31, 31, 31))

Write-Host ""
Write-Host "done."
