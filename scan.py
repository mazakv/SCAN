#!/usr/bin/env python3
# Copyright (C) 2026 SCAN Rainbow Defense Toolkit contributors
# SPDX-License-Identifier: GPL-3.0-or-later
"""SCAN - local-first defensive checks, URL triage and bounded website posture review.

This tool is a lightweight triage aid, not an antivirus or a definitive phishing detector.
The URL analyzer starts locally. Optional DNS/HEAD checks require explicit user confirmation.
The Nmap menu accepts only a single IPv4 loopback/private address.
"""
from __future__ import annotations

import colorsys
import hashlib
import json
import webbrowser
import csv
import io
import textwrap
import ipaddress
import os
import re
import queue
import threading
import shutil
import socket
import ssl
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit, urlunsplit, unquote, unquote_plus, urlencode, quote
from urllib.request import HTTPRedirectHandler, Request, build_opener

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except (AttributeError, OSError):
    pass

RESET = "\x1b[0m"
BOLD = "\x1b[1m"
CYAN = "\x1b[96m"
MAGENTA = "\x1b[95m"
GREEN = "\x1b[92m"
YELLOW = "\x1b[93m"
RED = "\x1b[91m"
DIM = "\x1b[90m"


APP_ROOT = Path(__file__).resolve().parent
LOG_DIR = APP_ROOT / "Logs"
APP_LOG = LOG_DIR / "scan.log"
ERROR_LOG = LOG_DIR / "errors.log"
DOWNLOAD_LOG = LOG_DIR / "downloads.log"
DOWNLOAD_CSV = LOG_DIR / "downloads.csv"
INSTALLED_STATE_FILE = LOG_DIR / "installed_packages.json"
SQLMAP_DIAG_LOG = LOG_DIR / "sqlmap_diagnostics.log"
_SQLMAP_VERIFIED_PYTHON: str | None = None
DOWNLOAD_FIELDS = ["Timestamp", "Name", "PackageId", "Action", "Status", "NewMiB", "TotalMiB", "Files", "Details"]

# Cache the in-progress folder-size display so redrawing the dashboard does not repeatedly
# walk a potentially large installer directory. Final sizes are always measured after the job.
_DASHBOARD_SIZE_CACHE: dict[str, tuple[float, int]] = {}

# Curated, practical tools. Duplicative editors/proxies/Kubernetes stacks were removed.
# SCAN integrates selected CLIs into workflows; GUI tools remain optional/manual.
EXTERNAL_TOOL_CATALOG = {
    1: ("Nmap", "Insecure.Nmap", "Bounded local/private-host service inventory", "https://nmap.org/download.html"),
    2: ("Wireshark", "WiresharkFoundation.Wireshark", "TShark packet-capture summaries for local files", "https://www.wireshark.org/download.html"),
    3: ("Sysinternals Suite", "Microsoft.Sysinternals.Suite", "Autoruns/Sigcheck/Process Explorer host diagnostics", "https://learn.microsoft.com/sysinternals/"),
    4: ("OpenSSL Light", "ShiningLight.OpenSSL.Light", "TLS certificate cross-check", "https://slproweb.com/products/Win32OpenSSL.html"),
    5: ("Git", "Git.Git", "Repository hygiene and tracked-file checks", "https://git-scm.com/download/win"),
    6: ("Python 3.12", "Python.Python.3.12", "Compatibility runtime for local tools", "https://www.python.org/downloads/windows/"),
    7: ("Node.js", "OpenJS.NodeJS", "Read-only JavaScript syntax checks", "https://nodejs.org/en/download"),
    8: ("7-Zip", "7zip.7zip", "Archive integrity testing without extraction", "https://www.7-zip.org/"),
    9: ("ClamAV", "Cisco.ClamAV", "On-demand local file and folder malware scan", "https://www.clamav.net/downloads"),
    10: ("Gitleaks", "Gitleaks.Gitleaks", "Redacted secret scanning for local project files", "https://github.com/gitleaks/gitleaks"),
    11: ("Trivy", "AquaSecurity.Trivy", "Dependency/config/container/SBOM scanning", "https://github.com/aquasecurity/trivy"),
    12: ("GitHub CLI", "GitHub.cli", "Optional GitHub repository metadata check", "https://cli.github.com/"),
    13: ("Docker Desktop", "Docker.DockerDesktop", "Local container/image inventory and Trivy image audit", "https://www.docker.com/products/docker-desktop/"),
    14: ("PowerShell 7", "Microsoft.PowerShell", "Local Windows host-health snapshot", "https://github.com/PowerShell/PowerShell"),
    15: ("cURL", "cURL.cURL", "HTTP/TLS header cross-check without redirect following", "https://curl.se/windows/"),
    16: ("Ruff", "astral-sh.ruff", "Read-only Python lint checks", "https://docs.astral.sh/ruff/"),
}
CORE_MENU_COUNT = 60

# Candidate executable names are deliberately fixed; no shell command is built from user input.
EXTERNAL_TOOL_COMMANDS = {
    1: ("nmap.exe", "nmap"), 2: ("Wireshark.exe", "wireshark.exe"),
    3: ("autorunsc64.exe", "autorunsc.exe", "procexp64.exe", "procexp.exe"),
    4: ("openssl.exe", "openssl"), 5: ("git.exe", "git"),
    6: ("python3.12.exe", "python3.12", "python.exe"), 7: ("node.exe", "node"),
    8: ("7z.exe", "7zz.exe", "7z"), 9: ("clamscan.exe", "clamscan"),
    10: ("gitleaks.exe", "gitleaks"), 11: ("trivy.exe", "trivy"),
    12: ("gh.exe", "gh"), 13: ("Docker Desktop.exe", "docker.exe", "docker"),
    14: ("pwsh.exe", "pwsh"), 15: ("curl.exe", "curl"), 16: ("ruff.exe", "ruff"),
}

_WINGET_INSTALLED_CACHE: set[str] = set()
_WINGET_CACHE_AT = 0.0
_WINGET_CACHE_OK = False
_WINGET_CACHE_TTL = 12.0
_WINGET_PACKAGE_CACHE: dict[str, tuple[float, bool]] = {}
_REGISTRY_DISPLAY_NAME_CACHE: set[str] = set()
_REGISTRY_CACHE_AT = 0.0
_REGISTRY_CACHE_TTL = 20.0

REGISTRY_DISPLAY_PATTERNS = {
    1: (r"^nmap(?:\s|$)",), 2: (r"^wireshark(?:\s|$)",),
    3: (r"sysinternals",), 4: (r"openssl",), 5: (r"^git(?:\s|$)", r"git for windows"),
    6: (r"^python 3\.12(?:\s|$)",), 7: (r"^node\.js(?:\s|$)",),
    8: (r"^7-zip(?:\s|$)",), 9: (r"clamav",), 10: (r"gitleaks",),
    11: (r"^trivy(?:\s|$)",), 12: (r"github cli", r"github command line"),
    13: (r"docker desktop",), 14: (r"powershell 7", r"powershell-7"),
    15: (r"curl",), 16: (r"ruff",),
}

def _load_install_state() -> dict[str, dict[str, str]]:
    try:
        data = json.loads(INSTALLED_STATE_FILE.read_text(encoding="utf-8"))
        if isinstance(data, dict):
            return {str(key): value for key, value in data.items() if isinstance(value, dict)}
    except (OSError, ValueError, TypeError):
        pass
    return {}


def _save_install_state(package_id: str, status: str, details: str = "") -> None:
    """Persist WinGet success evidence so a delayed inventory query won't immediately relock the menu."""
    ensure_log_files()
    state = _load_install_state()
    state[package_id] = {
        "status": status,
        "timestamp": datetime.now().astimezone().isoformat(timespec="seconds"),
        "details": str(details)[:500],
    }
    try:
        INSTALLED_STATE_FILE.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")
    except OSError as exc:
        log_event("INSTALLED_STATE_WRITE_FAILED", "WARN", f"{package_id} | {exc}")


def _remove_install_state(package_id: str) -> None:
    state = _load_install_state()
    if package_id not in state:
        return
    state.pop(package_id, None)
    try:
        if state:
            INSTALLED_STATE_FILE.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")
        else:
            INSTALLED_STATE_FILE.unlink(missing_ok=True)
    except OSError as exc:
        log_event("INSTALLED_STATE_REMOVE_FAILED", "WARN", f"{package_id} | {exc}")


def refresh_registry_display_name_cache(force: bool = False) -> set[str]:
    """Read installed-app registry entries once per short interval to keep menu rendering fast."""
    global _REGISTRY_DISPLAY_NAME_CACHE, _REGISTRY_CACHE_AT
    if os.name != "nt":
        return set()
    if not force and time.monotonic() - _REGISTRY_CACHE_AT < _REGISTRY_CACHE_TTL:
        return set(_REGISTRY_DISPLAY_NAME_CACHE)
    try:
        import winreg
    except ImportError:
        return set()
    roots = (
        (winreg.HKEY_CURRENT_USER, r"Software\Microsoft\Windows\CurrentVersion\Uninstall"),
        (winreg.HKEY_LOCAL_MACHINE, r"Software\Microsoft\Windows\CurrentVersion\Uninstall"),
        (winreg.HKEY_LOCAL_MACHINE, r"Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall"),
    )
    names: set[str] = set()
    for hive, root_path in roots:
        try:
            with winreg.OpenKey(hive, root_path) as root:
                count = winreg.QueryInfoKey(root)[0]
                for index in range(count):
                    try:
                        subkey_name = winreg.EnumKey(root, index)
                        with winreg.OpenKey(root, subkey_name) as subkey:
                            display_name, _kind = winreg.QueryValueEx(subkey, "DisplayName")
                        if str(display_name).strip():
                            names.add(str(display_name).strip().lower())
                    except OSError:
                        continue
        except OSError:
            continue
    _REGISTRY_DISPLAY_NAME_CACHE = names
    _REGISTRY_CACHE_AT = time.monotonic()
    return set(names)


def _registry_confirms_installed(tool_number: int, force: bool = False) -> bool:
    """Check Windows uninstall metadata as a second source when PATH/WinGet table is incomplete."""
    patterns = REGISTRY_DISPLAY_PATTERNS.get(tool_number, ())
    if not patterns:
        return False
    names = refresh_registry_display_name_cache(force=force)
    return any(re.search(pattern, name, re.IGNORECASE) for pattern in patterns for name in names)


def _contains_package_id(text: str, package_id: str) -> bool:
    return re.search(r"(?<![A-Za-z0-9_.-])" + re.escape(package_id) + r"(?![A-Za-z0-9_.-])",
                     text, flags=re.IGNORECASE) is not None


def refresh_winget_installed_cache(force: bool = False, timeout: float = 12.0) -> set[str]:
    """Refresh installed package IDs in one WinGet query, avoiding a query per menu cell."""
    global _WINGET_INSTALLED_CACHE, _WINGET_CACHE_AT, _WINGET_CACHE_OK
    if not force and _WINGET_CACHE_OK and time.monotonic() - _WINGET_CACHE_AT < _WINGET_CACHE_TTL:
        return set(_WINGET_INSTALLED_CACHE)
    try:
        command = ["winget", "list", "--accept-source-agreements", "--disable-interactivity"]
        try:
            result = subprocess.run(command, capture_output=True, text=True, encoding="utf-8",
                                    errors="replace", timeout=timeout)
        except (OSError, subprocess.SubprocessError):
            result = subprocess.run(["winget", "list", "--accept-source-agreements"],
                                    capture_output=True, text=True, encoding="utf-8",
                                    errors="replace", timeout=timeout)
        combined = (result.stdout or "") + "\n" + (result.stderr or "")
        found = {package_id for _name, package_id, _desc, _url in EXTERNAL_TOOL_CATALOG.values()
                 if _contains_package_id(combined, package_id)}
        if result.returncode == 0:
            _WINGET_INSTALLED_CACHE = found
            _WINGET_CACHE_AT = time.monotonic()
            _WINGET_CACHE_OK = True
        return set(_WINGET_INSTALLED_CACHE)
    except (OSError, subprocess.SubprocessError):
        return set(_WINGET_INSTALLED_CACHE)


def winget_confirms_installed(package_id: str, timeout: float = 5.0, force: bool = False) -> bool:
    """Verify one package by exact ID, using a short cache outside install/refresh operations."""
    global _WINGET_INSTALLED_CACHE, _WINGET_CACHE_AT, _WINGET_CACHE_OK
    cached = _WINGET_PACKAGE_CACHE.get(package_id)
    if not force and cached and time.monotonic() - cached[0] < _WINGET_CACHE_TTL:
        return cached[1]
    try:
        command = ["winget", "list", "--id", package_id, "--exact",
                   "--accept-source-agreements", "--disable-interactivity"]
        try:
            result = subprocess.run(command, capture_output=True, text=True, encoding="utf-8",
                                    errors="replace", timeout=timeout)
        except (OSError, subprocess.SubprocessError):
            result = subprocess.run(["winget", "list", "--id", package_id, "--exact",
                                    "--accept-source-agreements"], capture_output=True, text=True,
                                   encoding="utf-8", errors="replace", timeout=timeout)
        combined = (result.stdout or "") + "\n" + (result.stderr or "")
        confirmed = result.returncode == 0 and _contains_package_id(combined, package_id)
        _WINGET_PACKAGE_CACHE[package_id] = (time.monotonic(), confirmed)
        if confirmed:
            _WINGET_INSTALLED_CACHE.add(package_id)
        else:
            _WINGET_INSTALLED_CACHE.discard(package_id)
        _WINGET_CACHE_AT = time.monotonic()
        _WINGET_CACHE_OK = True
        return confirmed
    except (OSError, subprocess.SubprocessError):
        return False


def refresh_catalog_installed_status() -> None:
    """Refresh WinGet, executable paths, registry entries, and recent successful-install evidence."""
    refresh_windows_path_environment()
    refresh_registry_display_name_cache(force=True)
    refresh_winget_installed_cache(force=True, timeout=12.0)
    inventory = set(_WINGET_INSTALLED_CACHE)
    has_winget = bool(shutil.which("winget"))
    saved_state = _load_install_state()
    if not has_winget:
        # Without WinGet there is no dependable package inventory to invalidate saved WinGet evidence.
        # Keep existing records, while the live executable/registry checks above still work.
        for number, (_name, package_id, _description, _url) in EXTERNAL_TOOL_CATALOG.items():
            if find_installed_external_tool(number) is not None or _registry_confirms_installed(number):
                _save_install_state(package_id, "verified", "confirmed by path or uninstall registry")
        log_event("WINGET_STATUS_REFRESH", "WARN", "WinGet unavailable; existing install evidence retained")
        return
    for number, (name, package_id, _description, _url) in EXTERNAL_TOOL_CATALOG.items():
        path_ok = find_installed_external_tool(number) is not None
        registry_ok = _registry_confirms_installed(number)
        inventory_ok = package_id in inventory
        confirmed = path_ok or registry_ok or inventory_ok
        # If a package was installed by SCAN but the broad table omitted/truncated its ID,
        # perform a targeted query only for a previously handled package instead of repeated network-sensitive package queries.
        if not confirmed and has_winget and (package_id in saved_state or
                (APP_ROOT / "downloads" / "packages" / re.sub(r"[^A-Za-z0-9._-]+", "_", package_id)).exists()):
            confirmed = winget_confirms_installed(package_id, timeout=5.0, force=True)
        if confirmed:
            _save_install_state(package_id, "verified", "confirmed by executable path, uninstall registry, or WinGet inventory")
        else:
            _remove_install_state(package_id)
    log_event("WINGET_STATUS_REFRESH", "INFO", "Refreshed installed status from WinGet, PATH, registry, and saved install evidence")


def show_download_warning(message: str = "다운로드만 선택하면 설치되지 않아 메뉴에서 잠금 상태로 유지됩니다.") -> None:
    """Render one compact bottom warning box explaining a no-download or download-only result."""
    width = max(60, min(92, shutil.get_terminal_size(fallback=(92, 30)).columns - 2))
    inner = width - 4
    text = message.strip()
    if len(text) > inner:
        text = text[:inner - 1] + "…"
    print(paint("┌─ WARNING " + "─" * max(1, width - 12) + "┐", YELLOW + BOLD))
    print(paint("│ " + text.ljust(inner) + " │", YELLOW + BOLD))
    print(paint("└" + "─" * (width - 2) + "┘", YELLOW + BOLD))



def ensure_log_files() -> None:
    """Create Logs and its expected files without overwriting previous history."""
    try:
        LOG_DIR.mkdir(parents=True, exist_ok=True)
        for path in (APP_LOG, ERROR_LOG, DOWNLOAD_LOG):
            if not path.exists():
                path.write_text("", encoding="utf-8")
        if not DOWNLOAD_CSV.exists() or DOWNLOAD_CSV.stat().st_size == 0:
            import csv as _csv
            with DOWNLOAD_CSV.open("w", newline="", encoding="utf-8-sig") as handle:
                _csv.writer(handle).writerow(DOWNLOAD_FIELDS)
    except OSError:
        # The program should remain usable if logs cannot be written (e.g. read-only folder).
        pass


def log_event(event: str, status: str = "INFO", details: str = "") -> None:
    ensure_log_files()
    cleaned = str(details).replace("\r", " ").replace("\n", " ")
    timestamp = datetime.now().astimezone().isoformat(timespec='seconds')
    line = f"{timestamp}\t{status}\t{event}\t{cleaned}\n"
    try:
        with APP_LOG.open("a", encoding="utf-8") as handle:
            handle.write(line)
    except OSError:
        pass
    if str(status).upper() == "ERROR":
        try:
            with ERROR_LOG.open("a", encoding="utf-8") as handle:
                handle.write(line)
        except OSError:
            pass


def append_download_csv(name: str, package_id: str, action: str, status: str,
                        new_bytes: int | None, total_bytes: int | None, files: str = "", details: str = "") -> None:
    ensure_log_files()
    import csv as _csv
    new_mb = "N/A" if new_bytes is None else f"{new_bytes / (1024 * 1024):.3f}"
    total_mb = "N/A" if total_bytes is None else f"{total_bytes / (1024 * 1024):.3f}"
    try:
        with DOWNLOAD_CSV.open("a", newline="", encoding="utf-8") as handle:
            _csv.writer(handle).writerow([
                datetime.now().astimezone().isoformat(timespec="seconds"), name, package_id,
                action, status, new_mb, total_mb, files,
                str(details).replace("\r", " ").replace("\n", " ")
            ])
    except OSError as exc:
        log_event("CSV_LOG_WRITE_FAILED", "WARN", str(exc))


def append_download_detail(line: str) -> None:
    ensure_log_files()
    try:
        with DOWNLOAD_LOG.open("a", encoding="utf-8") as handle:
            handle.write(f"{datetime.now().astimezone().isoformat(timespec='seconds')}\t{line.rstrip()}\n")
    except OSError:
        pass


def _mib(value: int) -> str:
    return f"{value / (1024 * 1024):.2f} MiB"


def _directory_snapshot(folder: Path) -> dict[str, tuple[int, int]]:
    result: dict[str, tuple[int, int]] = {}
    if not folder.exists():
        return result
    try:
        for path in folder.rglob("*"):
            try:
                if path.is_file() and not path.is_symlink():
                    stat = path.stat()
                    result[str(path.relative_to(folder))] = (stat.st_size, stat.st_mtime_ns)
            except OSError:
                continue
    except OSError:
        pass
    return result


def _directory_bytes(folder: Path) -> int:
    return sum(size for size, _mtime in _directory_snapshot(folder).values())


def _append_winget_line(package_name: str, line: str) -> None:
    safe_line = line.rstrip("\r\n")
    if safe_line:
        append_download_detail(f"[{package_name}] {safe_line}")


def _draw_package_dashboard(action_label: str, package_name: str, package_number: int, total_packages: int,
                            completed: int, last_lines: list[str], current_folder: Path | None,
                            reported_percent: int | None, spinner: int, waiting_for_input: bool = False) -> None:
    # Percent shown in the main bar is package-count progress, not an invented byte estimate.
    package_fraction = completed / max(1, total_packages)
    bar_width = 38
    filled = int(bar_width * package_fraction)
    tail = ["."] * (bar_width - filled)
    if tail and completed < total_packages:
        # Moving marker shows activity without pretending to know transferred bytes.
        tail[spinner % len(tail)] = ">"
    bar = "#" * filled + "".join(tail)
    if os.name == "nt" and COLOR_ENABLED:
        print("\x1b[2J\x1b[H", end="")
    else:
        print("\n" + "=" * 74)
    print(paint("SCAN / TOOL TRANSFER CENTER", CYAN + BOLD))
    print(f"Action: {action_label} | Package {package_number}/{total_packages}: {package_name}")
    print(f"Package completion: [{bar}] {completed}/{total_packages} complete ({int(package_fraction * 100)}%)")
    if current_folder:
        folder_key = str(current_folder.resolve())
        now = time.monotonic()
        cached_size = _DASHBOARD_SIZE_CACHE.get(folder_key)
        if cached_size is None or now - cached_size[0] >= 2.0:
            size_bytes = _directory_bytes(current_folder)
            _DASHBOARD_SIZE_CACHE[folder_key] = (now, size_bytes)
        else:
            size_bytes = cached_size[1]
        print(f"Current package folder size: {_mib(size_bytes)} (refreshed at most every 2 s)")
    if reported_percent is not None:
        print(f"Percent mentioned by WinGet output: {reported_percent}% (source output; not guaranteed byte progress)")
    else:
        print(f"Activity: {'WAITING FOR YOUR INPUT IN WINGET' if waiting_for_input else 'WORKING ' + '|/-\\'[spinner % 4]}")
    print(f"Log: {DOWNLOAD_LOG}")
    print("-" * 74)
    print("LATEST LOG LINES (newest at bottom):")
    if last_lines:
        for line in last_lines[-5:]:
            print("  " + line[:160])
    else:
        print("  Waiting for WinGet output...")
    print("-" * 74)
    print("Tip: download-only mode measures saved file sizes exactly; install mode may not expose transfer size.")


def _run_winget_dashboard(command: list[str], action_label: str, package_name: str, package_number: int,
                          total_packages: int, completed: int, package_folder: Path | None) -> tuple[int, list[str]]:
    """Stream WinGet output into logs while maintaining a small progress/log dashboard."""
    log_event("WINGET_START", "INFO", f"{action_label} | {package_name} | {' '.join(command)}")
    append_download_detail(f"START {action_label}: {package_name}; command={' '.join(command)}")
    last_lines: list[str] = []
    output_queue: queue.Queue[str | None] = queue.Queue()
    try:
        proc = subprocess.Popen(command, stdin=None, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                text=True, encoding="utf-8", errors="replace", bufsize=1)
    except OSError as exc:
        line = f"Could not start WinGet: {exc}"
        append_download_detail(f"[{package_name}] {line}")
        print(paint(line, RED))
        return 9009, [line]

    def reader() -> None:
        # Read character-by-character so WinGet's prompts that do not end in a newline remain visible.
        assert proc.stdout is not None
        try:
            while True:
                char = proc.stdout.read(1)
                if char == "":
                    break
                output_queue.put(char)
        finally:
            output_queue.put(None)

    thread = threading.Thread(target=reader, daemon=True)
    thread.start()
    start = time.monotonic()
    spinner = 0
    reported_percent: int | None = None
    waiting_for_input = False
    reader_done = False
    last_redraw = 0.0
    last_char_time = time.monotonic()
    line_buffer = ""
    displayed_waiting = False

    def handle_output_line(line: str, partial: bool = False) -> None:
        nonlocal waiting_for_input, reported_percent
        line = line.rstrip("\r\n")
        if not line:
            return
        last_lines.append(line)
        del last_lines[:-8]
        _append_winget_line(package_name, line)
        low = line.lower()
        prompt_markers = (
            "do you agree", "accept the source agreements", "accept the package agreements",
            "[y/n]", "(y/n)", "[y] yes", "[n] no", "continue?", "press enter", "type yes",
            "agree to the terms", "terms of transaction", "do you accept"
        )
        if any(marker in low for marker in prompt_markers):
            waiting_for_input = True
        elif waiting_for_input and not partial:
            # New output after a prompt usually means WinGet received the user's response.
            waiting_for_input = False
        if ("%" in line) and any(word in low for word in ("download", "install", "progress", "complete")):
            match = re.search(r"(?<!\d)(\d{1,3})\s*%", line)
            if match:
                reported_percent = min(100, int(match.group(1)))

    while not reader_done or proc.poll() is None or not output_queue.empty() or line_buffer:
        try:
            char = output_queue.get(timeout=0.12)
            if char is None:
                reader_done = True
                if line_buffer:
                    handle_output_line(line_buffer, partial=True)
                    line_buffer = ""
            elif char in ("\n", "\r"):
                if line_buffer:
                    handle_output_line(line_buffer)
                    line_buffer = ""
                last_char_time = time.monotonic()
            else:
                line_buffer += char
                last_char_time = time.monotonic()
                if len(line_buffer) > 500:
                    handle_output_line(line_buffer, partial=True)
                    line_buffer = ""
        except queue.Empty:
            # Emit incomplete lines after a pause (e.g. an interactive agreement prompt ending in ':').
            if line_buffer and (time.monotonic() - last_char_time) > 0.35:
                handle_output_line(line_buffer, partial=True)
                line_buffer = ""
        now = time.monotonic()
        if waiting_for_input and not displayed_waiting:
            # Show the prompt once, then leave it on screen so keyboard input can reach WinGet.
            _draw_package_dashboard(action_label, package_name, package_number, total_packages, completed,
                                    last_lines, package_folder, reported_percent, spinner, waiting_for_input)
            displayed_waiting = True
            last_redraw = now
        elif not waiting_for_input:
            displayed_waiting = False
            if now - last_redraw >= 0.55:
                spinner += 1
                _draw_package_dashboard(action_label, package_name, package_number, total_packages, completed,
                                        last_lines, package_folder, reported_percent, spinner, waiting_for_input)
                last_redraw = now
    try:
        proc.wait(timeout=3)
    except subprocess.TimeoutExpired:
        proc.kill()
        proc.wait()
    thread.join(timeout=1)
    duration = int(time.monotonic() - start)
    rc = int(proc.returncode or 0)
    log_event("WINGET_END", "OK" if rc == 0 else "WARN", f"{action_label} | {package_name} | exit={rc} | {duration}s")
    append_download_detail(f"END {action_label}: {package_name}; exit={rc}; duration={duration}s")
    return rc, last_lines


def find_installed_external_tool(tool_number: int) -> str | None:
    """Resolve only a known tool executable from PATH or its documented install folders."""
    if tool_number not in EXTERNAL_TOOL_CATALOG:
        return None
    if tool_number == 6:
        if sys.version_info[:2] == (3, 12):
            return sys.executable
        launcher = shutil.which("py.exe") or shutil.which("py")
        if launcher:
            try:
                result = subprocess.run([launcher, "-3.12", "-c", "import sys; print(sys.executable)"],
                                        capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=5)
                candidate = result.stdout.strip().splitlines()
                if result.returncode == 0 and candidate and Path(candidate[-1]).is_file():
                    return candidate[-1]
            except Exception:
                pass
    for command in EXTERNAL_TOOL_COMMANDS.get(tool_number, ()):
        found = shutil.which(command)
        if found:
            # Do not mistake a generic Python or Docker CLI for the requested GUI app launcher.
            if tool_number == 2 and Path(found).name.lower() not in ("wireshark.exe",):
                continue
            if tool_number == 13 and Path(found).name.lower() == "docker.exe":
                # The menu item opens the desktop app; the CLI is resolved separately by integrations.
                continue
            return found
    pf = Path(os.environ.get("ProgramFiles", r"C:\Program Files"))
    pf86 = Path(os.environ.get("ProgramFiles(x86)", r"C:\Program Files (x86)"))
    local = Path(os.environ.get("LOCALAPPDATA", str(Path.home() / "AppData" / "Local")))
    candidates = {
        1: [pf / "Nmap" / "nmap.exe", pf86 / "Nmap" / "nmap.exe"],
        2: [pf / "Wireshark" / "Wireshark.exe", pf86 / "Wireshark" / "Wireshark.exe"],
        4: [pf / "OpenSSL-Win64" / "bin" / "openssl.exe", pf / "OpenSSL" / "bin" / "openssl.exe"],
        5: [pf / "Git" / "cmd" / "git.exe", pf / "Git" / "bin" / "git.exe"],
        6: [local / "Programs" / "Python" / "Python312" / "python.exe", pf / "Python312" / "python.exe"],
        7: [pf / "nodejs" / "node.exe", local / "Programs" / "nodejs" / "node.exe"],
        8: [pf / "7-Zip" / "7z.exe", pf86 / "7-Zip" / "7z.exe"],
        9: [pf / "ClamAV" / "clamscan.exe", local / "Programs" / "ClamAV" / "clamscan.exe"],
        10: [local / "Microsoft" / "WinGet" / "Links" / "gitleaks.exe"],
        11: [local / "Microsoft" / "WinGet" / "Links" / "trivy.exe"],
        12: [local / "Microsoft" / "WinGet" / "Links" / "gh.exe"],
        13: [pf / "Docker" / "Docker" / "frontend" / "Docker Desktop.exe", local / "Programs" / "Docker" / "Docker" / "Docker Desktop.exe"],
        14: [pf / "PowerShell" / "7" / "pwsh.exe", local / "Microsoft" / "PowerShell" / "pwsh.exe"],
        15: [Path(os.environ.get("SystemRoot", r"C:\Windows")) / "System32" / "curl.exe"],
        16: [local / "Microsoft" / "WinGet" / "Links" / "ruff.exe"],
    }
    for candidate in candidates.get(tool_number, []):
        if candidate.is_file():
            return str(candidate)
    win_get_root = local / "Microsoft" / "WinGet" / "Packages"
    portable_patterns = {
        3: ("Microsoft.Sysinternals.Suite*", ("autorunsc64.exe", "autorunsc.exe", "sigcheck64.exe", "sigcheck.exe", "procexp64.exe")),
        10: ("Gitleaks.Gitleaks*", ("gitleaks.exe",)), 11: ("AquaSecurity.Trivy*", ("trivy.exe",)),
        12: ("GitHub.cli*", ("gh.exe",)), 14: ("Microsoft.PowerShell*", ("pwsh.exe",)),
        16: ("astral-sh.ruff*", ("ruff.exe",)),
    }
    if tool_number in portable_patterns and win_get_root.is_dir():
        pattern, filenames = portable_patterns[tool_number]
        try:
            for package_dir in win_get_root.glob(pattern):
                for filename in filenames:
                    for candidate in package_dir.rglob(filename):
                        if candidate.is_file() and not candidate.is_symlink():
                            return str(candidate)
        except OSError:
            pass
    if tool_number == 3:
        sysinternal_roots = [pf / "Sysinternals Suite", pf86 / "Sysinternals Suite", local / "Microsoft" / "WinGet" / "Links"]
        for root in sysinternal_roots:
            for filename in EXTERNAL_TOOL_COMMANDS[3]:
                candidate = root / filename
                if candidate.is_file(): return str(candidate)
            if root.is_dir():
                for filename in EXTERNAL_TOOL_COMMANDS[3]:
                    try:
                        for candidate in root.rglob(filename):
                            if candidate.is_file() and not candidate.is_symlink(): return str(candidate)
                    except OSError: pass
    return None

def external_tool_status(tool_number: int) -> tuple[str | None, str]:
    """Combine executable, uninstall registry, WinGet inventory, and installer success evidence."""
    exe = find_installed_external_tool(tool_number)
    if exe:
        return exe, "INSTALLED"
    _name, package_id, _description, _url = EXTERNAL_TOOL_CATALOG[tool_number]
    if _registry_confirms_installed(tool_number):
        _save_install_state(package_id, "verified", "Windows uninstall registry contains this application")
        return None, "INSTALLED"
    installed_ids = refresh_winget_installed_cache()
    if package_id in installed_ids:
        _save_install_state(package_id, "verified", "WinGet installed-package inventory")
        return None, "INSTALLED"
    saved_state = _load_install_state().get(package_id)
    if saved_state and saved_state.get("status") in ("verified", "install_exit_0_pending_inventory"):
        # A successful WinGet install can precede the registered executable/PATH update. R refresh
        # revalidates this record and removes it if neither registry, executable, nor WinGet confirms it.
        return None, "INSTALLED"
    slug = re.sub(r"[^A-Za-z0-9._-]+", "_", package_id)
    package_folder = APP_ROOT / "downloads" / "packages" / slug
    # When this package has been handled by SCAN before, perform a targeted exact-ID query.
    if package_folder.exists() and winget_confirms_installed(package_id):
        _save_install_state(package_id, "verified", "exact WinGet list query")
        return None, "INSTALLED"
    if package_folder.exists() and _directory_bytes(package_folder) > 0:
        return None, "DOWNLOADED — INSTALL REQUIRED"
    return None, "DOWNLOAD REQUIRED"


def refresh_windows_path_environment() -> None:
    """Refresh user/system PATH values after installation without restarting Python."""
    if os.name != "nt":
        return
    try:
        import winreg
        parts = [os.environ.get("PATH", "")]
        roots = [
            (winreg.HKEY_CURRENT_USER, r"Environment", "Path"),
            (winreg.HKEY_LOCAL_MACHINE, r"SYSTEM\CurrentControlSet\Control\Session Manager\Environment", "Path"),
        ]
        for hive, key_name, value_name in roots:
            try:
                with winreg.OpenKey(hive, key_name) as key:
                    value, _kind = winreg.QueryValueEx(key, value_name)
                    if value:
                        parts.append(os.path.expandvars(value))
            except OSError:
                continue
        seen: set[str] = set()
        unique: list[str] = []
        for item in os.pathsep.join(parts).split(os.pathsep):
            item = item.strip().strip('"')
            normalized = os.path.normcase(os.path.normpath(item)) if item else ""
            if item and normalized not in seen and Path(item).is_dir():
                unique.append(item)
                seen.add(normalized)
        os.environ["PATH"] = os.pathsep.join(unique)
    except Exception:
        pass


def launch_external_tool(tool_number: int) -> None:
    name, package_id, _description, url = EXTERNAL_TOOL_CATALOG[tool_number]
    exe, status = external_tool_status(tool_number)
    if status != "INSTALLED":
        print(paint(f"LOCKED: {name} is not installed. Current status: {status}.", YELLOW + BOLD))
        print("Menu 33 → select package → I installs it. D only saves installer files.")
        log_event("OPTIONAL_TOOL_BLOCKED", "WARN", f"{name} | {status}")
        pause()
        return
    if not exe:
        # WinGet may confirm the install before PATH or a package-specific executable path is visible.
        refresh_windows_path_environment()
        exe = find_installed_external_tool(tool_number)
        if not exe:
            print(paint(f"{name}: INSTALLED (WinGet confirms it), but SCAN cannot locate its launcher path yet.", YELLOW + BOLD))
            print("Try closing and reopening SCAN/Terminal so Windows PATH refreshes, or launch it from the Start menu.")
            print(f"Official vendor page: {url}")
            if input("Open the official vendor page? [y/N]: ").strip().lower() in ("y", "yes"):
                try:
                    webbrowser.open(url)
                except Exception:
                    pass
            log_event("OPTIONAL_TOOL_LAUNCHER_NOT_FOUND", "WARN", f"{name} | WinGet confirms installed")
            pause()
            return
    gui_tools = {2, 13}
    if tool_number == 3:
        # Launch the GUI (Process Explorer/Autoruns), not the Autorunsc command-line utility.
        root = Path(exe).parent
        gui_candidates = [root / "procexp64.exe", root / "procexp.exe", root / "Autoruns64.exe", root / "autoruns.exe"]
        gui_exe = next((str(item) for item in gui_candidates if item.is_file()), None)
        if gui_exe:
            exe = gui_exe
            gui_tools.add(3)
        else:
            print("Sysinternals command-line tools are detected, but the GUI launcher was not found.")
            print("Use menu 39 to export a read-only Autoruns CSV report.")
            pause(); return
    if tool_number == 13:
        # Launch Docker Desktop GUI even though the integrated CLI uses docker.exe.
        pf = Path(os.environ.get("ProgramFiles", r"C:\Program Files"))
        local = Path(os.environ.get("LOCALAPPDATA", str(Path.home() / "AppData" / "Local")))
        gui_candidate = next((item for item in [pf / "Docker" / "Docker" / "frontend" / "Docker Desktop.exe",
                                                local / "Programs" / "Docker" / "Docker" / "Docker Desktop.exe"] if item.is_file()), None)
        if gui_candidate:
            exe = str(gui_candidate)
            gui_tools.add(13)
    if tool_number in gui_tools or (tool_number == 3 and Path(exe).name.lower() in ("procexp64.exe", "procexp.exe", "autoruns64.exe", "autoruns.exe")):
        try:
            subprocess.Popen([exe], cwd=str(Path(exe).parent))
            print(paint(f"Started {name}.", GREEN))
            log_event("OPTIONAL_TOOL_LAUNCH", "OK", f"{name} | {exe}")
        except OSError as exc:
            print(paint(f"Could not start {name}: {exc}", RED))
            log_event("OPTIONAL_TOOL_LAUNCH", "ERROR", f"{name} | {exc}")
        pause()
        return
    version_args = {
        1: ["--version"], 4: ["version"], 5: ["--version"], 6: ["--version"], 7: ["--version"],
        8: ["-h"], 9: ["--version"], 10: ["version"], 11: ["--version"], 12: ["--version"],
        14: ["-NoProfile", "-Command", "$PSVersionTable.PSVersion.ToString()"],
        15: ["--version"], 16: ["--version"],
    }
    try:
        result = subprocess.run([exe] + version_args.get(tool_number, ["--version"]), capture_output=True,
                                text=True, encoding="utf-8", errors="replace", timeout=15)
        output = (result.stdout + "\n" + result.stderr).strip()
        print(f"{name} executable: {exe}")
        print(output[:3000] if output else f"Exit code: {result.returncode}")
        log_event("OPTIONAL_TOOL_CHECK", "OK" if result.returncode == 0 else "WARN",
                  f"{name} | exit={result.returncode} | {output[:300]}")
    except Exception as exc:
        print(paint(f"Could not run {name} health check: {exc}", YELLOW))
        log_event("OPTIONAL_TOOL_CHECK", "ERROR", f"{name} | {exc}")
    pause()


def deep_file_analysis_tool() -> None:
    clear_screen()
    print(paint("SCAN / DEEP ANALYSIS CENTER", CYAN + BOLD))
    print("  [1] Static file analysis (files are not executed; URLs are not opened)")
    print("  [2] Local Windows security-baseline audit (read-only; no settings changed)")
    print("  [0] Return")
    choice = input("Choose analysis [1/2/0]: ").strip()
    if choice == "0" or not choice:
        return
    try:
        if choice == "1":
            from security_analysis import run_file_analysis
            log_event("MENU_OPEN", "INFO", "34 STATIC FILE ANALYSIS")
            run_file_analysis()
            log_event("FILE_ANALYSIS", "OK", "Module completed; see Logs/reports")
        elif choice == "2":
            script = APP_ROOT / "security_audit.py"
            if not script.is_file():
                raise FileNotFoundError(f"Missing security_audit.py: {script}")
            result = subprocess.run([sys.executable, str(script)], cwd=str(APP_ROOT), timeout=90)
            log_event("LOCAL_BASELINE_AUDIT", "OK" if result.returncode == 0 else "WARN",
                      f"exit={result.returncode}; report directory={LOG_DIR / 'reports'}")
        else:
            print(paint("Invalid choice.", YELLOW))
    except Exception as exc:
        log_event("DEEP_ANALYSIS", "ERROR", f"{type(exc).__name__}: {exc}")
        print(paint(f"Analysis module error: {exc}", RED))
    pause()



def _integration_exe(key: str) -> str | None:
    """Find a known CLI by its purpose, including tools inside the Sysinternals Suite."""
    names = {
        "nmap": ("nmap.exe", "nmap"), "curl": ("curl.exe", "curl"),
        "openssl": ("openssl.exe", "openssl"), "git": ("git.exe", "git"),
        "gitleaks": ("gitleaks.exe", "gitleaks"), "trivy": ("trivy.exe", "trivy"),
        "clamscan": ("clamscan.exe", "clamscan"), "7z": ("7z.exe", "7zz.exe", "7z"),
        "ruff": ("ruff.exe", "ruff"), "node": ("node.exe", "node"),
        "docker": ("docker.exe", "docker"), "gh": ("gh.exe", "gh"),
        "autorunsc": ("autorunsc64.exe", "autorunsc.exe"),
        "pwsh": ("pwsh.exe", "pwsh"),
        "sigcheck": ("sigcheck64.exe", "sigcheck.exe"),
        "tshark": ("tshark.exe", "tshark"),
    }
    for candidate in names.get(key, ()):
        found = shutil.which(candidate)
        if found:
            return found
    # Reuse the known installed-app catalogue path discovery instead of scanning arbitrary folders.
    catalog_map = {"nmap":1, "openssl":4, "git":5, "clamscan":9, "gitleaks":10,
                   "trivy":11, "docker":13, "node":7, "7z":8, "ruff":16, "gh":12, "pwsh":14}
    if key in catalog_map:
        number = catalog_map[key]
        found = find_installed_external_tool(number)
        if found and Path(found).name.lower() in {x.lower() for x in names.get(key, ())}:
            return found
    if key in ("autorunsc", "sigcheck", "tshark"):
        pf = Path(os.environ.get("ProgramFiles", r"C:\Program Files"))
        pf86 = Path(os.environ.get("ProgramFiles(x86)", r"C:\Program Files (x86)"))
        local = Path(os.environ.get("LOCALAPPDATA", str(Path.home() / "AppData" / "Local")))
        folders = [pf / "Sysinternals Suite", pf86 / "Sysinternals Suite",
                   local / "Microsoft" / "WinGet" / "Links", pf / "Wireshark", pf86 / "Wireshark"]
        if key in ("autorunsc", "sigcheck"):
            package_root = local / "Microsoft" / "WinGet" / "Packages"
            try:
                folders.extend(folder for folder in package_root.glob("Microsoft.Sysinternals.Suite*") if folder.is_dir())
            except OSError: pass
        if key == "tshark":
            package_root = local / "Microsoft" / "WinGet" / "Packages"
            try:
                folders.extend(folder for folder in package_root.glob("WiresharkFoundation.Wireshark*") if folder.is_dir())
            except OSError: pass
        for folder in folders:
            for name in names[key]:
                candidate = folder / name
                if candidate.is_file(): return str(candidate)
            if folder.is_dir() and ("Sysinternals" in str(folder) or "Packages" in str(folder)):
                for name in names[key]:
                    try:
                        for candidate in folder.rglob(name):
                            if candidate.is_file() and not candidate.is_symlink(): return str(candidate)
                    except OSError:
                        pass
    return None


def _report_slug(value: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9._-]+", "_", value).strip("._-")
    return (cleaned[:70] or "target")


def _run_cli_to_file(name: str, exe: str, args: list[str], destination: Path, timeout: int = 180) -> dict:
    """Stream large command output to a local report rather than truncating it in memory."""
    command = [exe] + args
    display = subprocess.list2cmdline(command)
    started = time.monotonic()
    try:
        with destination.open("w", encoding="utf-8-sig", errors="replace", newline="") as handle:
            result = subprocess.run(command, stdout=handle, stderr=subprocess.PIPE, text=True,
                                    encoding="utf-8", errors="replace", timeout=timeout, shell=False)
        status = "OK" if result.returncode == 0 else "REVIEW_OR_TOOL_EXIT_NONZERO"
        record = {"name": name, "status": status, "returncode": result.returncode,
                  "command_display": display[:1500], "stderr": (result.stderr or "")[-3000:],
                  "duration_seconds": round(time.monotonic() - started, 2), "report_path": str(destination),
                  "summary": f"Full command output streamed to {destination.name}; file size {destination.stat().st_size} bytes."}
    except subprocess.TimeoutExpired:
        record = {"name": name, "status": "TIMEOUT", "command_display": display[:1500],
                  "error": f"Exceeded {timeout} seconds; partial output may be in {destination.name}",
                  "duration_seconds": round(time.monotonic() - started, 2), "report_path": str(destination)}
    except (OSError, subprocess.SubprocessError) as exc:
        record = {"name": name, "status": "ERROR", "command_display": display[:1500],
                  "error": f"{type(exc).__name__}: {exc}", "duration_seconds": round(time.monotonic() - started, 2),
                  "report_path": str(destination)}
    log_event("INTEGRATED_TOOL_RUN", "OK" if record["status"] == "OK" else "WARN",
              f"{name} | status={record['status']} | seconds={record.get('duration_seconds')} | report={destination}")
    return record


def _composite_report(title: str, target: str, steps: list[dict], notices: list[str] | None = None) -> tuple[Path, Path]:
    ensure_log_files()
    report_dir = LOG_DIR / "reports"
    report_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().astimezone().strftime("%Y%m%d_%H%M%S")
    data = {"title": title, "generated_at": datetime.now().astimezone().isoformat(timespec="seconds"),
            "target": target, "read_only": True, "steps": steps,
            "notices": notices or [],
            "disclaimer": "Informational defensive triage only. Missing results do not prove safety; findings require review."}
    stem = f"{_report_slug(title)}_{_report_slug(target)}_{stamp}"
    json_path = report_dir / f"{stem}.json"
    txt_path = report_dir / f"{stem}.txt"
    json_path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    lines = [title, "=" * len(title), f"Generated: {data['generated_at']}", f"Target: {target}", "",
             data["disclaimer"], ""]
    for step in steps:
        lines += [f"[{step.get('name','step')}] STATUS={step.get('status','UNKNOWN')}",
                  f"Exit code: {step.get('returncode','N/A')}"]
        if step.get("command_display"): lines.append("Command: " + step["command_display"])
        if step.get("summary"): lines.append("Summary: " + str(step["summary"]))
        if step.get("report_path"): lines.append("Detailed output: " + str(step["report_path"]))
        if step.get("stdout"): lines += ["STDOUT:", str(step["stdout"])[:5000]]
        if step.get("stderr"): lines += ["STDERR:", str(step["stderr"])[:2500]]
        if step.get("error"): lines.append("Error: " + str(step["error"]))
        lines.append("")
    if notices:
        lines += ["Notes:"] + ["- " + note for note in notices] + [""]
    lines += [f"JSON report: {json_path}", "Results are local-only; no report is uploaded by SCAN."]
    txt_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    log_event("INTEGRATED_WORKFLOW_REPORT", "OK", f"{title} | target={target} | steps={len(steps)} | report={json_path.name}")
    return txt_path, json_path


def _run_cli_step(name: str, exe: str, args: list[str], timeout: int = 180,
                  report_path: Path | None = None, cwd: Path | None = None, input_text: str | None = None) -> dict:
    """Run an argv list without a shell, capture bounded output and log only command metadata."""
    command = [exe] + args
    started = time.monotonic()
    display = subprocess.list2cmdline(command)
    try:
        result = subprocess.run(command, cwd=str(cwd) if cwd else None, capture_output=True,
                                 text=True, encoding="utf-8", errors="replace", timeout=timeout, input=input_text,
                                 shell=False)
        stdout = (result.stdout or "")[-10000:]
        stderr = (result.stderr or "")[-6000:]
        status = "OK" if result.returncode == 0 else "REVIEW_OR_TOOL_EXIT_NONZERO"
        # A Gitleaks/Trivy report can exist with a non-zero findings exit; do not report it as a crash.
        if report_path and report_path.is_file() and result.returncode != 0:
            status = "COMPLETED_WITH_REPORT_NONZERO_EXIT"
        record = {"name": name, "status": status, "returncode": result.returncode,
                  "command_display": display[:1500], "stdout": stdout, "stderr": stderr,
                  "duration_seconds": round(time.monotonic() - started, 2)}
        if report_path: record["report_path"] = str(report_path)
    except subprocess.TimeoutExpired as exc:
        record = {"name": name, "status": "TIMEOUT", "command_display": display[:1500],
                  "error": f"Exceeded {timeout} seconds", "duration_seconds": round(time.monotonic() - started, 2)}
        if report_path: record["report_path"] = str(report_path)
    except (OSError, subprocess.SubprocessError) as exc:
        record = {"name": name, "status": "ERROR", "command_display": display[:1500],
                  "error": f"{type(exc).__name__}: {exc}", "duration_seconds": round(time.monotonic() - started, 2)}
        if report_path: record["report_path"] = str(report_path)
    log_event("INTEGRATED_TOOL_RUN", "OK" if record["status"].startswith("OK") or "COMPLETED" in record["status"] else "WARN",
              f"{name} | status={record['status']} | seconds={record.get('duration_seconds')} | report={report_path}")
    return record


def _pick_directory(prompt: str = "Project folder path: ") -> Path | None:
    raw = input(prompt).strip().strip('"')
    if not raw: return None
    try: folder = Path(raw).expanduser().resolve(strict=True)
    except (OSError, RuntimeError) as exc:
        print(paint(f"Path not available: {exc}", YELLOW)); return None
    if not folder.is_dir():
        print(paint("Please enter a folder path, not a file.", YELLOW)); return None
    if folder.parent == folder:
        print(paint("Scanning an entire drive/root is disabled. Choose one project folder.", YELLOW)); return None
    return folder


def _ask_yes(prompt: str) -> bool:
    return input(prompt).strip() == "YES"


def project_security_audit_tool() -> None:
    clear_screen(); print(paint("SCAN / PROJECT SECURITY AUDIT — GITLEAKS + TRIVY + GIT", CYAN + BOLD))
    print("Scans the project folder you choose. Gitleaks reports are fully redacted; no code is uploaded by SCAN.")
    print("Trivy can contact official vulnerability-data registries only after you explicitly approve that option.")
    folder = _pick_directory()
    if folder is None: pause(); return
    print("Selected:", folder)
    if not _ask_yes("Run read-only checks on this folder? Type YES: "): print("Cancelled."); pause(); return
    report_dir = LOG_DIR / "reports"; report_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().astimezone().strftime("%Y%m%d_%H%M%S")
    steps: list[dict] = []
    notices = ["Gitleaks current-directory scan does not guarantee full historical Git commit coverage.",
               "Trivy vulnerability results depend on the local database version and selected update mode."]
    git = _integration_exe("git")
    if git:
        check = _run_cli_step("Git repository status", git, ["-C", str(folder), "rev-parse", "--is-inside-work-tree"], timeout=8, cwd=folder)
        if check.get("returncode") == 0 and "true" in check.get("stdout", "").lower():
            steps.append(_run_cli_step("Git status", git, ["-C", str(folder), "status", "--short", "--branch"], timeout=12, cwd=folder))
            steps.append(_run_cli_step("Git diff whitespace check", git, ["-C", str(folder), "diff", "--check"], timeout=12, cwd=folder))
        else:
            steps.append({"name":"Git repository status", "status":"SKIPPED_NOT_A_GIT_REPOSITORY", "summary":"No Git working tree was detected."})
    else:
        steps.append({"name":"Git", "status":"NOT_INSTALLED", "summary":"Install Git from the optional tool center to enable this step."})
    gitleaks = _integration_exe("gitleaks")
    if gitleaks:
        gl_report = report_dir / f"gitleaks_{stamp}.json"
        args = ["dir", str(folder), "--no-banner", "--redact=100", "--report-format", "json", "--report-path", str(gl_report)]
        step = _run_cli_step("Gitleaks secret scan (redacted report)", gitleaks, args, timeout=300, report_path=gl_report, cwd=folder)
        if not gl_report.exists() and "unknown command" in (step.get("stderr", "") + step.get("stdout", "")).lower():
            step = _run_cli_step("Gitleaks legacy-compatible scan (redacted report)", gitleaks,
                                 ["detect", "--source", str(folder), "--redact=100", "--report-format", "json", "--report-path", str(gl_report)],
                                 timeout=300, report_path=gl_report, cwd=folder)
        steps.append(step)
    else: steps.append({"name":"Gitleaks", "status":"NOT_INSTALLED", "summary":"Secret scan skipped; install Gitleaks to enable it."})
    trivy = _integration_exe("trivy")
    if trivy:
        trivy_report = report_dir / f"trivy_fs_{stamp}.json"
        update_db = input("Allow Trivy to update/download vulnerability databases from official sources? [y/N]: ").strip().lower() in ("y", "yes")
        args = ["fs", "--scanners", "vuln,misconfig,secret,license", "--format", "json", "--output", str(trivy_report),
                "--skip-dirs", ".git", "--skip-dirs", "node_modules", "--skip-dirs", ".venv"]
        if not update_db: args += ["--skip-db-update", "--skip-java-db-update", "--skip-check-update", "--offline-scan"]
        else: notices.append("Trivy was allowed to contact official database registries to update its local scanner databases.")
        steps.append(_run_cli_step("Trivy filesystem/dependency/config/secret scan", trivy, args + [str(folder)],
                                   timeout=900, report_path=trivy_report, cwd=folder))
    else: steps.append({"name":"Trivy", "status":"NOT_INSTALLED", "summary":"Dependency/configuration scan skipped; install Trivy to enable it."})
    txt_path, json_path = _composite_report("PROJECT_SECURITY_AUDIT", str(folder), steps, notices)
    print("\nWorkflow finished. Review skipped steps and non-zero exit codes; they do not all mean a vulnerability.")
    print("TXT report:", txt_path); print("JSON report:", json_path); print("Logs: Logs\\scan.log and tool-specific reports.")
    pause()


def local_file_tool_scan() -> None:
    clear_screen(); print(paint("SCAN / LOCAL FILE SCAN — CLAMAV + SIGCHECK + 7-ZIP", CYAN + BOLD))
    print("Choose one file or one bounded folder. This does not execute inspected files or extract archives.")
    raw = input("File/folder path: ").strip().strip('"')
    if not raw: pause(); return
    try: target = Path(raw).expanduser().resolve(strict=True)
    except (OSError, RuntimeError) as exc: print(paint(str(exc), YELLOW)); pause(); return
    if target.parent == target: print(paint("Whole-drive scans are disabled. Choose a specific file/folder.", YELLOW)); pause(); return
    if not _ask_yes(f"Scan {target} without executing it? Type YES: "): print("Cancelled."); pause(); return
    steps=[]; report_dir=LOG_DIR/'reports'; report_dir.mkdir(parents=True,exist_ok=True)
    stamp=datetime.now().astimezone().strftime('%Y%m%d_%H%M%S')
    clamscan=_integration_exe('clamscan')
    if clamscan:
        clamlog=report_dir/f"clamav_{stamp}.log"
        args=["--infected", "--no-summary", f"--log={clamlog}"]
        if target.is_dir(): args.append("--recursive")
        args.append(str(target))
        steps.append(_run_cli_step("ClamAV on-demand local scan",clamscan,args,timeout=900,report_path=clamlog))
    else: steps.append({"name":"ClamAV","status":"NOT_INSTALLED","summary":"Install ClamAV and ensure local signatures are available."})
    sigcheck=_integration_exe('sigcheck')
    if sigcheck and target.is_file():
        steps.append(_run_cli_step("Sysinternals Sigcheck metadata/signature",sigcheck,
                                   ["-nobanner","-h","-i","-a",str(target)],timeout=60))
    else:
        steps.append({"name":"Sysinternals Sigcheck","status":"SKIPPED", "summary":"Available only when the Sysinternals CLI is present and a single file was selected."})
    sevenzip=_integration_exe('7z')
    if sevenzip and target.is_file() and target.suffix.lower() in {'.zip','.7z','.rar','.tar','.gz','.bz2','.xz'}:
        steps.append(_run_cli_step("7-Zip archive integrity test (no extraction)",sevenzip,["t","-y",str(target)],timeout=300))
    else:
        steps.append({"name":"7-Zip","status":"SKIPPED", "summary":"Only runs for a single supported archive file when 7-Zip is installed; no extraction is performed."})
    notices=["An AV 'clean' result is not proof that a file is safe.", "ClamAV uses its existing local signature database; SCAN does not silently update signatures."]
    txt,json_path=_composite_report("LOCAL_FILE_SCAN",str(target),steps,notices)
    print("\nTXT report:",txt,"\nJSON report:",json_path)
    pause()


def tls_http_cli_crosscheck_tool() -> None:
    clear_screen(); print(paint("SCAN / TLS + HTTP CLI CROSS-CHECK — CURL + OPENSSL", CYAN + BOLD))
    print("Read-only HTTPS HEAD + TLS handshake. No redirects are followed and no exploit checks are performed.")
    raw=input("HTTPS public domain (e.g. https://example.com): ").strip()
    try:
        import site_audit
        origin,host,scheme=site_audit.validate_target_for_test(raw)
        if scheme!='https': raise ValueError("Please enter an HTTPS URL.")
        addresses=site_audit.resolve_addresses_for_test(host)
        ip=next((x for x in addresses if ipaddress.ip_address(x).version==4), addresses[0])
    except Exception as exc: print(paint(f"Target rejected or DNS failed: {exc}",YELLOW)); pause(); return
    if not _ask_yes(f"Contact {host} on TCP/443 for one HTTPS HEAD and TLS handshake? Type YES: "):
        print("Cancelled."); pause(); return
    steps=[]; reports=LOG_DIR/'reports'; reports.mkdir(parents=True,exist_ok=True)
    stamp=datetime.now().astimezone().strftime('%Y%m%d_%H%M%S')
    curl=_integration_exe('curl')
    pinned=f"{host}:443:{'['+ip+']' if ':' in ip else ip}"
    headers_path=reports/f"curl_headers_{stamp}.txt"
    if curl:
        args=["--head","--silent","--show-error","--connect-timeout","5","--max-time","15","--max-redirs","0",
              "--resolve",pinned,"--dump-header",str(headers_path),"--output",os.devnull,
              "--write-out","HTTP_STATUS=%{http_code}\\nTLS_VERIFY=%{ssl_verify_result}\\nREMOTE_IP=%{remote_ip}\\n",origin]
        steps.append(_run_cli_step("cURL HTTPS HEAD with pinned public IP/no redirects",curl,args,timeout=20,report_path=headers_path))
    else: steps.append({"name":"cURL","status":"NOT_INSTALLED","summary":"Use the built-in Python site audit or install cURL to enable this cross-check."})
    openssl=_integration_exe('openssl')
    if openssl:
        connect=f"[{ip}]:443" if ':' in ip else f"{ip}:443"
        outpath=reports/f"openssl_tls_{stamp}.txt"
        step=_run_cli_step("OpenSSL TLS certificate handshake",openssl,
                           ["s_client","-connect",connect,"-servername",host,"-verify_hostname",host,"-verify_return_error","-brief"],
                           timeout=20,report_path=outpath,input_text="")
        # Save the captured handshake output locally as a dedicated detail file.
        outpath.write_text((step.get('stdout','')+'\n'+step.get('stderr','')).strip()+'\n',encoding='utf-8')
        step['report_path']=str(outpath); steps.append(step)
    else: steps.append({"name":"OpenSSL","status":"NOT_INSTALLED","summary":"Built-in Python TLS check remains available in menu 08."})
    txt,json_path=_composite_report("TLS_HTTP_CROSSCHECK",host,steps,[f"Resolved public addresses: {', '.join(addresses)}", "A reachable HTTPS page or valid certificate does not prove the whole website is safe."])
    print("\nTXT report:",txt,"\nJSON report:",json_path)
    pause()


def git_repository_readiness_tool() -> None:
    clear_screen(); print(paint("SCAN / GIT REPOSITORY READINESS — GIT + GITLEAKS + GH",CYAN+BOLD))
    print("Checks repository metadata and likely secret filenames; it does not upload, push, commit, or change files.")
    folder=_pick_directory("Local Git repository folder: ")
    if folder is None: pause(); return
    git=_integration_exe('git')
    if not git: print(paint("Git CLI not found. Install Git from menu 33.",YELLOW)); pause(); return
    if not _ask_yes(f"Check repository status in {folder}? Type YES: "): print("Cancelled."); pause(); return
    steps=[]; notices=[]
    root=_run_cli_step("Git repository root",git,["-C",str(folder),"rev-parse","--show-toplevel"],timeout=10,cwd=folder)
    steps.append(root)
    if root.get('returncode')!=0:
        txt,json_path=_composite_report("GIT_REPOSITORY_READINESS",str(folder),steps,["The selected folder is not a Git repository."])
        print("Not a Git repository. Report:",txt); pause(); return
    for label,args in (("Git status",["-C",str(folder),"status","--short","--branch"]),
                       ("Git diff check",["-C",str(folder),"diff","--check"]),
                       ("Tracked filenames with sensitive-looking names",["-C",str(folder),"ls-files"])):
        steps.append(_run_cli_step(label,git,args,timeout=20,cwd=folder))
    tracked=next((x.get('stdout','') for x in steps if x.get('name')=="Tracked filenames with sensitive-looking names"),"")
    risky=[line for line in tracked.splitlines() if re.search(r'(^|/)(\.env(?:\.|$)|.*\.(?:pem|key|pfx|p12)|credentials?\.(?:json|ya?ml)|secrets?\.)',line,re.I)]
    steps.append({"name":"Tracked secret-like filenames", "status":"REVIEW" if risky else "OK_NO_MATCHES",
                  "summary":f"Found {len(risky)} tracked filename(s) matching sensitive patterns.", "stdout":"\n".join(risky[:100])})
    gitleaks=_integration_exe('gitleaks')
    if gitleaks:
        reports=LOG_DIR/'reports'; reports.mkdir(parents=True,exist_ok=True)
        stamp=datetime.now().astimezone().strftime('%Y%m%d_%H%M%S'); gl=reports/f"gitleaks_gitready_{stamp}.json"
        steps.append(_run_cli_step("Gitleaks redacted working-tree scan",gitleaks,
                                   ["dir",str(folder),"--no-banner","--redact=100","--report-format","json","--report-path",str(gl)],
                                   timeout=300,report_path=gl,cwd=folder))
    else: steps.append({"name":"Gitleaks","status":"NOT_INSTALLED","summary":"Secret scan skipped."})
    remote=_run_cli_step("Git remote URL",git,["-C",str(folder),"remote","get-url","origin"],timeout=8,cwd=folder)
    steps.append(remote)
    remote_url=(remote.get('stdout') or '').strip().splitlines()
    gh=_integration_exe('gh')
    if gh and remote_url:
        from urllib.parse import urlparse
        text=remote_url[0]
        match=re.search(r"github\.com[:/]([^/]+)/([^/]+?)(?:\.git)?$",text,re.I)
        if match and input("Ask GitHub CLI for public repository metadata (network request, no upload)? [y/N]: ").strip().lower() in ('y','yes'):
            repo=f"{match.group(1)}/{match.group(2)}"
            steps.append(_run_cli_step("GitHub CLI repository metadata",gh,["repo","view",repo,"--json","nameWithOwner,isPrivate,url"],timeout=30,cwd=folder))
        elif match: notices.append("GitHub CLI metadata query was not requested, so no GitHub API call was made.")
    txt,json_path=_composite_report("GIT_REPOSITORY_READINESS",str(folder),steps,notices+["This workflow never commits or pushes. Review matching filenames before sharing a repository."])
    print("\nTXT report:",txt,"\nJSON report:",json_path)
    pause()


def sysinternals_autoruns_review_tool() -> None:
    clear_screen(); print(paint("SCAN / SYSINTERNALS AUTORUNS REVIEW",CYAN+BOLD))
    print("Read-only inventory of third-party auto-start entries. Unfamiliar entries are not automatically malicious.")
    autorunsc=_integration_exe('autorunsc')
    if not autorunsc:
        print("Sysinternals Autorunsc not found. Install Sysinternals Suite from menu 33, then refresh status."); pause(); return
    if not _ask_yes("Export a CSV of non-Microsoft auto-start entries? Type YES: "): print("Cancelled."); pause(); return
    reports=LOG_DIR/'reports'; reports.mkdir(parents=True,exist_ok=True)
    stamp=datetime.now().astimezone().strftime('%Y%m%d_%H%M%S'); csv_path=reports/f"autoruns_{stamp}.csv"
    step=_run_cli_to_file("Autorunsc CSV (hide Microsoft entries; read-only)",autorunsc,
                          ["-nobanner","-a","*","-c","-m","-h"],csv_path,timeout=180)
    # Output is stored locally in full and may contain user/system paths; it is not uploaded by SCAN.
    txt,json_path=_composite_report("SYSINTERNALS_AUTORUNS_REVIEW",socket.gethostname(),[step],
                                   ["Review entries with a trusted adult/administrator before disabling anything.", "This is a local inventory, not a malware verdict."])
    print("\nCSV details:",csv_path,"\nTXT summary:",txt,"\nJSON report:",json_path)
    pause()


def docker_local_image_audit_tool() -> None:
    clear_screen(); print(paint("SCAN / LOCAL DOCKER IMAGE AUDIT — DOCKER + TRIVY",CYAN+BOLD))
    print("Only images already present locally are eligible. SCAN does not pull images or update databases in this workflow.")
    docker=_integration_exe('docker'); trivy=_integration_exe('trivy')
    if not docker or not trivy:
        print("Required tools missing. Install Docker Desktop and Trivy from menu 33."); pause(); return
    listing=_run_cli_step("Docker local image inventory",docker,["image","ls","--format","{{.Repository}}:{{.Tag}}"],timeout=20)
    images=[line.strip() for line in listing.get('stdout','').splitlines() if line.strip() and line.strip()!='<none>:<none>']
    if listing.get('returncode')!=0 or not images:
        print(paint("Docker did not return local images. Start Docker Desktop and make sure the image is already present.",YELLOW))
        txt,json_path=_composite_report("DOCKER_LOCAL_IMAGE_AUDIT","local Docker inventory",[listing],["No image was scanned; SCAN did not pull from a registry."])
        print("Report:",txt); pause(); return
    print("Local images:")
    for idx,image_name in enumerate(images[:100],1): print(f"  [{idx}] {image_name}")
    chosen=input("Select an image number (0 to cancel): ").strip()
    if not chosen.isdigit() or int(chosen)==0 or not 1<=int(chosen)<=min(100,len(images)):
        print("Cancelled or invalid image selection."); pause(); return
    image_name=images[int(chosen)-1]
    if not _ask_yes(f"Run a cached-database Trivy scan of local image {image_name!r}? Type YES: "): print("Cancelled."); pause(); return
    reports=LOG_DIR/'reports'; reports.mkdir(parents=True,exist_ok=True)
    stamp=datetime.now().astimezone().strftime('%Y%m%d_%H%M%S'); dest=reports/f"trivy_image_{stamp}.json"
    step=_run_cli_step("Trivy local container image (no DB updates; no pull requested)",trivy,
                       ["image","--skip-db-update","--skip-java-db-update","--skip-check-update","--offline-scan","--format","json","--output",str(dest),image_name],
                       timeout=900,report_path=dest)
    txt,json_path=_composite_report("DOCKER_LOCAL_IMAGE_AUDIT",image_name,[listing,step],
                                   ["If Trivy says its local database is missing, refresh databases in the project audit with explicit permission and rerun.", "No image pull was requested by SCAN."])
    print("\nTXT report:",txt,"\nJSON report:",json_path,"\nTrivy detail:",dest)
    pause()


def source_code_quality_tool() -> None:
    clear_screen(); print(paint("SCAN / SOURCE CODE QUALITY — RUFF + NODE + PYTHON AST",CYAN+BOLD))
    print("Parses/lints source only. It does not execute project code or install dependencies.")
    folder=_pick_directory("Source project folder: ")
    if folder is None: pause(); return
    if not _ask_yes(f"Run read-only source checks under {folder}? Type YES: "): print("Cancelled."); pause(); return
    steps=[]; notices=[]; reports=LOG_DIR/'reports'; reports.mkdir(parents=True,exist_ok=True)
    py_files=[]; js_files=[]
    skip={'.git','node_modules','.venv','venv','env','__pycache__','dist','build'}
    try:
        for root,dirs,files in os.walk(folder):
            dirs[:]=[d for d in dirs if d not in skip]
            for file in files:
                suffix=Path(file).suffix.lower(); path=Path(root)/file
                if suffix=='.py' and len(py_files)<2000: py_files.append(path)
                elif suffix in ('.js','.mjs','.cjs') and len(js_files)<500: js_files.append(path)
                if len(py_files)>=2000 and len(js_files)>=500: break
            if len(py_files)>=2000 and len(js_files)>=500: break
    except OSError as exc: notices.append(f"Directory enumeration was incomplete: {exc}")
    syntax_errors=[]
    import ast
    for file in py_files:
        try: ast.parse(file.read_text(encoding='utf-8-sig',errors='replace'),filename=str(file))
        except (SyntaxError, OSError, ValueError) as exc: syntax_errors.append(f"{file}: {exc}")
    steps.append({"name":"Python AST syntax parse (does not execute source)","status":"REVIEW" if syntax_errors else "OK_NO_SYNTAX_ERRORS",
                  "summary":f"Parsed {len(py_files)} Python file(s); syntax issues: {len(syntax_errors)}.","stdout":"\n".join(syntax_errors[:200])})
    ruff=_integration_exe('ruff')
    if ruff and py_files:
        ruff_json=reports/f"ruff_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
        steps.append(_run_cli_step("Ruff static lint",ruff,["check","--output-format=json","--output-file",str(ruff_json),str(folder)],timeout=180,report_path=ruff_json,cwd=folder))
    else: steps.append({"name":"Ruff","status":"NOT_INSTALLED_OR_NO_PYTHON_FILES","summary":"Python AST parsing still ran locally."})
    node=_integration_exe('node')
    node_errors=[]
    if node:
        for file in js_files[:500]:
            result=_run_cli_step("Node.js syntax check",node,["--check",str(file)],timeout=15,cwd=folder)
            if result.get('returncode')!=0: node_errors.append({"file":str(file),"detail":result.get('stderr') or result.get('stdout') or result.get('error')})
        steps.append({"name":"Node.js --check (JavaScript is parsed, not run)","status":"REVIEW" if node_errors else "OK_NO_SYNTAX_ERRORS",
                      "summary":f"Checked {min(len(js_files),500)} JS/MJS/CJS file(s); syntax issues: {len(node_errors)}.","stdout":json.dumps(node_errors[:150],ensure_ascii=False,indent=2)})
    else: steps.append({"name":"Node.js","status":"NOT_INSTALLED","summary":"JavaScript syntax checks skipped."})
    if len(py_files)>=2000 or len(js_files)>=500: notices.append("File caps were reached (2,000 Python / 500 JavaScript); some files may not have been examined.")
    txt,json_path=_composite_report("SOURCE_CODE_QUALITY",str(folder),steps,notices)
    print(f"\nPython files: {len(py_files)} | JavaScript files: {len(js_files)}")
    print("TXT report:",txt,"\nJSON report:",json_path)
    pause()


def integrated_tool_doctor() -> None:
    clear_screen(); print(paint("SCAN / TOOL INTEGRATION DOCTOR",CYAN+BOLD))
    print("Tests installed CLI availability/version for commands used by SCAN workflows; no package is installed here.")
    checks=[("Nmap", "nmap", ["--version"]),("cURL","curl",["--version"]),("OpenSSL","openssl",["version"]),
            ("Git","git",["--version"]),("Gitleaks","gitleaks",["version"]),("Trivy","trivy",["--version"]),
            ("ClamAV","clamscan",["--version"]),("7-Zip","7z",["-h"]),("Ruff","ruff",["--version"]),
            ("Node.js","node",["--version"]),("Docker","docker",["--version"]),("GitHub CLI","gh",["--version"]),
            ("Sysinternals Autorunsc","autorunsc",["-?" ]), ("TShark","tshark",["--version"]),
            ("PowerShell 7","pwsh",["-NoLogo","-NoProfile","-Command","$PSVersionTable.PSVersion.ToString()"])]
    steps=[]
    for label,key,args in checks:
        exe=_integration_exe(key)
        if not exe:
            steps.append({"name":label,"status":"NOT_INSTALLED","summary":"Install only if you need the related workflow."}); continue
        steps.append(_run_cli_step(label,exe,args,timeout=15))
    txt,json_path=_composite_report("TOOL_INTEGRATION_DOCTOR",platform.platform(),steps,
                                   ["Non-zero --help/version codes can be normal for certain CLI tools; review stdout/stderr.", "This check does not install, upgrade, or update tool databases."])
    for item in steps:
        print(f"  {item['name']:<22} {item['status']}")
    print("\nTXT report:",txt,"\nJSON report:",json_path)
    pause()


def tshark_capture_review_tool() -> None:
    """Summarize a local capture file with TShark; never starts live capture."""
    clear_screen(); print(paint("SCAN / LOCAL PACKET CAPTURE REVIEW — TSHARK", CYAN + BOLD))
    print("Reads a capture file already on this computer. It does not capture live traffic or contact remote hosts.")
    raw=input("PCAP/PCAPNG file path: ").strip().strip('"')
    if not raw: pause(); return
    try: capture=Path(raw).expanduser().resolve(strict=True)
    except (OSError, RuntimeError) as exc: print(paint(f"File not available: {exc}",YELLOW)); pause(); return
    if not capture.is_file() or not capture.name.lower().endswith((".pcap", ".pcapng", ".cap", ".pcapng.gz", ".pcap.gz")):
        print(paint("Choose an existing .pcap, .pcapng or .cap capture file.",YELLOW)); pause(); return
    try: size=capture.stat().st_size
    except OSError as exc: print(paint(str(exc),YELLOW)); pause(); return
    if size > 1024**3:
        print(paint("Files over 1 GiB are not accepted in this interactive review to avoid long stalls.",YELLOW)); pause(); return
    tshark=_integration_exe("tshark")
    if not tshark:
        print(paint("TShark is not installed. Install Wireshark from menu 33, then restart SCAN.",YELLOW)); pause(); return
    print(f"File: {capture.name} | size: {size / (1024**2):.2f} MiB")
    print(paint("Packet captures can contain private IPs, DNS names, and unencrypted content. Reports stay on this PC.",YELLOW))
    if not _ask_yes("Create a read-only protocol summary? Type YES: "): print("Cancelled."); pause(); return
    steps=[]
    steps.append(_run_cli_step("TShark protocol hierarchy",tshark,["-r",str(capture),"-q","-z","io,phs"],timeout=300))
    steps.append(_run_cli_step("TShark conversation statistics",tshark,["-r",str(capture),"-q","-z","conv,tcp"],timeout=300))
    txt,json_path=_composite_report("LOCAL_PACKET_CAPTURE_REVIEW",capture.name,steps,[
        "Local file only; no live capture or network transmission was started.",
        f"Input size: {size} bytes. Capture contents may be sensitive; do not publish the reports.",
        "Protocol statistics are descriptive and do not by themselves establish an intrusion."])
    print("\nTXT report:",txt,"\nJSON report:",json_path)
    pause()


def windows_host_health_snapshot() -> None:
    """Collect a bounded read-only Windows health snapshot with PowerShell."""
    clear_screen(); print(paint("SCAN / WINDOWS HOST HEALTH SNAPSHOT",CYAN+BOLD))
    print("Read-only OS, firewall profile, Defender availability, and recent hotfix summary. No changes are made.")
    if os.name != "nt": print("Windows-only workflow."); pause(); return
    if not _ask_yes("Read local system-security status into a private report? Type YES: "): print("Cancelled."); pause(); return
    powershell=_integration_exe("pwsh") or shutil.which("powershell.exe")
    if not powershell:
        candidate=Path(os.environ.get("SystemRoot",r"C:\Windows"))/"System32"/"WindowsPowerShell"/"v1.0"/"powershell.exe"
        powershell=str(candidate) if candidate.is_file() else None
    if not powershell: print(paint("PowerShell not found.",YELLOW)); pause(); return
    script = r"""$ErrorActionPreference = 'Continue'
$os = Get-CimInstance Win32_OperatingSystem | Select-Object Caption, Version, LastBootUpTime
$fw = @(Get-NetFirewallProfile -ErrorAction SilentlyContinue | Select-Object Name, Enabled, DefaultInboundAction, DefaultOutboundAction)
$mp = $null
try { $mp = Get-MpComputerStatus -ErrorAction Stop | Select-Object AMServiceEnabled, AntivirusEnabled, RealTimeProtectionEnabled, AntispywareEnabled, QuickScanAge, FullScanAge } catch { $mp = @{Available=$false; Reason=$_.Exception.Message} }
$hotfix = @(Get-HotFix -ErrorAction SilentlyContinue | Sort-Object InstalledOn -Descending | Select-Object -First 8 HotFixID, InstalledOn, Description)
[ordered]@{ ComputerName=$env:COMPUTERNAME; CollectedAt=(Get-Date).ToString('o'); OS=$os; FirewallProfiles=$fw; Defender=$mp; RecentHotfixes=$hotfix } | ConvertTo-Json -Depth 5
"""
    step=_run_cli_step("Windows host-health snapshot",powershell,["-NoLogo","-NoProfile","-NonInteractive","-Command",script],timeout=35)
    txt,json_path=_composite_report("WINDOWS_HOST_HEALTH_SNAPSHOT",socket.gethostname(),[step],[
        "Read-only query only; SCAN did not enable/disable services, firewall profiles, or protection settings.",
        "Windows permissions and the active security provider can limit available fields.",
        "This report contains local system details; keep it private and out of public source-control repositories."])
    print("\nTXT report:",txt,"\nJSON report:",json_path)
    pause()


def sbom_inventory_tool() -> None:
    """Generate a CycloneDX software bill of materials with Trivy without updating vulnerability databases."""
    clear_screen(); print(paint("SCAN / SOFTWARE INVENTORY (SBOM) — TRIVY",CYAN+BOLD))
    print("Builds a local CycloneDX inventory from project files. No source code is executed and no vulnerability DB update is requested.")
    folder=_pick_directory("Project folder path: ")
    if folder is None: pause(); return
    trivy=_integration_exe("trivy")
    if not trivy: print(paint("Trivy is not installed. Install it from menu 33 only if you need SBOM features.",YELLOW)); pause(); return
    if not _ask_yes(f"Generate a software inventory for {folder}? Type YES: "): print("Cancelled."); pause(); return
    reports=LOG_DIR/"reports"; reports.mkdir(parents=True,exist_ok=True)
    stamp=datetime.now().astimezone().strftime("%Y%m%d_%H%M%S")
    sbom=reports/f"sbom_cyclonedx_{stamp}.json"
    step=_run_cli_step("Trivy filesystem SBOM (CycloneDX)",trivy,
        ["fs","--format","cyclonedx","--skip-db-update","--skip-java-db-update","--output",str(sbom),str(folder)],
        timeout=600,report_path=sbom,cwd=folder)
    if sbom.is_file():
        try:
            data=json.loads(sbom.read_text(encoding="utf-8"))
            components=data.get("components",[]) if isinstance(data,dict) else []
            step["summary"]=f"CycloneDX SBOM created. Components reported: {len(components) if isinstance(components,list) else 'unknown'}; file size: {sbom.stat().st_size} bytes."
        except (OSError,ValueError,TypeError) as exc:
            step["summary"]=f"SBOM output exists but could not be summarized: {exc}"
    txt,json_path=_composite_report("SOFTWARE_BILL_OF_MATERIALS",str(folder),[step],[
        "SBOM generation inventories detected software components; it is not a vulnerability verdict.",
        "The vulnerability database was not intentionally updated in this workflow.",
        "Package detection depends on files and ecosystems Trivy recognizes; absence from an SBOM does not prove absence."])
    print("\nSBOM file:",sbom,"\nTXT summary:",txt,"\nJSON summary:",json_path)
    pause()

def _write_workflow_report(title: str, payload: dict) -> tuple[Path, Path]:
    """Write local TXT and JSON reports for a read-only workflow."""
    ensure_log_files()
    report_dir = LOG_DIR / "reports"
    report_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    safe = re.sub(r"[^A-Za-z0-9_-]+", "_", title).strip("_")[:48] or "report"
    base = report_dir / f"{stamp}_{safe}"
    payload = {"title": title, "timestamp": datetime.now().astimezone().isoformat(), **payload}
    json_path = base.with_suffix(".json")
    txt_path = base.with_suffix(".txt")
    json_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2, default=str), encoding="utf-8")
    lines = [title, "=" * min(72, max(12, len(title))), f"Timestamp: {payload['timestamp']}", ""]
    for key, value in payload.items():
        if key in ("title", "timestamp"):
            continue
        lines.append(f"{key}: {json.dumps(value, ensure_ascii=False, indent=2, default=str)}")
        lines.append("")
    txt_path.write_text("\n".join(lines), encoding="utf-8")
    log_event("WORKFLOW_REPORT", "OK", f"{title} | {txt_path.name} | {json_path.name}")
    print(paint(f"Reports saved: {txt_path} and {json_path}", GREEN))
    return txt_path, json_path


def _safe_path_prompt(prompt: str = "Local file/folder path") -> Path | None:
    raw = input(f"{prompt} (or Q to cancel): ").strip().strip('"')
    if raw.lower() == "q" or not raw:
        return None
    path = Path(os.path.expandvars(os.path.expanduser(raw))).resolve()
    if not path.exists():
        print(paint("Path does not exist.", YELLOW))
        return None
    return path


def local_windows_baseline_set() -> None:
    """Set 1/3: gather local Windows status using read-only PowerShell queries."""
    print(paint("LOCAL WINDOWS BASELINE SET — read-only", CYAN + BOLD))
    if os.name != "nt":
        print("This set requires Windows."); pause(); return
    commands = {
        "os": "Get-CimInstance Win32_OperatingSystem | Select-Object Caption,Version,BuildNumber,LastBootUpTime | ConvertTo-Json -Compress",
        "firewall": "Get-NetFirewallProfile | Select-Object Name,Enabled,DefaultInboundAction,DefaultOutboundAction | ConvertTo-Json -Compress",
        "defender": "if (Get-Command Get-MpComputerStatus -ErrorAction SilentlyContinue) { Get-MpComputerStatus | Select-Object AntivirusEnabled,RealTimeProtectionEnabled,AntispywareEnabled,QuickScanAge,FullScanAge | ConvertTo-Json -Compress } else { 'Defender cmdlets unavailable' }",
        "listening_ports": "Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Select-Object -First 100 LocalAddress,LocalPort,OwningProcess | ConvertTo-Json -Compress",
    }
    results = {}
    for name, command in commands.items():
        try:
            proc = subprocess.run(["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", command], capture_output=True, text=True, timeout=18, errors="replace")
            results[name] = {"returncode": proc.returncode, "output": (proc.stdout or "").strip()[:16000], "stderr": (proc.stderr or "").strip()[:2000]}
        except Exception as exc:
            results[name] = {"error": f"{type(exc).__name__}: {exc}"}
    _write_workflow_report("local_windows_baseline_set", {"read_only": True, "checks": results})
    pause()


def project_release_readiness_set() -> None:
    """Set 2/3: static project checks, Git status, optional redacted Gitleaks scan."""
    path = _safe_path_prompt("Project folder")
    if path is None: pause(); return
    if not path.is_dir(): print("Choose a folder, not a file."); pause(); return
    result: dict = {"path": str(path), "code_not_executed": True, "checks": {}}
    py_files = list(path.rglob("*.py"))[:1500]
    parse_errors = []
    for file in py_files:
        try: compile(file.read_bytes(), str(file), "exec", dont_inherit=True)
        except Exception as exc: parse_errors.append({"file": str(file.relative_to(path)), "error": f"{type(exc).__name__}: {exc}"})
    result["checks"]["python_syntax"] = {"files_checked": len(py_files), "errors": parse_errors[:200], "status": "PASS" if not parse_errors else "REVIEW"}
    git = shutil.which("git")
    if git:
        try:
            proc = subprocess.run([git, "-C", str(path), "status", "--short", "--branch"], capture_output=True, text=True, timeout=12, errors="replace")
            result["checks"]["git_status"] = {"returncode": proc.returncode, "output": proc.stdout[:12000], "stderr": proc.stderr[:1000]}
        except Exception as exc: result["checks"]["git_status"] = {"error": str(exc)}
    else: result["checks"]["git_status"] = {"status": "SKIPPED", "reason": "Git not installed"}
    gitleaks = shutil.which("gitleaks")
    if gitleaks:
        try:
            (LOG_DIR / "reports").mkdir(parents=True, exist_ok=True)
            proc = subprocess.run([gitleaks, "dir", str(path), "--redact=100", "--no-banner", "--report-format", "json", "--report-path", str(LOG_DIR / "reports" / "gitleaks_temp.json")], capture_output=True, text=True, timeout=90, errors="replace")
            result["checks"]["gitleaks"] = {"returncode": proc.returncode, "summary": "Completed; secret values should be redacted. Review local report.", "stderr": proc.stderr[-2000:]}
        except Exception as exc: result["checks"]["gitleaks"] = {"error": str(exc)}
    else: result["checks"]["gitleaks"] = {"status": "SKIPPED", "reason": "Gitleaks not installed"}
    _write_workflow_report("project_release_readiness_set", result)
    pause()


def file_triage_set() -> None:
    """Set 3/3: hash, static indicators and optional ClamAV scan for one local file."""
    path = _safe_path_prompt("Local file path")
    if path is None: pause(); return
    if not path.is_file(): print("Choose a file."); pause(); return
    try:
        import security_analysis
        analysis = security_analysis._analyse_one(path)
    except Exception as exc:
        analysis = {"status": "ERROR", "error": f"{type(exc).__name__}: {exc}"}
    result = {"file_name": path.name, "size_bytes": path.stat().st_size, "analysis": analysis, "file_executed": False}
    clamscan = shutil.which("clamscan")
    if clamscan:
        try:
            proc = subprocess.run([clamscan, "--no-summary", str(path)], capture_output=True, text=True, timeout=90, errors="replace")
            result["clamav"] = {"returncode": proc.returncode, "output": (proc.stdout or "").strip()[-4000:], "stderr": (proc.stderr or "").strip()[-1000:]}
        except Exception as exc: result["clamav"] = {"error": str(exc)}
    else: result["clamav"] = {"status": "SKIPPED", "reason": "ClamAV not installed"}
    _write_workflow_report("file_triage_set", result)
    pause()


def duplicate_file_finder() -> None:
    root = _safe_path_prompt("Folder to scan for duplicate files")
    if root is None: pause(); return
    if not root.is_dir(): print("Choose a folder."); pause(); return
    groups: dict[str, list[str]] = {}
    checked = 0
    for file in root.rglob("*"):
        if checked >= 10000: break
        if not file.is_file(): continue
        try:
            h = hashlib.sha256()
            with file.open("rb") as stream:
                for chunk in iter(lambda: stream.read(1024 * 1024), b""): h.update(chunk)
            groups.setdefault(h.hexdigest(), []).append(str(file.relative_to(root)))
            checked += 1
        except (OSError, PermissionError): continue
    duplicates = [{"sha256": h, "files": files} for h, files in groups.items() if len(files) > 1]
    _write_workflow_report("duplicate_file_finder", {"root": str(root), "files_hashed": checked, "limit": 10000, "duplicates": duplicates})
    pause()


def large_file_inventory() -> None:
    root = _safe_path_prompt("Folder to inventory")
    if root is None: pause(); return
    if not root.is_dir(): print("Choose a folder."); pause(); return
    try: threshold_mb = int(input("Minimum file size in MiB [100]: ").strip() or "100")
    except ValueError: threshold_mb = 100
    threshold = max(1, min(threshold_mb, 102400)) * 1024 * 1024
    items = []
    for file in root.rglob("*"):
        if len(items) >= 2000: break
        try:
            if file.is_file() and file.stat().st_size >= threshold:
                items.append({"path": str(file.relative_to(root)), "bytes": file.stat().st_size, "MiB": round(file.stat().st_size / 1048576, 3)})
        except OSError: pass
    items.sort(key=lambda x: x["bytes"], reverse=True)
    _write_workflow_report("large_file_inventory", {"root": str(root), "threshold_MiB": threshold_mb, "items": items, "cap": 2000})
    pause()


def json_validator_tool() -> None:
    path = _safe_path_prompt("JSON file path")
    if path is None: pause(); return
    try:
        data = json.loads(path.read_text(encoding="utf-8-sig"))
        result = {"valid": True, "top_level_type": type(data).__name__, "top_level_keys": list(data.keys())[:200] if isinstance(data, dict) else None}
    except Exception as exc: result = {"valid": False, "error": f"{type(exc).__name__}: {exc}"}
    _write_workflow_report("json_validation", {"file_name": path.name, "result": result})
    pause()


def xml_validator_tool() -> None:
    import xml.etree.ElementTree as ET
    path = _safe_path_prompt("XML file path")
    if path is None: pause(); return
    try:
        tree = ET.parse(path)
        root = tree.getroot()
        result = {"valid": True, "root_tag": root.tag, "direct_children": len(list(root))}
    except Exception as exc: result = {"valid": False, "error": f"{type(exc).__name__}: {exc}"}
    _write_workflow_report("xml_validation", {"file_name": path.name, "result": result, "external_entities_resolved": False})
    pause()


def csv_structure_tool() -> None:
    import csv as _csv
    path = _safe_path_prompt("CSV file path")
    if path is None: pause(); return
    try:
        with path.open("r", encoding="utf-8-sig", newline="") as handle:
            reader = _csv.reader(handle)
            header = next(reader, [])
            widths: dict[str, int] = {}
            rows = 0
            for row in reader:
                rows += 1; widths[str(len(row))] = widths.get(str(len(row)), 0) + 1
                if rows >= 100000: break
        result = {"valid_read": True, "header_columns": len(header), "header": header[:200], "data_rows_sampled": rows, "column_count_distribution": widths, "sample_cap": 100000}
    except Exception as exc: result = {"valid_read": False, "error": f"{type(exc).__name__}: {exc}"}
    _write_workflow_report("csv_structure_check", {"file_name": path.name, "result": result})
    pause()


def file_entropy_tool() -> None:
    path = _safe_path_prompt("File path for entropy estimate")
    if path is None: pause(); return
    from collections import Counter
    try:
        with path.open("rb") as stream:
            sample = stream.read(1024 * 1024)
        counts = Counter(sample); length = len(sample)
        import math
        entropy = -sum((count / length) * math.log2(count / length) for count in counts.values()) if length else 0.0
        result = {"sampled_bytes": length, "shannon_entropy_bits_per_byte": round(entropy, 4), "interpretation": "Heuristic only; high entropy is not proof of malware or encryption"}
    except Exception as exc: result = {"error": f"{type(exc).__name__}: {exc}"}
    _write_workflow_report("file_entropy_estimate", {"file_name": path.name, "result": result})
    pause()


def pem_certificate_inspector() -> None:
    path = _safe_path_prompt("PEM certificate file path")
    if path is None: pause(); return
    try:
        text = path.read_text(encoding="ascii", errors="ignore")
        match = re.search(r"-----BEGIN CERTIFICATE-----(.*?)-----END CERTIFICATE-----", text, re.S)
        if not match: raise ValueError("No PEM certificate block found")
        import base64
        der = base64.b64decode(re.sub(r"\s+", "", match.group(1)), validate=True)
        cert_info = {"pem_block_found": True, "der_bytes": len(der), "sha256_der": hashlib.sha256(der).hexdigest(), "full_certificate_parsing": "Use OpenSSL x509 -in <file> -noout -subject -issuer -dates for full details"}
    except Exception as exc: cert_info = {"pem_block_found": False, "error": f"{type(exc).__name__}: {exc}"}
    _write_workflow_report("pem_certificate_inspection", {"file_name": path.name, "result": cert_info})
    pause()


def windows_event_log_summary() -> None:
    if os.name != "nt": print("Windows only."); pause(); return
    print("Reads recent System and Application event summaries; it does not clear or modify logs.")
    cmd = "$since=(Get-Date).AddDays(-1); Get-WinEvent -FilterHashtable @{LogName=@('System','Application');StartTime=$since;Level=1,2,3} -MaxEvents 250 -ErrorAction SilentlyContinue | Select-Object TimeCreated,LogName,Id,LevelDisplayName,ProviderName,Message | ConvertTo-Json -Depth 3 -Compress"
    try:
        proc = subprocess.run(["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", cmd], capture_output=True, text=True, timeout=25, errors="replace")
        output = proc.stdout.strip()
        try: events = json.loads(output) if output else []
        except json.JSONDecodeError: events = {"raw_output": output[:30000]}
        result = {"returncode": proc.returncode, "events_last_24h_max_250": events, "stderr": proc.stderr[-3000:]}
    except Exception as exc: result = {"error": f"{type(exc).__name__}: {exc}"}
    _write_workflow_report("windows_event_log_summary", {"read_only": True, "result": result})
    pause()


def scheduled_task_inventory() -> None:
    if os.name != "nt": print("Windows only."); pause(); return
    print("Exports a read-only list of scheduled tasks. Task actions may contain private local paths.")
    cmd = "Get-ScheduledTask | Select-Object TaskPath,TaskName,State,Author,Description | ConvertTo-Json -Depth 2 -Compress"
    try:
        proc = subprocess.run(["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", cmd], capture_output=True, text=True, timeout=25, errors="replace")
        try: tasks = json.loads(proc.stdout) if proc.stdout.strip() else []
        except json.JSONDecodeError: tasks = {"raw_output": proc.stdout[:20000]}
        result = {"returncode": proc.returncode, "tasks": tasks, "stderr": proc.stderr[-2000:]}
    except Exception as exc: result = {"error": f"{type(exc).__name__}: {exc}"}
    _write_workflow_report("scheduled_task_inventory", {"read_only": True, "result": result})
    pause()


def secret_name_hygiene_check() -> None:
    root = _safe_path_prompt("Project folder to check for risky secret-like filenames")
    if root is None: pause(); return
    if not root.is_dir(): print("Choose a folder."); pause(); return
    patterns = re.compile(r"(?i)(^\.env($|\.)|id_rsa|id_ed25519|credentials?|secrets?|token|private[-_]?key)")
    found = []
    for file in root.rglob("*"):
        if len(found) >= 2000: break
        if not file.is_file(): continue
        rel = str(file.relative_to(root))
        if patterns.search(file.name) and file.name not in (".env.example", ".env.sample"):
            try: size = file.stat().st_size
            except OSError: size = None
            found.append({"relative_path": rel, "size_bytes": size, "note": "Filename-only indicator; contents were not read"})
    _write_workflow_report("secret_filename_hygiene", {"root": str(root), "findings": found, "values_collected": False})
    pause()


def ipv4_subnet_calculator() -> None:
    raw = input("IPv4 address/CIDR (example 192.168.1.10/24; Q cancels): ").strip()
    if raw.lower() == "q": return
    try:
        network = ipaddress.ip_interface(raw).network
        result = {"network": str(network), "network_address": str(network.network_address), "broadcast_address": str(network.broadcast_address), "netmask": str(network.netmask), "num_addresses": network.num_addresses, "first_host": str(network[1]) if network.num_addresses > 2 else None, "last_host": str(network[-2]) if network.num_addresses > 2 else None}
    except Exception as exc: result = {"error": f"{type(exc).__name__}: {exc}"}
    print(json.dumps(result, ensure_ascii=False, indent=2))
    _write_workflow_report("ipv4_subnet_calculator", {"input": raw, "result": result})
    pause()


def scan_log_analyzer() -> None:
    candidates = [APP_LOG, ERROR_LOG, DOWNLOAD_LOG, LOG_DIR / "site_audit.log", SQLMAP_DIAG_LOG]
    summary = []
    for path in candidates:
        if not path.exists(): continue
        try:
            lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
            errors = [line for line in lines if re.search(r"\b(ERROR|FAILED|FATAL|TIMEOUT)\b", line, re.I)]
            summary.append({"file": path.name, "line_count": len(lines), "error_like_count": len(errors), "recent_error_like_lines": errors[-30:]})
        except OSError as exc: summary.append({"file": path.name, "error": str(exc)})
    _write_workflow_report("scan_log_analysis", {"local_logs_only": True, "summary": summary})
    pause()


def windows_update_inventory() -> None:
    if os.name != "nt": print("Windows only."); pause(); return
    cmd = "Get-HotFix | Sort-Object InstalledOn -Descending | Select-Object -First 80 HotFixID,Description,InstalledBy,InstalledOn | ConvertTo-Json -Compress"
    try:
        proc = subprocess.run(["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", cmd], capture_output=True, text=True, timeout=25, errors="replace")
        try: updates = json.loads(proc.stdout) if proc.stdout.strip() else []
        except json.JSONDecodeError: updates = {"raw_output": proc.stdout[:20000]}
        result = {"returncode": proc.returncode, "recent_hotfixes": updates, "stderr": proc.stderr[-2000:]}
    except Exception as exc: result = {"error": f"{type(exc).__name__}: {exc}"}
    _write_workflow_report("windows_update_inventory", {"read_only": True, "result": result})
    pause()


def process_publisher_review() -> None:
    if os.name != "nt": print("Windows only."); pause(); return
    cmd = "Get-CimInstance Win32_Process | Select-Object -First 200 ProcessId,ParentProcessId,Name,ExecutablePath | ConvertTo-Json -Compress"
    try:
        proc = subprocess.run(["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", cmd], capture_output=True, text=True, timeout=25, errors="replace")
        try: items = json.loads(proc.stdout) if proc.stdout.strip() else []
        except json.JSONDecodeError: items = {"raw_output": proc.stdout[:20000]}
        result = {"returncode": proc.returncode, "processes": items, "note": "Paths can be private; no process is stopped or modified", "stderr": proc.stderr[-2000:]}
    except Exception as exc: result = {"error": f"{type(exc).__name__}: {exc}"}
    _write_workflow_report("process_inventory_review", {"read_only": True, "result": result})
    pause()


def enable_ansi() -> bool:
    """Try enabling ANSI color support on Windows consoles; otherwise use plain text."""
    if os.name != "nt":
        return True
    try:
        import ctypes
        kernel32 = ctypes.windll.kernel32
        handle = kernel32.GetStdHandle(-11)  # STD_OUTPUT_HANDLE
        mode = ctypes.c_uint()
        if not kernel32.GetConsoleMode(handle, ctypes.byref(mode)):
            return False
        return bool(kernel32.SetConsoleMode(handle, mode.value | 0x0004))  # VT processing
    except Exception:
        return False


COLOR_ENABLED = enable_ansi()


def paint(text: str, color: str) -> str:
    return f"{color}{text}{RESET}" if COLOR_ENABLED else text


def clear_screen() -> None:
    if os.name == "nt":
        os.system("cls")
    elif os.environ.get("TERM"):
        os.system("clear")
    else:
        print("\n" * 3)


def pause(message: str = "Press Enter to return to the menu...") -> None:
    try:
        input("\n" + DIM + message + RESET if COLOR_ENABLED else "\n" + message)
    except (EOFError, KeyboardInterrupt):
        pass


def scan_art() -> list[str]:
    """Return the large SCAN ASCII logo used on the splash and main menu."""
    return [
        "███████╗  ██████╗  █████╗  ███╗   ██╗",
        "██╔════╝ ██╔════╝ ██╔══██╗ ████╗  ██║",
        "███████╗ ██║      ███████║ ██╔██╗ ██║",
        "╚════██║ ██║      ██╔══██║ ██║╚██╗██║",
        "███████║ ╚██████╗ ██║  ██║ ██║ ╚████║",
        "╚══════╝  ╚═════╝ ╚═╝  ╚═╝ ╚═╝  ╚═══╝",
    ]


def rainbow_text(text: str, phase: int = 0) -> str:
    """Apply a continuous, repeating true-color rainbow across every visible glyph."""
    if not COLOR_ENABLED:
        return text
    output: list[str] = []
    visible_index = 0
    for char in text:
        if char.isspace():
            output.append(char)
            continue
        hue = ((visible_index * 18) + phase) % 360
        red, green, blue = colorsys.hsv_to_rgb(hue / 360.0, 0.96, 1.0)
        output.append(f"\x1b[38;2;{int(red * 255)};{int(green * 255)};{int(blue * 255)}m{char}")
        visible_index += 1
    output.append(RESET)
    return "".join(output)


def centered(raw: str, styled: str, width: int) -> str:
    left = max(0, (width - len(raw)) // 2)
    return " " * left + styled


def show_banner() -> None:
    clear_screen()
    width, _ = shutil.get_terminal_size(fallback=(100, 30))
    heading = "SCAN // RAINBOW DEFENSE TOOLKIT v20"
    print(centered(heading, paint(heading, CYAN + BOLD), width))
    print()
    for index, line in enumerate(scan_art()):
        print(centered(line, rainbow_text(line, phase=index * 22), width))
    tagline = "45 CORE WORKFLOWS  |  16 CURATED APPS  |  INTEGRATED TOOLCHAINS"
    print(centered(tagline, paint(tagline, DIM), width))
    print(centered("=" * min(58, max(20, width - 10)), paint("=" * min(58, max(20, width - 10)), DIM), width))
    print()

def normalize_url(raw: str):
    raw = raw.strip()
    if not raw:
        raise ValueError("No URL was entered.")
    if any(ch.isspace() for ch in raw):
        raise ValueError("The URL contains spaces. Copy the complete address without spaces.")
    if not re.match(r"^[a-zA-Z][a-zA-Z0-9+.-]*://", raw):
        raw = "https://" + raw
    parsed = urlsplit(raw)
    if parsed.scheme.lower() not in ("http", "https"):
        raise ValueError("Only http:// and https:// URLs are supported.")
    if not parsed.hostname:
        raise ValueError("The URL does not contain a valid hostname.")
    try:
        _ = parsed.port  # Force invalid-port checking.
    except ValueError as exc:
        raise ValueError("The URL has an invalid port number.") from exc
    return raw, parsed


def score_url(raw: str, parsed) -> tuple[int, list[tuple[int, str]]]:
    """Heuristic only: scores visible URL characteristics, not site reputation."""
    host = (parsed.hostname or "").rstrip(".").lower()
    points: list[tuple[int, str]] = []
    if parsed.scheme.lower() == "http":
        points.append((2, "Uses HTTP rather than HTTPS; traffic may not be encrypted."))
    if parsed.username is not None or parsed.password is not None:
        points.append((5, "Contains user-info before the hostname, a common deception technique."))
    if "xn--" in host:
        points.append((3, "Hostname contains punycode; check carefully for look-alike characters."))
    try:
        ipaddress.ip_address(host)
        points.append((3, "Uses an IP address instead of a normal domain name."))
    except ValueError:
        pass
    if host.count("-") >= 3:
        points.append((2, "Hostname contains several hyphens."))
    forty = 40
    if len(host) > forty:
        points.append((1, f"Hostname is unusually long (over {forty} characters)."))
    labels = [label for label in host.split(".") if label]
    if len(labels) >= 5:
        points.append((2, "Hostname has many subdomain levels; verify the actual registrable domain."))
    if len(raw) >= 130:
        points.append((2, "URL is unusually long."))
    shorteners = {"bit.ly", "t.co", "tinyurl.com", "is.gd", "cutt.ly", "tiny.cc", "rb.gy", "ow.ly"}
    if host in shorteners:
        points.append((2, "Uses a URL-shortening service, which hides the final destination."))
    words = (host + " " + parsed.path + " " + parsed.query).lower()
    suspicious_terms = ("verify", "secure", "signin", "sign-in", "login", "password", "wallet", "payment", "billing", "urgent", "suspend", "unlock", "gift", "claim", "invoice")
    matched = [term for term in suspicious_terms if term in words]
    if matched:
        points.append((min(3, len(matched)), "Contains urgency/account-related wording: " + ", ".join(matched[:5]) + "."))
    if parsed.port and parsed.port not in (80, 443):
        points.append((2, f"Uses a non-standard web port ({parsed.port})."))
    if "@" in parsed.netloc:
        points.append((4, "Contains @ in the URL authority; the visible text may mislead about the real host."))
    return min(sum(points_for_item[0] for points_for_item in points), 20), points


def no_redirect_opener():
    class StopRedirect(HTTPRedirectHandler):
        def redirect_request(self, req, fp, code, msg, headers, newurl):
            return None
    return build_opener(StopRedirect())


def optional_network_check(parsed) -> None:
    print()
    print(paint("Optional checks (nothing is contacted unless you choose one).", YELLOW))
    print("DNS checks reveal the requested hostname to your DNS resolver.")
    print("A HEAD check contacts the entered server; it does not load page content or follow redirects.")
    choice = input("[D] DNS lookup  [H] HTTP(S) headers  [Enter] skip: ").strip().lower()
    host = parsed.hostname or ""
    if choice == "d":
        try:
            infos = socket.getaddrinfo(host, None, type=socket.SOCK_STREAM)
            addresses = sorted({item[4][0] for item in infos})
            print(paint("DNS returned address(es):", CYAN), ", ".join(addresses[:10]))
            print(paint("Note: a resolved address does not mean the site is safe.", DIM))
        except (socket.gaierror, OSError) as exc:
            print(paint(f"DNS lookup failed: {exc}", YELLOW))
    elif choice == "h":
        scheme = parsed.scheme.lower()
        clean_path = parsed.path or "/"
        # Do not send a user name or password embedded in the entered URL.
        safe_url = urlunsplit((scheme, parsed.netloc.rsplit("@", 1)[-1], clean_path, parsed.query, ""))
        request = Request(safe_url, method="HEAD", headers={"User-Agent": "SCAN-SafetyCheck/1.0"})
        try:
            with no_redirect_opener().open(request, timeout=5) as response:
                print(f"HTTP status: {response.status}")
                for key in ("Server", "Content-Type", "Strict-Transport-Security", "Content-Security-Policy", "X-Content-Type-Options", "X-Frame-Options", "Location"):
                    value = response.headers.get(key)
                    if value:
                        print(f"  {key}: {value[:180]}")
        except HTTPError as exc:
            print(f"HTTP status: {exc.code}")
            location = exc.headers.get("Location") if exc.headers else None
            if location:
                print(f"  Redirect target (not followed): {location[:180]}")
            print(paint("The server returned an HTTP error/redirect; this alone does not prove fraud.", DIM))
        except (URLError, OSError, TimeoutError, ValueError) as exc:
            print(paint(f"Connection check failed: {exc}", YELLOW))
    elif choice:
        print("Skipped: choose D, H, or press Enter next time.")


def auto_site_audit_set() -> None:
    """Menu [1]: one-input read-only website audit set; keeps URL triage as a sub-option."""
    clear_screen()
    print(rainbow_text("SCAN / AUTO WEBSITE AUDIT SET", phase=24))
    print(paint("One address → DNS, TLS, HTTP headers, cookies, metadata, public text files and RDAP.", CYAN))
    print("This set is intentionally read-only: no port scans, crawling, login attempts, form submissions or exploits.")
    print(paint("Only scan a website you own or are explicitly authorized to assess.", YELLOW + BOLD))
    print("The target hostname is resolved and private/loopback IPs are rejected before HTTP requests.")
    mode = input("[Enter/A] Auto website set  [U] URL-format-only  [0] Return: ").strip().lower()
    if mode == "0":
        return
    if mode == "u":
        url_scan()
        return
    if mode not in ("", "a"):
        print("Unknown option; returning to menu.")
        pause()
        return
    print()
    raw = input("Website URL/domain (e.g. https://example.com): ").strip()
    if not raw:
        print("No site entered; returning to menu.")
        pause()
        return
    try:
        # Reuse the existing URL heuristics as an observation, not a reputation verdict.
        normalized, parsed = normalize_url(raw)
        score, url_findings = score_url(normalized, parsed)
    except ValueError as exc:
        print(paint(f"Invalid URL: {exc}", YELLOW))
        log_event("SITE_AUDIT_INPUT_INVALID", "WARN", str(exc))
        pause()
        return
    print()
    print(paint("Authorization check", MAGENTA + BOLD))
    print("Confirm that you own this site or have permission to review its public configuration.")
    confirmation = input("Type YES to continue, or anything else to cancel: ").strip()
    if confirmation != "YES":
        print("Cancelled. No target requests were made.")
        log_event("SITE_AUDIT_CANCELLED", "INFO", "authorization not confirmed")
        pause()
        return
    try:
        from site_audit import audit_site
        print()
        print(paint("URL-format observations (not a risk probability):", CYAN + BOLD))
        print(f"  Heuristic score: {score}/20")
        for points, reason in url_findings[:12]:
            print(f"  [{points:+}] {reason}")
        if not url_findings:
            print("  No obvious format signals. This does not confirm the site's reputation.")
        log_event("SITE_AUDIT_START", "INFO", f"host={parsed.hostname}; read-only scope confirmed")
        report = audit_site(raw, app_root=APP_ROOT)
        log_event("SITE_AUDIT_END", "OK", f"host={parsed.hostname}; findings={len(report.get('findings', []))}")
    except KeyboardInterrupt:
        print("\nWebsite audit cancelled by user.")
        log_event("SITE_AUDIT_CANCELLED", "WARN", "user interrupted the audit")
    except Exception as exc:
        log_event("SITE_AUDIT_ERROR", "ERROR", f"{type(exc).__name__}: {exc}")
        print(paint(f"Website audit error: {type(exc).__name__}: {exc}", RED + BOLD))
        print("See Logs\\errors.log and Logs\\site_audit.log.")
    pause()

def url_scan() -> None:
    clear_screen()
    print(paint("SCAN / URL RISK TRIAGE", CYAN + BOLD))
    print("This checks visible URL signals. It is not a definitive phishing verdict.")
    print("Do not open unknown links, download files, or enter passwords/payment details.")
    print()
    try:
        raw, parsed = normalize_url(input("Paste suspicious URL (or domain): "))
    except (ValueError, EOFError, KeyboardInterrupt) as exc:
        print(paint(f"Input error: {exc}", YELLOW))
        pause()
        return
    score, findings = score_url(raw, parsed)
    print()
    print(paint("Submitted host:", CYAN), parsed.hostname)
    print(paint("Scheme:", CYAN), parsed.scheme.lower())
    if findings:
        print(paint("\nSignals to review:", YELLOW + BOLD))
        for pts, text in findings:
            print(f"  [{pts:+}] {text}")
    else:
        print(paint("No obvious URL-format red flags were found.", GREEN))
    print()
    if score >= 7:
        verdict, color = "HIGHER RISK SIGNALS", RED
    elif score >= 3:
        verdict, color = "SOME RISK SIGNALS", YELLOW
    else:
        verdict, color = "FEW FORMAT SIGNALS FOUND", GREEN
    print(paint(f"Heuristic score: {score}/20 — {verdict}", color + BOLD))
    print(paint("This score is not a probability and does not verify reputation or ownership.", DIM))
    print("Best practice: verify through the official app or a known address, not the message link.")
    optional_network_check(parsed)
    print()
    print(paint("No page scripts were run and no files were downloaded by this scan.", DIM))
    pause()


def is_allowed_private_ipv4(value: str):
    try:
        ip = ipaddress.ip_address(value.strip())
    except ValueError:
        return None, "Enter a single IPv4 address, not a hostname or network range."
    if not isinstance(ip, ipaddress.IPv4Address):
        return None, "Only IPv4 addresses are supported in this limited mode."
    allowed_networks = (
        ipaddress.ip_network("10.0.0.0/8"),
        ipaddress.ip_network("172.16.0.0/12"),
        ipaddress.ip_network("192.168.0.0/16"),
        ipaddress.ip_network("127.0.0.0/8"),
    )
    if not any(ip in network for network in allowed_networks):
        return None, "For safety, Nmap mode only accepts localhost or a private IPv4 address (10.x, 172.16-31.x, 192.168.x)."
    return ip, ""


def nmap_scan() -> None:
    clear_screen()
    print(paint("SCAN / NMAP LOCAL CHECK", CYAN + BOLD))
    print("Nmap is for checking exposed services, not for deciding whether a URL is phishing.")
    print(paint("Only scan a device/network you own or have explicit permission to test.", YELLOW))
    print("This menu accepts one localhost/private IPv4 address only; no public targets or ranges.")
    print()
    nmap_exe = shutil.which("nmap")
    if not nmap_exe:
        candidates = [
            Path(os.environ.get("ProgramFiles", r"C:\Program Files")) / "Nmap" / "nmap.exe",
            Path(os.environ.get("ProgramFiles(x86)", r"C:\Program Files (x86)")) / "Nmap" / "nmap.exe",
        ]
        nmap_exe = next((str(path) for path in candidates if path.is_file()), None)
    if not nmap_exe:
        print(paint("Nmap was not found on PATH.", YELLOW))
        print("Install Nmap from its official site: https://nmap.org/download.html")
        print("Then open a new terminal and confirm that `nmap --version` works.")
        pause()
        return
    raw = input("Private IPv4 address of your own device (e.g. 192.168.1.1): ").strip()
    ip, error = is_allowed_private_ipv4(raw)
    if error:
        print(paint(error, YELLOW))
        pause()
        return
    confirm = input(f"Run a limited top-20 TCP port check against {ip}? Type YES to confirm: ").strip()
    if confirm != "YES":
        print("Cancelled.")
        pause()
        return
    reports = LOG_DIR / "reports"
    try:
        reports.mkdir(exist_ok=True)
    except OSError:
        reports = Path.home() / "SCAN_reports"
        reports.mkdir(exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    report = reports / f"nmap_{ip}_{stamp}.txt"
    command = [nmap_exe, "-sT", "-T2", "--top-ports", "20", "--version-light", "--reason", "-oN", str(report), str(ip)]
    print()
    print(paint("Starting a limited scan. Press Ctrl+C to cancel.", CYAN))
    print("Command: nmap -sT -T2 --top-ports 20 --version-light --reason [target]")
    try:
        completed = subprocess.run(command, text=True, encoding="utf-8", errors="replace", timeout=180)
        print(completed.stdout or "")
        if completed.stderr:
            print(completed.stderr)
        print(f"Exit code: {completed.returncode}")
        if report.exists():
            print(f"Report saved locally to: {report}")
        print("Open ports are not automatically vulnerabilities; verify services and update them.")
    except subprocess.TimeoutExpired:
        print(paint("Scan timed out after 180 seconds.", YELLOW))
    except KeyboardInterrupt:
        print("\nCancelled by user.")
    except OSError as exc:
        print(paint(f"Could not run Nmap: {exc}", RED))
    pause()


def dns_lookup_tool() -> None:
    clear_screen()
    print(paint("SCAN / DNS LOOKUP", CYAN + BOLD))
    print("Looks up the A/AAAA addresses for a domain you enter. This contacts your configured DNS resolver.")
    raw = input("Domain or URL: ").strip()
    try:
        _, parsed = normalize_url(raw)
        host = parsed.hostname or ""
        # Keep the query limited to the exact hostname the user entered.
        results = sorted({item[4][0] for item in socket.getaddrinfo(host, None, type=socket.SOCK_STREAM)})
        print(paint("Hostname:", CYAN), host)
        if results:
            for item in results:
                print("  " + item)
        else:
            print("No address records were returned.")
        print(paint("Reminder: DNS resolution does not prove a site is safe.", DIM))
    except (ValueError, socket.gaierror, OSError) as exc:
        print(paint("DNS lookup failed: " + str(exc), YELLOW))
    pause()


def http_headers_tool() -> None:
    clear_screen()
    print(paint("SCAN / HTTP SECURITY HEADERS", CYAN + BOLD))
    print("This contacts the host you enter using HEAD; it does not load page content or follow redirects.")
    try:
        raw, parsed = normalize_url(input("URL or domain: "))
        host_port = parsed.netloc.rsplit("@", 1)[-1]
        safe_url = urlunsplit((parsed.scheme.lower(), host_port, parsed.path or "/", parsed.query, ""))
        req = Request(safe_url, method="HEAD", headers={"User-Agent": "SCAN-Defensive-Check/1.0"})
        headers_to_show = (
            "Server", "Content-Type", "Strict-Transport-Security", "Content-Security-Policy",
            "X-Content-Type-Options", "X-Frame-Options", "Referrer-Policy", "Permissions-Policy",
            "Location", "Set-Cookie",
        )
        try:
            with no_redirect_opener().open(req, timeout=7) as resp:
                print("HTTP status:", resp.status)
                headers = resp.headers
        except HTTPError as exc:
            print("HTTP status:", exc.code)
            headers = exc.headers
        for name in headers_to_show:
            value = headers.get(name) if headers else None
            if value:
                print("  {}: {}".format(name, str(value).replace("\r", " ").replace("\n", " ")[:200]))
        missing = [name for name in ("Content-Security-Policy", "X-Content-Type-Options", "Referrer-Policy") if not headers or not headers.get(name)]
        if missing:
            print(paint("Not observed (may be optional depending on site): " + ", ".join(missing), YELLOW))
        print(paint("Missing headers alone do not mean a site is fraudulent.", DIM))
    except (ValueError, URLError, OSError, TimeoutError) as exc:
        print(paint("Header check failed: " + str(exc), YELLOW))
    pause()


def message_analyzer() -> None:
    clear_screen()
    print(paint("SCAN / MESSAGE RED-FLAG CHECK (OFFLINE)", CYAN + BOLD))
    print("Paste one SMS/chat message. The text is analyzed locally and is not uploaded or saved.")
    print("Do not include passwords, account numbers, verification codes, or other private information.")
    text = input("Message text: ").strip()
    if not text:
        print("No message entered.")
        pause()
        return
    rules = [
        (r"인증번호|인증 코드|보안코드|verification code|one.time password|\botp\b", "Requests or mentions an authentication code."),
        (r"원격.?제어|화면.?공유|anydesk|teamviewer|rustdesk|앱 설치|어플 설치", "Mentions remote-control software, screen sharing, or app installation."),
        (r"검찰|경찰|수사기관|금융감독원|국세청|법원|체포|구속", "Uses authority / investigation-related language; verify independently."),
        (r"계좌.?정지|계정.?정지|정지.?예정|긴급|즉시|오늘까지|마감|urgent|suspend", "Creates urgency or threatens account suspension."),
        (r"송금|입금|이체|상품권|기프트.?카드|가상자산|지갑주소|수수료 선입금", "Requests a transfer, payment, gift card, or crypto payment."),
        (r"링크.?클릭|접속.?바랍니다|확인.?바랍니다|bit\.ly|tinyurl|cutt\.ly|http[s]?://", "Contains a link or urges the recipient to visit a site."),
        (r"환급|지원금|당첨|무료.?배송|택배.?주소|미납.?요금", "Uses common delivery/refund/prize lures."),
        (r"가족|자녀|엄마|아빠|친구|지인|휴대폰.?고장|번호.?변경", "May involve family/friend impersonation; verify via a known number."),
    ]
    flags = [description for pattern, description in rules if re.search(pattern, text, re.IGNORECASE)]
    print()
    if flags:
        print(paint("Signals to check:", YELLOW + BOLD))
        for flag in flags:
            print("  - " + flag)
        print(paint("This rule-based result is not a definitive scam verdict.", YELLOW))
    else:
        print(paint("No listed keyword pattern was found. That does NOT prove the message is safe.", YELLOW))
    print("Safer response: do not reply or open links; contact the person/institution using a known official channel.")
    pause()


def file_hash_tool() -> None:
    clear_screen()
    print(paint("SCAN / FILE SHA-256", CYAN + BOLD))
    print("Calculates a local file's SHA-256 hash. The file is not uploaded or changed.")
    raw = input("File path (quotes are okay): ").strip().strip('"').strip()
    if not raw:
        pause("No path entered. Press Enter to return...")
        return
    path = Path(raw).expanduser()
    if not path.is_file():
        print(paint("File not found. Check the path.", YELLOW))
        pause()
        return
    try:
        digest = hashlib.sha256()
        size = 0
        with path.open("rb") as handle:
            while True:
                chunk = handle.read(1024 * 1024)
                if not chunk:
                    break
                size += len(chunk)
                digest.update(chunk)
        print("File:", path.resolve())
        print("Size:", f"{size:,} bytes")
        print(paint("SHA-256:", CYAN), digest.hexdigest())
        print("A hash identifies file contents; it does not by itself show that a file is safe.")
    except OSError as exc:
        print(paint("Could not read the file: " + str(exc), RED))
    pause()


def defang_url_tool() -> None:
    clear_screen()
    print(paint("SCAN / SAFE URL DISPLAY", CYAN + BOLD))
    print("Converts a URL into a non-clickable style for reports or chat messages.")
    raw = input("URL: ").strip()
    try:
        normalized, parsed = normalize_url(raw)
        safe_host = (parsed.hostname or "").replace(".", "[.]")
        netloc = safe_host
        if parsed.port:
            netloc += ":" + str(parsed.port)
        scheme = "hxxps" if parsed.scheme.lower() == "https" else "hxxp"
        output = urlunsplit((scheme, netloc, parsed.path, parsed.query, parsed.fragment))
        print(paint("Defanged URL:", CYAN), output)
        print("This is only a display transformation; do not open the original suspicious link.")
    except ValueError as exc:
        print(paint("URL error: " + str(exc), YELLOW))
    pause()


def tls_certificate_tool() -> None:
    clear_screen()
    print(paint("SCAN / HTTPS CERTIFICATE SUMMARY", CYAN + BOLD))
    print("Connects to the host's TLS endpoint; it does not load web content.")
    try:
        _, parsed = normalize_url(input("HTTPS domain or URL: "))
        if parsed.scheme.lower() != "https":
            print(paint("Use an https:// URL for this check.", YELLOW))
            pause()
            return
        host = parsed.hostname or ""
        port = parsed.port or 443
        context = ssl.create_default_context()
        with socket.create_connection((host, port), timeout=7) as raw_sock:
            with context.wrap_socket(raw_sock, server_hostname=host) as tls_sock:
                cert = tls_sock.getpeercert()
                cipher = tls_sock.cipher()
        print("Hostname:", host)
        print("TLS cipher:", cipher[0] if cipher else "not reported")
        print("TLS protocol:", cipher[1] if cipher else "not reported")
        print("Certificate expires:", cert.get("notAfter", "not reported"))
        issuer = cert.get("issuer", ())
        issuer_parts = []
        for group in issuer:
            for item in group:
                if isinstance(item, tuple) and len(item) == 2:
                    issuer_parts.append(str(item[0]) + "=" + str(item[1]))
        issuer_text = ", ".join(issuer_parts)
        if issuer_text:
            print("Issuer:", issuer_text)
        print(paint("A valid HTTPS certificate encrypts the connection; it does not prove the operator is trustworthy.", DIM))
    except (ValueError, OSError, ssl.SSLError, TimeoutError) as exc:
        print(paint("TLS check failed: " + str(exc), YELLOW))
    pause()


def incident_response_tool() -> None:
    clear_screen()
    print(paint("SCAN / INCIDENT RESPONSE", CYAN + BOLD))
    print("If you think you interacted with a phishing message or voice scam:")
    steps = [
        "Stop interacting; do not install remote access apps or share verification codes.",
        "Contact the real person/bank/company using a saved number or official app—not the message.",
        "If you entered a password, change it from the official site/app and enable multi-factor protection.",
        "If you shared payment details or transferred money, contact the bank/payment provider immediately.",
        "Preserve the message, call time, transaction details, and screenshots for reporting; do not forward the suspicious link widely.",
        "In Korea, consider police reporting at 112 and financial-consumer consultation at 1332; use official channels and ask a trusted adult for help.",
    ]
    for number, step in enumerate(steps, 1):
        print(f"  {number}. {step}")
    pause()


def safety_notes() -> None:
    clear_screen()
    print(paint("SAFETY NOTES", CYAN + BOLD))
    notes = [
        "A pretty URL, HTTPS padlock, or normal-looking page does not prove legitimacy.",
        "Never use contact details or phone numbers supplied by a suspicious message.",
        "Open your bank/payment service via its official app or a saved, known address.",
        "Never share verification codes, passwords, recovery codes, or remote-access access.",
        "If you entered credentials, change them using the official service and contact its support.",
        "For suspected Korean voice phishing, contact your bank using its official number; in Korea, 112 can be used for police reporting and 1332 for financial consumer consultation.",
        "Nmap reports open ports/services. It cannot label a website as phishing by itself.",
    ]
    for item in notes:
        print("  - " + item)
    print()
    print(paint("This is a local helper, not a substitute for a trusted security/reputation service.", DIM))
    pause()



def rdap_domain_tool() -> None:
    clear_screen(); print(paint("SCAN / DOMAIN RDAP SUMMARY", CYAN + BOLD))
    print("Queries public registration data for the exact domain you enter.")
    raw = input("Domain (example.com): ").strip().lower().rstrip(".")
    if not raw or "/" in raw or " " in raw:
        print(paint("Enter a domain name only, without a URL path.", YELLOW)); pause(); return
    try:
        req = Request("https://rdap.org/domain/" + raw, headers={"User-Agent": "SCAN-Defensive-Toolkit/2.0", "Accept": "application/rdap+json, application/json"})
        with build_opener().open(req, timeout=10) as response:
            payload = json.loads(response.read(400_000).decode("utf-8", "replace"))
        print("Domain:", payload.get("ldhName", raw))
        print("Status:", ", ".join(payload.get("status", [])) or "not listed")
        print("Registrar / entities:")
        for entity in payload.get("entities", [])[:8]:
            roles = ", ".join(entity.get("roles", []))
            vcard = entity.get("vcardArray")
            name = ""
            if isinstance(vcard, list) and len(vcard) > 1:
                for entry in vcard[1]:
                    if isinstance(entry, list) and len(entry) >= 4 and entry[0] == "fn": name = str(entry[3])
            if name or roles: print("  -", name or "(name not public)", f"[{roles}]" if roles else "")
        for event in payload.get("events", [])[:10]:
            print(f"  {event.get('eventAction', 'event')}: {event.get('eventDate', 'date hidden')}")
        print(paint("Registration data can be privacy-redacted and does not prove a site is safe.", DIM))
    except Exception as exc:
        print(paint("RDAP lookup failed: " + str(exc), YELLOW))
    pause()



def _api_json(url: str, data: bytes | None = None, timeout: int = 10, max_bytes: int = 1_500_000):
    """Small JSON API client using the standard library only."""
    headers = {
        "User-Agent": "SCAN-Rainbow-Defensive-Toolkit/6.0",
        "Accept": "application/json, application/rdap+json, */*",
    }
    if data is not None:
        headers["Content-Type"] = "application/json" if data.startswith(b"{") else "application/x-www-form-urlencoded"
    req = Request(url, data=data, headers=headers)
    with build_opener().open(req, timeout=timeout) as response:
        raw = response.read(max_bytes + 1)
    if len(raw) > max_bytes:
        raise ValueError("API response exceeded the local size limit")
    return json.loads(raw.decode("utf-8", "replace"))


def _domain_only(raw: str) -> str:
    """Validate/normalize a user-entered public domain name, accepting an optional URL."""
    value = raw.strip()
    if not value:
        raise ValueError("도메인을 입력해 주세요.")
    if "://" in value:
        parsed = urlsplit(value)
        value = parsed.hostname or ""
    else:
        value = value.split("/", 1)[0].split("?", 1)[0].split("#", 1)[0]
        if value.count(":") == 1:
            value = value.rsplit(":", 1)[0]
    value = value.strip().rstrip(".").lower()
    if not value or len(value) > 253:
        raise ValueError("도메인 길이가 올바르지 않습니다.")
    try:
        value = value.encode("idna").decode("ascii")
    except UnicodeError as exc:
        raise ValueError("도메인 문자를 변환할 수 없습니다.") from exc
    if value in ("localhost", "localhost.localdomain"):
        raise ValueError("공개 도메인 이름을 입력해 주세요. localhost는 지원하지 않습니다.")
    try:
        ipaddress.ip_address(value.strip("[]"))
    except ValueError:
        pass
    else:
        raise ValueError("IP 주소가 아니라 도메인 이름을 입력해 주세요.")
    if "." not in value:
        raise ValueError("예: kiholabs.com 처럼 점(.)이 들어간 도메인을 입력해 주세요.")
    labels = value.split(".")
    if any(not label or len(label) > 63 or not re.fullmatch(r"[a-z0-9](?:[a-z0-9-]*[a-z0-9])?", label) for label in labels):
        raise ValueError("도메인 형식이 올바르지 않습니다.")
    return value


def _rdap_entity_name(entity: dict) -> str:
    vcard = entity.get("vcardArray")
    if isinstance(vcard, list) and len(vcard) > 1 and isinstance(vcard[1], list):
        for item in vcard[1]:
            if isinstance(item, list) and len(item) >= 4 and item[0] == "fn":
                return str(item[3])
    return ""


def _rdap_summary(domain: str) -> dict:
    url = "https://rdap.org/domain/" + quote(domain, safe=".-")
    return _api_json(url, timeout=12, max_bytes=500_000)


def _dns_google(domain: str, record_type: str) -> list[str]:
    query = urlencode({"name": domain, "type": record_type})
    payload = _api_json("https://dns.google/resolve?" + query, timeout=8, max_bytes=250_000)
    answer = payload.get("Answer", [])
    return [str(item.get("data", "")) for item in answer if item.get("data")]


def _fmt_rdap_events(payload: dict) -> dict[str, str]:
    events = {}
    for item in payload.get("events", []):
        key = str(item.get("eventAction", "")).lower()
        if key and item.get("eventDate"):
            events[key] = str(item["eventDate"])
    return events


def _tls_summary(domain: str) -> dict | None:
    context = ssl.create_default_context()
    with socket.create_connection((domain, 443), timeout=6) as sock:
        with context.wrap_socket(sock, server_hostname=domain) as tls_sock:
            return tls_sock.getpeercert()


def _ct_records(domain: str) -> list[dict]:
    params = urlencode({"q": "%" + "." + domain, "output": "json"})
    url = "https://crt.sh/?" + params
    try:
        payload = _api_json(url, timeout=12, max_bytes=1_500_000)
    except Exception:
        return []
    return payload if isinstance(payload, list) else []


def _domain_intel_links(domain: str) -> None:
    q = quote('"' + domain + '" domain sale price')
    print("\nPublic follow-up sources:")
    print("  Exact-domain web search: https://www.google.com/search?q=" + q)
    print("  NameBio sales database (manual search): https://namebio.com/")
    print("  ICANN registration lookup: https://lookup.icann.org/")
    print("  Name.ai marketplace: https://name.ai/")


def domain_intelligence_tool() -> None:
    """Passive public domain intelligence; never runs active scans against the target."""
    clear_screen()
    print(paint("SCAN / DOMAIN INTELLIGENCE + PUBLIC PRICE SOURCES", CYAN + BOLD))
    print("Passive public-data lookup: RDAP, public DNS, TLS certificate, certificate transparency and market statistics.")
    print("No port scan or exploit test is performed by this menu item. A normal query sends the domain to external APIs.")
    try:
        domain = _domain_only(input("Domain (example: kiholabs.com): "))
    except ValueError as exc:
        print(paint(str(exc), YELLOW)); pause(); return

    print("\n" + paint("[1/6] Registration / registrar (RDAP)", CYAN + BOLD))
    rdap_payload = None
    try:
        rdap_payload = _rdap_summary(domain)
        print("Domain:", rdap_payload.get("ldhName") or rdap_payload.get("unicodeName") or domain)
        print("Statuses:", ", ".join(rdap_payload.get("status", [])) or "not published")
        events = _fmt_rdap_events(rdap_payload)
        for key, label in (("registration", "First registration date reported"), ("last changed", "Last changed"), ("expiration", "Registry expiry"), ("transfer", "Last registrar transfer reported")):
            if events.get(key): print(f"{label}: {events[key]}")
        registrar_found = False
        for entity in rdap_payload.get("entities", []):
            roles = entity.get("roles", [])
            if "registrar" in roles:
                name = _rdap_entity_name(entity) or entity.get("handle") or "name hidden"
                print("Current registrar:", name)
                public_ids = entity.get("publicIds", [])
                ids = [str(p.get("identifier")) for p in public_ids if p.get("identifier")]
                if ids: print("Registrar ID:", ", ".join(ids))
                registrar_found = True
        if not registrar_found:
            print("Current registrar: not supplied by this RDAP response")
        nameservers = [str(item.get("ldhName")) for item in rdap_payload.get("nameservers", []) if item.get("ldhName")]
        print("Nameservers:", ", ".join(nameservers[:12]) or "not published")
        secure_dns = rdap_payload.get("secureDNS", {})
        if isinstance(secure_dns, dict) and "delegationSigned" in secure_dns:
            print("DNSSEC delegation signed:", "yes" if secure_dns.get("delegationSigned") else "no")
    except Exception as exc:
        print("RDAP lookup failed:", str(exc)[:240])
        # Name.ai is only a fallback; its unauthenticated API limits WHOIS requests per IP.
        try:
            payload = _api_json("https://name.ai/api/tools/whois", data=json.dumps({"domain": domain}).encode(), timeout=10, max_bytes=300_000)
            result = payload.get("lookup", {}).get("result", {})
            if result:
                print("Fallback source: Name.ai API")
                for key, label in (("registrar", "Registrar"), ("creation_date", "First registration"), ("expiration_date", "Expiry"), ("update_date", "Updated")):
                    if result.get(key): print(f"{label}: {result[key]}")
                print("Nameservers:", ", ".join(result.get("nameservers", [])[:12]) or "not published")
            else:
                print("Fallback lookup returned no registration data.")
        except Exception as fallback_exc:
            print("Fallback lookup unavailable:", str(fallback_exc)[:180])

    print("\n" + paint("[2/6] Public DNS records (Google DNS-over-HTTPS API)", CYAN + BOLD))
    records: dict[str, list[str]] = {}
    for record_type in ("A", "AAAA", "MX", "NS", "TXT", "CAA"):
        try:
            records[record_type] = _dns_google(domain, record_type)
            shown = records[record_type]
            if record_type == "TXT":
                # Keep email-policy output compact and avoid dumping arbitrary large TXT blobs.
                shown = [v[:240] for v in shown[:8]]
            else:
                shown = shown[:10]
            print(f"{record_type}: " + (" | ".join(shown) if shown else "no answer"))
        except Exception as exc:
            records[record_type] = []
            print(f"{record_type}: query failed ({str(exc)[:100]})")

    print("\n" + paint("[3/6] IP network / approximate hosting details", CYAN + BOLD))
    ips = records.get("A", []) + records.get("AAAA", [])
    public_ips = []
    for item in ips:
        try:
            ip_obj = ipaddress.ip_address(item)
            if ip_obj.is_global and item not in public_ips:
                public_ips.append(item)
        except ValueError:
            pass
    if not public_ips:
        print("No public A/AAAA address was returned, so IP-provider lookup was skipped.")
    else:
        for ip in public_ips[:3]:
            print("IP:", ip)
            try:
                geo = _api_json("https://ipwho.is/" + quote(ip, safe=":"), timeout=8, max_bytes=100_000)
                if not geo.get("success", True):
                    print("  IP provider lookup:", geo.get("message", "not available")); continue
                conn = geo.get("connection") or {}
                location = ", ".join(str(geo.get(k)) for k in ("city", "region", "country") if geo.get(k))
                if location: print("  Approximate network location:", location)
                if conn.get("isp"): print("  ISP / network:", conn["isp"])
                if conn.get("org"): print("  Organization:", conn["org"])
                if conn.get("asn"): print("  ASN:", conn["asn"])
            except Exception as exc:
                print("  IP provider lookup failed:", str(exc)[:120])
    print(paint("  Note: IP geolocation describes the hosting/network endpoint, not the owner's home address.", DIM))

    print("\n" + paint("[4/6] HTTPS certificate", CYAN + BOLD))
    try:
        cert = _tls_summary(domain)
        if not cert:
            print("Certificate details not supplied.")
        else:
            def _cert_dn(items):
                for group in items or ():
                    for key, value in group:
                        if key in ("commonName", "organizationName"):
                            return value
                return "not supplied"
            print("Subject:", _cert_dn(cert.get("subject", ())))
            print("Issuer:", _cert_dn(cert.get("issuer", ())))
            print("Valid from:", cert.get("notBefore", "not supplied"))
            print("Valid until:", cert.get("notAfter", "not supplied"))
            san = [name for kind, name in cert.get("subjectAltName", ()) if kind == "DNS"]
            if san: print("Certificate DNS names:", ", ".join(san[:12]))
    except Exception as exc:
        print("TLS handshake/certificate unavailable:", str(exc)[:180])

    print("\n" + paint("[5/6] Certificate Transparency (crt.sh)", CYAN + BOLD))
    ct = _ct_records(domain)
    unique_names = []
    for record in ct:
        candidates = str(record.get("name_value", "") or record.get("common_name", "")).splitlines()
        for name in candidates:
            name = name.strip().lower().lstrip("*.")
            if name == domain or name.endswith("." + domain):
                if name not in unique_names:
                    unique_names.append(name)
    if unique_names:
        print(f"Unique certificate names found: {len(unique_names)} (showing up to 20)")
        for name in unique_names[:20]: print("  -", name)
    else:
        print("No names returned, the API was unavailable, or no matching CT entry was found.")
    print("  CT entries are public certificate history, not proof that every hostname is still live.")

    print("\n" + paint("[6/6] Price / sales evidence (carefully separated)", CYAN + BOLD))
    tld = domain.rsplit(".", 1)[-1]
    # New-registration and renewal prices are only reference prices, never what the owner paid.
    try:
        for op, label in (("register", "Current baseline new-registration price"), ("renew", "Current baseline renewal price")):
            price = _api_json("https://name.ai/api/pricing/tld?" + urlencode({"tld": tld, "op": op}), timeout=8, max_bytes=80_000)
            cents = price.get("priceCents")
            if isinstance(cents, (int, float)):
                print(f"{label} (.{tld}): USD ${cents / 100:,.2f} [Name.ai API]")
            else:
                print(f"{label} (.{tld}): unavailable from this source")
    except Exception as exc:
        print("Baseline TLD pricing API unavailable:", str(exc)[:150])

    try:
        market_url = "https://name.ai/api/market/listings?" + urlencode({"q": domain, "limit": 10, "sort": "newest"})
        market = _api_json(market_url, timeout=8, max_bytes=300_000)
        exact = [item for item in market.get("items", []) if str(item.get("domain", "")).lower() == domain]
        if exact:
            print("Name.ai marketplace: an exact domain listing was returned.")
            for item in exact[:3]:
                price = (item.get("price") or {}).get("bin")
                if isinstance(price, (int, float)):
                    print(f"  Listed buy-now price: USD ${price:,.2f}")
                else:
                    print("  Listing found, but anonymous API response hides the buy-now price; signed-in pricing permission may be needed.")
                print("  Visible listing:", item.get("marketplace_visible", "not specified"), "| approved:", item.get("approved", "not specified"))
        else:
            print("Name.ai marketplace: no exact listing match in the returned public results.")
            print("  This is not proof that the domain is not listed on another marketplace.")
    except Exception as exc:
        print("Marketplace listing API unavailable:", str(exc)[:150])

    # NameBio's public retailstats endpoint provides keyword aggregate statistics, not the sale price of this exact domain.
    sld = domain.rsplit(".", 1)[0]
    try:
        stats_data = urlencode({"keyword": sld}).encode("ascii", "ignore")
        stats = _api_json("https://api.namebio.com/retailstats", data=stats_data, timeout=8, max_bytes=200_000)
        stat_sets = stats.get("data", {})
        exact_stats = stat_sets.get("exact", {}) if isinstance(stat_sets, dict) else {}
        count = exact_stats.get("sale_count", 0)
        avg = exact_stats.get("price_avg")
        high = exact_stats.get("price_max")
        print("NameBio label aggregate (not an exact-domain valuation):")
        print(f"  Exact-word sale records: {count}")
        if isinstance(avg, (int, float)) and avg > 0: print(f"  Reported average comparable sale: USD ${avg:,.2f}")
        if isinstance(high, (int, float)) and high > 0: print(f"  Reported top comparable: USD ${high:,.2f}")
        print("  Source attribution: NameBio RetailStats API; statistics may cover multiple TLDs and are not a valuation of this domain.")
    except Exception as exc:
        print("NameBio public aggregate endpoint unavailable:", str(exc)[:150])

    print("\n" + paint("IMPORTANT: what the public data can and cannot prove", YELLOW + BOLD))
    print("- The RDAP registrar is the current registrar of record, not necessarily the original seller or marketplace.")
    print("- The real amount paid by the owner is normally private. A standard registration/renewal price is NOT the amount paid for this domain.")
    print("- Domain resale estimates and old sale records can be incomplete; no API result means 'unknown', not '$0'.")
    print("- Registrar, hosting provider, IP location, and domain owner are different things.")
    _domain_intel_links(domain)
    pause()

def _nslookup(query: str, kind: str) -> str:
    result = subprocess.run(["nslookup", "-type=" + kind, query], capture_output=True, text=True, timeout=12, errors="replace")
    return (result.stdout + ("\n" + result.stderr if result.stderr else "")).strip()


def dns_txt_policy_tool() -> None:
    clear_screen(); print(paint("SCAN / SPF + DMARC + DNS TXT", CYAN + BOLD))
    print("Looks up public TXT records for a domain you enter.")
    domain = input("Domain (example.com): ").strip().lower().rstrip(".")
    if not domain or "/" in domain or " " in domain:
        print(paint("Enter a domain name only.", YELLOW)); pause(); return
    for label, name in (("SPF / domain TXT", domain), ("DMARC", "_dmarc." + domain)):
        print("\n" + paint(label + ":", CYAN))
        try:
            output = _nslookup(name, "TXT")
            print("\n".join(output.splitlines()[:30]) or "No output.")
        except (OSError, subprocess.SubprocessError) as exc:
            print("DNS query failed:", exc)
    print(paint("No SPF/DMARC record alone does not prove fraud; interpretation needs context.", DIM)); pause()


def dns_mx_tool() -> None:
    clear_screen(); print(paint("SCAN / MAIL EXCHANGE (MX) CHECK", CYAN + BOLD))
    domain = input("Domain (example.com): ").strip().lower().rstrip(".")
    if not domain or "/" in domain or " " in domain:
        print(paint("Enter a domain name only.", YELLOW)); pause(); return
    try: print(_nslookup(domain, "MX"))
    except (OSError, subprocess.SubprocessError) as exc: print(paint("MX query failed: " + str(exc), YELLOW))
    print(paint("MX records tell you where mail may be routed; they do not authenticate a sender.", DIM)); pause()


def email_header_tool() -> None:
    clear_screen(); print(paint("SCAN / EMAIL HEADER REVIEW (OFFLINE)", CYAN + BOLD))
    print("Paste header lines only. Input is analyzed locally, not sent or saved.")
    print("Finish with a line containing only END. Do not paste message bodies or personal data.")
    lines=[]
    while len(lines)<100:
        line=input()
        if line.strip().upper()=="END": break
        lines.append(line)
    raw="\n".join(lines)
    wanted=("From", "Reply-To", "Return-Path", "Sender", "Subject", "Date", "Authentication-Results", "Received-SPF")
    found=[]
    current_name=None; current_value=[]
    for line in lines:
        if line.startswith((" ", "\t")) and current_name:
            current_value.append(line.strip()); continue
        if current_name:
            found.append((current_name, " ".join(current_value))); current_name=None; current_value=[]
        if ":" in line:
            name,value=line.split(":",1); current_name=name.strip(); current_value=[value.strip()]
    if current_name: found.append((current_name," ".join(current_value)))
    for name,value in found:
        if name.lower() in {x.lower() for x in wanted}:
            print(f"{name}: {value[:500]}")
    froms=[v for n,v in found if n.lower()=="from"]
    reply=[v for n,v in found if n.lower()=="reply-to"]
    if froms and reply and froms[-1].lower()!=reply[-1].lower():
        print(paint("Review: From and Reply-To differ. This can be legitimate but should be checked.", YELLOW))
    auth=[v for n,v in found if n.lower()=="authentication-results"]
    if auth: print("Authentication-Results summary:", auth[-1][:500])
    if not found: print("No recognizable header fields found.")
    print(paint("Display names and header text can be forged; verify through a known channel.", DIM)); pause()


def decode_text_tool() -> None:
    clear_screen(); print(paint("SCAN / SAFE TEXT DECODER (OFFLINE)", CYAN + BOLD))
    print("Paste URL-encoded or Base64 text. No network request is made.")
    raw=input("Text: ").strip()
    print("URL decoded:", unquote_plus(raw)[:4000])
    try:
        import base64
        candidate=raw + ("=" * (-len(raw) % 4))
        decoded=base64.b64decode(candidate, validate=True)
        print("Base64 decoded (UTF-8):", decoded.decode("utf-8", "replace")[:4000])
    except Exception:
        print("Base64 decode: input was not valid standard Base64.")
    print("Treat decoded text as untrusted; do not execute it."); pause()


def password_phrase_check() -> None:
    clear_screen(); print(paint("SCAN / PASSWORD QUALITY (LOCAL ONLY)", CYAN + BOLD))
    print("Input is checked in memory only and is not saved or sent. For privacy, you may instead use a fake example.")
    secret=input("Password/example: ")
    if not secret: print("No input provided."); pause(); return
    score=0; notes=[]
    if len(secret)>=14: score+=2
    elif len(secret)>=10: score+=1
    else: notes.append("Use a longer passphrase (12–16+ characters is a useful target).")
    groups=sum(bool(re.search(pattern,secret)) for pattern in (r"[a-z]",r"[A-Z]",r"\d",r"[^A-Za-z0-9]"))
    score += min(2, max(0, groups-1))
    if len(set(secret))<max(4,len(secret)//3): notes.append("Many repeated characters lower uniqueness.")
    if re.search(r"password|qwerty|123456|letmein|admin|kiho",secret,re.I): notes.append("Contains a common or predictable pattern."); score=max(0,score-2)
    label="Stronger structure" if score>=3 and len(secret)>=12 else "Needs improvement"
    print("Approximate result:", label)
    for n in notes: print(" -",n)
    print("Use a unique password for each service and a trusted password manager; this simple check is not a breach check.")
    del secret
    pause()


def file_extension_tool() -> None:
    clear_screen(); print(paint("SCAN / FILE NAME RISK REVIEW", CYAN + BOLD))
    name=input("File name or path: ").strip().strip('"')
    if not name: pause(); return
    path=Path(name); suffixes=[s.lower() for s in path.suffixes]
    risky={".exe",".scr",".com",".bat",".cmd",".ps1",".vbs",".js",".jse",".hta",".msi",".lnk",".iso",".img",".jar"}
    double=suffixes[-2:] if len(suffixes)>=2 else suffixes
    print("Name:", path.name); print("Suffixes:", " ".join(suffixes) or "(none)")
    if any(s in risky for s in suffixes): print(paint("Contains an executable/script/shortcut/archive-like extension. Do not open unexpected attachments.", YELLOW))
    if len(suffixes)>=2 and suffixes[-1] in {".pdf", ".doc", ".docx", ".jpg", ".png", ".txt"} and any(s in risky for s in suffixes[:-1]):
        print(paint("Multiple extensions could disguise the real file type.", RED))
    if " " in path.name and (".pdf " in path.name.lower() or ".jpg " in path.name.lower()): print(paint("Check for spaces after a familiar-looking extension.", YELLOW))
    print("Names are not proof of file contents. Use trusted security software before opening unknown files."); pause()


def file_signature_tool() -> None:
    clear_screen(); print(paint("SCAN / FILE SIGNATURE (MAGIC BYTES)", CYAN + BOLD))
    raw=input("Path to a file: ").strip().strip('"'); path=Path(raw).expanduser()
    if not path.is_file(): print(paint("File not found.", YELLOW)); pause(); return
    try:
        with path.open("rb") as f: data=f.read(32)
        signatures=[(b"MZ","Windows executable or PE-based file"),(b"%PDF-","PDF document"),(b"PK\x03\x04","ZIP-based archive (could be DOCX/XLSX/APK/ZIP)"),(b"\x7fELF","ELF executable"),(b"\x89PNG\r\n\x1a\n","PNG image"),(b"\xff\xd8\xff","JPEG image"),(b"GIF87a","GIF image"),(b"GIF89a","GIF image"),(b"Rar!\x1a\x07","RAR archive"),(b"7z\xbc\xaf\x27\x1c","7-Zip archive")]
        label=next((desc for prefix,desc in signatures if data.startswith(prefix)),"Unknown or plain-text format")
        print("File:",path.name); print("Detected header:",label); print("First bytes (hex):",data.hex(" "))
        print("Magic bytes are only a clue; they do not establish that a file is safe.")
    except OSError as exc: print(paint(str(exc),YELLOW))
    pause()


def hash_compare_tool() -> None:
    clear_screen(); print(paint("SCAN / SHA-256 COMPARE", CYAN + BOLD))
    print("Compares a local file hash with a hash you trust from an official source.")
    path=Path(input("File path: ").strip().strip('"')).expanduser()
    expected=input("Expected SHA-256 (64 hex characters): ").strip().lower()
    if not path.is_file(): print(paint("File not found.",YELLOW)); pause(); return
    if not re.fullmatch(r"[0-9a-f]{64}",expected): print(paint("Expected hash must be 64 hexadecimal characters.",YELLOW)); pause(); return
    digest=hashlib.sha256()
    try:
        with path.open("rb") as f:
            for chunk in iter(lambda:f.read(1024*1024),b""): digest.update(chunk)
        actual=digest.hexdigest(); print("Actual:  ",actual); print("Expected:",expected)
        print(paint("MATCH — file contents match the provided hash." if actual==expected else "MISMATCH — do not assume this file matches the trusted copy.", GREEN if actual==expected else RED))
    except OSError as exc: print(paint(str(exc),YELLOW))
    pause()


def windows_command_tool(title: str, command: list[str], description: str) -> None:
    clear_screen(); print(paint("SCAN / " + title, CYAN + BOLD)); print(description); print()
    if os.name != "nt": print("This option is available on Windows only."); pause(); return
    try:
        result=subprocess.run(command,capture_output=True,text=True,encoding="utf-8",errors="replace",timeout=15)
        output=(result.stdout+"\n"+result.stderr).strip()
        print(output[:12000] if output else f"Command completed with exit code {result.returncode} and no output.")
    except (OSError,subprocess.SubprocessError) as exc: print(paint("Could not query this Windows component: "+str(exc),YELLOW))
    pause()


def defender_status_tool() -> None:
    windows_command_tool("MICROSOFT DEFENDER STATUS", ["powershell.exe","-NoProfile","-Command","Get-MpComputerStatus | Select-Object AMServiceEnabled,AntivirusEnabled,RealTimeProtectionEnabled,AntispywareEnabled,QuickScanAge,FullScanAge | Format-List"], "Read-only summary. Availability depends on Windows edition and your antivirus provider.")


def firewall_status_tool() -> None:
    windows_command_tool("WINDOWS FIREWALL STATUS", ["netsh.exe","advfirewall","show","allprofiles"], "Read-only status of Domain, Private, and Public firewall profiles.")


def local_network_tool() -> None:
    clear_screen(); print(paint("SCAN / LOCAL NETWORK INFO",CYAN+BOLD))
    try:
        print("Hostname:",socket.gethostname())
        addrs=sorted({entry[4][0] for entry in socket.getaddrinfo(socket.gethostname(),None)})
        print("Addresses:")
        for addr in addrs: print(" -",addr)
    except OSError as exc: print("Could not retrieve host addresses:",exc)
    windows_command_tool_after = False
    if os.name=="nt":
        try:
            r=subprocess.run(["ipconfig"],capture_output=True,text=True,encoding="utf-8",errors="replace",timeout=10)
            print("\nipconfig summary (first 120 lines):\n"+"\n".join(r.stdout.splitlines()[:120]))
        except Exception as exc: print("ipconfig failed:",exc)
    print("Local network information can be private; do not post full output publicly."); pause()


def listening_ports_tool() -> None:
    clear_screen(); print(paint("SCAN / LOCAL LISTENING TCP PORTS",CYAN+BOLD))
    print("Read-only local inventory. It does not probe remote hosts.")
    if os.name!="nt": print("This implementation currently requires Windows netstat."); pause(); return
    try:
        r=subprocess.run(["netstat.exe","-ano","-p","tcp"],capture_output=True,text=True,encoding="utf-8",errors="replace",timeout=10)
        rows=[]
        for line in r.stdout.splitlines():
            parts=line.split()
            if len(parts)>=5 and parts[0].upper()=="TCP" and parts[3].upper()=="LISTENING": rows.append((parts[1],parts[2],parts[4]))
        for local,remote,pid in rows[:100]: print(f"{local:<30} PID {pid}")
        print(f"\nTotal listening TCP sockets shown: {min(len(rows),100)} of {len(rows)}")
        print("To map a PID to an app, use Task Manager; do not terminate unknown system processes.")
    except Exception as exc: print(paint("netstat failed: "+str(exc),YELLOW))
    pause()


def hosts_file_tool() -> None:
    clear_screen(); print(paint("SCAN / WINDOWS HOSTS FILE REVIEW",CYAN+BOLD))
    if os.name!="nt": print("Windows-only option."); pause(); return
    path=Path(os.environ.get("SystemRoot",r"C:\Windows"))/"System32"/"drivers"/"etc"/"hosts"
    try:
        lines=path.read_text(encoding="utf-8",errors="replace").splitlines()
        entries=[line.strip() for line in lines if line.strip() and not line.lstrip().startswith("#")]
        print("Path:",path)
        if entries:
            for line in entries[:100]: print(" ",line)
        else: print("No active non-comment entries found.")
        print("Do not remove entries blindly; management/security software may use legitimate entries.")
    except OSError as exc: print(paint(str(exc),YELLOW))
    pause()


def startup_items_tool() -> None:
    clear_screen(); print(paint("SCAN / STARTUP ENTRY REVIEW",CYAN+BOLD))
    print("Read-only listing of common Run / RunOnce keys. Some entries are normal software.")
    if os.name!="nt": print("Windows-only option."); pause(); return
    try:
        import winreg
        locations=[("HKCU Run",winreg.HKEY_CURRENT_USER,r"Software\Microsoft\Windows\CurrentVersion\Run"),("HKLM Run",winreg.HKEY_LOCAL_MACHINE,r"Software\Microsoft\Windows\CurrentVersion\Run"),("HKCU RunOnce",winreg.HKEY_CURRENT_USER,r"Software\Microsoft\Windows\CurrentVersion\RunOnce"),("HKLM RunOnce",winreg.HKEY_LOCAL_MACHINE,r"Software\Microsoft\Windows\CurrentVersion\RunOnce")]
        count=0
        for label,hive,key in locations:
            print("\n"+label+":")
            try:
                with winreg.OpenKey(hive,key) as reg:
                    i=0
                    while True:
                        try: name,value,_=winreg.EnumValue(reg,i); print(f"  {name}: {str(value)[:350]}"); i+=1; count+=1
                        except OSError: break
            except FileNotFoundError: print("  (not present)")
        if count==0: print("No entries found in these common keys.")
        print("This is not a malware verdict. If unsure, ask a trusted administrator before changing startup entries.")
    except Exception as exc: print(paint("Registry read failed: "+str(exc),YELLOW))
    pause()


def remote_access_process_tool() -> None:
    clear_screen(); print(paint("SCAN / REMOTE-ACCESS APP AWARENESS",CYAN+BOLD))
    print("Checks the local process list for a few common remote-support tools; these may be legitimate if you installed them.")
    if os.name!="nt": print("Windows-only option."); pause(); return
    names=("anydesk","teamviewer","rustdesk","screenconnect","quickassist","remotehelp")
    try:
        r=subprocess.run(["tasklist.exe","/fo","csv","/nh"],capture_output=True,text=True,encoding="utf-8",errors="replace",timeout=10)
        rows=list(csv.reader(io.StringIO(r.stdout)))
        matches=[row[0] for row in rows if row and any(n in row[0].lower() for n in names)]
        print("Matched process names:")
        for name in matches: print(" -",name)
        if not matches: print("No listed process name matched. This does not prove remote-access software is absent.")
        print("If something is unfamiliar, verify with a trusted adult/administrator before uninstalling it.")
    except Exception as exc: print(paint(str(exc),YELLOW))
    pause()


def security_txt_tool() -> None:
    clear_screen(); print(paint("SCAN / SECURITY.TXT CONTACT FILE",CYAN+BOLD))
    print("Fetches only a public text file from the exact domain you enter; redirects are not followed.")
    try:
        _,parsed=normalize_url(input("Domain or URL: ")); host=parsed.hostname or ""
        if parsed.scheme!="https": print(paint("Tip: security.txt is normally requested over HTTPS.",YELLOW))
        for suffix in ("/.well-known/security.txt","/security.txt"):
            url=f"https://{host}{suffix}"
            req=Request(url,headers={"User-Agent":"SCAN-Defensive-Toolkit/2.0"})
            try:
                with no_redirect_opener().open(req,timeout=7) as response:
                    body=response.read(12000).decode("utf-8","replace")
                    print("URL:",url,"Status:",response.status); print(body[:6000]); break
            except HTTPError as exc:
                print(f"{url} -> HTTP {exc.code}")
            except Exception as exc: print(f"Request failed for {url}: {exc}")
    except ValueError as exc: print(paint(str(exc),YELLOW))
    print("Absence of security.txt is common and does not signal phishing."); pause()


def redirect_preview_tool() -> None:
    clear_screen(); print(paint("SCAN / REDIRECT PREVIEW (ONE HOP)",CYAN+BOLD))
    print("Sends a HEAD request to the URL you enter and does not follow redirects or load page content.")
    try:
        raw,parsed=normalize_url(input("URL: "))
        safe_netloc=parsed.netloc.rsplit("@",1)[-1]
        safe_url=urlunsplit((parsed.scheme.lower(),safe_netloc,parsed.path or "/",parsed.query,""))
        req=Request(safe_url,method="HEAD",headers={"User-Agent":"SCAN-Defensive-Check/2.0"})
        try:
            with no_redirect_opener().open(req,timeout=7) as resp: status=resp.status; location=resp.headers.get("Location")
        except HTTPError as exc: status=exc.code; location=exc.headers.get("Location") if exc.headers else None
        print("HTTP status:",status)
        if location:
            print("Redirect target (not followed):",location)
            try:
                next_url=urlsplit(location)
                if next_url.hostname: print("Next host:",next_url.hostname)
            except Exception: pass
        else: print("No Location redirect header was returned.")
        print("Redirects can be legitimate or malicious; inspect the destination before visiting it.")
    except Exception as exc: print(paint("Check failed: "+str(exc),YELLOW))
    pause()


def phone_number_check_tool() -> None:
    """Offline format and scam-context check; does not identify the subscriber or query reputation."""
    clear_screen()
    print(paint("SCAN / PHONE NUMBER CHECK", CYAN + BOLD))
    print("Offline-only check: the number is not sent to a server.")
    print("This can assess format and common number categories, not prove who called or whether it is fraudulent.\n")
    raw = input("Phone number (Korean or international; Enter to cancel): ").strip()
    if not raw:
        return
    # Allow only ordinary phone-number punctuation, digits, and a leading plus sign.
    if not re.fullmatch(r"\+?[0-9\s().-]{5,32}", raw):
        print(paint("Input contains unsupported characters. Paste only the phone number, without a name or message.", YELLOW))
        pause(); return
    compact = re.sub(r"[\s().-]", "", raw)
    if compact.startswith("+"):
        digits = compact[1:]
        international = True
    else:
        digits = compact
        international = False
    if not digits.isdigit() or not (7 <= len(digits) <= 15):
        print(paint("The number length is outside the common international range (7–15 digits). Check it manually.", YELLOW))
        pause(); return

    local = digits
    if international and digits.startswith("82"):
        local = "0" + digits[2:]
    elif not international and digits.startswith("82") and len(digits) >= 10:
        local = "0" + digits[2:]

    normalized = None
    category = "International / unclassified format"
    notes = []
    if local.startswith("010") and len(local) == 11:
        normalized = f"010-{local[3:7]}-{local[7:]}"
        category = "South Korea mobile number format"
    elif re.fullmatch(r"01[16789]\d{7,8}", local):
        normalized = f"{local[:3]}-{local[3:-4]}-{local[-4:]}"
        category = "Legacy South Korea mobile-number format"
        notes.append("Older mobile prefixes can be legitimate; the prefix alone does not prove identity.")
    elif local.startswith("02") and len(local) in (9, 10):
        normalized = f"02-{local[2:-4]}-{local[-4:]}"
        category = "Seoul landline format"
    elif re.fullmatch(r"0[3-6]\d{8,10}", local):
        normalized = f"{local[:3]}-{local[3:-4]}-{local[-4:]}"
        category = "South Korea regional landline format (approximate)"
    elif local.startswith("070") and len(local) == 11:
        normalized = f"070-{local[3:7]}-{local[7:]}"
        category = "Internet telephony format (070)"
        notes.append("070 is not inherently fraudulent; verify the caller through an independent official channel.")
    elif local.startswith("060"):
        category = "060 premium/service-number prefix"
        notes.append("Avoid calling back unless you recognize and trust the service; charges may apply.")
    elif re.fullmatch(r"0(?:80)\d{7,8}", local):
        category = "080 toll-free service-number format (possible)"
    elif re.fullmatch(r"0(?:15|16|18)\d{2,3}\d{4}", local):
        category = "Representative/business service-number pattern (approximate)"
        notes.append("A representative-number prefix does not authenticate the caller.")
    elif international:
        category = "International number format"
        notes.append("Country and subscriber details are not looked up by this offline checker.")

    print("\nResult")
    print("  Input:    ", raw)
    print("  Digits:   ", digits)
    if normalized:
        print("  Format:   ", normalized)
    print("  Category: ", category)
    if notes:
        for item in notes:
            print("  Note:     ", item)
    print("\nSafety signals to consider:")
    print("  - A caller asks for bank transfers, passwords, PINs, or one-time verification codes.")
    print("  - They pressure you to act immediately, install a remote-control app, or keep the call secret.")
    print("  - They give you a number or link to call back instead of letting you contact the institution independently.")
    print("\nThis tool does not check subscriber ownership, caller ID spoofing, or live scam reports.")
    print("Do not trust caller ID alone. End the call and use the bank/agency's official app or number to verify.")
    pause()


def _find_sqlmap_script() -> Path | None:
    root = Path(__file__).resolve().parent
    candidates = [
        root / "tools" / "sqlmap" / "sqlmap.py",
        root / "tools" / "sqlmap-master" / "sqlmap.py",
        root / "sqlmap" / "sqlmap.py",
    ]
    for candidate in candidates:
        if candidate.is_file():
            return candidate
    return None


def _install_sqlmap_from_official_source() -> Path:
    """Download and safely unpack the official sqlmap GitHub source ZIP."""
    import zipfile
    from pathlib import PurePosixPath

    root = Path(__file__).resolve().parent
    tools_dir = root / "tools"
    target = tools_dir / "sqlmap"
    tools_dir.mkdir(parents=True, exist_ok=True)
    archive_url = "https://github.com/sqlmapproject/sqlmap/archive/refs/heads/master.zip"
    print("Downloading the official sqlmap source archive from GitHub...")
    log_event("SQLMAP_DOWNLOAD_START", "INFO", archive_url)
    append_download_detail(f"START sqlmap source archive | {archive_url}")
    request = Request(archive_url, headers={"User-Agent": "SCAN-Rainbow-Defensive-Toolkit/13.0", "Accept": "application/zip, application/octet-stream"})
    downloaded = bytearray()
    last_display = 0.0
    expected_bytes: int | None = None
    with build_opener().open(request, timeout=30) as response:
        raw_size = response.headers.get("Content-Length", "").strip()
        if raw_size.isdigit():
            expected_bytes = int(raw_size)
        while len(downloaded) <= 30_000_000:
            chunk = response.read(min(64 * 1024, 30_000_001 - len(downloaded)))
            if not chunk:
                break
            downloaded.extend(chunk)
            now = time.monotonic()
            if now - last_display >= 0.2 or (expected_bytes and len(downloaded) >= expected_bytes):
                bar_width = 28
                if expected_bytes and expected_bytes > 0:
                    percent = min(100, int(len(downloaded) * 100 / expected_bytes))
                    filled = int(bar_width * percent / 100)
                    label = f"{percent:3d}%"
                else:
                    filled = int(bar_width * min(len(downloaded) / 30_000_000, 1.0))
                    label = "size unknown"
                bar = "#" * filled + "." * (bar_width - filled)
                size_label = _mib(len(downloaded))
                if expected_bytes:
                    size_label += f" / {_mib(expected_bytes)}"
                sys.stdout.write(f"\rsqlmap source download [{bar}] {label} | {size_label}   ")
                sys.stdout.flush()
                last_display = now
    data = bytes(downloaded)
    print()
    if len(data) > 30_000_000:
        append_download_csv("sqlmap source archive", "sqlmapproject/sqlmap", "SOURCE_DOWNLOAD", "FAILED_SIZE_LIMIT", len(data), len(data), "", "Exceeded 30 MB safety limit.")
        log_event("SQLMAP_DOWNLOAD_FAILED", "WARN", "archive exceeded 30 MB safety limit")
        raise RuntimeError("Downloaded archive exceeded 30 MB safety limit.")
    archive = io.BytesIO(data)
    with zipfile.ZipFile(archive) as zf:
        members = zf.namelist()
        root_prefix = None
        for member in members:
            parts = PurePosixPath(member).parts
            if len(parts) == 2 and parts[-1] == "sqlmap.py":
                root_prefix = parts[0] + "/"
                break
        if not root_prefix:
            raise RuntimeError("Official ZIP did not contain the expected sqlmap.py at its root.")
        selected = [name for name in members if name.startswith(root_prefix) and not name.endswith("/")]
        if len(selected) > 2500:
            raise RuntimeError("Unexpectedly large file count in the sqlmap source archive.")
        if target.exists():
            shutil.rmtree(target)
        target.mkdir(parents=True, exist_ok=True)
        total_bytes = 0
        for member in selected:
            relative = PurePosixPath(member[len(root_prefix):])
            if not relative.parts or any(part in ("..", "") for part in relative.parts):
                continue
            # Skip symbolic links: only write regular source/archive files.
            info = zf.getinfo(member)
            unix_mode = (info.external_attr >> 16) & 0xFFFF
            if (unix_mode & 0o170000) == 0o120000:
                continue
            total_bytes += info.file_size
            if total_bytes > 30_000_000:
                raise RuntimeError("Unpacked source exceeded 30 MB safety limit.")
            destination = target.joinpath(*relative.parts)
            if not destination.resolve().is_relative_to(target.resolve()):
                raise RuntimeError("Unsafe path found in the downloaded archive.")
            destination.parent.mkdir(parents=True, exist_ok=True)
            with zf.open(member, "r") as src_file, destination.open("wb") as dst_file:
                shutil.copyfileobj(src_file, dst_file)
    script = target / "sqlmap.py"
    if not script.is_file():
        raise RuntimeError("Download completed but tools\\sqlmap\\sqlmap.py was not created.")
    # Mark the download successful only after the ZIP was safely checked and extracted.
    append_download_csv("sqlmap source archive", "sqlmapproject/sqlmap", "SOURCE_DOWNLOAD", "SUCCESS", len(data), len(data), "official GitHub ZIP; extracted", archive_url)
    append_download_detail(f"FILE sqlmap source archive | {len(data):,} bytes | {_mib(len(data))} | validated/extracted from {archive_url}")
    log_event("SQLMAP_DOWNLOAD_SUCCESS", "OK", f"bytes={len(data)} | {_mib(len(data))}; extraction validated")
    return script


def _sqlmap_python_candidates() -> list[str]:
    """Prefer a common stable interpreter if installed, then fall back to SCAN's Python."""
    candidates: list[str] = []
    launcher = (shutil.which("py.exe") or shutil.which("py")) if os.name == "nt" else None
    if launcher:
        for version in ("3.12", "3.13", "3.14", "3.11"):
            try:
                probe = subprocess.run([launcher, f"-{version}", "-c", "import sys; print(sys.executable)"],
                                       capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=3)
                candidate = (probe.stdout or "").strip().splitlines()
                if probe.returncode == 0 and candidate and Path(candidate[-1]).is_file():
                    resolved = str(Path(candidate[-1]).resolve())
                    if resolved not in candidates:
                        candidates.append(resolved)
            except (OSError, subprocess.SubprocessError):
                continue
    if os.name == "nt":
        # Also search standard per-user/system install folders if the Python launcher is missing.
        candidate_paths: list[Path] = []
        local_app_data = os.environ.get("LOCALAPPDATA")
        program_files = os.environ.get("ProgramFiles")
        program_files_x86 = os.environ.get("ProgramFiles(x86)")
        for base in (local_app_data, program_files, program_files_x86):
            if base:
                for folder in ("Python312", "Python313", "Python314", "Python311"):
                    candidate_paths.append(Path(base) / "Programs" / "Python" / folder / "python.exe")
                    candidate_paths.append(Path(base) / folder / "python.exe")
        for path in candidate_paths:
            if path.is_file():
                try:
                    resolved = str(path.resolve())
                except OSError:
                    resolved = str(path)
                if resolved not in candidates:
                    candidates.append(resolved)
    for candidate in (sys.executable, shutil.which("python.exe"), shutil.which("python")):
        if candidate and Path(candidate).is_file():
            try:
                resolved = str(Path(candidate).resolve())
            except OSError:
                resolved = str(candidate)
            if resolved not in candidates:
                candidates.append(resolved)
    return candidates or [sys.executable]


def _sqlmap_diag(message: str) -> None:
    try:
        ensure_log_files()
        SQLMAP_DIAG_LOG.parent.mkdir(parents=True, exist_ok=True)
        with SQLMAP_DIAG_LOG.open("a", encoding="utf-8") as handle:
            handle.write(f"[{datetime.now().astimezone().isoformat(timespec='seconds')}] {message.replace(chr(10), ' ')[:1500]}\n")
    except OSError:
        pass


def _test_sqlmap(script: Path) -> tuple[bool, str]:
    global _SQLMAP_VERIFIED_PYTHON
    _SQLMAP_VERIFIED_PYTHON = None
    failures: list[str] = []
    if not script.is_file():
        message = f"sqlmap script missing: {script}"
        _sqlmap_diag(message)
        return False, message
    candidates = _sqlmap_python_candidates()
    _sqlmap_diag(f"SELFTEST_START script={script}; candidates={candidates}; preferred_timeout=60s")
    for interpreter in candidates:
        started = time.monotonic()
        try:
            result = subprocess.run([interpreter, "-u", str(script), "--version"],
                                    cwd=str(script.parent), capture_output=True, text=True,
                                    encoding="utf-8", errors="replace", timeout=60)
            elapsed = time.monotonic() - started
            output = ((result.stdout or "") + "\n" + (result.stderr or "")).strip()
            _sqlmap_diag(f"SELFTEST_RESULT interpreter={interpreter}; exit={result.returncode}; seconds={elapsed:.2f}; output={output[:900]!r}")
            if result.returncode == 0 and output:
                _SQLMAP_VERIFIED_PYTHON = interpreter
                log_event("SQLMAP_SELFTEST", "OK", f"interpreter={interpreter}; seconds={elapsed:.2f}; {output.splitlines()[0][:150]}")
                return True, f"{output.splitlines()[0][:140]} | Python={Path(interpreter).name} | {elapsed:.1f}s"
            failures.append(f"{Path(interpreter).name}: exit {result.returncode}; {(output or 'no output')[:180]}")
        except subprocess.TimeoutExpired as exc:
            partial = ""
            for value in (exc.stdout, exc.stderr):
                if value:
                    if isinstance(value, bytes):
                        value = value.decode("utf-8", "replace")
                    partial += str(value) + " "
            failures.append(f"{Path(interpreter).name}: timeout after 60s; output={partial[:140]}")
            _sqlmap_diag(f"SELFTEST_TIMEOUT interpreter={interpreter}; seconds=60; partial={partial[:900]!r}")
        except (OSError, subprocess.SubprocessError) as exc:
            failures.append(f"{Path(interpreter).name}: {type(exc).__name__}: {exc}")
            _sqlmap_diag(f"SELFTEST_EXCEPTION interpreter={interpreter}; {type(exc).__name__}: {exc}")
    summary = " | ".join(failures[:4]) or "No usable Python interpreter was found."
    _sqlmap_diag(f"SELFTEST_FAILED script={script}; {summary}")
    log_event("SQLMAP_SELFTEST", "ERROR", summary)
    return False, summary[:600]


def tool_status_tool() -> None:
    clear_screen(); print(paint("SCAN / INSTALLED TOOL STATUS", CYAN + BOLD))
    for name, command in (("Python", [sys.executable, "--version"]), ("Nmap", ["nmap", "--version"])):
        print("\n" + name + ":")
        try:
            result = subprocess.run(command, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=8)
            lines = (result.stdout + "\n" + result.stderr).strip().splitlines()
            if result.returncode == 0: print("  " + (lines[0] if lines else "installed"))
            else: print("  version check failed: " + (lines[0] if lines else str(result.returncode)))
        except Exception as exc:
            print("  not detected:", str(exc)[:180])
    print("\nsqlmap:")
    script = _find_sqlmap_script()
    if not script:
        print("  Not installed in this SCAN folder.")
        print("  Run menu 28; it can download the official source and test it with several installed Python interpreters.")
        print("  Self-test details are saved to Logs\\sqlmap_diagnostics.log.")
    else:
        ok, detail = _test_sqlmap(script)
        print("  Path:", script)
        print("  Self-test:", "PASS - " + detail if ok else "FAIL - " + detail)
    print("\nMenu 33 opens the 16-app install center; menus 35-48 run integrated multi-tool workflows and menu 46-60 add local diagnostic utilities.")
    pause()


def sqlmap_local_lab_tool() -> None:
    clear_screen(); print(paint("SCAN / SQLMAP — LOCAL LAB ONLY", CYAN + BOLD))
    print(paint("Safety lock: this launcher only accepts localhost / 127.0.0.1 / ::1.", YELLOW + BOLD))
    print("Use only an intentionally vulnerable training app that you have started on this same computer.")
    print("Public websites and other devices on your network are blocked by this launcher.")
    script = _find_sqlmap_script()
    if not script:
        print("\nsqlmap source is missing from this SCAN folder.")
        answer = input("Download official sqlmap source from GitHub now? [Y/n]: ").strip().lower()
        if answer not in ("", "y", "yes"):
            print("Cancelled."); pause(); return
        try:
            script = _install_sqlmap_from_official_source()
            print("Source downloaded to:", script)
        except Exception as exc:
            detail = f"{type(exc).__name__}: {exc}"
            print(paint("Automatic installation failed: " + detail, RED))
            print(r"Check Logs\downloads.log and Logs\sqlmap_diagnostics.log for details.")
            print("Official source: https://github.com/sqlmapproject/sqlmap")
            print("No test against any URL was run.")
            append_download_detail(f"FAILED sqlmap source preparation | {detail}")
            append_download_csv("sqlmap source archive", "sqlmapproject/sqlmap", "SOURCE_DOWNLOAD", "FAILED", None, None, "", detail)
            log_event("SQLMAP_DOWNLOAD_FAILED", "ERROR", detail)
            pause(); return
    ok, detail = _test_sqlmap(script)
    if not ok:
        print(paint("sqlmap self-test failed:", RED + BOLD), detail)
        print("This does NOT automatically mean the source download was corrupt.")
        print(r"Review Logs\sqlmap_diagnostics.log; each Python path, exit code, output, and timeout is recorded.")
        print("If Python 3.12 is not installed, install it from the official package page using menu 33, then retry.")
        print("Do not re-download the same source unless the diagnostic log shows archive/extraction errors.")
        pause(); return
    print("Self-test passed:", detail)
    print("\nLocal training URL (example: http://127.0.0.1:8080/vuln.php?id=1)")
    raw = input("Local lab URL: ").strip()
    try:
        normalized, parsed = normalize_url(raw)
    except ValueError as exc:
        print(paint(str(exc), YELLOW)); pause(); return
    host = (parsed.hostname or "").lower().strip("[]").rstrip(".")
    allowed = host == "localhost"
    try:
        allowed = allowed or ipaddress.ip_address(host).is_loopback
    except ValueError:
        pass
    if not allowed:
        print(paint("BLOCKED: only localhost or a loopback IP is allowed.", RED + BOLD)); pause(); return
    if parsed.username or parsed.password:
        print(paint("For safety, do not put login credentials in the URL.", YELLOW)); pause(); return
    if input("Type LOCAL-LAB to confirm you own the local training app: ").strip() != "LOCAL-LAB":
        print("Cancelled."); pause(); return
    command = [_SQLMAP_VERIFIED_PYTHON or sys.executable, str(script), "-u", normalized, "--batch", "--risk=1", "--level=1",
               "--threads=1", "--timeout=5", "--retries=0", "--ignore-redirects"]
    print("Running a basic, low-setting check against loopback only. Press Ctrl+C to stop.")
    try:
        result = subprocess.run(command, timeout=120)
        print("\nsqlmap exit code:", result.returncode)
        if result.returncode != 0:
            print("Nonzero exit codes can indicate an unreachable local app, malformed test URL, or Python/runtime issue.")
    except subprocess.TimeoutExpired:
        print(paint("Timed out after 120 seconds.", YELLOW))
    except KeyboardInterrupt:
        print("\nCancelled by user.")
    except OSError as exc:
        print(paint("Could not start sqlmap: " + str(exc), RED))
    pause()

def external_tool_manager() -> None:
    clear_screen(); print(paint("SCAN / CURATED TOOL CENTER", CYAN + BOLD))
    print("Only tools relevant to SCAN workflows are listed. Select a vendor page; this does not install anything.")
    for number, (name, _package_id, description, url) in EXTERNAL_TOOL_CATALOG.items():
        print(f"  [{number:02d}] {name:<20} | {description}")
    print("  [0] Return")
    choice = input("Open official page [1-16 / 0]: ").strip()
    if not choice.isdigit() or int(choice) == 0: return
    number = int(choice)
    if number not in EXTERNAL_TOOL_CATALOG:
        print("Invalid choice."); pause(); return
    name, _package_id, _description, url = EXTERNAL_TOOL_CATALOG[number]
    print("Opening:", name, url)
    try: webbrowser.open(url)
    except Exception: pass
    print("Install only if you need this tool; integrated workflows skip unavailable tools and report why.")
    pause()

def tool_install_center(initial_selected: list[int] | None = None, initial_action: str | None = None) -> None:
    """Install, update installed apps, or download packages chosen at startup or in this menu."""
    ensure_log_files()
    clear_screen()
    print(paint("SCAN / TOOL DOWNLOAD + INSTALL CENTER — 16 CURATED APPS (v20)", CYAN + BOLD))
    print("Menu catalogue: 60 built-in actions + 16 optional apps. Workflow sets are displayed in a separate section.")
    print("Startup no longer downloads optional packages automatically. Choose only what you need.")
    print("Download mode saves installers only; it does NOT install or unlock their menu entries.")
    print("Install mode delegates to WinGet and leaves publisher/licence/UAC prompts visible.")
    print("All download records and live output are written to Logs/downloads.log and Logs/downloads.csv.")
    print()
    try:
        check = subprocess.run(["winget", "--version"], capture_output=True, text=True,
                               encoding="utf-8", errors="replace", timeout=15)
    except FileNotFoundError:
        print(paint("WinGet was not found on this computer.", YELLOW + BOLD))
        print("Official Microsoft install page: https://aka.ms/getwinget")
        if input("Open the official Microsoft page? [Y/n]: ").strip().lower() not in ("n", "no"):
            try:
                webbrowser.open("https://aka.ms/getwinget")
            except Exception:
                pass
        pause()
        return
    except (OSError, subprocess.SubprocessError) as exc:
        print(paint("Could not check WinGet: " + str(exc), YELLOW))
        pause()
        return
    if check.returncode != 0:
        print(paint("WinGet is present but did not run successfully.", YELLOW + BOLD))
        print((check.stderr or check.stdout or "No version information returned.").strip()[:500])
        pause()
        return

    version = (check.stdout or check.stderr).strip().splitlines()
    print("WinGet:", version[0] if version else "available")
    print()
    for number, (name, package_id, description, _url) in EXTERNAL_TOOL_CATALOG.items():
        _exe, status = external_tool_status(number)
        status_label = "INSTALLED" if status == "INSTALLED" else status
        colour = GREEN if status == "INSTALLED" else DIM
        print(paint(f" [{number:02d}] {name:<20} | {description} [{status_label}]", colour))
        print(f"      WinGet ID: {package_id}")
    print("\n [A] Select all 16 curated packages")
    print(" [O] Open official vendor pages")
    print(" [0] Return")
    if initial_selected:
        selected = list(dict.fromkeys(number for number in initial_selected if number in EXTERNAL_TOOL_CATALOG))
        print(paint("\nPreselected before any download:", CYAN + BOLD))
        print("  " + ", ".join(f"{n:02d} {EXTERNAL_TOOL_CATALOG[n][0]}" for n in selected))
    else:
        raw = input("\nSelect catalog numbers/ranges e.g. 1,4,9-11 (or A/O/0): ").strip().lower()
        if raw in ("0", "q", "back"):
            show_download_warning("선택을 취소했습니다. 어떤 도구도 다운로드/설치하지 않았습니다.")
            pause()
            return
        if raw == "o":
            for number, (name, _package_id, _desc, url) in EXTERNAL_TOOL_CATALOG.items():
                print(f" [{number:02d}] {name:<20} {url}")
            page_choice = input("Open one official page by number (0 to return): ").strip()
            if page_choice.isdigit() and int(page_choice) in EXTERNAL_TOOL_CATALOG:
                try:
                    webbrowser.open(EXTERNAL_TOOL_CATALOG[int(page_choice)][3])
                except Exception:
                    pass
            pause()
            return
        if raw in ("a", "all"):
            selected = list(EXTERNAL_TOOL_CATALOG.keys())
        else:
            selected = []
            try:
                for token in raw.split(","):
                    token = token.strip()
                    if not token:
                        continue
                    if "-" in token:
                        pieces = token.split("-", 1)
                        if len(pieces) != 2:
                            raise ValueError(f"Invalid range: {token}")
                        start_num, end_num = int(pieces[0]), int(pieces[1])
                        if start_num > end_num:
                            start_num, end_num = end_num, start_num
                        values = list(range(start_num, end_num + 1))
                    else:
                        values = [int(token)]
                    for number in values:
                        if number not in EXTERNAL_TOOL_CATALOG:
                            raise ValueError(f"{number} is not a valid package number; valid range is 1-16.")
                        if number not in selected:
                            selected.append(number)
            except ValueError as exc:
                print(paint("Invalid selection: " + str(exc), YELLOW))
                show_download_warning("선택 번호가 잘못되어 다운로드를 시작하지 않았습니다.")
                pause()
                return
    if not selected:
        show_download_warning("선택된 도구가 없습니다. 선택 도구는 다운로드되지 않으며 메뉴에 잠금 상태로 남습니다.")
        pause()
        return
    print("\nSelected packages:")
    for number in selected:
        name, package_id, _description, _url = EXTERNAL_TOOL_CATALOG[number]
        print(f"  [{number:02d}] {name} ({package_id})")
    print("\nChoose an action:")
    if len(selected) >= 20:
        print(paint(f"WARNING: You selected {len(selected)} applications. This can require multiple GB of downloads and considerable time. It is okay to cancel and install smaller groups.", YELLOW + BOLD))
    print("  [I] INSTALL selected missing applications via WinGet")
    print("  [U] UPDATE selected applications that are already installed")
    print("  [D] DOWNLOAD installer files only — does not install or unlock the menu")
    print("  [0] Cancel")
    print(paint("  참고: I는 실제 설치, D는 파일만 저장합니다. D로는 메뉴 잠금이 풀리지 않습니다.", YELLOW))
    if initial_action in ("i", "d") and initial_selected:
        action = initial_action
        print(paint(f"\nStartup selection retained: {action.upper()} selected before the first download.", CYAN + BOLD))
    else:
        action = input("Action [I/U/D/0]: ").strip().lower()
    if action in ("0", "q", "cancel", ""):
        print("Cancelled. No package action was started.")
        show_download_warning("취소됨: 다운로드/설치가 시작되지 않았습니다. 선택 도구는 설치 전까지 잠겨 있습니다.")
        pause()
        return
    if action not in ("d", "i", "u"):
        print("Invalid action.")
        show_download_warning("잘못된 선택입니다. 다운로드/설치를 시작하지 않았습니다.")
        pause()
        return

    # Installing should never re-run installers for tools SCAN already detects.
    # Updating is a separate, explicit action and only targets currently installed apps.
    if action in ("i", "u"):
        detected_states = {number: external_tool_status(number)[1] for number in selected}
        if action == "i":
            skipped = [number for number in selected if detected_states[number] == "INSTALLED"]
            selected = [number for number in selected if detected_states[number] != "INSTALLED"]
            if skipped:
                print(paint("\nAlready installed — skipping these apps:", GREEN + BOLD))
                for number in skipped:
                    print(f"  [SKIP] {EXTERNAL_TOOL_CATALOG[number][0]}")
        else:
            skipped = [number for number in selected if detected_states[number] != "INSTALLED"]
            selected = [number for number in selected if detected_states[number] == "INSTALLED"]
            if skipped:
                print(paint("\nNot detected as installed — excluding from update:", YELLOW + BOLD))
                for number in skipped:
                    print(f"  [SKIP] {EXTERNAL_TOOL_CATALOG[number][0]}")
        if not selected:
            if action == "i":
                print(paint("\nEvery selected application is already installed. Use U to check for updates.", GREEN + BOLD))
            else:
                print(paint("\nNo selected application was detected as installed. Nothing will be upgraded.", YELLOW + BOLD))
            pause()
            return
        print("\nPackages that will be processed:")
        for number in selected:
            print(f"  [{number:02d}] {EXTERNAL_TOOL_CATALOG[number][0]}")

    action_name = "DOWNLOAD_ONLY" if action == "d" else ("UPDATE" if action == "u" else "INSTALL")
    print("\nThe source package license is not auto-accepted. If WinGet asks for agreement, read it and respond in the console.")
    print("The progress bar tracks completed package tasks. Exact file sizes are measured in download-only mode.")
    skip_existing = False
    if action == "d":
        skip_existing = input("Skip download folders that already contain saved files? [Y/n]: ").strip().lower() not in ("n", "no")
        if skip_existing:
            print("Existing folders will be reused as-is; this may reuse an older version. Delete a package folder to force a fresh download.")
    confirmation_phrase = action_name if len(selected) < 20 else f"{action_name} {len(selected)}"
    if input(f"Type {confirmation_phrase} to begin for {len(selected)} package(s): ").strip().upper() != confirmation_phrase:
        print("Cancelled. No package action was started.")
        show_download_warning("확인 문구가 일치하지 않아 작업을 취소했습니다. 다운로드/설치를 시작하지 않았습니다.")
        pause()
        return

    outcomes: list[tuple[str, bool, str]] = []
    completed = 0
    packages_root = APP_ROOT / "downloads" / "packages"
    packages_root.mkdir(parents=True, exist_ok=True)
    for index, number in enumerate(selected, 1):
        name, package_id, _description, _url = EXTERNAL_TOOL_CATALOG[number]
        slug = re.sub(r"[^A-Za-z0-9._-]+", "_", package_id)
        package_folder = packages_root / slug
        package_folder.mkdir(parents=True, exist_ok=True)
        before = _directory_snapshot(package_folder)
        before_total = sum(size for size, _mtime in before.values())
        if action == "d" and skip_existing and before_total > 0:
            total_bytes = before_total
            details = f"Reused existing files; no network transfer started; destination={package_folder}"
            append_download_detail(f"CACHE REUSE {name} | existing files={len(before)} | total={_mib(total_bytes)} | {package_folder}")
            append_download_csv(name, package_id, "DOWNLOAD_ONLY", "CACHED", 0, total_bytes,
                                "; ".join(sorted(before.keys())[:25]), details)
            outcomes.append((name, True, f"CACHED; reused {_mib(total_bytes)} without downloading"))
            log_event("PACKAGE_DOWNLOAD_CACHE_REUSE", "OK", f"{name} | total={total_bytes} bytes | {package_folder}")
            completed += 1
            print("\n" + paint(f"[{index}/{len(selected)}] {name}: CACHED (network skipped)", GREEN))
            print(f"  Existing saved files: {_mib(total_bytes)} | File count: {len(before)}")
            print(f"  Destination: {package_folder}")
            continue
        if action == "d":
            command = ["winget", "download", "--id", package_id, "--source", "winget",
                       "--download-directory", str(package_folder), "--verbose-logs"]
            rc, output_lines = _run_winget_dashboard(command, "DOWNLOAD ONLY", name, index, len(selected), completed, package_folder)
            after = _directory_snapshot(package_folder)
            total_bytes = sum(size for size, _mtime in after.values())
            new_bytes = sum(size for rel, (size, mtime) in after.items() if rel not in before or before[rel] != (size, mtime))
            changed_files = [rel for rel, value in after.items() if rel not in before or before[rel] != value]
            all_files = sorted(after.items())
            for relative, (size, _mtime) in all_files:
                append_download_detail(f"FILE {name} | {package_id} | {relative} | {size:,} bytes | {_mib(size)}")
            if rc == 0 and total_bytes > 0:
                status = "SUCCESS" if new_bytes > 0 else "CACHED"
                details = f"Saved files={len(after)}; changed/new={len(changed_files)}; destination={package_folder}"
                outcomes.append((name, True, f"{status}; new/changed {_mib(new_bytes)}, total saved {_mib(total_bytes)}"))
            else:
                status = "FAILED"
                details = f"WinGet exit={rc}; no saved files or download failed; destination={package_folder}"
                outcomes.append((name, False, f"Download failed (exit {rc}); see Logs/downloads.log"))
            append_download_csv(name, package_id, "DOWNLOAD_ONLY", status, new_bytes, total_bytes,
                                "; ".join(changed_files[:25]), details)
            log_event("PACKAGE_DOWNLOAD", status, f"{name} | changed={new_bytes} bytes | total={total_bytes} bytes | {package_folder}")
            completed += 1
            print("\n" + paint(f"[{index}/{len(selected)}] {name}: {status}", GREEN if status in ("SUCCESS", "CACHED") else YELLOW))
            print(f"  New/changed files: {_mib(new_bytes)} | Total saved: {_mib(total_bytes)} | File count: {len(after)}")
            print(f"  Destination: {package_folder}")
        else:
            action_label = "UPDATE" if action == "u" else "INSTALL"
            log_action = "UPDATE" if action == "u" else "INSTALL"
            log_stem = "winget_update" if action == "u" else "winget_install"
            install_log = LOG_DIR / f"{log_stem}_{slug}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.log"
            verb = "upgrade" if action == "u" else "install"
            command = ["winget", verb, "--id", package_id, "--exact", "--source", "winget",
                       "--verbose-logs", "--log", str(install_log)]
            rc, output_lines = _run_winget_dashboard(command, action_label, name, index, len(selected), completed, None)
            after = _directory_snapshot(package_folder)
            total_bytes = sum(size for size, _mtime in after.values())
            confirmed = winget_confirms_installed(package_id, force=True)
            exe_after = find_installed_external_tool(number) is not None
            registry_after = _registry_confirms_installed(number, force=True)
            if action == "u":
                still_installed = confirmed or exe_after or registry_after
                if rc == 0 and still_installed:
                    status = "UPDATED_OR_CURRENT"
                    okay = True
                    detail_status = "WinGet upgrade completed; installed state confirmed (a newer version may not have been available)"
                elif rc == 0:
                    status = "UPDATE_EXIT_0_PENDING_REFRESH"
                    okay = True
                    detail_status = "WinGet reported success; installed inventory may need refresh"
                else:
                    status = "UPDATE_FAILED_INSTALLED_REMAINS" if still_installed else "UPDATE_FAILED"
                    okay = False
                    detail_status = f"WinGet upgrade exit={rc}; installed state remains={still_installed}"
            elif confirmed or exe_after or registry_after:
                status = "INSTALLED_CONFIRMED"
                okay = True
                detail_status = "installed state confirmed by WinGet, executable path, or Windows uninstall registry"
                _save_install_state(package_id, "verified", detail_status)
            elif rc == 0:
                status = "INSTALLED_PENDING_REFRESH"
                okay = True
                detail_status = "WinGet reported success; saved as installed pending inventory refresh"
                _save_install_state(package_id, "install_exit_0_pending_inventory", detail_status)
            else:
                status = "FAILED"
                okay = False
                detail_status = f"WinGet exit={rc}; package not confirmed in installed inventory"
                _remove_install_state(package_id)
            details = f"WinGet {verb} exit={rc}; confirmation={detail_status}; log={install_log}; installer transfer size is not reliably exposed in {action_label.lower()} mode"
            outcomes.append((name, okay, f"{status}; {detail_status}; log={install_log.name}"))
            append_download_csv(name, package_id, log_action, status, None, total_bytes if total_bytes else None,
                                "", details)
            log_event(f"PACKAGE_{log_action}", status, f"{name} | exit={rc} | confirmed={confirmed} | {install_log}")
            completed += 1
            install_success = okay
            print("\n" + paint(f"[{index}/{len(selected)}] {name}: {status}", GREEN if install_success else YELLOW))
            if confirmed or exe_after or registry_after:
                inventory_label = "CONFIRMED"
            elif rc == 0:
                inventory_label = "PENDING REFRESH — WinGet reported success"
            else:
                inventory_label = "NOT CONFIRMED — review the log"
            print(f"  Installed-state check: {inventory_label}")
            print(f"  Menu availability: {'INSTALLED' if install_success else 'LOCKED — install not confirmed'}")
            print(f"  Exact download MB: WinGet {action_label.lower()} mode does not reliably report it; choose D mode for measured saved file sizes.")
            print(f"  Operation log: {install_log}")

    print("\n" + paint("TRANSFER / INSTALL SUMMARY", CYAN + BOLD))
    for name, succeeded, details in outcomes:
        print(f" [{'OK' if succeeded else 'CHECK'}] {name}: {details}")
    print(f"\nDetailed output: {DOWNLOAD_LOG}")
    print(f"CSV inventory:   {DOWNLOAD_CSV}")
    if action == "d":
        show_download_warning("다운로드 완료는 설치 완료가 아닙니다. 실제 사용하려면 메뉴 33에서 I(설치)를 선택해야 합니다.")
        print("Downloaded installer files remain locked until installed.")
    elif action == "u":
        print("\nUpdate check finished. Success means WinGet completed and the package remains detectable.")
        print("Review each package result and its operation log above.")
    else:
        print("\nInstalled status is checked with executable paths and WinGet's package inventory.")
        print("If a tool was installed outside SCAN, press R on the final page to refresh its status.")
    log_event("TOOL_CENTER_FINISH", "INFO", f"action={action_name}; selected={len(selected)}; completed={len(outcomes)}")
    pause()


def _consume_pending_tool_selection() -> list[int] | None:
    """Consume the package choices recorded by consent.ps1 before bootstrap downloads."""
    pending = LOG_DIR / "pending_tool_selection.txt"
    if not pending.exists():
        return None
    try:
        raw = pending.read_text(encoding="utf-8-sig").strip()
    except OSError as exc:
        log_event("PENDING_SELECTION_READ_FAILED", "WARN", str(exc))
        return None
    try:
        pending.unlink(missing_ok=True)
    except OSError:
        pass
    if raw.upper() == "NONE":
        return []
    if not raw:
        return None
    numbers: list[int] = []
    for token in raw.split(","):
        token = token.strip()
        try:
            if "-" in token:
                left, right = (int(part.strip()) for part in token.split("-", 1))
                if left > right:
                    left, right = right, left
                candidates = range(left, right + 1)
            else:
                candidates = (int(token),)
            for number in candidates:
                if number in EXTERNAL_TOOL_CATALOG and number not in numbers:
                    numbers.append(number)
        except (ValueError, TypeError):
            continue
    return numbers or None


def _consume_pending_tool_action() -> str | None:
    """Consume the explicit I/D choice made on the consent screen."""
    pending = LOG_DIR / "pending_tool_action.txt"
    if not pending.exists():
        return None
    try:
        raw = pending.read_text(encoding="utf-8-sig").strip().lower()
    except OSError as exc:
        log_event("PENDING_ACTION_READ_FAILED", "WARN", str(exc))
        return None
    try:
        pending.unlink(missing_ok=True)
    except OSError:
        pass
    if raw in ("i", "d", "u"):
        return raw
    log_event("PENDING_ACTION_INVALID", "WARN", f"invalid startup action: {raw!r}")
    return None


def main() -> None:
    ensure_log_files()
    log_event("SCAN_START", "INFO", f"version=v20; total_catalog_entries=76; root={APP_ROOT}")
    core_actions = {
        "01": auto_site_audit_set, "02": nmap_scan, "03": dns_lookup_tool,
        "04": http_headers_tool, "05": message_analyzer, "06": file_hash_tool,
        "07": defang_url_tool, "08": tls_certificate_tool, "09": incident_response_tool,
        "10": rdap_domain_tool, "11": dns_txt_policy_tool, "12": dns_mx_tool,
        "13": email_header_tool, "14": decode_text_tool, "15": file_extension_tool,
        "16": file_signature_tool, "17": hash_compare_tool, "18": defender_status_tool,
        "19": firewall_status_tool, "20": local_network_tool, "21": listening_ports_tool,
        "22": hosts_file_tool, "23": startup_items_tool, "24": remote_access_process_tool,
        "25": security_txt_tool, "26": redirect_preview_tool, "27": tool_status_tool,
        "28": sqlmap_local_lab_tool, "29": password_phrase_check, "30": external_tool_manager,
        "31": phone_number_check_tool, "32": domain_intelligence_tool, "33": tool_install_center,
        "34": deep_file_analysis_tool, "35": project_security_audit_tool,
        "36": local_file_tool_scan, "37": tls_http_cli_crosscheck_tool,
        "38": git_repository_readiness_tool, "39": sysinternals_autoruns_review_tool,
        "40": docker_local_image_audit_tool, "41": source_code_quality_tool,
        "42": integrated_tool_doctor, "43": tshark_capture_review_tool,
        "44": windows_host_health_snapshot, "45": sbom_inventory_tool,
        "46": local_windows_baseline_set, "47": project_release_readiness_set,
        "48": file_triage_set, "49": duplicate_file_finder, "50": large_file_inventory,
        "51": json_validator_tool, "52": xml_validator_tool, "53": csv_structure_tool,
        "54": file_entropy_tool, "55": pem_certificate_inspector,
        "56": windows_event_log_summary, "57": scheduled_task_inventory,
        "58": secret_name_hygiene_check, "59": ipv4_subnet_calculator,
        "60": scan_log_analyzer,
    }
    core_menu = [
        ("01", "AUTO SITE AUDIT SET"), ("02", "NMAP LOCAL SCAN"), ("03", "DNS / IP LOOKUP"),
        ("04", "HTTP SECURITY HEADERS"), ("05", "MESSAGE PHISHING CHECK"), ("06", "FILE SHA-256"),
        ("07", "DEFANG URL"), ("08", "TLS CERTIFICATE"), ("09", "INCIDENT RESPONSE"),
        ("10", "DOMAIN RDAP"), ("11", "SPF / DMARC TXT"), ("12", "MX RECORD CHECK"),
        ("13", "EMAIL HEADER REVIEW"), ("14", "TEXT DECODER"), ("15", "FILE NAME RISK"),
        ("16", "FILE SIGNATURE"), ("17", "HASH COMPARE"), ("18", "DEFENDER STATUS"),
        ("19", "FIREWALL STATUS"), ("20", "LOCAL NETWORK INFO"), ("21", "LISTENING PORTS"),
        ("22", "HOSTS FILE REVIEW"), ("23", "STARTUP ENTRY REVIEW"), ("24", "REMOTE-ACCESS REVIEW"),
        ("25", "SECURITY.TXT"), ("26", "REDIRECT PREVIEW"), ("27", "TOOL STATUS"),
        ("28", "SQLMAP LOCAL LAB"), ("29", "PASSWORD QUALITY"), ("30", "OFFICIAL TOOL CENTER"),
        ("31", "PHONE NUMBER CHECK"), ("32", "DOMAIN INTEL + PRICE"),
        ("33", "TOOL DOWNLOAD / INSTALL"), ("34", "DEEP ANALYSIS CENTER"),
        ("35", "PROJECT SECURITY AUDIT — GITLEAKS/TRIVY/GIT"),
        ("36", "LOCAL FILE SCAN — CLAMAV/SIGCHECK/7-ZIP"),
        ("37", "TLS + HTTP CROSS-CHECK — CURL/OPENSSL"),
        ("38", "GIT REPOSITORY READINESS — GIT/GITLEAKS/GH"),
        ("39", "SYSINTERNALS AUTORUNS REVIEW"),
        ("40", "LOCAL DOCKER IMAGE AUDIT — TRIVY"),
        ("41", "SOURCE CODE QUALITY — RUFF/NODE"),
        ("42", "TOOL INTEGRATION DOCTOR"),
        ("43", "LOCAL PCAP REVIEW — TSHARK"),
        ("44", "WINDOWS HOST HEALTH — POWERSHELL"),
        ("45", "SOFTWARE INVENTORY SBOM — TRIVY"),
        ("46", "SET: WINDOWS BASELINE"),
        ("47", "SET: PROJECT RELEASE READINESS"),
        ("48", "SET: FILE TRIAGE"),
        ("49", "DUPLICATE FILE FINDER"),
        ("50", "LARGE FILE INVENTORY"),
        ("51", "JSON VALIDATOR"),
        ("52", "XML VALIDATOR"),
        ("53", "CSV STRUCTURE CHECK"),
        ("54", "FILE ENTROPY ESTIMATE"),
        ("55", "PEM CERTIFICATE INSPECTOR"),
        ("56", "WINDOWS EVENT LOG SUMMARY"),
        ("57", "SCHEDULED TASK INVENTORY"),
        ("58", "SECRET FILENAME HYGIENE"),
        ("59", "IPV4 SUBNET CALCULATOR"),
        ("60", "SCAN LOG ANALYZER"),
    ]
    # Keep the three multi-action workflow sets in a dedicated final section, separate from single-purpose tools.
    _set_numbers = {"46", "47", "48"}
    core_menu = [item for item in core_menu if item[0] not in _set_numbers] + [item for item in core_menu if item[0] in _set_numbers]
    pending_selection = _consume_pending_tool_selection()
    pending_action = _consume_pending_tool_action()
    startup_no_optional_selection = pending_selection == []
    if pending_selection:
        log_event("STARTUP_TOOL_SELECTION", "INFO", ",".join(map(str, pending_selection)))
        log_event("STARTUP_TOOL_ACTION", "INFO", pending_action or "action not preselected")
        tool_install_center(initial_selected=pending_selection, initial_action=pending_action)
    elif startup_no_optional_selection:
        log_event("STARTUP_NO_OPTIONAL_TOOLS", "INFO", "User skipped all optional downloads before first download")
    page_size = 18
    core_page_count = (len(core_menu) + page_size - 1) // page_size
    if len(core_menu) != CORE_MENU_COUNT:
        raise RuntimeError(f"Internal menu catalogue mismatch: expected {CORE_MENU_COUNT}, got {len(core_menu)}")
    external_page_count = (len(EXTERNAL_TOOL_CATALOG) + page_size - 1) // page_size
    page_count = core_page_count + external_page_count
    page = 0
    while True:
        show_banner()
        width = shutil.get_terminal_size(fallback=(100, 30)).columns
        col_width = max(25, width // 3)
        print(paint("  DEFENSIVE TRIAGE TOOLS — menu [1] runs the bounded, read-only website audit set", DIM))
        is_external_page = page >= core_page_count
        external_page_index = page - core_page_count if is_external_page else -1
        page_label = (f"OPTIONAL APPS — CATALOG {external_page_index + 1}/{external_page_count} | locked until installed") if is_external_page else "CORE DEFENSIVE TOOLS"
        print(paint(f"  {page_label}  |  PAGE {page + 1}/{page_count}  |  number = open, p = previous, d = next, r = refresh install status, 0 = exit", CYAN + BOLD))
        print()
        if not is_external_page:
            items = core_menu[page * page_size:(page + 1) * page_size]
            if page == core_page_count - 1:
                print(paint("  INDIVIDUAL UTILITIES", DIM + BOLD))
            cells_by_pos = []
            for number, title in items:
                cells_by_pos.append((number, title, None))
            def _print_core_cells(cells):
                row_count = (len(cells) + 2) // 3
                for row in range(row_count):
                    row_cells = []
                    for col in range(3):
                        idx = row * 3 + col
                        if idx < len(cells):
                            number, title, _status = cells[idx]
                            cell = f"[{number}] {title}"
                            max_cell = max(20, col_width - 1)
                            if len(cell) > max_cell:
                                cell = cell[:max_cell - 1] + "…"
                            row_cells.append(cell.ljust(col_width))
                    print("  " + "".join(row_cells).rstrip())
            if page == core_page_count - 1:
                normal_cells = [cell for cell in cells_by_pos if cell[0] not in {"46", "47", "48"}]
                set_cells = [cell for cell in cells_by_pos if cell[0] in {"46", "47", "48"}]
                _print_core_cells(normal_cells)
                print()
                print(paint("  WORKFLOW SETS — MULTI-ACTION BUNDLES", CYAN + BOLD))
                _print_core_cells(set_cells)
            else:
                _print_core_cells(cells_by_pos)
        else:
            external_items: list[tuple[str, str, bool]] = []
            start_tool = external_page_index * page_size + 1
            shown_tools = list(EXTERNAL_TOOL_CATALOG.items())[start_tool - 1:start_tool - 1 + page_size]
            for tool_number, (name, _package_id, _description, _url) in shown_tools:
                _exe, status = external_tool_status(tool_number)
                menu_number = CORE_MENU_COUNT + tool_number
                installed = status == "INSTALLED"
                label = f"[{menu_number:03d}] {name} — {status}"
                external_items.append((str(menu_number), label, installed))
            row_count = (len(external_items) + 2) // 3
            for row in range(row_count):
                row_cells = []
                for col in range(3):
                    idx = row * 3 + col
                    if idx < len(external_items):
                        number, label, installed = external_items[idx]
                        max_cell = max(20, col_width - 1)
                        if len(label) > max_cell:
                            label = label[:max_cell - 1] + "…"
                        row_cells.append(paint(label.ljust(col_width), GREEN if installed else DIM))
                print("  " + "".join(row_cells).rstrip())
            print()
            print(paint("  GRAY = not installed; pressing its number is blocked. Download-only does not install.", DIM))
            print(paint("  Catalog entries 1-16 map to main-menu numbers 61-76. See TOOL_CATALOG_KO.txt for names.", DIM))
            print(paint("  Menu 33: choose I to install; press R here to refresh installed status.", DIM))
        if startup_no_optional_selection:
            print()
            show_download_warning("시작 화면에서 추가 도구 다운로드를 건너뛰었습니다. 선택 도구는 다운로드/설치되지 않았습니다.")
            startup_no_optional_selection = False
        print()
        try:
            choice = input(paint("  COMMAND > ", CYAN + BOLD)).strip().lower()
        except (EOFError, KeyboardInterrupt):
            print("\nExiting SCAN.")
            log_event("SCAN_EXIT", "INFO", "Keyboard/EOF interrupt")
            break
        if choice == "p":
            if page > 0:
                page -= 1
            else:
                print(paint("Already on the first page.", YELLOW))
                time.sleep(0.7)
            continue
        if choice == "d":
            if page + 1 < page_count:
                page += 1
            else:
                print(paint("Already on the last page.", YELLOW))
                time.sleep(0.7)
            continue
        if choice == "r" and is_external_page:
            print(paint("Refreshing installed-package inventory...", CYAN))
            refresh_catalog_installed_status()
            print(paint("Refresh complete.", GREEN))
            log_event("WINGET_STATUS_REFRESH", "INFO", "User refreshed optional-tool status")
            time.sleep(0.6)
            continue
        if choice.isdigit():
            numeric = int(choice)
            if numeric == 0:
                print("Goodbye. Stay safe online.")
                log_event("SCAN_EXIT", "INFO", "User selected 0")
                break
            if is_external_page:
                visible_tool_start = external_page_index * page_size + 1
                visible_tool_end = min((external_page_index + 1) * page_size, len(EXTERNAL_TOOL_CATALOG))
                visible_menu_start = CORE_MENU_COUNT + visible_tool_start
                visible_menu_end = CORE_MENU_COUNT + visible_tool_end
                if visible_menu_start <= numeric <= visible_menu_end:
                    tool_number = numeric - CORE_MENU_COUNT
                    exe, status = external_tool_status(tool_number)
                    if status != "INSTALLED":
                        name = EXTERNAL_TOOL_CATALOG[tool_number][0]
                        print(paint(f"[LOCKED] {name} requires installation before it can be selected. Status: {status}.", YELLOW + BOLD))
                        print("Go to menu 33 and choose I to install, or D to save installer files for manual installation.")
                        log_event("OPTIONAL_TOOL_BLOCKED", "WARN", f"{name} | status={status}")
                        time.sleep(1.3)
                        continue
                    action = lambda n=tool_number: launch_external_tool(n)
                else:
                    action = None
            else:
                page_start = page * page_size + 1
                page_end = min((page + 1) * page_size, len(core_menu))
                if page_start <= numeric <= page_end:
                    key = f"{numeric:02d}"
                    action = core_actions.get(key)
                else:
                    action = None
        else:
            action = None
        if action:
            log_event("MENU_ACTION_START", "INFO", f"choice={choice}")
            try:
                action()
                log_event("MENU_ACTION_END", "OK", f"choice={choice}")
            except KeyboardInterrupt:
                print("\nCancelled by user.")
                log_event("MENU_ACTION_CANCEL", "WARN", f"choice={choice}")
                pause()
            except Exception as exc:
                print(paint(f"Tool error: {exc}", RED))
                log_event("MENU_ACTION_ERROR", "ERROR", f"choice={choice} | {exc}")
                pause()
        else:
            print(paint("Invalid or unavailable command. Enter a menu number, p, d, or 0 to exit.", YELLOW))
            time.sleep(1)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        log_event("SCAN_INTERRUPTED", "WARN", "Top-level Ctrl+C")
        print("\n\nSCAN interrupted safely.")
        try:
            input("Press Enter to close...")
        except EOFError:
            pass
    except Exception as exc:
        ensure_log_files()
        detail = f"TOP_LEVEL_UNHANDLED | {type(exc).__name__}: {exc}"
        log_event("TOP_LEVEL_UNHANDLED", "ERROR", detail)
        print(paint("\n[SCAN FATAL ERROR] " + detail, RED + BOLD))
        print(f"See {ERROR_LOG}")
        try:
            input("Press Enter to close...")
        except (EOFError, KeyboardInterrupt):
            pass
