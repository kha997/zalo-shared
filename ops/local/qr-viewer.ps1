# Private pilot QR viewer (Windows side).
#
# Waits for the connector to emit its QR into the private view directory,
# stages exactly one local copy, shows it in the foreground, and removes every
# copy when the attempt ends. It never touches the network, never prints the
# image bytes and never keeps the QR after the window closes.
#
# The WSL view directory is owner-only (0700, uid 65532), so the copy is made
# through `wsl.exe -u root`; nothing else runs as root and no password is used.
# Rehearsal:  -FixturePath <png>  stages that local file instead of waiting.
#
# Usage:
#   powershell -NoProfile -ExecutionPolicy Bypass -File qr-viewer.ps1
#   powershell -NoProfile -ExecutionPolicy Bypass -File qr-viewer.ps1 `
#       -FixturePath C:\Users\Admin\pilot-private-qr\synthetic.png

[CmdletBinding()]
param(
  [string]$SourcePath = '/home/zen/pilot-private/zalo-shared/pilot/state/view/qr.png',
  [string]$WslDistribution = 'Ubuntu-24.04',
  [string]$StageDirectory = 'C:\Users\Admin\pilot-private-qr',
  [int]$TimeoutSeconds = 300,
  [string]$FixturePath = '',
  # Rehearsal only: close the window after N seconds so an automated check can
  # verify display and cleanup without a person. Zero keeps the window open.
  [int]$AutoCloseSeconds = 0
)

$ErrorActionPreference = 'Stop'
$stage = Join-Path $StageDirectory 'qr.png'
$log = Join-Path $StageDirectory 'qr-viewer.log'
$maxQrBytes = 1MB

# Base64 keeps this file ASCII so Windows PowerShell 5.1 cannot mis-decode the
# Vietnamese instruction: "Quet ma bang ung dung Zalo A tren dien thoai."
$instruction = [Text.Encoding]::UTF8.GetString(
  [Convert]::FromBase64String(
    'UXXDqXQgbcOjIGLhurFuZyDhu6luZyBk4bulbmcgWmFsbyBBIHRyw6puIMSRaeG7h24gdGhv4bqhaS4='
  )
)

function Write-Log([string]$line) {
  $stamp = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
  Add-Content -LiteralPath $log -Value "$stamp $line" -Encoding UTF8
}

function Remove-Staged {
  if (Test-Path -LiteralPath $stage) {
    Remove-Item -LiteralPath $stage -Force -ErrorAction SilentlyContinue
  }
}

function Test-Png([string]$path) {
  $info = [System.IO.FileInfo]::new($path)
  if (-not $info.Exists -or $info.Length -lt 33 -or $info.Length -gt $maxQrBytes) {
    return $false
  }
  $bytes = [byte[]]::new(33)
  $read = 0
  $stream = [System.IO.File]::OpenRead($path)
  try {
    while ($read -lt 33) {
      $n = $stream.Read($bytes, $read, 33 - $read)
      if ($n -le 0) { break }
      $read += $n
    }
  } finally {
    $stream.Dispose()
  }
  if ($read -ne 33) { return $false }
  $signature = [byte[]](0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)
  for ($i = 0; $i -lt $signature.Length; $i++) {
    if ($bytes[$i] -ne $signature[$i]) { return $false }
  }
  if ([Text.Encoding]::ASCII.GetString($bytes, 12, 4) -ne 'IHDR') { return $false }
  $width = ([int]$bytes[16] -shl 24) -bor ([int]$bytes[17] -shl 16) -bor `
           ([int]$bytes[18] -shl 8) -bor [int]$bytes[19]
  $height = ([int]$bytes[20] -shl 24) -bor ([int]$bytes[21] -shl 16) -bor `
            ([int]$bytes[22] -shl 8) -bor [int]$bytes[23]
  return ($width -gt 0 -and $width -le 4096 -and $height -gt 0 -and $height -le 4096)
}

function ConvertTo-WslPath([string]$windowsPath) {
  $full = [System.IO.Path]::GetFullPath($windowsPath)
  $drive = $full.Substring(0, 1).ToLowerInvariant()
  $rest = $full.Substring(2).Replace('\', '/')
  return "/mnt/$drive$rest"
}

if (-not (Test-Path -LiteralPath $StageDirectory)) {
  New-Item -ItemType Directory -Path $StageDirectory -Force | Out-Null
}

# A previous run must never leave a QR behind.
Remove-Staged
$wslStage = ConvertTo-WslPath $stage
Write-Log "viewer-start fixture=$([bool]$FixturePath) timeout=${TimeoutSeconds}s"

$deadline = (Get-Date).AddSeconds($TimeoutSeconds)
$found = $false
while (-not $found -and (Get-Date) -lt $deadline) {
  if ($FixturePath) {
    Copy-Item -LiteralPath $FixturePath -Destination $stage -Force
    $found = $true
  } else {
    & wsl.exe -d $WslDistribution -u root -- test -f $SourcePath 2>$null
    if ($LASTEXITCODE -eq 0) {
      & wsl.exe -d $WslDistribution -u root -- cp $SourcePath $wslStage 2>$null
      if ($LASTEXITCODE -eq 0 -and (Test-Path -LiteralPath $stage)) {
        $found = $true
      }
    }
  }
  if (-not $found) { Start-Sleep -Milliseconds 300 }
}

if (-not $found) {
  Write-Log 'viewer-timeout no-qr'
  exit 3
}

if (-not (Test-Png $stage)) {
  Remove-Staged
  Write-Log 'viewer-refused invalid-png'
  exit 4
}
$sha = (Get-FileHash -LiteralPath $stage -Algorithm SHA256).Hash.ToLowerInvariant()
Write-Log "viewer-staged sha256=$sha"

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$image = [System.Drawing.Image]::FromFile($stage)
$form = New-Object System.Windows.Forms.Form
$form.Text = 'Zalo pilot - QR'
$form.StartPosition = 'CenterScreen'
$form.FormBorderStyle = 'FixedSingle'
$form.MaximizeBox = $false
$form.MinimizeBox = $false
$form.BackColor = [System.Drawing.Color]::White
$form.ClientSize = New-Object System.Drawing.Size(560, 660)
$form.TopMost = $true

$label = New-Object System.Windows.Forms.Label
$label.Text = $instruction
$label.TextAlign = 'MiddleCenter'
$label.Font = New-Object System.Drawing.Font('Segoe UI', 12, [System.Drawing.FontStyle]::Bold)
$label.Bounds = New-Object System.Drawing.Rectangle(20, 16, 520, 56)
$form.Controls.Add($label)

$panel = New-Object System.Windows.Forms.Panel
$panel.Bounds = New-Object System.Drawing.Rectangle(40, 84, 480, 480)
$panel.BackColor = [System.Drawing.Color]::White
$form.Controls.Add($panel)

$picture = New-Object System.Windows.Forms.PictureBox
$picture.Dock = 'Fill'
# Zoom preserves the QR's square aspect ratio whatever the source size is.
$picture.SizeMode = [System.Windows.Forms.PictureBoxSizeMode]::Zoom
$picture.Image = $image
$panel.Controls.Add($picture)

$hint = New-Object System.Windows.Forms.Label
$hint.Text = 'Cua so tu dong dong va xoa ma khi phien ket thuc.'
$hint.TextAlign = 'MiddleCenter'
$hint.Bounds = New-Object System.Drawing.Rectangle(20, 580, 520, 40)
$form.Controls.Add($hint)

$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 1000

# The connector owns its private view file and clears it on success, failure
# and expiry, so the viewer only ever removes its own staged copy.
$cleanup = {
  try { $timer.Stop() } catch {}
  try { $picture.Image = $null; $image.Dispose() } catch {}
  Remove-Staged
  Write-Log 'viewer-form-closing staged-copy-removed'
}

$timer.Add_Tick({
  if (-not $FixturePath) {
    & wsl.exe -d $WslDistribution -u root -- test -f $SourcePath 2>$null
    if ($LASTEXITCODE -ne 0) {
      Write-Log 'viewer-close source-cleared'
      $form.Close()
    }
  }
})

$form.Add_Shown({
  $form.Activate()
  $timer.Start()
  if ($AutoCloseSeconds -gt 0) {
    $auto = New-Object System.Windows.Forms.Timer
    $auto.Interval = $AutoCloseSeconds * 1000
    $auto.Add_Tick({
      $auto.Stop()
      Write-Log 'viewer-autoclose rehearsal'
      $form.Close()
    })
    $auto.Start()
  }
})
$form.Add_FormClosing({
  & $cleanup
})

try {
  [System.Windows.Forms.Application]::Run($form)
} finally {
  if (Test-Path -LiteralPath $stage) {
    Remove-Staged
    Write-Log 'viewer-closed cleanup=final'
  }
  try { $image.Dispose() } catch {}
}
exit 0
