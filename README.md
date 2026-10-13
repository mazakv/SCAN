<div align="center">

# 🌈 SCAN Rainbow Defense Toolkit
### Defensive triage • Local-first analysis • Windows-focused workflows

**v20 · 60 built-in actions · 3 workflow sets · 16 optional applications**

[한국어](docs/README_KO.md) · [English](docs/GUIDE_EN.md) · [日本語](docs/GUIDE_JA.md) · [简体中文](docs/GUIDE_ZH_CN.md) · [Русский](docs/GUIDE_RU.md) · [Español](docs/GUIDE_ES.md)

</div>

---

## Table of contents
1. [Project purpose](#project-purpose)
2. [Design principles](#design-principles)
3. [Features at a glance](#features-at-a-glance)
4. [Requirements](#requirements)
5. [Installation and first run](#installation-and-first-run)
6. [Consent, privacy and data flow](#consent-privacy-and-data-flow)
7. [Menu reference](#menu-reference)
8. [Workflow sets](#workflow-sets)
9. [Optional application catalog](#optional-application-catalog)
10. [Reports and logs](#reports-and-logs)
11. [Security boundaries](#security-boundaries)
12. [Troubleshooting](#troubleshooting)
13. [Testing and limitations](#testing-and-limitations)
14. [Repository publishing](#repository-publishing)
15. [Project layout](#project-layout)
16. [Licensing](#licensing)
17. [Disclaimer](#disclaimer)

## Project purpose
SCAN is a Windows-first, local-first defensive triage toolkit. It brings common read-only checks and local analysis workflows into one console-based launcher, with a separate Windows Forms consent window. The goal is to make routine checks easier to discover and repeat without pretending that one menu can replace endpoint protection, a professional penetration test, an incident-response team or a formal audit.

The project prioritizes understandable boundaries: network-facing features are described before use, optional applications are not silently installed, local reports are kept on disk, and high-impact security actions are intentionally limited. SCAN should be used on computers, repositories, files and networks that you own or are explicitly authorized to assess.

## Design principles

### Local-first, not “no network ever”
Most file and host checks work with local data. Some features necessarily contact external services, for example DNS/RDAP/TLS/HTTP metadata checks or an explicitly selected installer. The consent document explains these flows. Local-first does not mean that every action is offline.

### Read-only by default
Many features gather metadata or inspect existing files. Some optional vendor tools can have their own behavior, and the toolkit cannot guarantee every third-party binary behaves identically across versions. Review commands and reports before using them on important systems.

### Explicit dependency selection
SCAN has 16 optional applications. The first-run selection allows a user to choose a small subset, skip all, install through WinGet, or download only. Download-only does not mark a dependency as installed. Missing tools are reported rather than quietly installed during an unrelated scan.

### Privacy-aware packaging
The release ZIP intentionally omits runtime log files, generated reports, old challenge logs, old changelog copies and test-result scratch files. Runtime logs are recreated when the app runs. Never publish reports or logs without inspecting them for personal or organizational data.

## Features at a glance
- 60 built-in menu actions.
- 3 grouped multi-action workflow sets, shown in their own section.
- 16 optional applications in a separate install/status catalog.
- Windows Forms consent dialog with a scrollable, static text area.
- Privacy and authorized-use notes in six languages.
- Bundled main and third-party license texts, included in the consent reading document.
- Local reports and runtime logs.
- Tests for catalogue integrity and important safety constraints.
- A publisher script supplied separately from the public source archive.

## Requirements
- Windows 10/11 is the intended runtime for the full launcher and Windows Forms consent experience.
- Python 3 is required for the main menu and local analysis modules. A current supported Python release is recommended.
- PowerShell is used by the Windows bootstrap and consent window.
- Git, Nmap, Trivy, Gitleaks, ClamAV, TShark, OpenSSL, cURL, Ruff, Node.js, Docker Desktop and other dependencies are optional and only needed for relevant workflows.
- Some features require administrative visibility or permissions; do not elevate privileges unless you understand why a feature needs them.

## Installation and first run
1. Download the release ZIP and extract the entire folder. Do not run files directly from inside the ZIP preview.
2. Keep the extracted folder in a path you can access and write to.
3. Run `SCAN.bat`.
4. Read the consent window. It includes privacy and safety information in multiple languages and then the bundled project and third-party license text. Use the scrollbar or mouse wheel to read the complete document.
5. If you agree to the stated terms and authorized-use boundaries, check the acknowledgement box and select **AGREE / 동의**. If you do not agree, select **거부 / 종료** or close the window.
6. On the optional-tool selection screen, choose only the applications required for your tasks.
7. Use the main menu to run a check. Check the displayed target and output path before proceeding.

### Optional-tool selection keys
- `I`: install selected apps through WinGet.
- `D`: download selected installers/packages only, where supported. Downloaded packages are not automatically installed.
- `A`: select all listed optional apps. This is not recommended unless you understand the disk, network and maintenance implications.
- `0`: skip optional app selection.
- `Q`: cancel the selection flow.

### Main menu navigation
- Enter the number printed beside a tool to open it.
- `p`: previous page.
- `d`: next page.
- `r`: refresh optional-tool status.
- `0`: exit.

## Consent, privacy and data flow

### What the consent window is for
The consent window is an acknowledgement screen, not a legal guarantee or a substitute for reading the software licenses. Its text is scrollable and does not use an animated redraw loop while the user is reading. The **AGREE** button is disabled until the acknowledgement checkbox is selected. Declining or closing the dialog stops the initial workflow.

### Data that may be processed
Depending on the selected feature, local data can include file names, full file paths, hashes, source code text or syntax metadata, project dependency manifests, local process/service information, Windows event metadata, scheduled task metadata, packet-capture metadata and installed-tool versions. The toolkit may write diagnostic logs and reports under `Logs`.

A web metadata workflow may send a hostname/domain to DNS resolvers, RDAP services, TLS endpoints or HTTP servers. The installer flow may contact WinGet and vendor download endpoints if you explicitly choose installation or download. These are feature-dependent actions; do not assume the entire application is permanently offline.

### Data not automatically published
SCAN does not automatically publish reports, commit changes, push to GitHub or upload the user's local logs. The publisher script is a separate file. Before running it, review the staged file list and diff. Never publish `.env` files, tokens, credentials, local reports, packet captures, personal paths or logs.

### User responsibilities
Keep local reports private, remove sensitive fields before sharing, use the least privileges required, and follow your organization's policies. If you do not understand the target or the effect of a tool, do not run it.

## Menu reference

The menu has 60 built-in actions. The optional-app catalog follows the built-in actions, with 16 selected applications. Sets are grouped in a separate **WORKFLOW SETS — MULTI-ACTION BUNDLES** section instead of being mixed visually with single-purpose utilities.

| Menu | Name | Purpose and boundaries |
|---:|---|---|
| 1 | Auto Website Audit Set | Public DNS/TLS/HTTP/RDAP metadata. No login, crawling, form submission, exploit, brute force or redirect following. |
| 2 | Nmap Local Scan | A bounded scan of one authorized local/private IPv4 host. |
| 3 | DNS / IP Lookup | Resolve or inspect basic DNS/IP metadata. |
| 4 | HTTP Security Headers | Inspect HTTP response header metadata. |
| 5 | Message Phishing Check | Heuristic review of user-provided message text. Not a definitive verdict. |
| 6 | File SHA-256 | Calculate a cryptographic hash for a selected file. |
| 7 | Defang URL | Convert a URL into a safer-to-display form. |
| 8 | TLS Certificate | Inspect certificate metadata where supported. |
| 9 | Incident Response Notes | Local incident-response helper/checklist. |
| 10 | Domain RDAP | Query public domain registration metadata. |
| 11 | SPF / DMARC TXT | Inspect domain email-policy TXT records. |
| 12 | MX Record Check | Inspect mail-exchange DNS records. |
| 13 | Email Header Review | Review supplied email headers; redact personal addresses before sharing. |
| 14 | Text Decoder | Decode supported text encodings or representations. |
| 15 | File Name Risk | Heuristic file-name/extension hints; not a malware verdict. |
| 16 | File Signature | Inspect magic/signature bytes of a local file. |
| 17 | Hash Compare | Compare file hashes. |
| 18 | Defender Status | Read available Microsoft Defender status. |
| 19 | Firewall Status | Read firewall profile state. |
| 20 | Local Network Info | Display local network information. |
| 21 | Listening Ports | Review listening socket metadata. |
| 22 | Hosts File Review | Review the local hosts file. |
| 23 | Startup Entry Review | Review selected startup metadata. |
| 24 | Remote-Access Review | Inspect indicators related to remote-access software/processes. |
| 25 | security.txt | Inspect a site's published security contact metadata where supported. |
| 26 | Redirect Preview | Review redirect metadata without following chains. |
| 27 | Tool Status | Check availability of supported tools. |
| 28 | SQLMap Local Lab | Restricted to a user-started intentionally vulnerable local lab on loopback only. |
| 29 | Password Quality | Local password-phrase quality hints; do not enter real passwords. |
| 30 | Official Tool Center | Open/select official tool information. |
| 31 | Phone Number Check | Format/metadata-oriented phone-number helper; not identity verification. |
| 32 | Domain Intel + Price | Domain-related public metadata helper. |
| 33 | Tool Download / Install | Explicit optional dependency selection. |
| 34 | Deep Analysis Center | Entry point for supported local static analysis. |
| 35 | Project Security Audit | Git, Gitleaks and Trivy workflow. |
| 36 | Local File Scan | Static file scan with optional ClamAV, Sigcheck and archive integrity check. |
| 37 | TLS + HTTP Cross-check | cURL/OpenSSL cross-check with redirect handling constrained. |
| 38 | Git Repository Readiness | Local Git status and optional redacted secret scanning; no commit/push. |
| 39 | Sysinternals Autoruns Review | Read-only Autoruns report. |
| 40 | Local Docker Image Audit | Audit an image already available locally. |
| 41 | Source Code Quality | Parse Python/Node source; do not execute project code. |
| 42 | Tool Integration Doctor | Inspect supported CLI availability and versions. |
| 43 | Local PCAP Review | Summarize an existing PCAP/PCAPNG file; no live capture. |
| 44 | Windows Host Health | Read-only Windows health snapshot. |
| 45 | Software Inventory SBOM | Create a CycloneDX software inventory. |
| 46 | **SET A: Windows Baseline** | Bundled OS, Defender, firewall and listening-port snapshot. |
| 47 | **SET B: Project Release Readiness** | Bundled Python syntax, Git status and optional Gitleaks check. |
| 48 | **SET C: File Triage** | Bundled static file details/hash and optional ClamAV check. |
| 49 | Duplicate File Finder | Hash-based duplicate candidate report; does not delete files. |
| 50 | Large File Inventory | List files above a selected size threshold. |
| 51 | JSON Validator | Parse JSON data locally. |
| 52 | XML Validator | Parse XML data locally. |
| 53 | CSV Structure Check | Check basic CSV shape/structure. |
| 54 | File Entropy Estimate | Heuristic entropy indicator; not a malware verdict. |
| 55 | PEM Certificate Inspector | Inspect PEM certificate blocks/fingerprints. |
| 56 | Windows Event Log Summary | Read a summary of recent event warnings/errors. |
| 57 | Scheduled Task Inventory | Read scheduled-task metadata. |
| 58 | Secret Filename Hygiene | Filename-only hints; does not read secret values. |
| 59 | IPv4 Subnet Calculator | Local CIDR/subnet calculations. |
| 60 | SCAN Log Analyzer | Summarize local SCAN log error candidates. |

## Workflow sets

### Set A — Windows Baseline (menu 46)
Provides a compact snapshot of operating-system details, available Defender status, firewall profiles and listening ports. It is intended for situational awareness. A missing Defender status or inaccessible field is not proof that protection is absent or present. Review results in the context of Windows edition, permissions and installed security software.

### Set B — Project Release Readiness (menu 47)
Combines source syntax checks, Git repository status and optional Gitleaks checks when the required tools are installed. It does not publish code or push changes. Secret scanners can miss credentials or report false positives. Review output and never paste real tokens or passwords into an issue or report.

### Set C — File Triage (menu 48)
Collects basic file metadata and hash information and can invoke an optional local antivirus scanner if available. It does not execute the selected file. Static indicators are only clues; use reputable security software and qualified assistance for suspicious files. Do not open or run an unknown file just because SCAN reports no findings.

## Optional application catalog

The 16 optional applications are Nmap, Wireshark/TShark, Sysinternals Suite, OpenSSL Light, Git, Python 3.12, Node.js, 7-Zip, ClamAV, Gitleaks, Trivy, GitHub CLI, Docker Desktop, PowerShell 7, cURL and Ruff. Availability, package IDs and installation behavior depend on the Windows package manager and vendor releases.

### Startup selection status

The startup tool chooser checks for known executable paths, Windows uninstall entries and cached WinGet download folders before asking for a selection. **Green `INSTALLED`** means SCAN detected the application; **green `DOWNLOADED`** means files are already present under `downloads/packages` but does not prove that the application is installed; **gray `MISSING`** means no supported installation or cached package was detected.

- `A` or `M` selects applications not detected as installed. In install mode, SCAN checks again and skips applications already detected as installed.
- `U` updates only selected apps that SCAN detects as installed by running WinGet's explicit `upgrade` operation.
- `D` saves package files only. Existing package folders can be reused; a cached download is not the same as an installed app.
- If every app is detected as installed or already downloaded, the chooser displays its green status for three seconds and proceeds to the main menu. It does not silently install or update anything.

Detection is best-effort: portable apps, non-standard install paths, or manually moved files may not appear in the same way across systems. Use menu 33 to refresh status and manage individual packages.

Suggested minimal combinations:
- Website metadata: no optional app is required for the basic workflow; cURL/OpenSSL support the cross-check.
- Project audit: Git + Gitleaks + Trivy.
- Local file checks: ClamAV + 7-Zip; Sysinternals adds Sigcheck.
- Packet file summary: Wireshark/TShark.
- Local Docker image audit: Docker Desktop + Trivy.
- Source quality: Ruff and/or Node.js.
- SBOM: Trivy.

Do not select all applications without a reason. Installing software changes the machine, consumes disk space and may require vendor updates. Review package source and permissions first.

## Reports and logs

The application creates runtime files under `Logs`. Reports may be written to `Logs/reports`. Depending on the workflow, these can include local paths, usernames, hostnames, IP addresses, project metadata, software inventories, certificate details or packet metadata. Treat them as potentially sensitive.

The release archive deliberately does not ship previous run logs, challenge logs, generated reports, old changelog copies or test-result scratch files. This keeps the package smaller and avoids distributing stale data. Required log files are recreated when the program starts.

Before sharing a report:
1. Open it locally and inspect all fields.
2. Remove usernames, home-directory paths, private IPs, internal hostnames, tokens and project names that should not be public.
3. Confirm the recipient and purpose.
4. Share only the minimum necessary excerpt.

## Security boundaries

- Only assess systems you own or have explicit permission to assess.
- Website metadata checks are not penetration tests.
- Nmap is restricted by the wrapper to one local/private IPv4 target; do not bypass that restriction.
- SQLMap is restricted by SCAN to `localhost`, `127.0.0.1`, or `::1` and an intentionally vulnerable local lab app you start yourself. Do not use it against public websites or other people's systems.
- No workflow should be used to evade access controls, collect another person's credentials or disrupt systems.
- Do not disable Defender, firewall, browser protections or operating-system controls to make a tool work.
- A tool status check cannot guarantee that the executable is trustworthy or up to date. Verify vendor signatures and official sources.

## Troubleshooting

### The consent window does not open
Extract the full ZIP and make sure `CONSENT_AND_LICENSES.txt` is present next to `consent.ps1`. Check Windows security prompts rather than disabling protections. If the file is missing or damaged, re-extract the archive.

### A dependency is missing
Use the tool status and optional app center. Some packages may be unavailable for your Windows version or architecture. You can skip an optional dependency and still use unrelated local features.

### A report is empty
Confirm the input path, that the file exists, that the current user can read it, and that the expected third-party CLI is installed. Check the relevant log locally, but redact it before sharing.

### A scan is slow or times out
Large projects and vendor tools may take time. A timeout does not automatically mean the input is corrupt or the system is infected. Do not increase limits blindly on a production system.

### Windows-only behavior
The intended runtime is Windows. Static Python tests on Linux/macOS cannot validate Windows Forms rendering, PowerShell policy, WinGet installation or vendor-specific Windows behavior. Those require a Windows test environment.

## Testing and limitations

The repository includes automated tests for menu catalogue consistency, target validation, local-file handling and selected workflow safety properties. Mock-based tests do not prove that every external CLI works in every environment. A test passing means only that the tested conditions passed. It is not a security certification.

## Repository publishing

Repository: https://github.com/mazakv/SCAN

The `PUBLISH_TO_GITHUB_SCAN_v20.bat` publisher script is supplied separately and should be reviewed before use. The repository link is a real public repository, but the latest source is not present until the publisher is run and the reviewed commit is pushed. It stages selected source files and excludes runtime logs, reports, downloaded installers, SQLMap source, secrets and `.bat` files from the public source index. Review the staged file list and diff before confirming a push. A successful push is a public release action: ensure you intend to publish the staged content.

## Project layout

```text
SCAN_Rainbow_Defense_Tool_v20/
├── SCAN.bat
├── consent.ps1
├── CONSENT_AND_LICENSES.txt
├── bootstrap.ps1
├── scan.py
├── site_audit.py
├── security_audit.py
├── security_analysis.py
├── USER_GUIDE_KO.txt
├── README.md
├── LICENSE
├── LICENSES/
├── docs/
│   ├── README_KO.md
│   ├── GUIDE_EN.md
│   ├── GUIDE_JA.md
│   ├── GUIDE_ZH_CN.md
│   ├── GUIDE_RU.md
│   └── GUIDE_ES.md
├── tests/
└── Logs/
```

## Licensing

SCAN code is distributed under the GNU General Public License version 3 or, at your option, any later version. The license text is included in `LICENSE`. Third-party tools and bundled notices retain their own licenses and vendor terms; review the text files in `LICENSES/`. Inclusion of a notice does not mean SCAN owns or relicenses a third-party product. The consent reading document contains the bundled license texts for convenient review.

## Disclaimer

SCAN is provided “as is,” without warranties of any kind to the maximum extent permitted by applicable law. The authors and contributors are not responsible for how the toolkit is used. You are responsible for authorization, compliance with applicable law, protecting data, verifying results and deciding whether further expert review is needed. False positives, false negatives, incomplete dependency data, vendor changes, permissions and platform differences may affect results. Do not rely on one automated result for high-impact decisions.

---

**Language note:** English is the primary reference for technical behavior. Translated guides are provided for accessibility; if a translation differs in meaning, consult the English guide and the original license files.
