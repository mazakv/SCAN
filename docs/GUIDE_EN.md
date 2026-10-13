# SCAN Rainbow Defense Toolkit v20 — English Guide

## 1. Overview
SCAN is a Windows-first, local-first defensive triage toolkit. It helps inspect host posture, selected local files, source projects, packet captures and tool availability, then stores reports locally. It is not a substitute for a professional security product, and a clean result is not proof that a system is safe.

## 2. Quick start
1. Extract the ZIP to a normal folder.
2. Run `SCAN.bat`.
3. Scroll through the consent window, including the bundled open-source license texts at the end.
4. If you agree, check the acknowledgement box and choose `AGREE / 동의`. Otherwise choose `거부 / 종료`.
5. Select only optional applications you need. `I` installs through WinGet, `D` downloads only, and `Q` cancels. Download-only apps are not considered installed.
6. Enter a menu number. `p` means previous page, `d` next page, `r` refresh tool status, and `0` exits.

## 3. Menu and workflow sets
The toolkit has 60 built-in actions and 16 optional applications. Workflow sets are displayed separately from individual utilities.
- 1: Read-only website metadata set for public DNS/TLS/HTTP/RDAP information. It does not log in, crawl, submit forms, exploit, brute-force or follow redirects.
- 2: Bounded Nmap scan for one authorized local/private IPv4 host.
- 35: Project audit using Git, Gitleaks and Trivy. Review reports before sharing even when secret redaction is intended.
- 36: Static local-file checks with optional ClamAV, Sigcheck and 7-Zip; files are not executed or extracted.
- 37: cURL/OpenSSL HTTPS/TLS cross-check designed not to follow redirects.
- 38: Git repository readiness; it does not commit or push.
- 39: Read-only Autoruns review.
- 40: Trivy review of a Docker image already present locally; no automatic image pull.
- 41: Python AST, Ruff and Node syntax checks; project code is parsed, not executed.
- 43: TShark summary of a PCAP/PCAPNG file already on disk; no live capture.
- 44: Read-only Windows OS/firewall/Defender snapshot.
- 45: CycloneDX SBOM generation for a local project; an SBOM is not a vulnerability verdict.
- Set A (46): Windows baseline — OS, Defender, firewall and listening-port snapshot.
- Set B (47): Project release readiness — Python syntax, Git status and optional Gitleaks.
- Set C (48): File triage — static file details and SHA-256, with optional ClamAV.
- 49–60: Duplicate hash finder, large-file inventory, JSON/XML/CSV validation, heuristic entropy estimate, PEM certificate inspection, Windows event summary, scheduled task inventory, secret-like filename hygiene, IPv4 subnet calculator and SCAN log analyzer.

## 4. Privacy and data flow
- Local file analysis reads the selected file on your computer. Some workflows may call external command-line utilities.
- Website metadata checks may send the entered hostname/domain to DNS, RDAP, TLS or HTTP services.
- Logs and reports can contain usernames, local paths, domains, IP addresses, project names, installed-software details or packet metadata.
- SCAN does not automatically publish reports or upload them to GitHub.
- Never commit `Logs` or reports to a public repository. Inspect and redact reports before sharing.
- Declining or closing the consent dialog stops the initial workflow.

## 5. Authorized-use boundaries
Use the toolkit only on systems you own or are explicitly authorized to assess. The website metadata set is not a penetration test. The Nmap wrapper is restricted to one local/private IPv4 target. SQLMap is restricted by SCAN to `localhost`, `127.0.0.1` or `::1` and a deliberately vulnerable local lab app you started yourself. Do not use it against public websites or other people's systems. Entropy, filename and hash indicators are not definitive malware verdicts. Missing tools are reported as unavailable rather than silently installed.

## 6. Reports and cleanup
Runtime logs are recreated under `Logs`; reports may appear in `Logs/reports`. The release ZIP excludes historical logs, challenge logs and obsolete changelog files to reduce clutter. Logs can contain personal or organizational information, so keep them private.

## 7. Troubleshooting
- If startup fails, extract the whole archive and run `SCAN.bat`; inspect whether Windows blocked a file. Do not disable security controls indiscriminately.
- If a tool is unavailable, check the tool status/install center and use official vendor distribution channels.
- If a report is empty, confirm the path, permissions and dependency availability.
- A SQLMap timeout alone does not prove that source files are corrupted. Keep all testing within your local lab.
- Windows Forms and WinGet behavior must be tested on Windows. Passing static checks or unit tests on another OS does not validate those Windows-specific components.

## 8. License
SCAN code is licensed under GNU GPL version 3 or later. Third-party tools retain their own licenses and vendor terms. Read `LICENSE` and the original texts under `LICENSES`. The consent dialog includes the bundled GPL and third-party license text after the privacy and safety notice.

## 9. Project layout
`SCAN.bat` is the Windows entry point; `consent.ps1` displays consent; `bootstrap.ps1` handles initial setup; `scan.py` contains the main menu and workflow dispatch; helper modules provide additional checks; `tests/` contains local tests; `LICENSE` and `LICENSES/` contain license materials; `docs/` contains localized guides.

## 10. Disclaimer
The toolkit is provided “as is.” False positives, missed findings, data loss, service interruptions, vendor-tool changes and operating-system differences cannot be ruled out. Back up important data and review any action that could change state. SCAN is not legal advice, a formal audit, or a replacement for professional incident response.
