# Termination guard for the Windows QR viewer.
#
# Spawned by qr-viewer.ps1 before the QR is staged. It waits for the viewer
# process to exit and then removes the staged copy, so a forced kill, an
# unhandled error, a stuck dialog or a review-driven shutdown cannot leave a
# scannable QR on disk.
#
# Ownership is decided by the run id, not the PID: qr-viewer-run.txt is written
# by the run that owns the stage directory. If a newer run has replaced it (for
# example after this viewer was killed and the operator restarted), the guard
# leaves that run's copy alone.
#
# It prints nothing and touches no network. All logging is non-throwing.
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][int]$ViewerPid,
  [Parameter(Mandatory = $true)][string]$RunId,
  [Parameter(Mandatory = $true)][string]$StageDirectory,
  # How long to wait for the viewer after spawning, and then how long to keep
  # retrying the delete while Windows releases handles.
  [int]$WaitSeconds = 3600,
  # 240 × 250 ms ≈ 60 s: outlast an antivirus or search-indexer handle rather
  # than give up and leave a scannable copy behind.
  [int]$Attempts = 240,
  # Consecutive absent readings needed before "there is nothing to remove" is
  # believed: one sample can miss a file that is still there.
  [int]$ConfirmAbsent = 12
)

$ErrorActionPreference = 'SilentlyContinue'
$stage = Join-Path $StageDirectory 'qr.png'
$runFile = Join-Path $StageDirectory 'qr-viewer-run.txt'
$stateLock = Join-Path $StageDirectory 'qr-viewer-state.lock'
$log = Join-Path $StageDirectory 'qr-viewer.log'

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

# The viewer waits for this line before it stages anything, so a guard that
# cannot run stops the attempt instead of leaving a copy nothing would remove.
Write-Log "viewer-guard ready pid=$ViewerPid run=$RunId"

try {
  $viewer = [System.Diagnostics.Process]::GetProcessById($ViewerPid)
  if (-not $viewer.WaitForExit($WaitSeconds * 1000)) {
    # The viewer is still alive after the wait (hung dialog, stuck message
    # loop). Removing the staged file is safe: the image is already decoded
    # into memory, so the window keeps displaying it. Never leave it behind.
    Write-Log "viewer-guard viewer-still-running run=$RunId"
  }
} catch {
  # The viewer is already gone, or the PID was never observable from here.
  Write-Log "viewer-guard viewer-unobservable run=$RunId"
}

Write-Log "viewer-guard woke run=$RunId stage-present=$([System.IO.File]::Exists($stage)) run-file-present=$([System.IO.File]::Exists($runFile))"

# The viewer and this guard share one exclusive state lock. Ownership is
# re-read and the copy is deleted inside it, and the viewer writes its run id
# inside it, so a newer run that claims the stage cannot have its copy removed
# between this guard's check and its delete.
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

# Ownership is re-read under the lock before every delete: a newer run that
# replaced the run id must never lose its copy to this guard. A missing run file
# means the owning viewer finished its cleanup (it only clears the id after a
# confirmed removal) or a newer run has not written its id yet, so this guard
# must not delete. An unreadable run file is retried and then treated as not
# owned: deleting another run's live QR is worse than leaving a copy for the
# next run's start sweep.
function Test-Owned {
  for ($i = 0; $i -lt 5; $i++) {
    try {
      if (-not (Test-RunFilePresent)) { return $false }
      $owner = ([System.IO.File]::ReadAllText($runFile)).Trim()
      return ($owner -eq $RunId)
    } catch {
      Start-Sleep -Milliseconds 100
    }
  }
  return $false
}

# Enumerating the directory reports a real I/O failure, while File.Exists
# reports every failure as "absent". On a busy volume that single false answer
# would let the guard walk away from a QR that is still on disk.
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

function Test-RunFilePresent {
  try {
    foreach ($entry in [System.IO.Directory]::EnumerateFileSystemEntries($StageDirectory)) {
      if ([string]::Equals($entry, $runFile, [StringComparison]::OrdinalIgnoreCase)) { return $true }
    }
    return $false
  } catch {
    return $null
  }
}

$superseded = $false
if (-not (Test-Owned)) { $superseded = $true }

$observed = $false
$confirmed = $false
$absentStreak = 0
for ($i = 0; -not $confirmed -and -not $superseded -and $i -lt $Attempts; $i++) {
  $lock = Enter-StateLock
  if (-not $lock) {
    # Deleting without the lock could race a newer run's claim, so wait instead.
    $absentStreak = 0
    Start-Sleep -Milliseconds 250
    continue
  }
  try {
    if (-not (Test-Owned)) {
      $superseded = $true
      break
    }
    $present = Get-StagePresent
    if ($present -eq $true) {
      $observed = $true
      $absentStreak = 0
      try { [System.IO.File]::Delete($stage) } catch {}
      # Two oracles must agree the copy is gone before it counts as removed.
      if ((Get-StagePresent) -eq $false -and -not (Test-Path -LiteralPath $stage)) {
        $confirmed = $true
      }
    } elseif ($present -eq $false) {
      # Absent is only believed after it holds for the whole confirmation
      # window, so one API's stale view cannot walk away from a copy still on
      # disk.
      if (Test-Path -LiteralPath $stage) {
        $absentStreak = 0
      } else {
        $absentStreak++
        if ($absentStreak -ge $ConfirmAbsent) { $confirmed = $true }
      }
    } else {
      # An unreadable directory is neither present nor absent; it must not
      # count toward the confirmation window.
      $absentStreak = 0
    }
  } finally {
    if ($lock) { try { $lock.Dispose() } catch {} }
  }
  if ($confirmed -or $superseded) { break }
  [GC]::Collect()
  [GC]::WaitForPendingFinalizers()
  Start-Sleep -Milliseconds 250
}

if ($superseded) {
  Write-Log "viewer-guard superseded run=$RunId"
  exit 0
}
if (-not $confirmed) {
  Write-Log "viewer-guard retention-failed run=$RunId"
  exit 5
}

# Clear the run id only when this run still owns it, inside the same exclusive
# handle the viewer uses to write it, so a newer run's id is never removed.
$lock = Enter-StateLock
try {
  if ([System.IO.File]::Exists($runFile) -and
      ([System.IO.File]::ReadAllText($runFile)).Trim() -eq $RunId) {
    [System.IO.File]::Delete($runFile)
  }
} catch {} finally {
  if ($lock) { try { $lock.Dispose() } catch {} }
}

if ($observed) {
  Write-Log "viewer-guard removed-staged run=$RunId"
} else {
  Write-Log "viewer-guard nothing-to-remove run=$RunId"
}
exit 0
