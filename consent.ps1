# Copyright (C) 2026 SCAN Rainbow Defense Toolkit contributors
# SPDX-License-Identifier: GPL-3.0-or-later
# SCAN v20 native Windows Forms privacy, safety and full-license consent guide. A static dialog avoids console redraw flicker.
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
Write-ConsentLog 'Consent screen opened.' 'INFO'

$guidePath = Join-Path $PSScriptRoot 'CONSENT_AND_LICENSES.txt'
if (-not (Test-Path -LiteralPath $guidePath -PathType Leaf)) {
    try { [Console]::CursorVisible = $true } catch {}
    [Console]::ForegroundColor = 'Red'
    [Console]::WriteLine('[ERROR] CONSENT_AND_LICENSES.txt 파일을 찾을 수 없습니다.')
    [Console]::ResetColor()
    Write-ConsentLog 'CONSENT_AND_LICENSES.txt missing.' 'ERROR'
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
    if ($Text -match '(주의|중요|반드시|차단|동의|개인정보|허가받은|악성|위험|삭제|제한|비밀번호|실제 결제|확정 판정|LICENSE|라이선스)') {
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

function Show-PreDownloadSelection {
    $items = @(
        @{N=1; Name='Nmap'},
        @{N=2; Name='Wireshark'},
        @{N=3; Name='Sysinternals Suite'},
        @{N=4; Name='OpenSSL Light'},
        @{N=5; Name='Git'},
        @{N=6; Name='Python 3.12'},
        @{N=7; Name='Node.js'},
        @{N=8; Name='7-Zip'},
        @{N=9; Name='ClamAV'},
        @{N=10; Name='Gitleaks'},
        @{N=11; Name='Trivy'},
        @{N=12; Name='GitHub CLI'},
        @{N=13; Name='Docker Desktop'},
        @{N=14; Name='PowerShell 7'},
        @{N=15; Name='cURL'},
        @{N=16; Name='Ruff'}
    )
    while ($true) {
        try { [Console]::Clear() } catch { Clear-Host }
        $art = @(
            '  ███████╗  ██████╗  █████╗  ███╗   ██╗',
            '  ██╔════╝ ██╔════╝ ██╔══██╗ ████╗  ██║',
            '  ███████╗ ██║      ███████║ ██╔██╗ ██║',
            '  ╚════██║ ██║      ██╔══██║ ██║╚██╗██║',
            '  ███████║ ╚██████╗ ██║  ██║ ██║ ╚████║',
            '  ╚══════╝  ╚═════╝ ╚═╝  ╚═╝ ╚═╝  ╚═══╝'
        )
        Animate-RainbowBanner $art 'PRE-DOWNLOAD SELECTION  |  45 MENU ITEMS + 16 CURATED APPS' 6
        Write-ConsoleRow 7 '선택 도구를 먼저 고르세요. 아직 다운로드는 시작되지 않습니다.' ([ConsoleColor]::Gray) -Center -MaxWidth 88
        Write-ConsoleRow 8 ('─' * 70) ([ConsoleColor]::DarkGray) -Center -MaxWidth 80
        for ($row = 0; $row -lt 8; $row++) {
            $left = $items[$row]
            $right = $items[$row + 8]
            $leftText = (' [{0,2}] {1}' -f $left.N, $left.Name).PadRight(34)
            $rightText = (' [{0,2}] {1}' -f $right.N, $right.Name)
            Write-ConsoleRow (9 + $row) ($leftText + $rightText) ([ConsoleColor]::Gray) -MaxWidth 88
        }
        Write-ConsoleRow 18 '번호: 1~16 / 범위: 1-4,9-11 / A=전체 16 / L=목록 / 0=건너뜀 / Q=취소' ([ConsoleColor]::Cyan) -MaxWidth 88
        Write-ConsoleRow 20 '내장 메뉴 항목 45개 + 선택 설치 앱 16개. 필요한 도구만 선택하세요.' ([ConsoleColor]::Yellow) -MaxWidth 88
        Write-ConsoleRow 21 '도구는 SCAN 메뉴 35~45에서 연동됩니다. L을 누르면 전체 설명서를 엽니다.' ([ConsoleColor]::Yellow) -MaxWidth 88
        try { [Console]::SetCursorPosition(0, 23); [Console]::Write((' ' * ([Math]::Max(50, [Console]::WindowWidth) - 1))); [Console]::SetCursorPosition(0, 23) } catch {}
        $raw = (Read-Host '도구 번호').Trim().ToLowerInvariant()
        if ($raw -eq 'q') {
            Write-ConsentLog 'Startup cancelled at optional package selection; no downloads started.' 'INFO'
            return $false
        }
        if ($raw -in @('0','none','skip')) {
            Clear-PendingToolChoices
            Write-PreDownloadSelection 'NONE'
            Write-ConsentLog 'No optional packages selected before first download; a single warning will appear at the bottom of the SCAN main menu.' 'INFO'
            Write-ConsoleRow 22 '선택 도구가 없습니다. 메인 메뉴 아래쪽에 경고가 한 번 표시됩니다.' ([ConsoleColor]::Yellow) -MaxWidth 88
            Start-Sleep -Milliseconds 700
            return $true
        }
        if ($raw -eq 'l') {
            $catalogPath = Join-Path $PSScriptRoot 'TOOL_CATALOG_KO.txt'
            if (Test-Path -LiteralPath $catalogPath) { try { Start-Process -FilePath 'notepad.exe' -ArgumentList @($catalogPath) -Wait } catch { Write-ConsentLog ('Unable to open tool catalog: ' + $_.Exception.Message) 'WARN' } }
            continue
        }
        if ($raw -in @('a','all')) {
            $selected = 1..16
        } else {
            $selected = @()
            $valid = $true
            foreach ($token in $raw.Split(',')) {
                $piece = $token.Trim()
                if ($piece -match '^\d+\s*-\s*\d+$') {
                    $range = $piece -split '-', 2
                    $a = [int]$range[0].Trim(); $b = [int]$range[1].Trim()
                    if ($a -gt $b) { $tmp=$a; $a=$b; $b=$tmp }
                    if ($a -lt 1 -or $b -gt 16) { $valid = $false; break }
                    foreach ($num in ($a..$b)) { if ($selected -notcontains $num) { $selected += $num } }
                } else {
                    $num = 0
                    if (-not [int]::TryParse($piece, [ref]$num) -or $num -lt 1 -or $num -gt 16) { $valid = $false; break }
                    if ($selected -notcontains $num) { $selected += $num }
                }
            }
            if (-not $valid -or $selected.Count -eq 0) {
                Write-ConsoleRow 23 '잘못된 번호입니다. 1~16, 범위(1-4), A, 0 또는 Q를 입력하세요.' ([ConsoleColor]::Red) -MaxWidth 88
                Start-Sleep -Milliseconds 900
                continue
            }
        }
        $selected = @($selected | Sort-Object -Unique)
        $selectedNames = foreach ($num in $selected) { ($items | Where-Object { $_.N -eq $num } | Select-Object -First 1).Name }
        Write-Host ''
        Write-Host ('선택됨: ' + ($selectedNames -join ', ')) -ForegroundColor Green
        Write-Host ''
        Write-Host '이제 작업을 선택하세요. I=선택 도구 설치, D=파일 다운로드만, Q=취소.' -ForegroundColor Cyan
        Write-Host 'I를 선택해도 마지막 확인 문구(INSTALL)를 입력하기 전에는 설치가 시작되지 않습니다.' -ForegroundColor Yellow
        while ($true) {
            $action = (Read-Host '작업 선택 [I/D/Q]').Trim().ToLowerInvariant()
            if ($action -in @('i','d','q')) { break }
            Write-Host 'I, D 또는 Q 중 하나를 입력하세요.' -ForegroundColor Red
        }
        if ($action -eq 'q') {
            Clear-PendingToolChoices
            Write-ConsentLog 'User cancelled optional-tool action before any download or install.' 'INFO'
            Write-Host '취소했습니다. 다운로드나 설치는 시작되지 않았습니다.' -ForegroundColor DarkYellow
            Start-Sleep -Milliseconds 700
            return $false
        }
        Write-PreDownloadSelection (($selected -join ','))
        Write-PreDownloadAction $action
        Write-ConsentLog ('Optional packages selected before first download: ' + ($selected -join ',')) 'OK'
        Write-ConsentLog ('Optional package action selected before first download: ' + $action.ToUpperInvariant()) 'OK'
        return $true
    }
}

function Show-ConsentDialog {
    Add-Type -AssemblyName System.Windows.Forms -ErrorAction Stop
    Add-Type -AssemblyName System.Drawing -ErrorAction Stop
    [void][System.Windows.Forms.Application]::EnableVisualStyles()

    $form = New-Object System.Windows.Forms.Form
    $form.Text = 'SCAN 개인정보 처리 · 안전 사용 · 라이선스 전문 동의'
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
    $titleLabel.Text = 'SCAN 개인정보 처리 · 안전 사용 · 라이선스 전문 동의'
    $titleLabel.Location = [System.Drawing.Point]::new(25, 18)
    $titleLabel.Size = [System.Drawing.Size]::new(1050, 48)
    $titleLabel.TextAlign = [System.Drawing.ContentAlignment]::MiddleCenter
    $titleLabel.ForeColor = [System.Drawing.Color]::FromArgb(245, 247, 255)
    $titleLabel.BackColor = $header.BackColor
    $titleLabel.Font = [System.Drawing.Font]::new('Segoe UI', 22, [System.Drawing.FontStyle]::Bold)
    $header.Controls.Add($titleLabel)

    $subtitle = New-Object System.Windows.Forms.Label
    $subtitle.Text = '개인정보 안내  ·  이용 범위  ·  안전 수칙  ·  오픈소스 라이선스'
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
    $terms = @('주의', '중요', '반드시', '개인정보', '허가받은', '비밀번호', '라이선스', '위험', '제한', 'AGREE', 'localhost', '127.0.0.1', '::1')
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
    $ack.Text = '개인정보·안전 안내와 라이선스 전문을 읽었고 조건을 이해했습니다.'
    $ack.Location = [System.Drawing.Point]::new(20, 13)
    $ack.Size = [System.Drawing.Size]::new(700, 26)
    $ack.ForeColor = [System.Drawing.Color]::FromArgb(43, 49, 62)
    $ack.Font = [System.Drawing.Font]::new('Segoe UI', 10, [System.Drawing.FontStyle]::Bold)
    $footer.Controls.Add($ack)

    $hint = New-Object System.Windows.Forms.Label
    $hint.Text = '오른쪽 스크롤바 또는 마우스 휠로 전체 본문과 라이선스 전문을 읽으세요. 동의하지 않으면 거부를 선택하세요.'
    $hint.Location = [System.Drawing.Point]::new(20, 45)
    $hint.Size = [System.Drawing.Size]::new(720, 30)
    $hint.ForeColor = [System.Drawing.Color]::FromArgb(93, 101, 117)
    $hint.Font = [System.Drawing.Font]::new('Segoe UI', 8.5)
    $footer.Controls.Add($hint)

    $decline = New-Object System.Windows.Forms.Button
    $decline.Text = '거부 / 종료'
    $decline.Location = [System.Drawing.Point]::new(820, 24)
    $decline.Size = [System.Drawing.Size]::new(112, 40)
    $decline.DialogResult = [System.Windows.Forms.DialogResult]::Cancel
    $decline.FlatStyle = [System.Windows.Forms.FlatStyle]::System
    $footer.Controls.Add($decline)

    $agree = New-Object System.Windows.Forms.Button
    $agree.Text = 'AGREE / 동의'
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
    Write-ConsentLog 'Opening static WinForms consent guide; no animated console redraw loop.' 'INFO'
    $accepted = Show-ConsentDialog
    try { [Console]::CursorVisible = $true; [Console]::ResetColor() } catch {}
    if ($accepted) {
        Write-ConsentLog 'AGREE accepted from static Windows Forms guide dialog.' 'OK'
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
    [Console]::WriteLine('CONSENT_AND_LICENSES.txt와 consent.ps1을 ZIP에서 함께 압축 해제했는지 확인하세요.')
    exit 2
}
finally {
    try { [Console]::CursorVisible = $true } catch {}
    try { [Console]::ResetColor() } catch {}
}
