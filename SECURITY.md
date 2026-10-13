# Security policy

- Use SCAN only on systems, files, and applications you own or have explicit permission to assess.
- The SQLMap launcher is restricted to loopback hosts and intended local training apps. Do not remove these checks in distributed builds.
- Menu [1] Auto Website Audit Set is limited to public-domain, read-only DNS/TLS/HTTP metadata checks. It pins requests to prevalidated public IPs, refuses private/loopback DNS answers, and does not follow target redirects, crawl links, submit forms, or run exploit tests.
- File-analysis modules do not execute inspected files or visit extracted URLs.
- Reports and logs can contain local host names, Windows paths, package IDs, and findings. Review them before sharing. They are excluded by default from Git commits.
- This toolkit is not an antivirus, compliance certification, or guarantee of security.
- To report a bug, include a minimal reproduction and redacted error output. Do not upload secrets, auth tokens, private keys, personal data, or sensitive logs.
