#!/usr/bin/env python3
# Copyright (C) 2026 SCAN Rainbow Defense Toolkit contributors
# SPDX-License-Identifier: GPL-3.0-or-later
"""SCAN offline static file triage module.

This module never executes inspected files and never contacts extracted URLs.
Findings are heuristic indicators, not proof that a file is malicious or safe.
"""
from __future__ import annotations

import hashlib
import json
import math
import os
import re
from datetime import datetime
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent
LOG_DIR = ROOT / "Logs"
REPORT_DIR = LOG_DIR / "reports"
MAX_FILES = 500
MAX_FILE_SIZE = 250 * 1024 * 1024
MAX_TOTAL_HASH_BYTES = 1024 * 1024 * 1024
SAMPLE_SIZE = 512 * 1024
TEXT_SAMPLE_SIZE = 2 * 1024 * 1024

SIGNATURES: list[tuple[str, bytes]] = [
    ("PE executable / DLL", b"MZ"),
    ("PDF document", b"%PDF-"),
    ("PNG image", b"\x89PNG\r\n\x1a\n"),
    ("JPEG image", b"\xff\xd8\xff"),
    ("GIF image", b"GIF8"),
    ("ZIP-based archive / Office document", b"PK\x03\x04"),
    ("GZIP archive", b"\x1f\x8b"),
    ("ELF executable", b"\x7fELF"),
    ("SQLite database", b"SQLite format 3\x00"),
    ("Windows shortcut", b"\x4c\x00\x00\x00\x01\x14\x02\x00"),
]

EXTENSION_EXPECTATIONS = {
    ".exe": "PE executable / DLL", ".dll": "PE executable / DLL", ".sys": "PE executable / DLL",
    ".pdf": "PDF document", ".png": "PNG image", ".jpg": "JPEG image", ".jpeg": "JPEG image",
    ".gif": "GIF image", ".zip": "ZIP-based archive / Office document", ".docx": "ZIP-based archive / Office document",
    ".xlsx": "ZIP-based archive / Office document", ".pptx": "ZIP-based archive / Office document",
    ".gz": "GZIP archive", ".sqlite": "SQLite database", ".db": "SQLite database", ".lnk": "Windows shortcut",
}

INDICATORS: list[tuple[str, str, int]] = [
    ("PowerShell encoded-command flag", "powershell -enc", 12),
    ("PowerShell encoded-command flag", "powershell.exe -encodedcommand", 12),
    ("Base64 decode API reference", "frombase64string", 8),
    ("Windows Script Host automation reference", "wscript.shell", 10),
    ("Certutil URL-cache command reference", "certutil -urlcache", 12),
    ("BITS transfer command reference", "bitsadmin /transfer", 10),
    ("PowerShell download-string reference", "downloadstring(", 12),
    ("PowerShell download-file reference", "downloadfile(", 10),
    ("PowerShell expression execution reference", "invoke-expression", 8),
    ("Scheduled-task creation reference", "schtasks /create", 8),
    ("Run-key persistence path reference", "currentversion\\run", 8),
    ("Real-time protection modification reference", "disablerealtimemonitoring", 14),
    ("Process injection API reference", "writeprocessmemory", 10),
    ("Process injection API reference", "createremotethread", 10),
    ("HTML application host reference", "mshta.exe", 8),
]
URL_RE = re.compile(rb"https?://[A-Za-z0-9._~:/?#\[\]@!$&'()*+,;=%-]{5,240}", re.I)


def _entropy(data: bytes) -> float:
    if not data:
        return 0.0
    counts = [0] * 256
    for value in data:
        counts[value] += 1
    size = len(data)
    result = 0.0
    for count in counts:
        if count:
            p = count / size
            result -= p * math.log2(p)
    return result


def _detect_type(head: bytes, full_sample: bytes) -> str:
    for label, magic in SIGNATURES:
        if head.startswith(magic):
            if label == "PE executable / DLL" and len(full_sample) > 64:
                # MZ alone is weak; try to confirm the PE marker in the first MB.
                pe_offset = None
                try:
                    if len(full_sample) >= 0x40:
                        pe_offset = int.from_bytes(full_sample[0x3C:0x40], "little")
                except Exception:
                    pe_offset = None
                if pe_offset is not None and 0 <= pe_offset < len(full_sample) - 4 and full_sample[pe_offset:pe_offset + 4] == b"PE\x00\x00":
                    return "PE executable / DLL (PE marker found)"
                return "MZ header (PE marker not confirmed in sample)"
            return label
    stripped = head.lstrip()
    if stripped.startswith((b"#!", b"<?php", b"<html", b"<!DOCTYPE html", b"<script")):
        return "Text / script / HTML"
    if b"\x00" not in head[:4096]:
        try:
            head[:4096].decode("utf-8")
            return "Text / source file (heuristic)"
        except UnicodeDecodeError:
            pass
    return "Unknown / binary"


def _hash_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while True:
            block = handle.read(1024 * 1024)
            if not block:
                break
            digest.update(block)
    return digest.hexdigest()


def _analyse_one(path: Path) -> dict[str, Any]:
    findings: list[dict[str, str]] = []
    entry: dict[str, Any] = {"path": str(path), "findings": findings, "indicators": [], "urls_found_in_file": []}
    try:
        if path.is_symlink():
            entry.update({"status": "SKIPPED", "reason": "Symbolic links are not followed."})
            return entry
        if not path.is_file():
            entry.update({"status": "SKIPPED", "reason": "Not a regular file."})
            return entry
        stat = path.stat()
        entry["size_bytes"] = stat.st_size
        entry["modified_local"] = datetime.fromtimestamp(stat.st_mtime).astimezone().isoformat(timespec="seconds")
        if stat.st_size > MAX_FILE_SIZE:
            findings.append({"severity": "INFO", "title": "File exceeds analysis size limit", "detail": f"Skipped content analysis above {MAX_FILE_SIZE // (1024 * 1024)} MiB; metadata only."})
            entry.update({"status": "SIZE_LIMIT", "sha256": None, "detected_type": "Not inspected", "entropy_sample": None, "score": 0})
            return entry
        entry["sha256"] = _hash_file(path)
        with path.open("rb") as handle:
            head = handle.read(max(SAMPLE_SIZE, 4096))
        detected = _detect_type(head[:4096], head[:1024 * 1024])
        entry["detected_type"] = detected
        sample = head[:SAMPLE_SIZE]
        entropy = round(_entropy(sample), 3)
        entry["entropy_sample"] = entropy
        ext = path.suffix.lower()
        expected = EXTENSION_EXPECTATIONS.get(ext)
        if expected and expected not in detected:
            # .exe and .dll are expected to have a confirmed PE marker, but MZ-only is reported as a mismatch.
            findings.append({"severity": "MEDIUM", "title": "File type / extension mismatch", "detail": f"Extension {ext} suggests {expected}; sampled signature looks like {detected}. This can be benign or intentional."})
        if entropy >= 7.35 and stat.st_size >= 4096:
            findings.append({"severity": "LOW", "title": "High sample entropy", "detail": f"Sample entropy is {entropy}/8. Packed, compressed, encrypted, or random data can all have high entropy."})
        text_sample = head[:TEXT_SAMPLE_SIZE].decode("latin-1", errors="ignore").lower()
        for title, needle, weight in INDICATORS:
            if needle in text_sample:
                entry["indicators"].append({"indicator": title, "weight": weight, "matched_text": needle})
                findings.append({"severity": "MEDIUM" if weight < 12 else "HIGH", "title": title, "detail": f"Static string reference found: {needle!r}. String presence alone does not prove malicious behavior."})
        urls = []
        for match in URL_RE.findall(head[:TEXT_SAMPLE_SIZE]):
            url = match.decode("ascii", errors="ignore")
            if url not in urls:
                urls.append(url)
            if len(urls) >= 10:
                break
        entry["urls_found_in_file"] = urls
        score = 0
        for finding in findings:
            score += {"INFO": 0, "LOW": 5, "MEDIUM": 10, "HIGH": 15}.get(finding["severity"], 0)
        entry["score"] = min(100, score)
        entry["status"] = "ANALYSED"
    except PermissionError:
        entry.update({"status": "ERROR", "reason": "Access denied; run only if you have permission to inspect this file."})
    except OSError as exc:
        entry.update({"status": "ERROR", "reason": str(exc)[:240]})
    return entry


def _render_report(report: dict[str, Any]) -> str:
    lines = [
        "SCAN / OFFLINE STATIC FILE TRIAGE REPORT",
        "=" * 46,
        f"Created: {report['created_local']}",
        f"Target: {report['target']}",
        f"Files inspected / attempted: {report['file_count']}",
        "IMPORTANT: Heuristic triage only. This is not an antivirus verdict.",
        "No inspected file was executed and extracted URLs were not contacted.",
        "",
    ]
    for item in report["items"]:
        lines += ["-" * 46, f"File: {item['path']}", f"Status: {item.get('status', 'UNKNOWN')}"]
        if "size_bytes" in item:
            lines.append(f"Size: {item['size_bytes']:,} bytes ({item['size_bytes'] / (1024 * 1024):.2f} MiB)")
        if item.get("sha256"):
            lines.append(f"SHA-256: {item['sha256']}")
        if item.get("detected_type"):
            lines.append(f"Detected sample type: {item['detected_type']}")
        if item.get("entropy_sample") is not None:
            lines.append(f"Sample entropy: {item['entropy_sample']}/8")
        lines.append(f"Heuristic score: {item.get('score', 0)}/100 (not a probability)")
        if item.get("reason"):
            lines.append(f"Note: {item['reason']}")
        if item.get("findings"):
            lines.append("Findings:")
            for finding in item["findings"]:
                lines.append(f"  [{finding['severity']}] {finding['title']}: {finding['detail']}")
        else:
            lines.append("Findings: none from the limited heuristics in this module")
        if item.get("urls_found_in_file"):
            lines.append("URLs embedded in sample (not opened):")
            lines.extend(f"  {url}" for url in item["urls_found_in_file"])
    lines += ["", "End of report. A low score or no findings does not mean the file is safe."]
    return "\n".join(lines) + "\n"


def run_file_analysis() -> None:
    print("SCAN / DEEP FILE ANALYSIS — OFFLINE ONLY")
    print("Checks file metadata, SHA-256, sampled file signatures, extension mismatches,")
    print("sample entropy, selected suspicious strings, and URLs embedded in file samples.")
    print("It does not execute files, delete files, or contact discovered URLs.")
    print(f"Limits: up to {MAX_FILES} files; files over {MAX_FILE_SIZE // (1024 * 1024)} MiB are metadata-only; maximum content hashing per run is {MAX_TOTAL_HASH_BYTES // (1024 * 1024)} MiB.")
    raw = input("Path to a file or folder (quotes are okay): ").strip().strip('"')
    if not raw:
        print("Cancelled; no path was supplied.")
        return
    target = Path(os.path.expandvars(raw)).expanduser()
    try:
        target = target.resolve(strict=True)
    except OSError as exc:
        print(f"Cannot resolve path: {exc}")
        return
    if target.is_file():
        paths = [target]
    elif target.is_dir():
        paths = []
        try:
            for root, dirs, files in os.walk(target, followlinks=False):
                dirs[:] = [d for d in dirs if not (Path(root) / d).is_symlink()]
                for filename in files:
                    candidate = Path(root) / filename
                    paths.append(candidate)
                    if len(paths) >= MAX_FILES:
                        break
                if len(paths) >= MAX_FILES:
                    break
        except OSError as exc:
            print(f"Some directory entries could not be read: {exc}")
        if not paths:
            print("No regular files were found in the selected folder.")
            return
    else:
        print("The target must be an existing file or folder.")
        return

    items = []
    total = len(paths)
    total_hashed_bytes = 0
    for index, path in enumerate(paths, 1):
        print(f"\rAnalysing file {index}/{total}: {path.name[:55]:55}", end="", flush=True)
        try:
            size = path.stat().st_size
        except OSError:
            size = 0
        if size <= MAX_FILE_SIZE and total_hashed_bytes + size > MAX_TOTAL_HASH_BYTES:
            items.append({
                "path": str(path), "status": "TOTAL_BUDGET_LIMIT", "size_bytes": size,
                "reason": f"Content analysis skipped because the run-wide hashing budget ({MAX_TOTAL_HASH_BYTES // (1024 * 1024)} MiB) was reached.",
                "findings": [], "indicators": [], "urls_found_in_file": [], "score": 0,
            })
            continue
        item = _analyse_one(path)
        items.append(item)
        if item.get("status") == "ANALYSED":
            total_hashed_bytes += size
    print()
    created = datetime.now().astimezone().isoformat(timespec="seconds")
    report = {"created_local": created, "target": str(target), "file_count": len(items), "items": items,
              "limits": {"max_files": MAX_FILES, "max_file_size_bytes": MAX_FILE_SIZE,
                         "max_total_hash_bytes": MAX_TOTAL_HASH_BYTES, "actual_hashed_bytes": total_hashed_bytes},
              "disclaimer": "Static heuristic triage only; not proof of maliciousness or safety."}
    try:
        REPORT_DIR.mkdir(parents=True, exist_ok=True)
        stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        base = REPORT_DIR / f"deep_file_analysis_{stamp}"
        json_path = base.with_suffix(".json")
        text_path = base.with_suffix(".txt")
        json_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
        text_path.write_text(_render_report(report), encoding="utf-8")
        log_path = LOG_DIR / "security_analysis.log"
        LOG_DIR.mkdir(parents=True, exist_ok=True)
        with log_path.open("a", encoding="utf-8") as handle:
            flagged = sum(1 for item in items if item.get("score", 0) > 0)
            handle.write(f"{created}\tFILE_ANALYSIS\tfiles={len(items)}\titems_with_indicators={flagged}\ttarget={target}\treport={text_path}\n")
        print(f"Report (TXT):  {text_path}")
        print(f"Report (JSON): {json_path}")
    except OSError as exc:
        print(f"Could not save the report: {exc}")
    flagged = sum(1 for item in items if item.get("score", 0) > 0)
    errors = sum(1 for item in items if item.get("status") == "ERROR")
    print(f"Summary: {len(items)} file(s), {flagged} with heuristic indicators, {errors} read error(s).")
    print("Reminder: this is a static triage result, not a definitive malware verdict.")
