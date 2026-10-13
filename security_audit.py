#!/usr/bin/env python3
# Copyright (C) 2026 SCAN Rainbow Defense Toolkit contributors
# SPDX-License-Identifier: GPL-3.0-or-later
"""Read-only Windows security posture snapshot. Does not modify settings or contact remote hosts."""
from __future__ import annotations
import json, os, platform, shutil, subprocess, sys, socket, re
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent
LOGS = ROOT / "Logs"
REPORTS = LOGS / "reports"

def run_readonly(command: list[str], timeout: int = 8) -> dict:
    try:
        result = subprocess.run(command, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=timeout)
        return {"command": command, "returncode": result.returncode, "stdout": (result.stdout or "")[:5000], "stderr": (result.stderr or "")[:1500]}
    except Exception as exc:
        return {"command": command, "error": f"{type(exc).__name__}: {exc}"}

def main() -> int:
    REPORTS.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().astimezone().strftime("%Y%m%d_%H%M%S")
    report = {
        "title": "SCAN Local Windows Security Baseline",
        "generated_at": datetime.now().astimezone().isoformat(timespec="seconds"),
        "read_only": True,
        "remote_connections_made": False,
        "warning": "Informational snapshot only. Not a vulnerability assessment or malware verdict.",
        "system": {"platform": platform.platform(), "hostname": socket.gethostname(), "python": sys.version.split()[0], "python_executable": sys.executable},
        "checks": [],
    }
    if os.name != "nt":
        report["error"] = "This check is Windows-only; no checks were run."
    else:
        ps = shutil.which("powershell.exe") or shutil.which("pwsh.exe") or shutil.which("powershell") or shutil.which("pwsh")
        if not ps:
            report["checks"].append({"name": "PowerShell", "status": "NOT_AVAILABLE", "detail": "PowerShell executable not found."})
        else:
            commands = [
                ("Defender status", "Get-MpComputerStatus | Select-Object AMServiceEnabled,AntivirusEnabled,RealTimeProtectionEnabled,BehaviorMonitorEnabled,IoavProtectionEnabled,AntivirusSignatureLastUpdated | Format-List"),
                ("Firewall profiles", "Get-NetFirewallProfile | Select-Object Name,Enabled,DefaultInboundAction,DefaultOutboundAction | Format-Table -AutoSize"),
                ("UAC registry setting", "Get-ItemProperty 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\System' -Name EnableLUA -ErrorAction SilentlyContinue | Select-Object EnableLUA | Format-List"),
                ("SMBv1 feature state", "Get-WindowsOptionalFeature -Online -FeatureName SMB1Protocol -ErrorAction SilentlyContinue | Select-Object FeatureName,State | Format-List"),
                ("OS version", "Get-CimInstance Win32_OperatingSystem | Select-Object Caption,Version,BuildNumber,LastBootUpTime | Format-List"),
                ("Recent hotfix list", "Get-HotFix | Sort-Object InstalledOn -Descending | Select-Object -First 12 HotFixID,Description,InstalledOn | Format-Table -AutoSize"),
                ("Local listening ports", "Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Select-Object -First 80 LocalAddress,LocalPort,OwningProcess | Sort-Object LocalPort | Format-Table -AutoSize"),
                ("Remote Desktop policy", "Get-ItemProperty 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Terminal Server' -Name fDenyTSConnections -ErrorAction SilentlyContinue | Select-Object fDenyTSConnections | Format-List"),
            ]
            for name, expression in commands:
                item = run_readonly([ps, "-NoLogo", "-NoProfile", "-NonInteractive", "-Command", expression], timeout=12)
                item["name"] = name
                report["checks"].append(item)
    json_path = REPORTS / f"security_baseline_{stamp}.json"
    txt_path = REPORTS / f"security_baseline_{stamp}.txt"
    json_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    lines = [report["title"], "=" * len(report["title"]), f"Generated: {report['generated_at']}", "", report["warning"], ""]
    lines += ["System:", json.dumps(report["system"], ensure_ascii=False, indent=2), ""]
    if report.get("error"): lines += ["ERROR:", report["error"], ""]
    for check in report["checks"]:
        lines += [f"[{check.get('name','Check')}]", f"Return code: {check.get('returncode','N/A')}"]
        if check.get("error"): lines.append("Error: " + check["error"])
        if check.get("stdout"): lines += [check["stdout"].rstrip()]
        if check.get("stderr"): lines += ["STDERR:", check["stderr"].rstrip()]
        lines.append("")
    lines += ["No changes were made. No remote hosts were contacted.", "A result can be incomplete if permissions or Windows features are unavailable."]
    txt_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print("Local security-baseline audit finished (read-only).")
    print("TXT report:", txt_path)
    print("JSON report:", json_path)
    print("Notice: this is an informational snapshot, not proof that the computer is secure.")
    return 0

if __name__ == "__main__":
    try: raise SystemExit(main())
    except KeyboardInterrupt: print("Cancelled."); raise SystemExit(130)
