# ─── DEPLOYMENT ZIP PACKAGER ────────────────────────────────────────────────
# Snapshots the entire project into a single "Deployment" ZIP on the Desktop so
# the work can be carried, archived or handed over as one artifact.
#
# Two deliberate safety rules, because this file has repeatedly been re-cut over
# months of builds and an overwritten snapshot is unrecoverable:
#
#   1. An existing ZIP at the destination is NEVER deleted. It is renamed with its
#      own LastWriteTime (e.g. "Unified POS Deployment (2026-09-16).zip") so the
#      previous snapshot survives as a dated backup. -NoBackup opts out.
#   2. Every entry is added individually inside try/catch. A file locked by a
#      running dev server (Vite's dep cache, a *.tsbuildinfo) is reported and
#      skipped instead of aborting a 400 MB archive halfway through.
#
# The archive root is the project folder name, matching the layout of the
# snapshots taken so far, so unzipping gives "The ultimate architecture/...".
#
# Usage:
#   powershell -File scripts/make-deployment-zip.ps1
#   powershell -File scripts/make-deployment-zip.ps1 -Destination "D:\pos.zip"
#   powershell -File scripts/make-deployment-zip.ps1 -ExcludeNodeModules   # lean source zip
param(
  [string]$Source = (Split-Path -Parent $PSScriptRoot),
  [string]$Destination = "$env:USERPROFILE\Desktop\Unified POS Deployment.zip",
  [switch]$ExcludeNodeModules,
  [switch]$NoBackup
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

if (-not (Test-Path -LiteralPath $Source)) { throw "Source folder not found: $Source" }
$Source = (Resolve-Path -LiteralPath $Source).Path
$rootName = Split-Path -Leaf $Source

# ── Protect any previous snapshot ────────────────────────────────────────────
$backupPath = $null
if ((-not $NoBackup) -and (Test-Path -LiteralPath $Destination)) {
  $existing = Get-Item -LiteralPath $Destination
  $dated = "{0} ({1}).zip" -f [System.IO.Path]::GetFileNameWithoutExtension($Destination), $existing.LastWriteTime.ToString('yyyy-MM-dd')
  $backupPath = Join-Path $existing.DirectoryName $dated
  if (Test-Path -LiteralPath $backupPath) {
    Write-Host "Backup already exists, leaving it in place: $backupPath"
  } else {
    Rename-Item -LiteralPath $Destination -NewName $dated
    Write-Host "Previous snapshot kept as: $dated"
  }
}

# ── Collect files ────────────────────────────────────────────────────────────
$files = Get-ChildItem -LiteralPath $Source -Recurse -File -Force
if ($ExcludeNodeModules) {
  $files = $files | Where-Object { $_.FullName -notmatch '\\node_modules\\' }
}
Write-Host "Packaging $($files.Count) files from $Source"

# ── Archive ──────────────────────────────────────────────────────────────────
$tmpZip = "$Destination.tmp"
if (Test-Path -LiteralPath $tmpZip) { Remove-Item -LiteralPath $tmpZip -Force }
$fs = [System.IO.File]::Open($tmpZip, [System.IO.FileMode]::CreateNew)
$skipped = @()
$added = 0
try {
  $archive = New-Object System.IO.Compression.ZipArchive($fs, [System.IO.Compression.ZipArchiveMode]::Create)
  foreach ($file in $files) {
    $relative = $file.FullName.Substring($Source.Length).TrimStart('\', '/')
    $entryName = ($rootName + '/' + ($relative -replace '\\', '/'))
    try {
      $entry = $archive.CreateEntry($entryName, [System.IO.Compression.CompressionLevel]::Optimal)
      $stream = $entry.Open()
      try {
        $in = [System.IO.File]::Open($file.FullName, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
        $in.CopyTo($stream)
        $in.Dispose()
      } finally { $stream.Dispose() }
      $added++
    } catch {
      # Locked or vanished mid-run: record it and keep going.
      $skipped += "{0}  ({1})" -f $relative, $_.Exception.Message
    }
  }
  $archive.Dispose()
} finally { $fs.Dispose() }

Move-Item -LiteralPath $tmpZip -Destination $Destination -Force

# ── Report ───────────────────────────────────────────────────────────────────
$zipItem = Get-Item -LiteralPath $Destination
Write-Host ""
Write-Host ("ZIP      : {0} ({1:N1} MB)" -f $zipItem.FullName, ($zipItem.Length / 1MB))
Write-Host ("Entries  : $added of $($files.Count)")
if ($backupPath) { Write-Host ("Backup   : $backupPath") }
if ($skipped.Count -gt 0) {
  Write-Host "Skipped  : $($skipped.Count) locked/unreadable file(s)"
  $skipped | Select-Object -First 10 | ForEach-Object { Write-Host "  - $_" }
}

# ── Verify the archive really opens and contains the money-critical files ────
$verify = [System.IO.Compression.ZipFile]::OpenRead($Destination)
try {
  $critical = @(
    "$rootName/packages/server/src/services/registerAccess.ts",
    "$rootName/packages/server/src/middleware/registerAccess.ts",
    "$rootName/packages/server/src/routes/registers.ts",
    "$rootName/packages/server/prisma/schema.prisma",
    "$rootName/packages/web/src/components/RegisterLockScreen.tsx",
    "$rootName/packages/web/src/hooks/useRegisterLock.ts",
    "$rootName/docker-compose.yml",
    "$rootName/Dockerfile"
  )
  $names = $verify.Entries | ForEach-Object { $_.FullName }
  $missing = $critical | Where-Object { $names -notcontains $_ }
  Write-Host ""
  Write-Host "Archive readable: true ($($verify.Entries.Count) entries)"
  if ($missing.Count -gt 0) {
    Write-Host "MISSING critical files:" -ForegroundColor Red
    $missing | ForEach-Object { Write-Host "  - $_" }
    exit 1
  }
  Write-Host "Integrity check  : all key files present"
} finally { $verify.Dispose() }

if ($skipped.Count -gt 0) { exit 2 }
exit 0
