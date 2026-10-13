# Copyright (C) 2026 SCAN Rainbow Defense Toolkit contributors
# SPDX-License-Identifier: GPL-3.0-or-later
# SCAN v22 Windows Forms startup notice. The full license texts are kept in LICENSE and LICENSES/.
# Read-only screen: no packages are downloaded or installed by this script.
$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false) } catch {}
try { [Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false) } catch {}
try { [Console]::CursorVisible = $false } catch {}

# Explicitly enable ANSI true-colour output where the Windows console supports it.
# A ConsoleColor fallback is kept for older CMD/PowerShell hosts.
$script:VTEnabled = $false
$script:Escape = [char]27
$script:RainbowPhase = 0
try {
    $vtTypeDefinition = @'
using System;
using System.Runtime.InteropServices;
public static class ScanConsentVT {
    [DllImport("kernel32.dll", SetLastError=true)] public static extern IntPtr GetStdHandle(int nStdHandle);
    [DllImport("kernel32.dll", SetLastError=true)] public static extern bool GetConsoleMode(IntPtr hConsoleHandle, out int mode);
    [DllImport("kernel32.dll", SetLastError=true)] public static extern bool SetConsoleMode(IntPtr hConsoleHandle, int mode);
}
'@
    Add-Type -TypeDefinition $vtTypeDefinition -ErrorAction Stop
    $handle = [ScanConsentVT]::GetStdHandle(-11)
    [int]$mode = 0
    if ([ScanConsentVT]::GetConsoleMode($handle, [ref]$mode)) {
        if ([ScanConsentVT]::SetConsoleMode($handle, ($mode -bor 0x0004))) { $script:VTEnabled = $true }
    }
} catch { $script:VTEnabled = $false }

$logsDir = Join-Path $PSScriptRoot 'Logs'
$consentLog = Join-Path $logsDir 'consent.log'
$errorLog = Join-Path $logsDir 'errors.log'
try { if (-not (Test-Path -LiteralPath $logsDir)) { New-Item -ItemType Directory -Path $logsDir -Force | Out-Null } } catch {}
function Write-ConsentLog([string]$Message, [string]$Status = 'INFO') {
    $line = "{0}`t{1}`t{2}" -f (Get-Date).ToString('o'), $Status, ($Message -replace '[\r\n]+', ' ')
    try { Add-Content -LiteralPath $consentLog -Value $line -Encoding UTF8 } catch {}
    if ($Status -eq 'ERROR') { try { Add-Content -LiteralPath $errorLog -Value $line -Encoding UTF8 } catch {} }
}
Write-ConsentLog 'Startup notice opened.' 'INFO'

$guidePath = Join-Path $PSScriptRoot 'STARTUP_NOTICE.txt'
if (-not (Test-Path -LiteralPath $guidePath -PathType Leaf)) {
    try { [Console]::CursorVisible = $true } catch {}
    [Console]::ForegroundColor = 'Red'
    [Console]::WriteLine('[ERROR] STARTUP_NOTICE.txt was not found.')
    [Console]::ResetColor()
    Write-ConsentLog 'STARTUP_NOTICE.txt missing.' 'ERROR'
    exit 2
}

function Get-CellWidth([char]$Character) {
    $code = [int]$Character
    # Korean/Japanese/CJK and full-width forms occupy two console cells. The block-drawing
    # characters used in the SCAN logo normally occupy one cell in Windows Terminal/CMD.
    if (($code -ge 0x1100 -and $code -le 0x11FF) -or
        ($code -ge 0x2E80 -and $code -le 0xA4CF) -or
        ($code -ge 0xAC00 -and $code -le 0xD7AF) -or
        ($code -ge 0xF900 -and $code -le 0xFAFF) -or
        ($code -ge 0xFE30 -and $code -le 0xFE6F) -or
        ($code -ge 0xFF01 -and $code -le 0xFF60) -or
        ($code -ge 0xFFE0 -and $code -le 0xFFE6)) { return 2 }
    return 1
}

function Wrap-Text([string]$Text, [int]$MaxWidth) {
    $result = New-Object 'System.Collections.Generic.List[string]'
    if ([string]::IsNullOrWhiteSpace($Text)) { $result.Add(''); return $result }
    $line = ''
    $width = 0
    foreach ($ch in $Text.ToCharArray()) {
        $cw = Get-CellWidth $ch
        if ($width + $cw -gt $MaxWidth -and $line.Length -gt 0) {
            $result.Add($line.TrimEnd())
            $line = ''
            $width = 0
            if ([char]::IsWhiteSpace($ch)) { continue }
        }
        $line += [string]$ch
        $width += $cw
    }
    if ($line.Length -gt 0) { $result.Add($line.TrimEnd()) }
    return $result
}

function Write-ConsoleRow([int]$Row, [string]$Text, [ConsoleColor]$Color = [ConsoleColor]::Gray, [switch]$Center, [int]$MaxWidth = 90) {
    $width = 90
    try { $width = [Math]::Max(50, [Console]::WindowWidth) } catch {}
    if ($Row -lt 0) { return }
    if ($Text.Length -gt $MaxWidth) { $Text = $Text.Substring(0, $MaxWidth) }
    try {
        [Console]::SetCursorPosition(0, $Row)
        [Console]::Write((' ' * [Math]::Max(1, $width - 1)))
        [Console]::SetCursorPosition(0, $Row)
        $padding = 0
        if ($Center) {
            $visual = 0
            foreach ($ch in $Text.ToCharArray()) { $visual += (Get-CellWidth $ch) }
            $padding = [Math]::Max(0, [int](($width - $visual) / 2))
            [Console]::Write((' ' * $padding))
        } else {
            [Console]::Write('  ')
        }
        [Console]::ForegroundColor = $Color
        [Console]::Write($Text)
        [Console]::ResetColor()
    } catch {
        Write-Host $Text -ForegroundColor $Color
    }
}

function Get-LineStyle([string]$Text) {
    if ($Text -match '^\s*\d+[.)]\s+' -or $Text -match '^\s*[-=]{4,}\s*$' -or $Text -match '^SCAN RAINBOW') {
        return [ConsoleColor]::Cyan
    }
    if ($Text -match '(NOTICE|IMPORTANT|MUST|BLOCKED|AGREE|PRIVACY|AUTHORIZED|MALWARE|RISK|DELETE|LIMIT|PASSWORD|PAYMENT|VERDICT|LICENSE)') {
        return [ConsoleColor]::Yellow
    }
    return [ConsoleColor]::Gray
}


function Write-RainbowConsoleRow([int]$Row, [string]$Text) {
    $width = 90
    try { $width = [Math]::Max(50, [Console]::WindowWidth) } catch {}
    $visual = 0
    foreach ($ch in $Text.ToCharArray()) { $visual += (Get-CellWidth $ch) }
    $left = [Math]::Max(0, [int](($width - $visual) / 2))
    try {
        [Console]::SetCursorPosition(0, $Row)
        [Console]::Write((' ' * [Math]::Max(1, $width - 1)))
        [Console]::SetCursorPosition($left, $Row)
        if ($script:VTEnabled) {
            $visible = 0
            foreach ($ch in $Text.ToCharArray()) {
                if ([char]::IsWhiteSpace($ch)) { [Console]::Write([string]$ch); continue }
                $hue = [double](($visible * 8 + $Row * 17 + $script:RainbowPhase) % 360)
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
        } else {
            # High-contrast six-colour rainbow when virtual-terminal RGB is unavailable.
            $palette = @([ConsoleColor]::Red, [ConsoleColor]::Yellow, [ConsoleColor]::Green,
                         [ConsoleColor]::Cyan, [ConsoleColor]::Blue, [ConsoleColor]::Magenta)
            $index = 0
            foreach ($ch in $Text.ToCharArray()) {
                if ([char]::IsWhiteSpace($ch)) { [Console]::Write([string]$ch); continue }
                [Console]::ForegroundColor = $palette[(($index + [int]($script:RainbowPhase / 45)) % $palette.Count)]
                [Console]::Write([string]$ch)
                $index++
            }
            [Console]::ResetColor()
        }
    } catch {
        Write-Host $Text -ForegroundColor Magenta
    }
}

function Animate-RainbowBanner([string[]]$Art, [string]$Subtitle, [int]$Frames = 6) {
    # Brief, low-flicker shimmer. The rest of the guide stays static and readable.
    $palette = @([ConsoleColor]::Red, [ConsoleColor]::Yellow, [ConsoleColor]::Green,
                 [ConsoleColor]::Cyan, [ConsoleColor]::Blue, [ConsoleColor]::Magenta)
    $sparkles = @('✦', '✧', '✶', '✷', '✺', '✧')
    for ($frame = 0; $frame -lt $Frames; $frame++) {
        $script:RainbowPhase = ($script:RainbowPhase + 27) % 360
        for ($i = 0; $i -lt $Art.Count; $i++) { Write-RainbowConsoleRow $i $Art[$i] }
        $symbol = $sparkles[$frame % $sparkles.Count]
        $caption = ($symbol + '  ' + $Subtitle + '  ' + $symbol)
        Write-ConsoleRow 6 $caption $palette[$frame % $palette.Count] -Center -MaxWidth 88
        Start-Sleep -Milliseconds 45
    }
}

function Write-PreDownloadSelection([string]$SelectedText) {
    $pendingPath = Join-Path $logsDir 'pending_tool_selection.txt'
    try {
        [System.IO.File]::WriteAllText($pendingPath, $SelectedText, (New-Object System.Text.UTF8Encoding($false)))
    } catch {
        Write-ConsentLog ('Could not save optional package selection: ' + $_.Exception.Message) 'ERROR'
        throw
    }
}

function Write-PreDownloadAction([string]$Action) {
    $pendingActionPath = Join-Path $logsDir 'pending_tool_action.txt'
    try {
        [System.IO.File]::WriteAllText($pendingActionPath, $Action.ToUpperInvariant(), (New-Object System.Text.UTF8Encoding($false)))
    } catch {
        Write-ConsentLog ('Could not save preselected package action: ' + $_.Exception.Message) 'ERROR'
        throw
    }
}

function Clear-PendingToolChoices {
    foreach ($name in @('pending_tool_selection.txt', 'pending_tool_action.txt')) {
        $path = Join-Path $logsDir $name
        try { if (Test-Path -LiteralPath $path) { Remove-Item -LiteralPath $path -Force } } catch {}
    }
}

function Get-OptionalToolStatus([hashtable]$Item) {
    $number = [int]$Item.N
    $packageId = [string]$Item.PackageId
    $commands = @{
        1=@('nmap.exe','nmap'); 2=@('Wireshark.exe','tshark.exe'); 3=@('autorunsc64.exe','autorunsc.exe','sigcheck64.exe','sigcheck.exe','procexp64.exe','procexp.exe');
        4=@('openssl.exe','openssl'); 5=@('git.exe','git'); 6=@('python3.12.exe','python3.12'); 7=@('node.exe','node'); 8=@('7z.exe','7zz.exe','7z');
        9=@('clamscan.exe','clamscan'); 10=@('gitleaks.exe','gitleaks'); 11=@('trivy.exe','trivy'); 12=@('gh.exe','gh');
        13=@('Docker Desktop.exe'); 14=@('pwsh.exe','pwsh'); 15=@('curl.exe'); 16=@('ruff.exe','ruff')
    }
    if ($number -eq 6) {
        $py = Get-Command 'py.exe' -ErrorAction SilentlyContinue
        if ($py) { try { $v = (& $py.Source -3.12 --version 2>$null | Select-Object -First 1); if ($v -match 'Python\s+3\.12\.') { return 'INSTALLED' } } catch {} }
    }
    foreach ($cmd in $commands[$number]) { if (Get-Command -Name $cmd -ErrorAction SilentlyContinue) { return 'INSTALLED' } }

    $pf = $env:ProgramFiles; if (-not $pf) { $pf = 'C:\Program Files' }
    $pf86 = [Environment]::GetEnvironmentVariable('ProgramFiles(x86)'); if (-not $pf86) { $pf86 = 'C:\Program Files (x86)' }
    $local = $env:LOCALAPPDATA; if (-not $local) { $local = Join-Path $env:USERPROFILE 'AppData\Local' }
    $paths = @()
    switch ($number) {
        1 { $paths = @((Join-Path $pf 'Nmap\nmap.exe'),(Join-Path $pf86 'Nmap\nmap.exe')) }
        2 { $paths = @((Join-Path $pf 'Wireshark\Wireshark.exe'),(Join-Path $pf86 'Wireshark\Wireshark.exe')) }
        3 { $paths = @((Join-Path $pf 'Sysinternals Suite\autorunsc64.exe'),(Join-Path $pf 'Sysinternals Suite\Autoruns64.exe')) }
        4 { $paths = @((Join-Path $pf 'OpenSSL-Win64\bin\openssl.exe'),(Join-Path $pf 'OpenSSL\bin\openssl.exe')) }
        5 { $paths = @((Join-Path $pf 'Git\cmd\git.exe'),(Join-Path $local 'Programs\Git\cmd\git.exe')) }
        6 { $paths = @((Join-Path $local 'Programs\Python\Python312\python.exe'),(Join-Path $pf 'Python312\python.exe'),(Join-Path $pf86 'Python312\python.exe')) }
        7 { $paths = @((Join-Path $pf 'nodejs\node.exe'),(Join-Path $local 'Programs\nodejs\node.exe')) }
        8 { $paths = @((Join-Path $pf '7-Zip\7z.exe'),(Join-Path $pf86 '7-Zip\7z.exe')) }
        9 { $paths = @((Join-Path $pf 'ClamAV\clamscan.exe')) }
        10 { $paths = @((Join-Path $local 'Microsoft\WinGet\Links\gitleaks.exe')) }
        11 { $paths = @((Join-Path $local 'Microsoft\WinGet\Links\trivy.exe')) }
        12 { $paths = @((Join-Path $local 'Microsoft\WinGet\Links\gh.exe')) }
        13 { $paths = @((Join-Path $pf 'Docker\Docker\Docker Desktop.exe'),(Join-Path $pf 'Docker\Docker\frontend\Docker Desktop.exe')) }
        14 { $paths = @((Join-Path $pf 'PowerShell\7\pwsh.exe'),(Join-Path $local 'Microsoft\PowerShell\pwsh.exe')) }
        15 { $paths = @((Join-Path $env:SystemRoot 'System32\curl.exe')) }
        16 { $paths = @((Join-Path $local 'Microsoft\WinGet\Links\ruff.exe')) }
    }
    foreach ($p in $paths) { if ($p -and (Test-Path -LiteralPath $p -PathType Leaf)) { return 'INSTALLED' } }

    if (-not $script:InstalledAppNamesLoaded) {
        $names = New-Object 'System.Collections.Generic.List[string]'
        foreach ($root in @('HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*','HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*','HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*')) {
            try { Get-ItemProperty -Path $root -ErrorAction SilentlyContinue | ForEach-Object { if (-not [string]::IsNullOrWhiteSpace([string]$_.DisplayName)) { [void]$names.Add(([string]$_.DisplayName).ToLowerInvariant()) } } } catch {}
        }
        $script:InstalledAppNames = @($names.ToArray())
        $script:InstalledAppNamesLoaded = $true
    }
    $patterns = @{
        1='^nmap(?:\s|$)'; 2='wireshark'; 3='sysinternals'; 4='openssl'; 5='^(git(?:\s|$)|git for windows)'; 6='^python 3\.12(?:\s|$)';
        7='^node\.js(?:\s|$)'; 8='^7-zip'; 9='clamav'; 10='gitleaks'; 11='^trivy'; 12='github (cli|command line)';
        13='docker desktop'; 14='^powershell 7'; 15='^curl'; 16='ruff'
    }
    foreach ($installedName in $script:InstalledAppNames) { if ($installedName -match $patterns[$number]) { return 'INSTALLED' } }

    if (-not $script:WingetListLoaded) {
        $script:WingetListLoaded = $true
        $script:WingetListText = ''
        if (Get-Command 'winget.exe' -ErrorAction SilentlyContinue) {
            try { $script:WingetListText = (& winget list --accept-source-agreements --disable-interactivity 2>$null | Out-String) } catch {}
        }
    }
    if ($script:WingetListText -and $script:WingetListText.IndexOf($packageId,[StringComparison]::OrdinalIgnoreCase) -ge 0) { return 'INSTALLED' }

    $packagesRoot = Join-Path $PSScriptRoot 'downloads\packages'
    $slug = $packageId -replace '[^A-Za-z0-9._-]+','_'
    $folder = Join-Path $packagesRoot $slug
    if (Test-Path -LiteralPath $folder -PathType Container) {
        try { $saved = Get-ChildItem -LiteralPath $folder -File -Recurse -ErrorAction SilentlyContinue | Where-Object { $_.Length -gt 0 -and $_.Name -notlike '*.part' } | Select-Object -First 1; if ($saved) { return 'DOWNLOADED' } } catch {}
    }
    return 'MISSING'
}

function Write-OptionalToolCell([int]$Row,[int]$Column,[string]$Text,[string]$Status) {
    $cellWidth = 39
    if ($Text.Length -gt $cellWidth) { $Text = $Text.Substring(0,$cellWidth-1) + '…' }
    try {
        [Console]::SetCursorPosition($Column,$Row)
        [Console]::Write((' ' * $cellWidth))
        [Console]::SetCursorPosition($Column,$Row)
        if ($Status -in @('INSTALLED','DOWNLOADED')) { [Console]::ForegroundColor = [ConsoleColor]::Green } else { [Console]::ForegroundColor = [ConsoleColor]::DarkGray }
        [Console]::Write($Text.PadRight($cellWidth))
        [Console]::ResetColor()
    } catch { $color = if ($Status -in @('INSTALLED','DOWNLOADED')) { [ConsoleColor]::Green } else { [ConsoleColor]::DarkGray }; Write-ConsoleRow $Row $Text $color -MaxWidth 88 }
}

function Get-OptionalToolStatus([hashtable]$Item) {
    $number = [int]$Item.N
    $packageId = [string]$Item.PackageId
    $commands = @{
        1=@('nmap.exe','nmap'); 2=@('Wireshark.exe','tshark.exe'); 3=@('autorunsc64.exe','autorunsc.exe','sigcheck64.exe','sigcheck.exe','procexp64.exe','procexp.exe');
        4=@('openssl.exe','openssl'); 5=@('git.exe','git'); 6=@('python3.12.exe','python3.12'); 7=@('node.exe','node'); 8=@('7z.exe','7zz.exe','7z');
        9=@('clamscan.exe','clamscan'); 10=@('gitleaks.exe','gitleaks'); 11=@('trivy.exe','trivy'); 12=@('gh.exe','gh');
        13=@('Docker Desktop.exe'); 14=@('pwsh.exe','pwsh'); 15=@('curl.exe'); 16=@('ruff.exe','ruff')
    }
    if ($number -eq 6) {
        $py = Get-Command 'py.exe' -ErrorAction SilentlyContinue
        if ($py) { try { $v = (& $py.Source -3.12 --version 2>$null | Select-Object -First 1); if ($v -match 'Python\s+3\.12\.') { return 'INSTALLED' } } catch {} }
    }
    foreach ($cmd in $commands[$number]) { if (Get-Command -Name $cmd -ErrorAction SilentlyContinue) { return 'INSTALLED' } }

    $pf = $env:ProgramFiles; if (-not $pf) { $pf = 'C:\Program Files' }
    $pf86 = [Environment]::GetEnvironmentVariable('ProgramFiles(x86)'); if (-not $pf86) { $pf86 = 'C:\Program Files (x86)' }
    $local = $env:LOCALAPPDATA; if (-not $local) { $local = Join-Path $env:USERPROFILE 'AppData\Local' }
    $paths = @()
    switch ($number) {
        1 { $paths = @((Join-Path $pf 'Nmap\nmap.exe'),(Join-Path $pf86 'Nmap\nmap.exe')) }
        2 { $paths = @((Join-Path $pf 'Wireshark\Wireshark.exe'),(Join-Path $pf86 'Wireshark\Wireshark.exe')) }
        3 { $paths = @((Join-Path $pf 'Sysinternals Suite\autorunsc64.exe'),(Join-Path $pf 'Sysinternals Suite\Autoruns64.exe')) }
        4 { $paths = @((Join-Path $pf 'OpenSSL-Win64\bin\openssl.exe'),(Join-Path $pf 'OpenSSL\bin\openssl.exe')) }
        5 { $paths = @((Join-Path $pf 'Git\cmd\git.exe'),(Join-Path $local 'Programs\Git\cmd\git.exe')) }
        6 { $paths = @((Join-Path $local 'Programs\Python\Python312\python.exe'),(Join-Path $pf 'Python312\python.exe'),(Join-Path $pf86 'Python312\python.exe')) }
        7 { $paths = @((Join-Path $pf 'nodejs\node.exe'),(Join-Path $local 'Programs\nodejs\node.exe')) }
        8 { $paths = @((Join-Path $pf '7-Zip\7z.exe'),(Join-Path $pf86 '7-Zip\7z.exe')) }
        9 { $paths = @((Join-Path $pf 'ClamAV\clamscan.exe')) }
        10 { $paths = @((Join-Path $local 'Microsoft\WinGet\Links\gitleaks.exe')) }
        11 { $paths = @((Join-Path $local 'Microsoft\WinGet\Links\trivy.exe')) }
        12 { $paths = @((Join-Path $local 'Microsoft\WinGet\Links\gh.exe')) }
        13 { $paths = @((Join-Path $pf 'Docker\Docker\Docker Desktop.exe'),(Join-Path $pf 'Docker\Docker\frontend\Docker Desktop.exe')) }
        14 { $paths = @((Join-Path $pf 'PowerShell\7\pwsh.exe'),(Join-Path $local 'Microsoft\PowerShell\pwsh.exe')) }
        15 { $paths = @((Join-Path $env:SystemRoot 'System32\curl.exe')) }
        16 { $paths = @((Join-Path $local 'Microsoft\WinGet\Links\ruff.exe')) }
    }
    foreach ($p in $paths) { if ($p -and (Test-Path -LiteralPath $p -PathType Leaf)) { return 'INSTALLED' } }

    if (-not $script:InstalledAppNamesLoaded) {
        $names = New-Object 'System.Collections.Generic.List[string]'
        foreach ($root in @('HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*','HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*','HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*')) {
            try { Get-ItemProperty -Path $root -ErrorAction SilentlyContinue | ForEach-Object { if (-not [string]::IsNullOrWhiteSpace([string]$_.DisplayName)) { [void]$names.Add(([string]$_.DisplayName).ToLowerInvariant()) } } } catch {}
        }
        $script:InstalledAppNames = @($names.ToArray())
        $script:InstalledAppNamesLoaded = $true
    }
    $patterns = @{
        1='^nmap(?:\s|$)'; 2='wireshark'; 3='sysinternals'; 4='openssl'; 5='^(git(?:\s|$)|git for windows)'; 6='^python 3\.12(?:\s|$)';
        7='^node\.js(?:\s|$)'; 8='^7-zip'; 9='clamav'; 10='gitleaks'; 11='^trivy'; 12='github (cli|command line)';
        13='docker desktop'; 14='^powershell 7'; 15='^curl'; 16='ruff'
    }
    foreach ($installedName in $script:InstalledAppNames) { if ($installedName -match $patterns[$number]) { return 'INSTALLED' } }

    if (-not $script:WingetListLoaded) {
        $script:WingetListLoaded = $true
        $script:WingetListText = ''
        if (Get-Command 'winget.exe' -ErrorAction SilentlyContinue) {
            try { $script:WingetListText = (& winget list --accept-source-agreements --disable-interactivity 2>$null | Out-String) } catch {}
        }
    }
    if ($script:WingetListText -and $script:WingetListText.IndexOf($packageId,[StringComparison]::OrdinalIgnoreCase) -ge 0) { return 'INSTALLED' }

    $packagesRoot = Join-Path $PSScriptRoot 'downloads\packages'
    $slug = $packageId -replace '[^A-Za-z0-9._-]+','_'
    $folder = Join-Path $packagesRoot $slug
    if (Test-Path -LiteralPath $folder -PathType Container) {
        try { $saved = Get-ChildItem -LiteralPath $folder -File -Recurse -ErrorAction SilentlyContinue | Where-Object { $_.Length -gt 0 -and $_.Name -notlike '*.part' } | Select-Object -First 1; if ($saved) { return 'DOWNLOADED' } } catch {}
    }
    return 'MISSING'
}

function Write-OptionalToolCell([int]$Row,[int]$Column,[string]$Text,[string]$Status) {
    $cellWidth = 39
    if ($Text.Length -gt $cellWidth) { $Text = $Text.Substring(0,$cellWidth-1) + '…' }
    try {
        [Console]::SetCursorPosition($Column,$Row)
        [Console]::Write((' ' * $cellWidth))
        [Console]::SetCursorPosition($Column,$Row)
        if ($Status -in @('INSTALLED','DOWNLOADED')) { [Console]::ForegroundColor = [ConsoleColor]::Green } else { [Console]::ForegroundColor = [ConsoleColor]::DarkGray }
        [Console]::Write($Text.PadRight($cellWidth))
        [Console]::ResetColor()
    } catch { $color = if ($Status -in @('INSTALLED','DOWNLOADED')) { [ConsoleColor]::Green } else { [ConsoleColor]::DarkGray }; Write-ConsoleRow $Row $Text $color -MaxWidth 88 }
}

function Show-PreDownloadSelection {
    $items = @(
        @{N=1; Name='Nmap'; PackageId='Insecure.Nmap'},
        @{N=2; Name='Wireshark'; PackageId='WiresharkFoundation.Wireshark'},
        @{N=3; Name='Sysinternals Suite'; PackageId='Microsoft.Sysinternals.Suite'},
        @{N=4; Name='OpenSSL Light'; PackageId='ShiningLight.OpenSSL.Light'},
        @{N=5; Name='Git'; PackageId='Git.Git'},
        @{N=6; Name='Python 3.12'; PackageId='Python.Python.3.12'},
        @{N=7; Name='Node.js'; PackageId='OpenJS.NodeJS'},
        @{N=8; Name='7-Zip'; PackageId='7zip.7zip'},
        @{N=9; Name='ClamAV'; PackageId='Cisco.ClamAV'},
        @{N=10; Name='Gitleaks'; PackageId='Gitleaks.Gitleaks'},
        @{N=11; Name='Trivy'; PackageId='AquaSecurity.Trivy'},
        @{N=12; Name='GitHub CLI'; PackageId='GitHub.cli'},
        @{N=13; Name='Docker Desktop'; PackageId='Docker.DockerDesktop'},
        @{N=14; Name='PowerShell 7'; PackageId='Microsoft.PowerShell'},
        @{N=15; Name='cURL'; PackageId='cURL.cURL'},
        @{N=16; Name='Ruff'; PackageId='astral-sh.ruff'}
    )
    while ($true) {
        $states = @{}
        foreach ($item in $items) { $states[[int]$item.N] = Get-OptionalToolStatus $item }
        $allReady = @($items | Where-Object { $states[[int]$_.N] -eq 'MISSING' }).Count -eq 0
        try { [Console]::Clear() } catch { Clear-Host }
        $art = @(
            '  ███████╗  ██████╗  █████╗  ███╗   ██╗',
            '  ██╔════╝ ██╔════╝ ██╔══██╗ ████╗  ██║',
            '  ███████╗ ██║      ███████║ ██╔██╗ ██║',
            '  ╚════██║ ██║      ██╔══██╗ ██║╚██╗██║',
            '  ███████║ ╚██████╗ ██║  ██║ ██║ ╚████║',
            '  ╚══════╝  ╚═════╝ ╚═╝  ╚═╝ ╚═╝  ╚═══╝'
        )
        Animate-RainbowBanner $art 'PRE-DOWNLOAD SELECTION  |  73 CORE ENTRIES + 16 OPTIONAL APPS' 6
        Write-ConsoleRow 7 'Choose optional tools before any download starts.' ([ConsoleColor]::Gray) -Center -MaxWidth 88
        Write-ConsoleRow 8 ('─' * 70) ([ConsoleColor]::DarkGray) -Center -MaxWidth 80
        for ($row = 0; $row -lt 8; $row++) {
            $left = $items[$row]
            $right = $items[$row + 8]
            $leftState = $states[[int]$left.N]; $rightState = $states[[int]$right.N]
            $leftText = (' [{0,2}] {1} [{2}]' -f $left.N,$left.Name,$leftState)
            $rightText = (' [{0,2}] {1} [{2}]' -f $right.N,$right.Name,$rightState)
            Write-OptionalToolCell (9+$row) 2 $leftText $leftState
            Write-OptionalToolCell (9+$row) 43 $rightText $rightState
        }
        Write-ConsoleRow 18 'Green = installed or downloaded; gray = missing.' ([ConsoleColor]::Cyan) -MaxWidth 88
        Write-ConsoleRow 19 'I=install missing apps; U=upgrade installed apps; D=download files only.' ([ConsoleColor]::Gray) -MaxWidth 88
        if ($allReady) {
            Write-ConsoleRow 21 'All 16 tools are installed or downloaded.' ([ConsoleColor]::Green) -Center -MaxWidth 88
            Write-ConsoleRow 22 'Continuing automatically in 3 seconds...' ([ConsoleColor]::Green) -Center -MaxWidth 88
            Clear-PendingToolChoices
            Write-PreDownloadSelection 'NONE'
            Write-ConsentLog 'All 16 tools detected as installed or downloaded; skipped selection after a 3-second status display.' 'OK'
            Start-Sleep -Seconds 3
            return $true
        }
        Write-ConsoleRow 20 'A/M=select tools not detected as installed; downloaded files are green.' ([ConsoleColor]::Yellow) -MaxWidth 88
        Write-ConsoleRow 21 'U=select installed apps for update. Explicit numbers allow I/U/D choice.' ([ConsoleColor]::Yellow) -MaxWidth 88
        Write-ConsoleRow 22 'L=catalog | 0=skip | Q=cancel' ([ConsoleColor]::Yellow) -MaxWidth 88
        try { [Console]::SetCursorPosition(0,24); [Console]::Write((' ' * ([Math]::Max(50,[Console]::WindowWidth)-1))); [Console]::SetCursorPosition(0,24) } catch {}
        $raw = (Read-Host 'Tool IDs / ranges / A / M / U / L / 0 / Q').Trim().ToLowerInvariant()
        if ($raw -eq 'q') { Write-ConsentLog 'Startup cancelled at optional package selection; no downloads started.' 'INFO'; return $false }
        if ($raw -in @('0','none','skip')) {
            Clear-PendingToolChoices; Write-PreDownloadSelection 'NONE'
            Write-ConsentLog 'No optional packages selected before startup; tools remain available in menu 33.' 'INFO'
            Write-ConsoleRow 23 'No optional tools selected. Continuing to the main menu.' ([ConsoleColor]::Yellow) -MaxWidth 88
            Start-Sleep -Milliseconds 600; return $true
        }
        if ($raw -eq 'l') { $catalogPath = Join-Path $PSScriptRoot 'TOOL_CATALOG.txt'; if (Test-Path -LiteralPath $catalogPath) { try { Start-Process -FilePath 'notepad.exe' -ArgumentList @($catalogPath) -Wait } catch { Write-ConsentLog ('Unable to open tool catalog: ' + $_.Exception.Message) 'WARN' } }; continue }
        $presetAction = $null
        if ($raw -eq 'u') {
            $selected = @($items | Where-Object { $states[[int]$_.N] -eq 'INSTALLED' } | ForEach-Object { [int]$_.N }); $presetAction='u'
            if ($selected.Count -eq 0) { Write-ConsoleRow 23 'No installed apps detected for update.' ([ConsoleColor]::Yellow) -MaxWidth 88; Start-Sleep -Milliseconds 900; continue }
        } elseif ($raw -in @('a','all','m','missing')) {
            $selected = @($items | Where-Object { $states[[int]$_.N] -ne 'INSTALLED' } | ForEach-Object { [int]$_.N })
            if ($selected.Count -eq 0) { Write-ConsoleRow 23 'All apps are installed. Use U to check updates.' ([ConsoleColor]::Green) -MaxWidth 88; Start-Sleep -Milliseconds 900; continue }
        } else {
            $selected=@(); $valid=$true
            foreach ($token in $raw.Split(',')) {
                $piece=$token.Trim()
                if ($piece -match '^\d+\s*-\s*\d+$') { $range=$piece -split '-',2; $a=[int]$range[0].Trim(); $b=[int]$range[1].Trim(); if ($a -gt $b) {$tmp=$a;$a=$b;$b=$tmp}; if ($a -lt 1 -or $b -gt 16) {$valid=$false;break}; foreach($num in ($a..$b)){if($selected -notcontains $num){$selected+=$num}} }
                else { $num=0; if(-not [int]::TryParse($piece,[ref]$num) -or $num -lt 1 -or $num -gt 16){$valid=$false;break}; if($selected -notcontains $num){$selected+=$num} }
            }
            if (-not $valid -or $selected.Count -eq 0) { Write-ConsoleRow 23 'Invalid choice. Enter 1-16, ranges, A, M, U, 0 or Q.' ([ConsoleColor]::Red) -MaxWidth 88; Start-Sleep -Milliseconds 900; continue }
        }
        $selected=@($selected | Sort-Object -Unique)
        $selectedNames=foreach($num in $selected){($items | Where-Object {$_.N -eq $num} | Select-Object -First 1).Name}
        Write-Host ''; Write-Host ('Selected: ' + ($selectedNames -join ', ')) -ForegroundColor Green; Write-Host ''
        if ($presetAction) { $action=$presetAction; Write-Host 'Update mode selected for detected installed apps.' -ForegroundColor Cyan }
        else {
            Write-Host 'I=install (already installed apps are skipped), U=update installed apps, D=download only, Q=cancel.' -ForegroundColor Cyan
            while ($true) { $action=(Read-Host 'Action [I/U/D/Q]').Trim().ToLowerInvariant(); if ($action -in @('i','u','d','q')) {break}; Write-Host 'Enter I, U, D or Q.' -ForegroundColor Red }
        }
        if ($action -eq 'q') { Clear-PendingToolChoices; Write-ConsentLog 'User cancelled optional-tool action before any download or install.' 'INFO'; Write-Host 'Cancelled; no tool action started.' -ForegroundColor DarkYellow; Start-Sleep -Milliseconds 600; return $false }
        Write-PreDownloadSelection (($selected -join ',')); Write-PreDownloadAction $action
        Write-ConsentLog ('Optional packages selected: ' + ($selected -join ',')) 'OK'
        Write-ConsentLog ('Optional action selected: ' + $action.ToUpperInvariant()) 'OK'
        return $true
    }
}
function Show-ConsentDialog {
    Add-Type -AssemblyName System.Windows.Forms -ErrorAction Stop
    Add-Type -AssemblyName System.Drawing -ErrorAction Stop
    [void][System.Windows.Forms.Application]::EnableVisualStyles()

    $form = New-Object System.Windows.Forms.Form
    $form.Text = 'SCAN Privacy, Safety and License Acknowledgement'
    $form.StartPosition = [System.Windows.Forms.FormStartPosition]::CenterScreen
    $form.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::FixedDialog
    $form.ClientSize = [System.Drawing.Size]::new(1100, 780)
    $form.MaximizeBox = $false
    $form.MinimizeBox = $true
    $form.ShowInTaskbar = $true
    $form.BackColor = [System.Drawing.Color]::FromArgb(248, 249, 252)
    $form.Font = [System.Drawing.Font]::new('Segoe UI', 10)

    # Static privacy-consent header. No animated logo or redraw loop.
    $header = New-Object System.Windows.Forms.Panel
    $header.Location = [System.Drawing.Point]::new(0, 0)
    $header.Size = [System.Drawing.Size]::new(1100, 120)
    $header.BackColor = [System.Drawing.Color]::FromArgb(22, 25, 38)
    $form.Controls.Add($header)

    $titleLabel = New-Object System.Windows.Forms.Label
    $titleLabel.Text = 'SCAN Privacy, Safety and License Acknowledgement'
    $titleLabel.Location = [System.Drawing.Point]::new(25, 18)
    $titleLabel.Size = [System.Drawing.Size]::new(1050, 48)
    $titleLabel.TextAlign = [System.Drawing.ContentAlignment]::MiddleCenter
    $titleLabel.ForeColor = [System.Drawing.Color]::FromArgb(245, 247, 255)
    $titleLabel.BackColor = $header.BackColor
    $titleLabel.Font = [System.Drawing.Font]::new('Segoe UI', 22, [System.Drawing.FontStyle]::Bold)
    $header.Controls.Add($titleLabel)

    $subtitle = New-Object System.Windows.Forms.Label
    $subtitle.Text = 'Privacy notice  ·  Authorized use  ·  Safety limits  ·  License files'
    $subtitle.Location = [System.Drawing.Point]::new(0, 72)
    $subtitle.Size = [System.Drawing.Size]::new(1100, 28)
    $subtitle.TextAlign = [System.Drawing.ContentAlignment]::MiddleCenter
    $subtitle.ForeColor = [System.Drawing.Color]::FromArgb(174, 190, 218)
    $subtitle.BackColor = $header.BackColor
    $subtitle.Font = [System.Drawing.Font]::new('Segoe UI', 10, [System.Drawing.FontStyle]::Regular)
    $header.Controls.Add($subtitle)

    $rich = New-Object System.Windows.Forms.RichTextBox
    $rich.Location = [System.Drawing.Point]::new(18, 135)
    $rich.Size = [System.Drawing.Size]::new(1064, 530)
    $rich.Anchor = [System.Windows.Forms.AnchorStyles]::Top -bor [System.Windows.Forms.AnchorStyles]::Left -bor [System.Windows.Forms.AnchorStyles]::Right
    $rich.ReadOnly = $true
    $rich.DetectUrls = $false
    $rich.WordWrap = $true
    $rich.ScrollBars = [System.Windows.Forms.RichTextBoxScrollBars]::Vertical
    $rich.BorderStyle = [System.Windows.Forms.BorderStyle]::FixedSingle
    $rich.BackColor = [System.Drawing.Color]::White
    $rich.ForeColor = [System.Drawing.Color]::FromArgb(40, 45, 56)
    $rich.Font = [System.Drawing.Font]::new('Segoe UI', 10)
    $document = [System.IO.File]::ReadAllText($guidePath, [System.Text.Encoding]::UTF8)
    $rich.Text = $document

    # Highlight important safety terms once during construction; no per-keystroke re-render.
    $terms = @('NOTICE', 'IMPORTANT', 'AUTHORIZED', 'PRIVACY', 'PASSWORD', 'LICENSE', 'RISK', 'LIMIT', 'AGREE', 'localhost', '127.0.0.1', '::1')
    foreach ($term in $terms) {
        $searchAt = 0
        while ($searchAt -lt $rich.TextLength) {
            $found = $rich.Find($term, $searchAt, [System.Windows.Forms.RichTextBoxFinds]::None)
            if ($found -lt 0) { break }
            $rich.Select($found, $term.Length)
            $rich.SelectionColor = [System.Drawing.Color]::FromArgb(145, 53, 12)
            $rich.SelectionBackColor = [System.Drawing.Color]::FromArgb(255, 245, 190)
            $searchAt = $found + $term.Length
        }
    }
    $rich.Select(0, 0)
    $rich.SelectionStart = 0
    $rich.SelectionLength = 0
    $rich.ScrollToCaret()
    $form.Controls.Add($rich)

    $footer = New-Object System.Windows.Forms.Panel
    $footer.Location = [System.Drawing.Point]::new(0, 680)
    $footer.Size = [System.Drawing.Size]::new(1100, 100)
    $footer.BackColor = [System.Drawing.Color]::FromArgb(239, 242, 248)
    $form.Controls.Add($footer)

    $ack = New-Object System.Windows.Forms.CheckBox
    $ack.Text = 'I have read the privacy and safety notice and understand the authorized-use limits.'
    $ack.Location = [System.Drawing.Point]::new(20, 13)
    $ack.Size = [System.Drawing.Size]::new(700, 26)
    $ack.ForeColor = [System.Drawing.Color]::FromArgb(43, 49, 62)
    $ack.Font = [System.Drawing.Font]::new('Segoe UI', 10, [System.Drawing.FontStyle]::Bold)
    $footer.Controls.Add($ack)

    $hint = New-Object System.Windows.Forms.Label
    $hint.Text = 'This is a short startup notice. Full license texts are provided separately in LICENSE and LICENSES/.'
    $hint.Location = [System.Drawing.Point]::new(20, 45)
    $hint.Size = [System.Drawing.Size]::new(720, 30)
    $hint.ForeColor = [System.Drawing.Color]::FromArgb(93, 101, 117)
    $hint.Font = [System.Drawing.Font]::new('Segoe UI', 8.5)
    $footer.Controls.Add($hint)

    $decline = New-Object System.Windows.Forms.Button
    $decline.Text = 'DECLINE / EXIT'
    $decline.Location = [System.Drawing.Point]::new(820, 24)
    $decline.Size = [System.Drawing.Size]::new(112, 40)
    $decline.DialogResult = [System.Windows.Forms.DialogResult]::Cancel
    $decline.FlatStyle = [System.Windows.Forms.FlatStyle]::System
    $footer.Controls.Add($decline)

    $agree = New-Object System.Windows.Forms.Button
    $agree.Text = 'AGREE / CONTINUE'
    $agree.Location = [System.Drawing.Point]::new(945, 24)
    $agree.Size = [System.Drawing.Size]::new(125, 40)
    $agree.Enabled = $false
    $agree.DialogResult = [System.Windows.Forms.DialogResult]::OK
    $agree.FlatStyle = [System.Windows.Forms.FlatStyle]::System
    $footer.Controls.Add($agree)

    $ack.Add_CheckedChanged({ $agree.Enabled = $ack.Checked })
    $form.AcceptButton = $agree
    $form.CancelButton = $decline

    try { [Console]::CursorVisible = $true } catch {}
    $result = $form.ShowDialog()
    $form.Dispose()
    return ($result -eq [System.Windows.Forms.DialogResult]::OK)
}

try {
    Write-ConsentLog 'Opening static WinForms startup notice; no animated console redraw loop.' 'INFO'
    $accepted = Show-ConsentDialog
    try { [Console]::CursorVisible = $true; [Console]::ResetColor() } catch {}
    if ($accepted) {
        Write-ConsentLog 'AGREE accepted from the startup notice dialog.' 'OK'
        $continued = Show-PreDownloadSelection
        if ($continued) { exit 0 }
        exit 10
    }
    Write-ConsentLog 'User declined or closed consent dialog; no package action started.' 'INFO'
    exit 10
}
catch {
    try { [Console]::CursorVisible = $true } catch {}
    [Console]::ForegroundColor = 'Red'
    [Console]::WriteLine('[CONSENT SCREEN ERROR] ' + $_.Exception.Message)
    [Console]::ResetColor()
    Write-ConsentLog ('CONSENT SCREEN ERROR | ' + $_.Exception.Message + ' | ' + $_.InvocationInfo.PositionMessage + ' | ' + $_.ScriptStackTrace) 'ERROR'
    [Console]::WriteLine('Make sure STARTUP_NOTICE.txt and consent.ps1 were extracted from the same ZIP.')
    exit 2
}
finally {
    try { [Console]::CursorVisible = $true } catch {}
    try { [Console]::ResetColor() } catch {}
}
