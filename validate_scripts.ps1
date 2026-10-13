# Copyright (C) 2026 SCAN Rainbow Defense Toolkit contributors
# SPDX-License-Identifier: GPL-3.0-or-later
# Parse PowerShell scripts without executing them, and log syntax errors before launch.
$ErrorActionPreference = 'Stop'
$logsDir = Join-Path $PSScriptRoot 'Logs'
$errorLog = Join-Path $logsDir 'errors.log'
$launcherLog = Join-Path $logsDir 'launcher.log'
try {
    if (-not (Test-Path -LiteralPath $logsDir)) {
        New-Item -ItemType Directory -Path $logsDir -Force | Out-Null
    }
} catch {
    Write-Host ('[ERROR] Cannot create Logs folder: ' + $_.Exception.Message) -ForegroundColor Red
    exit 3
}
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
function Add-LogLine([string]$Path, [string]$Message) {
    try {
        [System.IO.File]::AppendAllText($Path, $Message + [Environment]::NewLine, $script:utf8NoBom)
    } catch {
        Write-Host ('[WARN] Could not write log: ' + $_.Exception.Message) -ForegroundColor Yellow
    }
}
$targets = @('validate_scripts.ps1', 'consent.ps1', 'bootstrap.ps1')
$hasErrors = $false
foreach ($target in $targets) {
    $path = Join-Path $PSScriptRoot $target
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
        $message = "SCRIPT_MISSING file=$target"
        Add-LogLine $errorLog ("[{0}] {1}" -f (Get-Date -Format o), $message)
        Add-LogLine $launcherLog ("[{0}] {1}" -f (Get-Date -Format o), $message)
        Write-Host ('[ERROR] Required PowerShell script is missing: ' + $target) -ForegroundColor Red
        $hasErrors = $true
        continue
    }
    $tokens = $null
    $parseErrors = $null
    try {
        $null = [System.Management.Automation.Language.Parser]::ParseFile($path, [ref]$tokens, [ref]$parseErrors)
    } catch {
        $message = "SCRIPT_PARSE_CHECK_FAILED file=$target detail=$($_.Exception.Message)"
        Add-LogLine $errorLog ("[{0}] {1}" -f (Get-Date -Format o), $message)
        Add-LogLine $launcherLog ("[{0}] {1}" -f (Get-Date -Format o), $message)
        Write-Host ('[ERROR] Could not inspect ' + $target + ': ' + $_.Exception.Message) -ForegroundColor Red
        $hasErrors = $true
        continue
    }
    if ($null -ne $parseErrors -and $parseErrors.Count -gt 0) {
        foreach ($problem in $parseErrors) {
            $detail = ($problem.Message -replace '[\r\n]+', ' ')
            $line = "[{0}] POWERSHELL_PARSE_ERROR file={1} line={2} column={3} id={4} message={5}" -f (Get-Date -Format o), $target, $problem.Extent.StartLineNumber, $problem.Extent.StartColumnNumber, $problem.ErrorId, $detail
            Add-LogLine $errorLog $line
            Add-LogLine $launcherLog $line
            Write-Host ("[SYNTAX ERROR] {0}:{1}:{2} {3}" -f $target, $problem.Extent.StartLineNumber, $problem.Extent.StartColumnNumber, $detail) -ForegroundColor Red
        }
        $hasErrors = $true
    } else {
        Add-LogLine $launcherLog ("[{0}] POWERSHELL_SYNTAX_OK file={1}" -f (Get-Date -Format o), $target)
    }
}
if ($hasErrors) {
    Write-Host ''
    Write-Host '[ERROR] PowerShell syntax preflight failed. See Logs\errors.log.' -ForegroundColor Red
    exit 2
}
Write-Host '[SCAN] PowerShell syntax preflight passed.' -ForegroundColor Green
exit 0
