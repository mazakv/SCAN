#!/usr/bin/env python3
# Copyright (C) 2026 SCAN Rainbow Defense Toolkit contributors
# SPDX-License-Identifier: GPL-3.0-or-later
"""Bounded, read-only website posture review for domains the user may assess.

This module does not perform port scans, crawl arbitrary links, submit forms,
try credentials, fuzz parameters, exploit vulnerabilities, or follow redirects.
Only the site's root page and three conventional public text endpoints are read.
"""
from __future__ import annotations

import html
import html.parser
import http.client
import ipaddress
import json
import re
import socket
import ssl
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime
from pathlib import Path
from typing import Any

USER_AGENT = "SCAN-Rainbow-Defensive-Toolkit/14.0 (read-only-site-audit)"
MAX_ROOT_BYTES = 192_000
MAX_TEXT_BYTES = 24_000
TIMEOUT_SECONDS = 7


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def _validate_url(raw: str) -> tuple[str, str, str]:
    """Return origin URL, ASCII host, and scheme after strict validation."""
    value = (raw or "").strip()
    if not value:
        raise ValueError("사이트 주소를 입력해 주세요.")
    if not re.match(r"^[a-zA-Z][a-zA-Z0-9+.-]*://", value):
        value = "https://" + value
    parsed = urllib.parse.urlsplit(value)
    scheme = parsed.scheme.lower()
    if scheme not in ("https", "http"):
        raise ValueError("https:// 또는 http:// 주소만 지원합니다.")
    if parsed.username is not None or parsed.password is not None:
        raise ValueError("주소에 사용자 이름이나 비밀번호를 넣지 마세요.")
    if not parsed.hostname:
        raise ValueError("호스트 이름을 확인할 수 없습니다.")
    if parsed.port is not None and ((scheme == "https" and parsed.port != 443) or (scheme == "http" and parsed.port != 80)):
        raise ValueError("안전을 위해 HTTPS는 443, HTTP는 80 기본 포트만 지원합니다.")
    try:
        host = parsed.hostname.rstrip(".").encode("idna").decode("ascii").lower()
    except UnicodeError as exc:
        raise ValueError("도메인 문자를 변환할 수 없습니다.") from exc
    if len(host) > 253 or "." not in host:
        raise ValueError("예: example.com 형식의 공개 도메인을 입력해 주세요.")
    if host == "localhost" or host.endswith((".localhost", ".local", ".internal", ".lan", ".test")):
        raise ValueError("이 자동 사이트 세트는 공개 도메인용입니다. 로컬 실습은 별도 로컬 도구를 사용하세요.")
    try:
        ipaddress.ip_address(host.strip("[]"))
    except ValueError:
        pass
    else:
        raise ValueError("이 세트에는 IP 주소 대신 공개 도메인 이름을 입력해 주세요.")
    labels = host.split(".")
    if any(not label or len(label) > 63 or not re.fullmatch(r"[a-z0-9](?:[a-z0-9-]*[a-z0-9])?", label) for label in labels):
        raise ValueError("도메인 형식이 올바르지 않습니다.")
    # Deliberately normalize to the origin and discard path, query, fragment.
    origin = f"{scheme}://{host}/"
    return origin, host, scheme


def _resolve_public(host: str) -> list[str]:
    """Resolve a host and refuse loopback, private, link-local or non-global IPs."""
    try:
        rows = socket.getaddrinfo(host, None, type=socket.SOCK_STREAM)
    except OSError as exc:
        raise ValueError(f"DNS 조회 실패: {exc}") from exc
    addresses = sorted({str(row[4][0]).split("%", 1)[0] for row in rows})
    if not addresses:
        raise ValueError("DNS에서 IP 주소를 찾지 못했습니다.")
    invalid = []
    for text in addresses:
        try:
            addr = ipaddress.ip_address(text)
        except ValueError:
            invalid.append(text)
            continue
        if not addr.is_global:
            invalid.append(text)
    if invalid:
        raise ValueError("도메인이 공개 IP가 아닌 주소로 해석되어 요청을 중단했습니다: " + ", ".join(invalid[:5]))
    return addresses[:20]


def _request(url: str, max_bytes: int, method: str = "GET", pinned_ips: list[str] | None = None) -> dict[str, Any]:
    """Fetch a single exact-origin URL without redirects, pinned to prevalidated public IPs."""
    parsed = urllib.parse.urlsplit(url)
    host = parsed.hostname or ""
    scheme = parsed.scheme.lower()
    port = parsed.port or (443 if scheme == "https" else 80)
    path = urllib.parse.urlunsplit(("", "", parsed.path or "/", parsed.query, ""))
    if scheme not in ("https", "http") or port not in (80, 443):
        return {"url": url, "error": "Only HTTP/HTTPS standard ports are allowed.", "elapsed_ms": 0}
    candidates = pinned_ips or []
    if not candidates:
        return {"url": url, "error": "No prevalidated public IP was supplied.", "elapsed_ms": 0}
    last_error = "connection failed"
    for ip in candidates[:6]:
        started = time.monotonic()
        conn = None
        try:
            if scheme == "https":
                class PinnedHTTPSConnection(http.client.HTTPSConnection):
                    def connect(self_inner):
                        raw_sock = socket.create_connection((ip, port), self_inner.timeout)
                        self_inner.sock = self_inner._context.wrap_socket(raw_sock, server_hostname=host)
                conn = PinnedHTTPSConnection(host, port=port, timeout=TIMEOUT_SECONDS, context=ssl.create_default_context())
            else:
                class PinnedHTTPConnection(http.client.HTTPConnection):
                    def connect(self_inner):
                        self_inner.sock = socket.create_connection((ip, port), self_inner.timeout)
                conn = PinnedHTTPConnection(host, port=port, timeout=TIMEOUT_SECONDS)
            conn.request(method, path, headers={"Host": host, "User-Agent": USER_AGENT,
                                                "Accept": "text/html,text/plain,application/xml,application/json,*/*;q=0.5",
                                                "Connection": "close"})
            response = conn.getresponse()
            raw = response.read(max_bytes + 1)
            too_large = len(raw) > max_bytes
            charset = "utf-8"
            for header_name, header_value in response.getheaders():
                if header_name.lower() == "content-type":
                    match = re.search(r"charset=([^;\s]+)", header_value, re.I)
                    if match:
                        charset = match.group(1).strip('"\'')
                    break
            body = raw[:max_bytes].decode(charset, "replace")
            headers: dict[str, str] = {}
            cookies: list[str] = []
            for key, value in response.getheaders():
                normalized_key = str(key).lower()
                if normalized_key == "set-cookie":
                    if len(cookies) < 12:
                        cookies.append(str(value)[:1200])
                else:
                    headers[normalized_key] = (headers.get(normalized_key, "") + (", " if normalized_key in headers else "") + str(value))[:1200]
            return {
                "url": url, "status": int(response.status), "reason": str(response.reason or "")[:120],
                "headers": headers, "set_cookie": cookies, "body": body,
                "body_bytes_read": min(len(raw), max_bytes), "truncated": too_large,
                "elapsed_ms": int((time.monotonic() - started) * 1000), "connected_ip": ip,
            }
        except Exception as exc:
            last_error = f"{type(exc).__name__}: {exc}"
        finally:
            if conn is not None:
                try:
                    conn.close()
                except Exception:
                    pass
    return {"url": url, "error": last_error[:500], "elapsed_ms": 0}


def _doh(hostname: str, record_type: str) -> dict[str, Any]:
    query = urllib.parse.urlencode({"name": hostname, "type": record_type})
    url = "https://dns.google/resolve?" + query
    result = _request_json(url, MAX_TEXT_BYTES)
    answers = result.get("Answer", []) if isinstance(result, dict) else []
    return {"status": result.get("Status") if isinstance(result, dict) else None,
            "answers": [str(a.get("data", ""))[:500] for a in answers[:30] if isinstance(a, dict)]}


def _request_json(url: str, max_bytes: int) -> dict[str, Any]:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/dns-json, application/json"})
    # This API URL is fixed by SCAN, not supplied by the site being audited.
    with urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS) as response:
        raw = response.read(max_bytes + 1)
    if len(raw) > max_bytes:
        raise ValueError("API response exceeded size limit")
    result = json.loads(raw.decode("utf-8", "replace"))
    return result if isinstance(result, dict) else {}


class _PageInfo(html.parser.HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.title = ""
        self._in_title = False
        self.meta: dict[str, str] = {}
        self.canonical: str | None = None
        self.forms: list[dict[str, Any]] = []
        self._form: dict[str, Any] | None = None
        self.external_http_assets: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attr = {k.lower(): (v or "") for k, v in attrs}
        if tag.lower() == "title":
            self._in_title = True
        if tag.lower() == "meta":
            name = (attr.get("name") or attr.get("property") or "").lower()
            if name in ("description", "robots", "viewport", "referrer", "og:title", "og:site_name"):
                self.meta[name] = attr.get("content", "")[:500]
        if tag.lower() == "link" and "canonical" in attr.get("rel", "").lower().split():
            self.canonical = attr.get("href", "")[:1000]
        if tag.lower() == "form":
            if len(self.forms) < 30:
                self._form = {"action": attr.get("action", ""), "method": attr.get("method", "get").lower(), "password_field": False}
        if tag.lower() == "input" and self._form is not None and attr.get("type", "").lower() == "password":
            self._form["password_field"] = True
        if tag.lower() in ("script", "img", "iframe", "link", "source"):
            for key in ("src", "href"):
                candidate = attr.get(key, "")
                if candidate.startswith("http://") and len(self.external_http_assets) < 30:
                    self.external_http_assets.append(candidate[:1000])

    def handle_endtag(self, tag: str) -> None:
        if tag.lower() == "title":
            self._in_title = False
        if tag.lower() == "form" and self._form is not None:
            self.forms.append(self._form)
            self._form = None

    def handle_data(self, data: str) -> None:
        if self._in_title and len(self.title) < 500:
            self.title += data


def _tls_check(host: str, pinned_ips: list[str] | None = None) -> dict[str, Any]:
    started = time.monotonic()
    candidates = pinned_ips or []
    last_error = "no prevalidated public IP was supplied"
    for ip in candidates[:6]:
        try:
            context = ssl.create_default_context()
            with socket.create_connection((ip, 443), timeout=TIMEOUT_SECONDS) as raw:
                with context.wrap_socket(raw, server_hostname=host) as wrapped:
                    cert = wrapped.getpeercert()
                    cipher = wrapped.cipher()
                    version = wrapped.version()
            return {
                "ok": True, "connected_ip": ip, "protocol": version,
                "cipher": cipher[0] if cipher else None,
                "issuer": _dn_to_text(cert.get("issuer", ())),
                "subject": _dn_to_text(cert.get("subject", ())),
                "not_before": cert.get("notBefore"), "not_after": cert.get("notAfter"),
                "subject_alt_names": [item[1] for item in cert.get("subjectAltName", [])[:30] if len(item) > 1],
                "elapsed_ms": int((time.monotonic() - started) * 1000),
            }
        except Exception as exc:
            last_error = f"{type(exc).__name__}: {exc}"
    return {"ok": False, "error": last_error[:500], "elapsed_ms": int((time.monotonic() - started) * 1000)}


def _dn_to_text(dn: Any) -> str:
    parts: list[str] = []
    for group in dn or ():
        for key, value in group:
            parts.append(f"{key}={value}")
    return ", ".join(parts)[:1000]


def _base_findings(root: dict[str, Any], scheme: str, tls: dict[str, Any], txt: dict[str, Any], dmarc: dict[str, Any], page: dict[str, Any]) -> list[dict[str, str]]:
    findings: list[dict[str, str]] = []
    headers = root.get("headers", {})
    status = root.get("status")
    if root.get("error"):
        findings.append({"level": "WARN", "check": "Homepage HTTP", "detail": root["error"]})
    elif isinstance(status, int) and 300 <= status < 400:
        findings.append({"level": "INFO", "check": "Redirect", "detail": f"HTTP {status}; Location recorded but not followed."})
    elif isinstance(status, int) and status >= 400:
        findings.append({"level": "WARN", "check": "Homepage HTTP", "detail": f"HTTP status {status}. This alone does not prove a vulnerability."})
    else:
        findings.append({"level": "INFO", "check": "Homepage HTTP", "detail": f"HTTP status {status if status is not None else 'unknown'}"})
    if scheme == "https" and not tls.get("ok"):
        findings.append({"level": "WARN", "check": "TLS certificate", "detail": str(tls.get("error", "TLS check failed"))[:300]})
    elif tls.get("ok"):
        findings.append({"level": "INFO", "check": "TLS certificate", "detail": f"{tls.get('protocol')} / expires {tls.get('not_after')}"})
    if scheme == "https" and "strict-transport-security" not in headers:
        findings.append({"level": "REVIEW", "check": "HSTS", "detail": "Strict-Transport-Security header not observed on the homepage response."})
    if "content-security-policy" not in headers:
        findings.append({"level": "REVIEW", "check": "CSP", "detail": "Content-Security-Policy header not observed. Check application requirements before adding one."})
    if "x-content-type-options" not in headers:
        findings.append({"level": "REVIEW", "check": "X-Content-Type-Options", "detail": "Header not observed."})
    csp = headers.get("content-security-policy", "").lower()
    if "x-frame-options" not in headers and "frame-ancestors" not in csp:
        findings.append({"level": "REVIEW", "check": "Framing protection", "detail": "Neither X-Frame-Options nor CSP frame-ancestors was observed."})
    if "referrer-policy" not in headers:
        findings.append({"level": "INFO", "check": "Referrer-Policy", "detail": "Header not observed."})
    if "permissions-policy" not in headers:
        findings.append({"level": "INFO", "check": "Permissions-Policy", "detail": "Header not observed."})
    for cookie in root.get("set_cookie", []):
        low = cookie.lower()
        missing = []
        if "secure" not in low: missing.append("Secure")
        if "httponly" not in low: missing.append("HttpOnly")
        if "samesite" not in low: missing.append("SameSite")
        if missing:
            findings.append({"level": "REVIEW", "check": "Cookie flags", "detail": f"A Set-Cookie header omitted: {', '.join(missing)} (review context; not every cookie needs all flags)."})
    spf_records = [value for value in txt.get("answers", []) if "v=spf1" in value.lower()]
    if not spf_records:
        findings.append({"level": "REVIEW", "check": "SPF", "detail": "No SPF record found in the queried TXT answers."})
    dmarc_records = [value for value in dmarc.get("answers", []) if "v=dmarc1" in value.lower()]
    if not dmarc_records:
        findings.append({"level": "REVIEW", "check": "DMARC", "detail": "No DMARC record found at _dmarc.<domain>."})
    if page.get("external_http_assets"):
        findings.append({"level": "REVIEW", "check": "Mixed-content references", "detail": f"Found {len(page['external_http_assets'])} absolute http:// asset reference(s) in the root HTML."})
    for form in page.get("forms", []):
        action = str(form.get("action", ""))
        if form.get("password_field") and action.startswith("http://"):
            findings.append({"level": "WARN", "check": "Password form action", "detail": "A password-input form appears to submit to an explicit http:// action. Form was not submitted."})
        elif form.get("password_field") and scheme == "http":
            findings.append({"level": "WARN", "check": "Password form on HTTP", "detail": "A password-input form was observed on HTTP. No credentials were entered or sent."})
    if headers.get("server") or headers.get("x-powered-by"):
        findings.append({"level": "INFO", "check": "Technology headers", "detail": "Server/X-Powered-By headers are visible; this is informational and not a vulnerability by itself."})
    return findings


def audit_site(raw: str, app_root: Path | None = None) -> dict[str, Any]:
    """Run the bounded read-only audit and write a TXT/JSON report."""
    origin, host, scheme = _validate_url(raw)
    addresses = _resolve_public(host)
    started_at = datetime.now().astimezone()
    print("\n[1/6] DNS resolution…")
    dns_answers: dict[str, dict[str, Any]] = {"A-local": {"answers": [a for a in addresses if ":" not in a]}, "AAAA-local": {"answers": [a for a in addresses if ":" in a]}}
    for record_type, name in (("MX", host), ("NS", host), ("TXT", host), ("TXT", "_dmarc." + host)):
        label = "DMARC" if name.startswith("_dmarc.") else record_type
        print(f"  - {label} record…")
        try:
            dns_answers[label] = _doh(name, record_type)
        except Exception as exc:
            dns_answers[label] = {"error": f"{type(exc).__name__}: {exc}"}
    print("[2/6] TLS certificate (read-only handshake)…")
    tls = _tls_check(host, addresses)
    print("[3/6] Homepage HTTP headers and limited HTML metadata…")
    root = _request(origin, MAX_ROOT_BYTES, pinned_ips=addresses)
    body = root.get("body", "")
    page_info = _PageInfo()
    try:
        page_info.feed(body)
        page_info.close()
    except Exception:
        pass
    page: dict[str, Any] = {
        "title": html.unescape(page_info.title.strip())[:500],
        "meta": page_info.meta,
        "canonical": page_info.canonical,
        "forms": page_info.forms[:30],
        "external_http_assets": list(dict.fromkeys(page_info.external_http_assets))[:30],
        "body_truncated": bool(root.get("truncated")),
    }
    print("[4/6] Public site text files (not followed or crawled)…")
    root_url = origin.rstrip("/")
    text_files = {}
    for label, path in (("security_txt", "/.well-known/security.txt"), ("robots_txt", "/robots.txt"), ("sitemap_xml", "/sitemap.xml")):
        time.sleep(0.15)
        item = _request(root_url + path, MAX_TEXT_BYTES, pinned_ips=addresses)
        item.pop("body", None) if item.get("error") else None
        body_text = item.pop("body", "")
        item["preview"] = body_text[:1800]
        if label == "sitemap_xml":
            item["url_entries_seen"] = len(re.findall(r"<loc>\s*[^<]+\s*</loc>", body_text, flags=re.I))
        text_files[label] = item
    print("[5/6] Security header and mail-policy review…")
    findings = _base_findings(root, scheme, tls, dns_answers.get("TXT", {}), dns_answers.get("DMARC", {}), page)
    if not text_files["security_txt"].get("status", 0) or text_files["security_txt"].get("status", 0) >= 400:
        findings.append({"level": "INFO", "check": "security.txt", "detail": "No readable security.txt was found at the standard .well-known path. This is common and not itself a vulnerability."})
    if text_files["robots_txt"].get("status") == 200:
        findings.append({"level": "INFO", "check": "robots.txt", "detail": "A public robots.txt was retrieved; paths are not automatically crawled."})
    if text_files["sitemap_xml"].get("status") == 200:
        findings.append({"level": "INFO", "check": "sitemap.xml", "detail": f"Sitemap returned HTTP 200; counted {text_files['sitemap_xml'].get('url_entries_seen', 0)} visible <loc> entries in a capped preview. URLs were not visited."})
    rdap: dict[str, Any]
    print("[6/6] Public registration information and report generation…")
    try:
        rdap_url = "https://rdap.org/domain/" + urllib.parse.quote(host, safe=".-")
        rdap = _request_json(rdap_url, MAX_TEXT_BYTES)
        rdap_summary = {
            "ldhName": rdap.get("ldhName"),
            "status": rdap.get("status", [])[:20] if isinstance(rdap.get("status", []), list) else [],
            "events": [{"action": event.get("eventAction"), "date": event.get("eventDate")} for event in rdap.get("events", [])[:15] if isinstance(event, dict)],
            "entity_roles": [role for entity in rdap.get("entities", [])[:20] if isinstance(entity, dict) for role in entity.get("roles", [])[:8]],
        }
    except Exception as exc:
        rdap_summary = {"error": f"{type(exc).__name__}: {exc}"}
    # Add contextual note rather than presenting heuristics as a verdict.
    findings.append({"level": "INFO", "check": "Scope", "detail": "Read-only checks only; no port scans, brute force, form submission, crawler, exploit test, or redirect following."})
    report: dict[str, Any] = {
        "title": "SCAN Automatic Website Audit Set",
        "version": "14.0",
        "generated_at": started_at.isoformat(timespec="seconds"),
        "target": {"host": host, "origin": origin, "scheme": scheme, "resolved_public_addresses": addresses},
        "scope": {"read_only": True, "redirects_followed": False, "forms_submitted": False, "links_crawled": False, "exploit_tests": False},
        "checks": {"dns": dns_answers, "tls": tls, "homepage": {k: v for k, v in root.items() if k != "body"}, "page": page, "public_text_files": text_files, "rdap": rdap_summary},
        "findings": findings,
        "notice": "This is an informational posture review, not a penetration test or definitive security verdict. A missing header may be acceptable for some sites; verify application requirements.",
    }
    base = Path(app_root or Path(__file__).resolve().parent)
    reports_dir = base / "Logs" / "reports"
    logs_dir = base / "Logs"
    reports_dir.mkdir(parents=True, exist_ok=True)
    logs_dir.mkdir(parents=True, exist_ok=True)
    stamp = started_at.strftime("%Y%m%d_%H%M%S")
    safe_host = re.sub(r"[^a-zA-Z0-9.-]", "_", host)[:80]
    json_path = reports_dir / f"website_audit_{safe_host}_{stamp}.json"
    txt_path = reports_dir / f"website_audit_{safe_host}_{stamp}.txt"
    json_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    lines = [
        report["title"], "=" * len(report["title"]), f"Generated: {report['generated_at']}",
        f"Target: {origin}", f"Resolved IPs: {', '.join(addresses)}", "",
        "SCOPE: READ-ONLY. No port scanning, crawling, form submission, brute-force, or exploit tests.",
        "Results below are observations to review, not a conclusive vulnerability rating.", "",
        "HOMEPAGE", json.dumps(report["checks"]["homepage"], ensure_ascii=False, indent=2), "",
        "PAGE METADATA", json.dumps(page, ensure_ascii=False, indent=2), "",
        "DNS", json.dumps(dns_answers, ensure_ascii=False, indent=2), "",
        "TLS", json.dumps(tls, ensure_ascii=False, indent=2), "",
        "PUBLIC TEXT FILES", json.dumps(text_files, ensure_ascii=False, indent=2), "",
        "RDAP", json.dumps(rdap_summary, ensure_ascii=False, indent=2), "",
        "REVIEW ITEMS",
    ]
    lines.extend(f"[{item['level']}] {item['check']}: {item['detail']}" for item in findings)
    lines.extend(["", report["notice"], ""])
    txt_path.write_text("\n".join(lines), encoding="utf-8")
    with (logs_dir / "site_audit.log").open("a", encoding="utf-8") as handle:
        handle.write(f"[{started_at.isoformat(timespec='seconds')}] TARGET={host} STATUS=COMPLETED JSON={json_path.name} TXT={txt_path.name} FINDINGS={len(findings)}\n")
    report["report_files"] = {"json": str(json_path), "txt": str(txt_path)}
    print("\nAudit finished.")
    print("  Host:", host)
    print("  DNS addresses:", ", ".join(addresses))
    print("  HTTP status:", root.get("status", root.get("error", "unknown")))
    print("  Findings to review:", len(findings))
    print("  JSON report:", json_path)
    print("  TXT report:", txt_path)
    print("  Log:", logs_dir / "site_audit.log")
    print("\nInstalled tools are optional helpers; the automatic set does not blindly launch optional tools. The curated catalog has 16 apps, integrated where appropriate.")
    return report


def validate_target_for_test(raw: str) -> tuple[str, str, str]:
    """Public alias used by unit tests and other read-only SCAN modules."""
    return _validate_url(raw)


def resolve_addresses_for_test(host: str) -> list[str]:
    """Public alias used to test that local/private IP targets are refused."""
    return _resolve_public(host)
