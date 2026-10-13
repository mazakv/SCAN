# Copyright (C) 2026 SCAN Rainbow Defense Toolkit contributors
# SPDX-License-Identifier: GPL-3.0-or-later
# SCAN bootstrapper: one combined progress bar for prerequisite checks/downloads/setup.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
try { [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false) } catch {}
try { [Console]::CursorVisible = $false } catch {}
$Host.UI.RawUI.WindowTitle = 'SCAN v20 - Integrated Rainbow Defense Toolkit'
$script:LogsDir = Join-Path $PSScriptRoot 'Logs'
$script:BootstrapLog = Join-Path $script:LogsDir 'bootstrap.log'
$script:ErrorLog = Join-Path $script:LogsDir 'errors.log'
$script:DownloadCsv = Join-Path $script:LogsDir 'downloads.csv'
if (-not (Test-Path -LiteralPath $script:LogsDir)) { New-Item -ItemType Directory -Path $script:LogsDir -Force | Out-Null }
if (-not (Test-Path -LiteralPath $script:BootstrapLog)) { New-Item -ItemType File -Path $script:BootstrapLog -Force | Out-Null }
if (-not (Test-Path -LiteralPath $script:DownloadCsv) -or (Get-Item -LiteralPath $script:DownloadCsv).Length -eq 0) {
    'Timestamp,Name,PackageId,Action,Status,NewMiB,TotalMiB,Files,Details' | Set-Content -LiteralPath $script:DownloadCsv -Encoding UTF8
}
$script:Palette = @('Red','Yellow','Green','Cyan','Blue','Magenta')
$script:SplashDrawn = $false
$script:RainbowPhase = 0
$script:VTEnabled = $false
$script:Escape = [char]27
$script:Art = @(
'  ███████╗  ██████╗  █████╗  ███╗   ██╗',
'  ██╔════╝ ██╔════╝ ██╔══██╗ ████╗  ██║',
'  ███████╗ ██║      ███████║ ██╔██╗ ██║',
'  ╚════██║ ██║      ██╔══██║ ██║╚██╗██║',
'  ███████║ ╚██████╗ ██║  ██║ ██║ ╚████║',
'  ╚══════╝  ╚═════╝ ╚═╝  ╚═╝ ╚═╝  ╚═══╝'
)
try {
    if (-not ('ScanConsoleVT' -as [type])) {
        $vtTypeDefinition = @'
using System;
using System.Runtime.InteropServices;
public static class ScanConsoleVT {
    [DllImport("kernel32.dll", SetLastError=true)] public static extern IntPtr GetStdHandle(int nStdHandle);
    [DllImport("kernel32.dll", SetLastError=true)] public static extern bool GetConsoleMode(IntPtr hConsoleHandle, out int mode);
    [DllImport("kernel32.dll", SetLastError=true)] public static extern bool SetConsoleMode(IntPtr hConsoleHandle, int mode);
}
'@
        Add-Type -TypeDefinition $vtTypeDefinition -ErrorAction Stop
    }
    $handle = [ScanConsoleVT]::GetStdHandle(-11)
    [int]$mode = 0
    if ([ScanConsoleVT]::GetConsoleMode($handle, [ref]$mode)) {
        if ([ScanConsoleVT]::SetConsoleMode($handle, ($mode -bor 0x0004))) { $script:VTEnabled = $true }
    }
} catch { $script:VTEnabled = $false }
$script:LastDisplayKey = ''

function Get-ConsoleWidth {
    try { return [Math]::Max(70, [Console]::WindowWidth) } catch { return 90 }
}

function Write-AtRow([int]$Row, [string]$Text, [string]$Color = '') {
    $width = Get-ConsoleWidth
    try {
        [Console]::SetCursorPosition(0, [Math]::Max(0, $Row - 1))
        [Console]::Write((' ' * [Math]::Max(1, $width - 1)))
        [Console]::SetCursorPosition(0, [Math]::Max(0, $Row - 1))
        if ($script:VTEnabled -and $Color) { [Console]::Write("$($script:Escape)[$Color`m$Text$($script:Escape)[0m") }
        else { [Console]::Write($Text) }
    } catch { Write-Host $Text }
}

function Write-ScanLog([string]$Message, [string]$Status = 'INFO') {
    $line = "{0}`t{1}`t{2}" -f (Get-Date).ToString('o'), $Status, ($Message -replace '[\r\n]+', ' ')
    try { Add-Content -LiteralPath $script:BootstrapLog -Value $line -Encoding UTF8 } catch {}
    if ($Status -eq 'ERROR') { try { Add-Content -LiteralPath $script:ErrorLog -Value $line -Encoding UTF8 } catch {} }
}

function Write-DownloadCsv([string]$Name, [string]$PackageId, [string]$Action, [string]$Status,
                           [object]$NewBytes, [object]$TotalBytes, [string]$Files, [string]$Details) {
    try {
        $newMb = if ($null -eq $NewBytes) { 'N/A' } else { '{0:N3}' -f ([double]$NewBytes / 1MB) }
        $totalMb = if ($null -eq $TotalBytes) { 'N/A' } else { '{0:N3}' -f ([double]$TotalBytes / 1MB) }
        $row = [pscustomobject]@{
            Timestamp = (Get-Date).ToString('o'); Name = $Name; PackageId = $PackageId; Action = $Action;
            Status = $Status; NewMiB = $newMb; TotalMiB = $totalMb; Files = $Files; Details = $Details
        }
        $row | Export-Csv -LiteralPath $script:DownloadCsv -NoTypeInformation -Append -Encoding UTF8
    } catch { Write-ScanLog ('Could not append download inventory: ' + $_.Exception.Message) 'WARN' }
}

function Write-CenteredAt([int]$Row, [string]$Text, [string]$Color = '') {
    $width = Get-ConsoleWidth
    $pad = [Math]::Max(0, [int](($width - $Text.Length) / 2))
    Write-AtRow $Row ((' ' * $pad) + $Text) $Color
}

function Write-RainbowLine([string]$Text, [int]$Row, [int]$Phase = 0) {
    $width = Get-ConsoleWidth
    $left = [Math]::Max(0, [int](($width - $Text.Length) / 2))
    try { [Console]::SetCursorPosition($left, [Math]::Max(0, $Row - 1)) } catch {}
    if (-not $script:VTEnabled) {
        $index = 0
        foreach ($ch in $Text.ToCharArray()) {
            if ($ch -eq ' ') { [Console]::Write(' '); continue }
            $color = $script:Palette[(($index + [int]($Phase / 18)) % $script:Palette.Count)]
            Write-Host ([string]$ch) -NoNewline -ForegroundColor $color
            $index++
        }
        return
    }
    $visible = 0
    foreach ($ch in $Text.ToCharArray()) {
        if ([char]::IsWhiteSpace($ch)) { [Console]::Write([string]$ch); continue }
        $hue = [double](($visible * 18 + $Phase) % 360)
        $x = 1.0 - [Math]::Abs((($hue / 60.0) % 2.0) - 1.0)
        switch ([int][Math]::Floor($hue / 60.0)) {
            0 { $r=1.0; $g=$x; $b=0.0 }
            1 { $r=$x; $g=1.0; $b=0.0 }
            2 { $r=0.0; $g=1.0; $b=$x }
            3 { $r=0.0; $g=$x; $b=1.0 }
            4 { $r=$x; $g=0.0; $b=1.0 }
            default { $r=1.0; $g=0.0; $b=$x }
        }
        $ri=[int]($r*255); $gi=[int]($g*255); $bi=[int]($b*255)
        [Console]::Write("$($script:Escape)[38;2;$ri;$gi;${bi}m$ch")
        $visible++
    }
    [Console]::Write("$($script:Escape)[0m")
}

function Initialize-Splash {
    if ($script:SplashDrawn) { return }
    try { [Console]::Clear() } catch { Clear-Host }
    Write-CenteredAt 2 'SCAN // RAINBOW DEFENSE TOOLKIT v15' '96;1'
    for ($r = 0; $r -lt $script:Art.Count; $r++) {
        Write-RainbowLine $script:Art[$r] (4 + $r) ($r * 27)
    }
    Write-CenteredAt 11 '60 BUILT-IN ACTIONS  |  3 WORKFLOW SETS  |  16 OPTIONAL APPS' '90'
    Write-CenteredAt 13 'SETUP / DOWNLOAD  0%' '96;1'
    Write-CenteredAt 15 ('[' + ('.' * 44) + ']') '92'
    Write-CenteredAt 17 'Initializing...' ''
    $script:SplashDrawn = $true
}

function Update-SplashRainbow {
    # Only repaint the fixed logo rows; never clear the entire screen during animation.
    $script:RainbowPhase = ($script:RainbowPhase + 22) % 360
    for ($r = 0; $r -lt $script:Art.Count; $r++) {
        Write-RainbowLine $script:Art[$r] (4 + $r) ([int]($script:RainbowPhase + $r * 27))
    }
}

function Show-Splash([int]$Percent, [string]$Stage, [switch]$Force) {
    $Percent = [Math]::Max(0, [Math]::Min(100, $Percent))
    Initialize-Splash
    Update-SplashRainbow
    $width = Get-ConsoleWidth
    $barWidth = [Math]::Min(44, [Math]::Max(24, $width - 20))
    $fill = [int][Math]::Round($barWidth * $Percent / 100.0)
    $empty = $barWidth - $fill
    $label = ('SETUP / DOWNLOAD  {0,3}%' -f $Percent)
    Write-CenteredAt 13 $label '96;1'
    $bar = '[' + ('#' * $fill) + ('.' * $empty) + ']'
    Write-CenteredAt 15 $bar '92'
    Write-AtRow 17 $Stage
}

function Animate-SplashBriefly([int]$Frames = 14) {
    # Short, non-flickering startup animation; only the logo rows change color.
    for ($frame = 0; $frame -lt $Frames; $frame++) {
        $script:RainbowPhase = ($script:RainbowPhase + 18) % 360
        for ($r = 0; $r -lt $script:Art.Count; $r++) {
            Write-RainbowLine $script:Art[$r] (4 + $r) ([int]($script:RainbowPhase + $r * 27))
        }
        Start-Sleep -Milliseconds 55
    }
}

function Get-PythonExe {
    $pyLauncher = Get-Command 'py.exe' -ErrorAction SilentlyContinue
    if ($pyLauncher) {
        try {
            $candidate = (& $pyLauncher.Source -3 -c 'import sys; print(sys.executable if sys.version_info >= (3, 10) else "")' 2>$null | Select-Object -First 1)
            if ($candidate -and (Test-Path -LiteralPath $candidate.Trim())) { return $candidate.Trim() }
        } catch {}
    }
    $pythonCommand = Get-Command 'python.exe' -ErrorAction SilentlyContinue
    if ($pythonCommand) {
        try {
            $candidate = (& $pythonCommand.Source -c 'import sys; print(sys.executable if sys.version_info >= (3, 10) else "")' 2>$null | Select-Object -First 1)
            if ($candidate -and (Test-Path -LiteralPath $candidate.Trim())) { return $candidate.Trim() }
        } catch {}
    }
    $paths = @(
        (Join-Path $env:LocalAppData 'Programs\Python\Python314\python.exe'),
        (Join-Path $env:LocalAppData 'Programs\Python\Python315\python.exe'),
        (Join-Path $env:ProgramFiles 'Python314\python.exe'),
        (Join-Path $env:ProgramFiles 'Python315\python.exe')
    )
    foreach ($path in $paths) {
        if ($path -and (Test-Path -LiteralPath $path)) {
            try { & $path -c 'import sys; raise SystemExit(0 if sys.version_info >= (3, 10) else 1)' *> $null; if ($LASTEXITCODE -eq 0) { return $path } } catch {}
        }
    }
    return $null
}

function Get-NmapExe {
    $cmd = Get-Command 'nmap.exe' -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    $programFiles = $env:ProgramFiles
    $programFiles86 = ${env:ProgramFiles(x86)}
    $paths = @()
    if ($programFiles) { $paths += (Join-Path $programFiles 'Nmap\nmap.exe') }
    if ($programFiles86) { $paths += (Join-Path $programFiles86 'Nmap\nmap.exe') }
    foreach ($path in $paths) { if (Test-Path -LiteralPath $path) { return $path } }
    return $null
}

function Download-FileWithProgress([string]$Url, [string]$Destination, [int]$StartPercent, [int]$EndPercent, [string]$Label) {
    Write-ScanLog ("DOWNLOAD START | {0} | {1}" -f $Label, $Url) 'INFO'
    Write-AtRow 19 ("DOWNLOAD LOG | " + $Label) '96;1'
    Write-AtRow 20 ("Destination: " + $Destination)
    Write-AtRow 21 'Downloaded data: preparing connection...'
    Write-AtRow 22 ("Log file: " + $script:BootstrapLog)
    $partial = $Destination + '.part'
    if (Test-Path -LiteralPath $partial) { Remove-Item -LiteralPath $partial -Force -ErrorAction SilentlyContinue }
    $request = [System.Net.HttpWebRequest]::Create($Url)
    $request.UserAgent = 'SCAN-Toolkit-Setup/1.0'
    $request.Timeout = 30000
    $request.ReadWriteTimeout = 30000
    $response = $null; $inputStream = $null; $outputStream = $null
    try {
        $response = $request.GetResponse()
        $total = [long]$response.ContentLength
        $inputStream = $response.GetResponseStream()
        $outputStream = [System.IO.File]::Open($partial, [System.IO.FileMode]::Create, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
        $buffer = New-Object byte[] 65536
        [long]$received = 0
        $lastLocal = -1
        $lastProgressAt = [DateTime]::UtcNow
        while ($true) {
            # Read directly into the buffer. The previous async loop slept up to 70 ms per
            # 64 KiB chunk, adding avoidable latency. No artificial sleep is used here.
            $read = $inputStream.Read($buffer, 0, $buffer.Length)
            if ($read -le 0) { break }
            $outputStream.Write($buffer, 0, $read)
            $received += $read
            $now = [DateTime]::UtcNow
            if (($received % (1024 * 512)) -lt $read -or ($total -gt 0 -and $received -eq $total) -or (($now - $lastProgressAt).TotalMilliseconds -ge 400)) {
                $receivedLabel = '{0:N2} MiB' -f ([double]$received / 1MB)
                if ($total -gt 0) { $receivedLabel += (' / {0:N2} MiB' -f ([double]$total / 1MB)) }
                Write-AtRow 21 ("Downloaded data: " + $receivedLabel)
                $lastProgressAt = $now
            }
            if ($total -gt 0) {
                $local = [int][Math]::Floor(($received * 100.0) / $total)
                if ($local -ge 100) { $local = 100 }
                if (($local -ge $lastLocal + 2) -or $local -eq 100) {
                    $overall = $StartPercent + [int][Math]::Floor(($EndPercent - $StartPercent) * $local / 100.0)
                    Show-Splash $overall ("Downloading {0} — {1}%" -f $Label, $local)
                    $lastLocal = $local
                }
            }
        }
        $outputStream.Flush()
        $outputStream.Dispose(); $outputStream = $null
        $inputStream.Dispose(); $inputStream = $null
        $response.Dispose(); $response = $null
        if (-not (Test-Path -LiteralPath $partial) -or (Get-Item -LiteralPath $partial).Length -lt 100000) {
            throw 'Download was unexpectedly small; the file may be an HTML error page.'
        }
        Move-Item -LiteralPath $partial -Destination $Destination -Force
        $actualBytes = [long](Get-Item -LiteralPath $Destination).Length
        $sizeLabel = '{0:N2} MiB' -f ([double]$actualBytes / 1MB)
        Write-DownloadCsv $Label 'bootstrap' 'DOWNLOAD' 'SUCCESS' $actualBytes $actualBytes $Destination ("URL=" + $Url)
        Write-ScanLog ("DOWNLOAD SUCCESS | {0} | {1} bytes ({2}) | {3}" -f $Label, $actualBytes, $sizeLabel, $Destination) 'OK'
        Write-AtRow 21 ("Downloaded data: " + $sizeLabel + " — complete") '92;1'
        Show-Splash $EndPercent ("Downloaded {0} — {1}" -f $Label, $sizeLabel)
    }
    catch {
        $message = $_.Exception.Message
        Write-ScanLog ("DOWNLOAD FAILED | {0} | {1} | {2}" -f $Label, $Url, $message) 'ERROR'
        Write-DownloadCsv $Label 'bootstrap' 'DOWNLOAD' 'FAILED' $null $null $Destination ("URL=" + $Url + "; error=" + $message)
        Write-AtRow 21 ("Download failed: " + $message) '91;1'
        if ($outputStream) { $outputStream.Dispose() }
        if ($inputStream) { $inputStream.Dispose() }
        if ($response) { $response.Dispose() }
        Remove-Item -LiteralPath $partial -Force -ErrorAction SilentlyContinue
        throw
    }
}

function Test-TrustedSignature([string]$Path, [string]$PublisherPattern) {
    try {
        $signature = Get-AuthenticodeSignature -FilePath $Path
        if ($signature.Status -ne 'Valid') { return $false }
        return ($signature.SignerCertificate.Subject -match $PublisherPattern)
    } catch { return $false }
}

function Ensure-Installer([string]$Url, [string]$Destination, [int]$StartPct, [int]$EndPct, [string]$Label, [string]$PublisherPattern) {
    if (Test-Path -LiteralPath $Destination) {
        Show-Splash $EndPct ("Found cached {0} installer — checking signature" -f $Label)
        if (Test-TrustedSignature $Destination $PublisherPattern) {
            $cachedBytes = [long](Get-Item -LiteralPath $Destination).Length
            Write-DownloadCsv $Label 'bootstrap' 'CACHE_REUSE' 'CACHED' 0 $cachedBytes $Destination 'Existing installer passed publisher signature check.'
            Write-ScanLog ("CACHE REUSE | {0} | {1:N2} MiB | {2}" -f $Label, ([double]$cachedBytes / 1MB), $Destination) 'OK'
            return $true
        }
        Remove-Item -LiteralPath $Destination -Force -ErrorAction SilentlyContinue
    }
    try {
        Download-FileWithProgress $Url $Destination $StartPct $EndPct $Label
        if (-not (Test-TrustedSignature $Destination $PublisherPattern)) {
            $untrustedBytes = [long](Get-Item -LiteralPath $Destination).Length
            Write-ScanLog ("SIGNATURE CHECK FAILED | {0} | {1}" -f $Label, $Destination) 'ERROR'
            Write-DownloadCsv $Label 'bootstrap' 'SIGNATURE_CHECK' 'REJECTED' 0 $untrustedBytes $Destination 'The installer did not pass the Windows signature/publisher check; file removed.'
            Remove-Item -LiteralPath $Destination -Force -ErrorAction SilentlyContinue
            throw ("The downloaded {0} installer did not pass the Windows signature/publisher check." -f $Label)
        }
        return $true
    } catch {
        Show-Splash $StartPct ("Could not prepare {0}: {1}" -f $Label, $_.Exception.Message) -Force
        Write-Host ''
        Write-Host ("Official download page: " + $Url) -ForegroundColor Yellow
        return $false
    }
}

try {
    $downloadDir = Join-Path $PSScriptRoot 'downloads'
    $toolsDir = Join-Path $PSScriptRoot 'tools'
    $sqlmapDir = Join-Path $toolsDir 'sqlmap'
    if (-not (Test-Path -LiteralPath $downloadDir)) { New-Item -ItemType Directory -Path $downloadDir | Out-Null }
    if (-not (Test-Path -LiteralPath $toolsDir)) { New-Item -ItemType Directory -Path $toolsDir | Out-Null }
    Write-ScanLog 'Bootstrap started after consent.' 'INFO'
    Show-Splash 1 'Checking installed prerequisites...'
    Animate-SplashBriefly 5

    $pythonExe = Get-PythonExe
    if ($pythonExe) {
        Write-ScanLog ("Python already installed — skipped | " + $pythonExe) 'OK'
        Show-Splash 90 ("Python already installed — skipped ({0})" -f $pythonExe)
    } else {
        Show-Splash 3 'Python was not found. Preparing the official installer...'
        Write-Host ''
        Write-Host 'FIRST DOWNLOAD CONFIRMATION' -ForegroundColor Cyan
        Write-Host 'Python is required to run SCAN. It will be downloaded only after your confirmation.' -ForegroundColor Yellow
        Write-Host 'Your optional-tool selection and I/D action are saved. SCAN will apply them after Python is ready.' -ForegroundColor Gray
        $runtimeChoice = (Read-Host 'Download and install the official Python runtime now? [Y/n]').Trim().ToLowerInvariant()
        if ($runtimeChoice -in @('n','no','q','cancel')) {
            Write-ScanLog 'User declined the required Python download; no installer was downloaded.' 'INFO'
            Write-Host ''
            Write-Host 'Setup cancelled. No download was started. Run SCAN.bat again when ready.' -ForegroundColor Yellow
            Write-Host ('┌─ WARNING ' + ('─' * 65) + '┐') -ForegroundColor Yellow
            Write-Host '│ Python은 SCAN 실행에 필수입니다. 다운로드하지 않아 프로그램이 시작되지 않았습니다. │' -ForegroundColor Yellow
            Write-Host ('└' + ('─' * 75) + '┘') -ForegroundColor Yellow
            Write-ScanLog 'WARNING: required Python runtime download declined; SCAN could not start.' 'WARN'
            exit 10
        }
        Write-ScanLog 'User confirmed the required Python runtime download.' 'OK'
        $arch = $env:PROCESSOR_ARCHITECTURE
        if ($env:PROCESSOR_ARCHITEW6432) { $arch = $env:PROCESSOR_ARCHITEW6432 }
        if ($arch -eq 'ARM64') {
            $pythonUrl = 'https://www.python.org/ftp/python/3.14.8/python-3.14.8-arm64.exe'
            $pythonInstaller = Join-Path $downloadDir 'python-3.14.8-arm64.exe'
        } elseif ([Environment]::Is64BitOperatingSystem) {
            $pythonUrl = 'https://www.python.org/ftp/python/3.14.8/python-3.14.8-amd64.exe'
            $pythonInstaller = Join-Path $downloadDir 'python-3.14.8-amd64.exe'
        } else {
            $pythonUrl = 'https://www.python.org/ftp/python/3.14.8/python-3.14.8.exe'
            $pythonInstaller = Join-Path $downloadDir 'python-3.14.8.exe'
        }
        $ok = Ensure-Installer $pythonUrl $pythonInstaller 3 22 'Python 3' 'Python Software Foundation|Python'
        if (-not $ok) { throw 'Could not verify/download Python. Use the official Python page linked in README.txt.' }
        Show-Splash 23 'Installing Python for the current Windows user...'
        $install = Start-Process -FilePath $pythonInstaller -ArgumentList '/quiet InstallAllUsers=0 PrependPath=1 Include_launcher=1 Include_pip=1 Include_test=0 Shortcuts=0' -PassThru
        while (-not $install.HasExited) { Update-SplashRainbow; Start-Sleep -Milliseconds 80; $install.Refresh() }
        if ($install.ExitCode -ne 0 -and $install.ExitCode -ne 3010) { throw ("Python installer returned exit code {0}." -f $install.ExitCode) }
        $localPython = Join-Path $env:LocalAppData 'Programs\Python\Python314'
        if (Test-Path -LiteralPath $localPython) { $env:PATH = $localPython + ';' + (Join-Path $localPython 'Scripts') + ';' + $env:PATH }
        $pythonExe = Get-PythonExe
        if (-not $pythonExe) { throw 'Python installed but could not be detected. Restart Windows and try again.' }
        Show-Splash 90 'Python installed and verified. Optional tools are user-controlled.'
    }

    # Do not silently fetch optional tools on every first launch. The user chooses these
    # from SCAN's Tool Download/Install Center (menu 33), or requests sqlmap on menu 28.
    Write-ScanLog 'Optional tools are not auto-downloaded during startup; use menu 33 or menu 28.' 'INFO'
    Show-Splash 98 'Core runtime ready — optional tool downloads are user-controlled.'

    Show-Splash 100 'Ready — starting SCAN...'
    Start-Sleep -Milliseconds 250
    try { [Console]::CursorVisible = $true } catch {}
    Clear-Host
    $env:PYTHONUTF8 = '1'
    Write-ScanLog 'Starting SCAN Python UI.' 'INFO'
    & $pythonExe (Join-Path $PSScriptRoot 'scan.py')
    exit $LASTEXITCODE
}
catch {
    try { [Console]::CursorVisible = $true } catch {}
    Clear-Host
    Write-Host '[SCAN SETUP ERROR]' -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Yellow
    Write-ScanLog ('BOOTSTRAP ERROR | ' + $_.Exception.Message + ' | ' + $_.InvocationInfo.PositionMessage + ' | ' + $_.ScriptStackTrace) 'ERROR'
    Write-Host ''
    Write-Host 'Python official page: https://www.python.org/downloads/windows/'
    Write-Host 'Nmap official page:   https://nmap.org/download.html'
    exit 1
}
finally {
    try { [Console]::CursorVisible = $true } catch {}
}
