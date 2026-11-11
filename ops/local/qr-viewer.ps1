# Private pilot QR viewer (Windows side).
#
# Waits for the connector to emit its QR into the private view directory,
# stages exactly one local copy, shows it in the foreground, and removes every
# copy when the attempt ends. It never touches the network, never prints the
# image bytes and never keeps the QR after the window closes.
#
# Cleanup is defence in depth, because the 2026-11-11 run left the staged copy
# behind after `viewer-close source-cleared`:
#   1. every cleanup step is non-throwing (log, delete, dispose) so a close
#      cannot be aborted halfway;
#   2. an independent guard process waits for this PID and removes the staged
#      copy after the viewer is gone, including on a forced kill;
#   3. the guard only touches a copy whose run id still matches the run that
#      spawned it, so a newer attempt's QR is never deleted by an older guard.
#
# The WSL view directory is owner-only (0700, uid 65532), so the copy is made
# through `wsl.exe -u root`. That root shell is one command away for any local
# Windows account, so this viewer is a single-operator convenience on a
# dedicated host, not an access boundary.
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
  [int]$AutoCloseSeconds = 0,
  # The attempt id from the launcher. Two launches of one attempt share it, so a
  # duplicate start is recognised; a new attempt has a different id and the old
  # viewer closes on the ownership change instead of showing the new QR.
  [string]$RunId = '',
  # Rehearsal only: place the window outside every desktop so a lifecycle test
  # can run without flashing a QR at the Owner. A live attempt never sets this.
  [switch]$Offscreen
)

$ErrorActionPreference = 'Stop'
$stage = Join-Path $StageDirectory 'qr.png'
$runFile = Join-Path $StageDirectory 'qr-viewer-run.txt'
$ownerFile = Join-Path $StageDirectory 'qr-viewer-owner.txt'
$stateLock = Join-Path $StageDirectory 'qr-viewer-state.lock'
$log = Join-Path $StageDirectory 'qr-viewer.log'
$guardScript = Join-Path $PSScriptRoot 'qr-viewer-guard.ps1'
$maxQrBytes = 1MB
if ([string]::IsNullOrWhiteSpace($RunId)) { $RunId = [Guid]::NewGuid().ToString() }
if ($RunId -notmatch '^[A-Za-z0-9._-]{1,64}$') {
  Write-Output 'qr-viewer: REFUSED invalid run id'
  exit 4
}

# Base64 keeps this file ASCII so Windows PowerShell 5.1 cannot mis-decode the
# Vietnamese instruction: "Quet ma bang ung dung Zalo A tren dien thoai."
$instruction = [Text.Encoding]::UTF8.GetString(
  [Convert]::FromBase64String(
    'UXXDqXQgbcOjIGLhurFuZyDhu6luZyBk4bulbmcgWmFsbyBBIHRyw6puIMSRaeG7h24gdGhv4bqhaS4='
  )
)

# Never throw: a log write must not abort a close. FileShare.ReadWrite lets the
# termination guard append to the same file at the same time.
function Write-Log([string]$line) {
  $stamp = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
  $bytes = [Text.Encoding]::UTF8.GetBytes("$stamp $line`r`n")
  for ($i = 0; $i -lt 4; $i++) {
    try {
      $file = [System.IO.FileStream]::new(
        $log,
        [System.IO.FileMode]::Append,
        [System.IO.FileAccess]::Write,
        [System.IO.FileShare]::ReadWrite
      )
      try { $file.Write($bytes, 0, $bytes.Length) } finally { $file.Dispose() }
      return
    } catch {
      Start-Sleep -Milliseconds 100
    }
  }
}

# The launcher starts this process detached, so Windows gives it a console of
# its own. Hide that console handle (never the form) so the Owner sees only the
# QR window, and never fail the run if the call is unavailable.
try {
  Add-Type -Namespace PilotQr -Name ConsoleWindow -MemberDefinition @'
[DllImport("kernel32.dll")] public static extern System.IntPtr GetConsoleWindow();
[DllImport("user32.dll")] public static extern bool ShowWindow(System.IntPtr hWnd, int nCmdShow);
[DllImport("user32.dll")] public static extern bool IsWindowVisible(System.IntPtr hWnd);
'@
  $consoleHandle = [PilotQr.ConsoleWindow]::GetConsoleWindow()
  if ($consoleHandle -ne [System.IntPtr]::Zero) {
    [PilotQr.ConsoleWindow]::ShowWindow($consoleHandle, 0) | Out-Null
    Write-Log "viewer-console handle=present visible=$([PilotQr.ConsoleWindow]::IsWindowVisible($consoleHandle))"
  } else {
    Write-Log 'viewer-console handle=absent'
  }
} catch {
  Write-Log 'viewer-console hide=unavailable'
}

# Enumerating the directory reports a real I/O failure, while File.Exists
# reports every failure as "absent" — a single false answer here would let the
# viewer report a clean close over a QR that is still on disk. Returns $true,
# $false, or $null when the directory could not be read at all.
function Get-StagePresent {
  for ($i = 0; $i -lt 5; $i++) {
    try {
      foreach ($entry in [System.IO.Directory]::EnumerateFileSystemEntries($StageDirectory)) {
        if ([string]::Equals($entry, $stage, [StringComparison]::OrdinalIgnoreCase)) { return $true }
      }
      return $false
    } catch {
      Start-Sleep -Milliseconds 100
    }
  }
  return $null
}

# Never throw: report whether the staged copy is gone. Absence is only believed
# after it holds for a confirmation window, so a transient miss cannot be
# mistaken for a successful removal. The state lock is what closes the
# check-then-delete race with the guard: the guard re-reads the run id and
# deletes inside this exclusive handle, and this run writes its run id inside the
# same handle before staging anything, so the guard's delete is ordered either
# before this run's claim (nothing to delete) or after it (ownership changed).
function Enter-StateLock {
  for ($i = 0; $i -lt 40; $i++) {
    try {
      return [System.IO.File]::Open(
        $stateLock,
        [System.IO.FileMode]::OpenOrCreate,
        [System.IO.FileAccess]::ReadWrite,
        [System.IO.FileShare]::None
      )
    } catch {
      Start-Sleep -Milliseconds 50
    }
  }
  return $null
}

function Test-OwnerCurrent {
  try {
    if (-not [System.IO.File]::Exists($ownerFile)) { return $false }
    return (([System.IO.File]::ReadAllText($ownerFile)).Trim() -eq $RunId)
  } catch {
    return $false
  }
}

function Remove-Staged {
  for ($i = 0; $i -lt 10; $i++) {
    $lock = Enter-StateLock
    try {
      $present = Get-StagePresent
      if ($present -eq $false -and -not (Test-Path -LiteralPath $stage)) { return $true }
      if ($present -eq $true) {
        try { [System.IO.File]::Delete($stage) } catch {}
      }
    } finally {
      if ($lock) { try { $lock.Dispose() } catch {} }
    }
    [GC]::Collect()
    [GC]::WaitForPendingFinalizers()
    Start-Sleep -Milliseconds 200
  }
  for ($i = 0; $i -lt 12; $i++) {
    if ((Get-StagePresent) -eq $false -and -not (Test-Path -LiteralPath $stage)) { return $true }
    Start-Sleep -Milliseconds 250
  }
  return $false
}

# Only the run that still owns the owner file clears it, inside the state lock,
# so a newer attempt's ownership is never removed by an old viewer.
function Clear-Owner {
  $lock = Enter-StateLock
  if (-not $lock) { return }
  try {
    if ([System.IO.File]::Exists($ownerFile) -and
        ([System.IO.File]::ReadAllText($ownerFile)).Trim() -eq $RunId) {
      [System.IO.File]::Delete($ownerFile)
    }
  } catch {
  } finally {
    try { $lock.Dispose() } catch {}
  }
}

function Write-RunId {
  # Written inside the guard's state lock so the guard can never read the old
  # id, then delete a copy this run staged after the read.
  $lock = Enter-StateLock
  try {
    [System.IO.File]::WriteAllText($runFile, $RunId, [Text.Encoding]::ASCII)
  } catch {} finally {
    if ($lock) { try { $lock.Dispose() } catch {} }
  }
}

function Clear-RunId {
  try {
    if ([System.IO.File]::Exists($runFile) -and
        ([System.IO.File]::ReadAllText($runFile)).Trim() -eq $RunId) {
      [System.IO.File]::Delete($runFile)
    }
  } catch {}
  Clear-Owner
}

# The launcher treats an old run file as a stale copy left by a dead run. A live
# viewer therefore keeps its run file fresh until it closes, so a second launch
# during a long display never deletes the copy this run is showing.
function Touch-RunId {
  try {
    if (-not [System.IO.File]::Exists($runFile)) { return }
    if (([System.IO.File]::ReadAllText($runFile)).Trim() -ne $runId) { return }
    [System.IO.File]::SetLastWriteTimeUtc($runFile, [DateTime]::UtcNow)
  } catch {}
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

# wsl.exe hands its arguments to a shell inside the distribution, so a root
# copy must never receive a path that can carry separators or shell syntax.
if ($WslDistribution -notmatch '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$') {
  Write-Log 'viewer-refused invalid-distribution'
  exit 4
}
if ($SourcePath -notmatch '^/[A-Za-z0-9._/-]+$') {
  Write-Log 'viewer-refused invalid-source'
  exit 4
}
$wslStage = ConvertTo-WslPath $stage
if ($wslStage -notmatch '^/mnt/[a-z]/[A-Za-z0-9._/-]+$') {
  Write-Log 'viewer-refused invalid-stage'
  exit 4
}

# Ownership is claimed before anything is staged. The launcher writes the same
# id, so a viewer that finds a different one was superseded before it started;
# it exits without touching the newer run's files.
$claimLock = Enter-StateLock
try {
  if (-not $claimLock) {
    Write-Log 'viewer-refused state-lock-timeout'
    exit 5
  }
  if ([System.IO.File]::Exists($ownerFile)) {
    $owner = ([System.IO.File]::ReadAllText($ownerFile)).Trim()
    if ($owner -and $owner -ne $RunId) {
      Write-Log "viewer-refused superseded owner=$owner run=$RunId"
      exit 0
    }
  }
  [System.IO.File]::WriteAllText($ownerFile, $RunId, [Text.Encoding]::ASCII)
} finally {
  if ($claimLock) { try { $claimLock.Dispose() } catch {} }
}

# A previous run's QR must not survive, and a copy that cannot be removed must
# stop this run before another one is staged.
if (-not (Remove-Staged)) {
  Write-Log 'viewer-refused stale-copy-remains'
  exit 5
}
Write-RunId
Write-Log "viewer-start pid=$PID run=$runId fixture=$([bool]$FixturePath) timeout=${TimeoutSeconds}s"

# The guard is started before anything is staged. It survives this process and
# removes the copy after termination, whatever path got us there.
$guardStarted = $false
try {
  if (Test-Path -LiteralPath $guardScript) {
    Start-Process -FilePath 'powershell.exe' -WindowStyle Hidden -ArgumentList @(
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $guardScript,
      '-ViewerPid', "$PID", '-RunId', $runId, '-StageDirectory', $StageDirectory
    ) | Out-Null
    $guardStarted = $true
  }
} catch {}

# A started process is not a running guard: wait for its own ready record, so a
# guard that died at startup stops this run before any QR is staged.
$guardReady = $false
if ($guardStarted) {
  $readyDeadline = (Get-Date).AddSeconds(20)
  while (-not $guardReady -and (Get-Date) -lt $readyDeadline) {
    try {
      if (([System.IO.File]::ReadAllText($log)).Contains("viewer-guard ready pid=$PID run=$runId")) {
        $guardReady = $true
        break
      }
    } catch {}
    if (-not $guardReady) { Start-Sleep -Milliseconds 200 }
  }
  Write-Log "viewer-guard started pid=$PID run=$runId ready=$guardReady"
}
if (-not ($guardStarted -and $guardReady)) {
  # Without a live guard a forced kill could leave the QR behind, so this run
  # fails closed instead of staging a copy nothing would remove.
  if (-not (Remove-Staged)) {
    Write-Log 'viewer-refused guard-unavailable cleanup=FAILED'
    exit 5
  }
  Clear-RunId
  Write-Log 'viewer-refused guard-unavailable'
  exit 5
}

# A window created in a non-interactive session (0) is invisible to the logged-on
# Owner, so record the session and let the launcher refuse that outcome.
$sessionId = [System.Diagnostics.Process]::GetCurrentProcess().SessionId
Write-Log "viewer-session id=$sessionId interactive=$([Environment]::UserInteractive) run=$RunId"

$deadline = (Get-Date).AddSeconds($TimeoutSeconds)
$found = $false
while (-not $found -and (Get-Date) -lt $deadline) {
  if ($FixturePath) {
    try {
      Copy-Item -LiteralPath $FixturePath -Destination $stage -Force
      $found = $true
    } catch {
      if (-not (Remove-Staged)) {
        Write-Log 'viewer-refused fixture-copy-failed cleanup=FAILED'
        exit 5
      }
      Clear-RunId
      Write-Log 'viewer-refused fixture-copy-failed'
      exit 4
    }
  } else {
    & wsl.exe -d $WslDistribution -u root -- test -f $SourcePath 2>$null
    if ($LASTEXITCODE -eq 0) {
      & wsl.exe -d $WslDistribution -u root -- cp $SourcePath $wslStage 2>$null
      if ($LASTEXITCODE -eq 0 -and (Test-Path -LiteralPath $stage)) {
        $found = $true
      }
    }
  }
  if (-not $found) {
    Touch-RunId
    Start-Sleep -Milliseconds 300
  }
}

if (-not $found) {
  if (-not (Remove-Staged)) {
    Write-Log "viewer-timeout no-qr cleanup=FAILED run=$RunId"
    exit 5
  }
  Clear-RunId
  Write-Log "viewer-timeout no-qr run=$RunId"
  exit 3
}

if (-not (Test-Png $stage)) {
  if (-not (Remove-Staged)) {
    Write-Log 'viewer-refused invalid-png cleanup=FAILED'
    exit 5
  }
  Clear-RunId
  Write-Log 'viewer-refused invalid-png'
  exit 4
}
$sha = (Get-FileHash -LiteralPath $stage -Algorithm SHA256).Hash.ToLowerInvariant()
Write-Log "viewer-staged sha256=$sha run=$runId"

$image = $null
$stream = $null
$picture = $null
$timer = $null
$form = $null
# Kept in script scope: an event handler cannot see a local of another handler.
$closeAt = if ($AutoCloseSeconds -gt 0) { (Get-Date).AddSeconds($AutoCloseSeconds) } else { $null }
$script:displayDeadline = $null
$script:cleanupDone = $false
$script:currentSha = $sha
$script:lastRefreshState = ''
$refresh = Join-Path $StageDirectory 'qr-refresh.tmp'
$refreshWsl = ConvertTo-WslPath $refresh
if ($refreshWsl -notmatch '^/mnt/[a-z]/[A-Za-z0-9._/-]+$') {
  Write-Log 'viewer-refused invalid-refresh-path'
  exit 4
}

# A connector that rewrites its QR during one attempt must update this window in
# place, never open another. The new bytes are written to a same-volume temp,
# validated and decoded before the window swaps to them, so a half-written source
# never reaches the Owner and the old image stays until the new one is ready.
function Update-FromSource {
  & wsl.exe -d $WslDistribution -u root -- test -f $SourcePath 2>$null
  if ($LASTEXITCODE -ne 0) { return 'absent' }
  Remove-Item -LiteralPath $refresh -Force -ErrorAction SilentlyContinue
  & wsl.exe -d $WslDistribution -u root -- cp $SourcePath $refreshWsl 2>$null
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $refresh)) {
    Remove-Item -LiteralPath $refresh -Force -ErrorAction SilentlyContinue
    return 'unreadable'
  }
  if (-not (Test-Png $refresh)) {
    Remove-Item -LiteralPath $refresh -Force -ErrorAction SilentlyContinue
    return 'invalid'
  }
  $newSha = (Get-FileHash -LiteralPath $refresh -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($newSha -eq $script:currentSha) {
    Remove-Item -LiteralPath $refresh -Force -ErrorAction SilentlyContinue
    return 'unchanged'
  }
  $bytes = [System.IO.File]::ReadAllBytes($refresh)
  $newStream = New-Object System.IO.MemoryStream
  $newStream.Write($bytes, 0, $bytes.Length)
  $newStream.Position = 0
  $newImage = $null
  try {
    $newImage = [System.Drawing.Image]::FromStream($newStream)
  } catch {
    $newStream.Dispose()
    Remove-Item -LiteralPath $refresh -Force -ErrorAction SilentlyContinue
    return 'undecodable'
  }
  [System.IO.File]::Copy($refresh, $stage, $true)
  Remove-Item -LiteralPath $refresh -Force -ErrorAction SilentlyContinue
  $oldImage = $script:currentImage
  $script:currentImage = $newImage
  if ($picture) { $picture.Image = $newImage }
  if ($oldImage) { try { $oldImage.Dispose() } catch {} }
  if ($script:stream) { try { $script:stream.Dispose() } catch {} }
  $script:image = $newImage
  $script:stream = $newStream
  $script:currentSha = $newSha
  Write-Log "viewer-refreshed sha256=$newSha run=$RunId"
  return 'refreshed'
}

# The connector owns its private view file and clears it on success, failure
# and expiry, so the viewer only ever removes its own staged copy. Every step
# is guarded: under $ErrorActionPreference='Stop' one throw here would abort
# the close and leave the QR behind. Defined before anything that can throw so
# the finally below always has a working cleanup.
function Invoke-Cleanup([string]$where) {
  if ($script:cleanupDone) { return }
  $script:cleanupDone = $true
  try { if ($timer) { $timer.Stop() } } catch {}
  try { if ($picture) { $picture.Image = $null } } catch {}
  try { if ($image) { $image.Dispose() } } catch {}
  if (Remove-Staged) {
    Write-Log "viewer-$where staged-copy-removed run=$RunId"
  } else {
    Write-Log "viewer-$where staged-copy-remains run=$RunId"
  }
}

try {
  Add-Type -AssemblyName System.Windows.Forms
  Add-Type -AssemblyName System.Drawing

  # Decode from memory: a file lock would make the staged copy unremovable and a
  # header-valid but corrupt PNG would otherwise survive as a scannable file.
  $bytes = [System.IO.File]::ReadAllBytes($stage)
  $stream = New-Object System.IO.MemoryStream
  $stream.Write($bytes, 0, $bytes.Length)
  $stream.Position = 0
  try {
    $image = [System.Drawing.Image]::FromStream($stream)
  } catch {
    $stream.Dispose()
    $stream = $null
    if (-not (Remove-Staged)) {
      Write-Log 'viewer-refused undecodable-png cleanup=FAILED'
      exit 5
    }
    Clear-RunId
    Write-Log 'viewer-refused undecodable-png'
    exit 4
  }
  $script:currentImage = $image

  $form = New-Object System.Windows.Forms.Form
  $form.Text = 'Zalo pilot - QR'
  $form.StartPosition = 'CenterScreen'
  $form.FormBorderStyle = 'FixedSingle'
  $form.MaximizeBox = $false
  $form.MinimizeBox = $false
  $form.BackColor = [System.Drawing.Color]::White
  $form.ClientSize = New-Object System.Drawing.Size(560, 660)
  $form.TopMost = $true
  # An operator must not have to hunt for the window: normal state, taskbar entry
  # and an explicit foreground activation when it is shown.
  $form.WindowState = 'Normal'
  $form.ShowInTaskbar = $true
  if ($Offscreen) {
    # Rehearsal only: far outside the virtual desktop, no taskbar entry and no
    # topmost activation, so the lifecycle test never flashes a QR.
    $form.StartPosition = 'Manual'
    $form.Location = New-Object System.Drawing.Point(-32000, -32000)
    $form.ShowInTaskbar = $false
    $form.TopMost = $false
  }

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

  $timer.Add_Tick({
    Touch-RunId
    # A newer attempt owns the stage directory. Close before touching the source,
    # so this viewer can never display a new session's QR.
    if (-not (Test-OwnerCurrent)) {
      Write-Log "viewer-close superseded run=$RunId"
      try { $timer.Stop() } catch {}
      try { $form.Close() } catch {}
      return
    }
    if (-not $FixturePath) {
      $state = Update-FromSource
      if ($state -eq 'absent') {
        Write-Log "viewer-close source-cleared run=$RunId"
        try { $timer.Stop() } catch {}
        try { $form.Close() } catch {}
        return
      }
      if ($state -ne 'unchanged' -and $state -ne 'refreshed' -and $state -ne $script:lastRefreshState) {
        Write-Log "viewer-refresh-refused $state"
      }
      $script:lastRefreshState = $state
    }
    if ($closeAt -and (Get-Date) -ge $closeAt) {
      Write-Log "viewer-autoclose rehearsal run=$RunId"
      try { $timer.Stop() } catch {}
      try { $form.Close() } catch {}
      return
    }
    # Independent of the connector: a killed or hung connector never clears its
    # source, so the window bounds itself and the copy is removed regardless.
    if ($script:displayDeadline -and (Get-Date) -ge $script:displayDeadline) {
      Write-Log "viewer-close display-timeout run=$RunId"
      try { $timer.Stop() } catch {}
      try { $form.Close() } catch {}
    }
  })

  $form.Add_Shown({
    $form.BringToFront()
    $form.Activate()
    $timer.Start()
    $script:displayDeadline = (Get-Date).AddSeconds($TimeoutSeconds)
    $shownSession = [System.Diagnostics.Process]::GetCurrentProcess().SessionId
    Write-Log "viewer-shown handle=$($form.Handle) session=$shownSession topmost=$($form.TopMost) visible=$($form.Visible) offscreen=$([bool]$Offscreen) image=$($image.Width)x$($image.Height) run=$RunId"
  })
  $form.Add_FormClosing({
    try { Invoke-Cleanup 'form-closing' } catch { Write-Log 'viewer-form-closing cleanup-error' }
  })

  [System.Windows.Forms.Application]::Run($form)
} finally {
  try { Invoke-Cleanup 'form-closing' } catch {}
  try { if ($stream) { $stream.Dispose() } } catch {}
  if (Remove-Staged) {
    Clear-RunId
    Write-Log "viewer-closed cleanup=final run=$RunId"
  } else {
    # A QR left on disk must never be reported as a clean exit. The guard is
    # still the last resort; it logs its own outcome.
    Write-Log "viewer-closed cleanup=FAILED staged-copy-remains run=$RunId"
    exit 5
  }
}
exit 0
