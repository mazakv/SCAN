# Contributing to SCAN v22

1. Keep built-in checks read-only by default. Clearly identify every operation that writes files, contacts a remote service, downloads software, or installs a package.
2. Never build shell command strings from user-supplied values. Prefer argument lists with `shell=False` for Python subprocess calls.
3. Do not record passwords, tokens, or secret values in logs. Configure secret-scanning output to redact values and keep reports local until reviewed.
4. Add unit tests for catalog consistency, input validation, local-file behavior, and the authorization/safety boundaries of each new workflow.
5. Keep tool IDs, visible menu entries, workflow bundles, catalog documentation, README counts, and tests synchronized. v22 has 73 core entries (67 individual tools and six workflow sets) plus 16 optional apps.
6. Optional tools must remain opt-in. Do not silently install dependencies during an unrelated scan, and verify official sources and installer signatures where supported.
7. Avoid collecting data that is unnecessary for a tool's purpose. Explain when paths, DNS cache entries, process/service metadata, installed software, or browser-extension names may be sensitive.
8. Do not add features for unauthorized access, credential theft, evasion, disruption, or scanning third-party targets without permission. Preserve the local-only constraints on Nmap and SQLMap workflows.
9. Never claim that a clean result proves a system is safe or that the project guarantees legal immunity. Include limitations and advise users to obtain authorization before an assessment.
10. Exclude local logs, reports, caches, downloaded installers, secrets, and `*.bat` launch/publisher files from public source-control commits. Review the staged diff and file list before publishing.
