# SCAN Rainbow Defense Toolkit v22.1.0 — Windows (English)

**SCAN is a defensive triage toolkit for local system, file, project, and bounded public-metadata checks. It is not a security certification, antivirus replacement, professional incident-response service, or legal advice.**

## Overview
- 73 core menu entries (67 individual tools + 6 workflow sets), 16 optional apps, 89 total menu entries.
- Local Python checks, metadata review, and selected integrated workflows.
- Local TXT/JSON reports in `Logs/`; inspect them before sharing.
- Optional AI review needs an API key and a separate explicit upload confirmation.

## Installation and first run

1. Download the Windows ZIP.
2. In File Explorer, right-click it and choose Extract All. Do not run the project from the ZIP preview.
3. Run SCAN.bat from the extracted folder. Keep the folder writable so Logs and reports can be created.
4. Review the PowerShell syntax preflight and startup notice. If Python is missing, installation is offered only after confirming the official python.org download.
5. Optional apps require explicit selection. Apps detected as already installed are skipped. Review any WinGet/UAC or vendor agreement prompts.

## Requirements
Python 3.10 or newer is required. Some integrated workflows depend on optional tools or network access. Menu availability varies by operating system.

## Platform limitations
Most menu actions use shared Python code, while OS-specific features only work on their supported platform. Windows-only PowerShell/WinGet functions are not available on Termux, Linux, or macOS.
Most menu actions use shared Python code, while OS-specific features only work on their supported platform. Windows-only PowerShell/WinGet functions are not available on Termux, Linux, or macOS.

## Reports and logs may include usernames, local paths, hostnames, IP addresses, software inventories, or project metadata. Review and redact them before sharing. Optional AI report review sends data to an external API only after you inspect the preview and type UPLOAD.
Reports and logs may include usernames, local paths, hostnames, IP addresses, software inventories, or project metadata. Review and redact them before sharing. Optional AI report review sends data to an external API only after you inspect the preview and type UPLOAD.

## Check only devices, files, accounts, repositories, and networks you own or are explicitly authorized to assess. A clean result is not proof of safety; false positives and missed findings are possible. Do not disable security protections.
Check only devices, files, accounts, repositories, and networks you own or are explicitly authorized to assess. A clean result is not proof of safety; false positives and missed findings are possible. Do not disable security protections.

## SCAN is licensed under GNU GPL v3 or later. Full license texts and third-party notices are in LICENSE and LICENSES/. Bundled third-party tools may have separate terms.
SCAN is licensed under GNU GPL v3 or later. Full license texts and third-party notices are in LICENSE and LICENSES/. Bundled third-party tools may have separate terms.

## Optional tool catalog

| # | Application | WinGet package ID |
|---:|---|---|
| 1 | Nmap | `Insecure.Nmap` |
| 2 | Wireshark | `WiresharkFoundation.Wireshark` |
| 3 | Sysinternals Suite | `Microsoft.Sysinternals.Suite` |
| 4 | OpenSSL Light | `ShiningLight.OpenSSL.Light` |
| 5 | Git | `Git.Git` |
| 6 | Python 3.12 | `Python.Python.3.12` |
| 7 | Node.js | `OpenJS.NodeJS` |
| 8 | 7-Zip | `7zip.7zip` |
| 9 | ClamAV | `Cisco.ClamAV` |
| 10 | Gitleaks | `Gitleaks.Gitleaks` |
| 11 | Trivy | `AquaSecurity.Trivy` |
| 12 | GitHub CLI | `GitHub.cli` |
| 13 | Docker Desktop | `Docker.DockerDesktop` |
| 14 | PowerShell 7 | `Microsoft.PowerShell` |
| 15 | cURL | `cURL.cURL` |
| 16 | Ruff | `astral-sh.ruff` |

## Troubleshooting and limitations
Setup/startup guidance and the README are localized for this package. Detailed tool screens and some result messages may remain in English to keep the shared code consistent.
- Windows menu 33 delegates installs to WinGet. On other platforms, use your OS package manager/vendor documentation.
- A missing finding does not certify a system or file as safe.
- Website metadata checks may contact DNS, RDAP, TLS, or HTTP services; the program is not fully offline.

**Package version:** v22.1.0
**Repository:** https://github.com/mazakv/SCAN
**License:** GNU GPL v3 or later; see `LICENSE` and `LICENSES/`.
