from __future__ import annotations

import ast
import json
import re
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import scan
import security_analysis
import site_audit


class ProjectIntegrityTests(unittest.TestCase):
    def test_optional_catalog_has_16_contiguous_practical_entries(self) -> None:
        catalog = scan.EXTERNAL_TOOL_CATALOG
        self.assertEqual(len(catalog), 16)
        self.assertEqual(sorted(catalog), list(range(1, 17)))
        package_ids = [entry[1].lower() for entry in catalog.values()]
        self.assertEqual(len(package_ids), len(set(package_ids)))
        for name, package_id, description, url in catalog.values():
            self.assertTrue(name.strip(), package_id)
            self.assertTrue(package_id.strip(), name)
            self.assertTrue(description.strip(), name)
            self.assertTrue(url.startswith("https://"), name)

    def test_core_plus_optional_catalog_has_76_entries(self) -> None:
        source = (ROOT / "scan.py").read_text(encoding="utf-8")
        tree = ast.parse(source)
        core_menu = None
        for node in ast.walk(tree):
            if isinstance(node, ast.Assign) and any(
                isinstance(target, ast.Name) and target.id == "core_menu" for target in node.targets
            ):
                core_menu = ast.literal_eval(node.value)
                break
        self.assertIsNotNone(core_menu, "main() must define core_menu as a literal list")
        self.assertEqual(len(core_menu), 60)
        self.assertEqual(scan.CORE_MENU_COUNT, 60)
        self.assertEqual(len(core_menu) + len(scan.EXTERNAL_TOOL_CATALOG), 76)

    def test_consent_catalog_matches_python_catalog(self) -> None:
        source = (ROOT / "consent.ps1").read_text(encoding="utf-8-sig")
        names = re.findall(r"@\{N=(\d+); Name='([^']+)'\}", source)
        self.assertEqual(len(names), 16)
        powershell_names = {int(number): name for number, name in names}
        python_names = {number: entry[0] for number, entry in scan.EXTERNAL_TOOL_CATALOG.items()}
        self.assertEqual(powershell_names, python_names)
        self.assertIn("Show-ConsentDialog", source)
        self.assertNotIn(")    while ($true)", source)

    def test_documented_catalog_names_ids_and_menu_numbers_match(self) -> None:
        catalog = (ROOT / "TOOL_CATALOG_KO.txt").read_text(encoding="utf-8-sig")
        entries = re.findall(r"\[(\d+) \| 메인 메뉴 (\d+)\] (.+?)\n  WinGet ID: ([^\n]+)", catalog)
        self.assertEqual(len(entries), 16)
        for number_text, menu_text, name, package_id in entries:
            number = int(number_text)
            menu_number = int(menu_text)
            self.assertIn(number, scan.EXTERNAL_TOOL_CATALOG)
            expected_name, expected_id = scan.EXTERNAL_TOOL_CATALOG[number][:2]
            self.assertEqual(name, expected_name)
            self.assertEqual(package_id.strip(), expected_id)
            self.assertEqual(menu_number, scan.CORE_MENU_COUNT + number)
        self.assertNotRegex(catalog, r"(?m)^\[\d+ \| 메인 메뉴 \d+\] KeePassXC$")
        self.assertNotRegex(catalog, r"(?m)^\[\d+ \| 메인 메뉴 \d+\] OWASP ZAP$")

    def test_optional_cli_tools_are_referenced_by_integrated_workflows(self) -> None:
        source = (ROOT / "scan.py").read_text(encoding="utf-8")
        # GUI launch is intentional for Docker Desktop/Wireshark; their CLIs are wired separately.
        for key in ("nmap", "tshark", "autorunsc", "sigcheck", "openssl", "git", "node",
                    "7z", "clamscan", "gitleaks", "trivy", "gh", "docker", "pwsh", "curl", "ruff"):
            with self.subTest(tool=key):
                self.assertIn(f'"{key}"', source)
        self.assertIn('for version in ("3.12", "3.13", "3.14", "3.11")', source)
        self.assertIn('def sbom_inventory_tool()', source)
        self.assertIn('def windows_host_health_snapshot()', source)
        self.assertIn('def tshark_capture_review_tool()', source)

    def test_all_added_workflows_are_registered(self) -> None:
        source = (ROOT / "scan.py").read_text(encoding="utf-8")
        self.assertIn('("01", "AUTO SITE AUDIT SET")', source)
        for menu_number, function_name, label in (
            ("43", "tshark_capture_review_tool", "LOCAL PCAP REVIEW — TSHARK"),
            ("44", "windows_host_health_snapshot", "WINDOWS HOST HEALTH — POWERSHELL"),
            ("45", "sbom_inventory_tool", "SOFTWARE INVENTORY SBOM — TRIVY"),
        ):
            self.assertRegex(source, rf'"{menu_number}": {function_name}')
            self.assertIn(label, source)
        self.assertIn('"tshark": ("tshark.exe", "tshark")', source)
        self.assertIn('"trivy":11', source)


    def test_v20_workflows_registered_and_consent_title_replaced(self) -> None:
        source = (ROOT / "scan.py").read_text(encoding="utf-8")
        consent = (ROOT / "consent.ps1").read_text(encoding="utf-8-sig")
        for number, function_name, label in (
            ("46", "local_windows_baseline_set", "SET: WINDOWS BASELINE"),
            ("47", "project_release_readiness_set", "SET: PROJECT RELEASE READINESS"),
            ("48", "file_triage_set", "SET: FILE TRIAGE"),
            ("49", "duplicate_file_finder", "DUPLICATE FILE FINDER"),
            ("50", "large_file_inventory", "LARGE FILE INVENTORY"),
            ("51", "json_validator_tool", "JSON VALIDATOR"),
            ("52", "xml_validator_tool", "XML VALIDATOR"),
            ("53", "csv_structure_tool", "CSV STRUCTURE CHECK"),
            ("54", "file_entropy_tool", "FILE ENTROPY ESTIMATE"),
            ("55", "pem_certificate_inspector", "PEM CERTIFICATE INSPECTOR"),
            ("56", "windows_event_log_summary", "WINDOWS EVENT LOG SUMMARY"),
            ("57", "scheduled_task_inventory", "SCHEDULED TASK INVENTORY"),
            ("58", "secret_name_hygiene_check", "SECRET FILENAME HYGIENE"),
            ("59", "ipv4_subnet_calculator", "IPV4 SUBNET CALCULATOR"),
            ("60", "scan_log_analyzer", "SCAN LOG ANALYZER"),
        ):
            self.assertIn(f'"{number}": {function_name}', source)
            self.assertIn(label, source)
        self.assertIn("개인정보 처리 · 안전 사용 · 라이선스 전문 동의", consent)
        self.assertNotIn("$letters = @('S', 'C', 'A', 'N')", consent)

    def test_site_audit_normalizes_domain_to_origin(self) -> None:
        origin, host, scheme = site_audit.validate_target_for_test("https://example.com/security/path?q=1")
        self.assertEqual(origin, "https://example.com/")
        self.assertEqual(host, "example.com")
        self.assertEqual(scheme, "https")

    def test_site_audit_rejects_local_ip_credentials_and_non_http_schemes(self) -> None:
        values = (
            "127.0.0.1", "http://localhost", "https://user:pass@example.com", "ftp://example.com",
            "http://example.com:8080", "https://example.com:80", "http://example.com:443",
        )
        for value in values:
            with self.subTest(value=value), self.assertRaises(ValueError):
                site_audit.validate_target_for_test(value)

    def test_site_audit_blocks_private_dns_answers(self) -> None:
        with patch.object(site_audit.socket, "getaddrinfo", return_value=[(2, 1, 6, "", ("192.168.1.5", 0))]):
            with self.assertRaises(ValueError):
                site_audit.resolve_addresses_for_test("example.com")

    def test_site_audit_html_parser_extracts_metadata_without_submitting_forms(self) -> None:
        parser = site_audit._PageInfo()
        parser.feed('<title>Demo</title><meta name="description" content="A page"><img src="http://cdn.example/x.png"><form action="http://example.com/login"><input type="password"></form>')
        self.assertEqual(parser.title, "Demo")
        self.assertEqual(parser.meta["description"], "A page")
        self.assertEqual(len(parser.external_http_assets), 1)
        self.assertTrue(parser.forms[0]["password_field"])
        self.assertEqual(parser.forms[0]["method"], "get")

    def test_site_audit_writes_txt_json_and_log_with_mocked_network(self) -> None:
        root_response = {
            "url": "https://example.com/", "status": 200,
            "headers": {"content-type": "text/html", "strict-transport-security": "max-age=31536000"},
            "set_cookie": [], "body": "<title>Example</title><p>Hello</p>", "body_bytes_read": 31,
            "truncated": False, "elapsed_ms": 1,
        }
        text_response = {"url": "https://example.com/robots.txt", "status": 404, "headers": {},
                         "set_cookie": [], "body": "", "body_bytes_read": 0, "truncated": False, "elapsed_ms": 1}
        with tempfile.TemporaryDirectory() as temp_dir, \
             patch.object(site_audit, "_resolve_public", return_value=["93.184.216.34"]), \
             patch.object(site_audit, "_doh", return_value={"status": 0, "answers": []}), \
             patch.object(site_audit, "_tls_check", return_value={"ok": True, "protocol": "TLSv1.3", "not_after": "Jan 1 00:00:00 2030 GMT"}), \
             patch.object(site_audit, "_request", side_effect=[root_response, text_response, text_response, text_response]), \
             patch.object(site_audit, "_request_json", return_value={"ldhName": "example.com", "status": [], "events": [], "entities": []}), \
             patch.object(site_audit.time, "sleep", return_value=None):
            result = site_audit.audit_site("example.com", app_root=Path(temp_dir))
            paths = result["report_files"]
            self.assertTrue(Path(paths["json"]).is_file())
            self.assertTrue(Path(paths["txt"]).is_file())
            self.assertTrue((Path(temp_dir) / "Logs" / "site_audit.log").is_file())
            saved = json.loads(Path(paths["json"]).read_text(encoding="utf-8"))
            self.assertTrue(saved["scope"]["read_only"])
            self.assertFalse(saved["scope"]["redirects_followed"])

    def test_static_file_triage_is_read_only_and_returns_expected_fields(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            sample = Path(temp_dir) / "sample.txt"
            sample.write_bytes(b"powershell -enc Zg== https://example.org/path\n")
            result = security_analysis._analyse_one(sample)
        self.assertEqual(result["status"], "ANALYSED")
        self.assertRegex(result["sha256"], r"^[0-9a-f]{64}$")
        self.assertTrue(result["indicators"])
        self.assertTrue(any("example.org" in item for item in result["urls_found_in_file"]))

    def test_sqlmap_self_test_runner_with_safe_dummy_script(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            dummy = Path(temp_dir) / "dummy_sqlmap.py"
            dummy.write_text("print('sqlmap-dummy-version')\n", encoding="utf-8")
            with patch.object(scan, "_sqlmap_python_candidates", return_value=[sys.executable]):
                ok, detail = scan._test_sqlmap(dummy)
        self.assertTrue(ok, detail)
        self.assertIn("sqlmap-dummy-version", detail)

    def test_tshark_workflow_uses_local_capture_only_and_writes_report(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            capture = Path(temp_dir) / "sample.pcapng"
            capture.write_bytes(b"fake-capture")
            logs = Path(temp_dir) / "Logs"
            with patch.object(scan, "LOG_DIR", logs), \
                 patch("builtins.input", side_effect=[str(capture), "YES"]), \
                 patch.object(scan, "_integration_exe", return_value="tshark"), \
                 patch.object(scan, "_run_cli_step", side_effect=[
                     {"name": "protocol", "status": "OK", "stdout": "Ethernet: 10"},
                     {"name": "conversations", "status": "OK", "stdout": "TCP: 5"},
                 ]) as run_step, \
                 patch.object(scan, "_composite_report", return_value=(logs / "x.txt", logs / "x.json")), \
                 patch.object(scan, "pause"), patch.object(scan, "clear_screen"):
                scan.tshark_capture_review_tool()
            self.assertEqual(run_step.call_count, 2)
            first_args = run_step.call_args_list[0].args
            self.assertIn("-r", first_args[2])
            read_path = Path(first_args[2][first_args[2].index("-r") + 1])
            # Windows may resolve a short 8.3 temporary path to its long-name alias.
            self.assertEqual(read_path.resolve(), capture.resolve())
            self.assertNotIn("-i", first_args[2], "workflow must read a file, not start a live capture")

    def test_sbom_workflow_invokes_trivy_and_never_requests_db_update(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            folder = Path(temp_dir) / "project"
            folder.mkdir()
            logs = Path(temp_dir) / "Logs"
            def fake_run(name, exe, args, **kwargs):
                output_path = Path(args[args.index("--output") + 1])
                output_path.parent.mkdir(parents=True, exist_ok=True)
                output_path.write_text(json.dumps({"bomFormat": "CycloneDX", "components": [{"name": "a"}, {"name": "b"}]}), encoding="utf-8")
                return {"name": name, "status": "OK", "returncode": 0, "report_path": str(output_path)}
            with patch.object(scan, "LOG_DIR", logs), \
                 patch.object(scan, "_pick_directory", return_value=folder), \
                 patch.object(scan, "_integration_exe", return_value="trivy"), \
                 patch.object(scan, "_ask_yes", return_value=True), \
                 patch.object(scan, "_run_cli_step", side_effect=fake_run) as run_step, \
                 patch.object(scan, "_composite_report", return_value=(logs / "summary.txt", logs / "summary.json")), \
                 patch.object(scan, "pause"), patch.object(scan, "clear_screen"):
                scan.sbom_inventory_tool()
            argv = run_step.call_args.args[2]
            self.assertIn("cyclonedx", argv)
            self.assertIn("--skip-db-update", argv)
            self.assertIn("--skip-java-db-update", argv)
            self.assertFalse(any(arg in ("image", "docker") for arg in argv))

    def test_integrated_tool_runner_uses_argv_not_shell_and_returns_status(self) -> None:
        completed = type("Completed", (), {"returncode": 0, "stdout": "tool v1", "stderr": ""})()
        with patch.object(scan.subprocess, "run", return_value=completed) as runner, patch.object(scan, "log_event"):
            result = scan._run_cli_step("mock tool", "mock.exe", ["--version"], timeout=2)
        self.assertEqual(result["status"], "OK")
        self.assertIn("shell", runner.call_args.kwargs)
        self.assertFalse(runner.call_args.kwargs["shell"])

    def test_github_publisher_excludes_batch_files_and_runtime_data(self) -> None:
        gitignore = (ROOT / ".gitignore").read_text(encoding="utf-8")
        readme = (ROOT / "README.md").read_text(encoding="utf-8")
        self.assertIn("PUBLISH_TO_GITHUB_SCAN_v20.bat", readme)
        self.assertIn('*.bat', gitignore)
        self.assertIn("/tools/sqlmap/", gitignore)
        self.assertIn(".env", gitignore)
        self.assertFalse((ROOT / "PUBLISH_TO_GITHUB.bat").exists())

    def test_docs_match_v20_curated_counts_and_local_sqlmap_scope(self) -> None:
        readme = (ROOT / "README.md").read_text(encoding="utf-8")
        guide = (ROOT / "USER_GUIDE_KO.txt").read_text(encoding="utf-8-sig")
        self.assertIn("60 built-in actions", readme)
        self.assertIn("16 optional applications", readme)
        self.assertIn("restricted by SCAN to `localhost`, `127.0.0.1`, or `::1`", readme)
        self.assertIn("SQLMap", guide)
        self.assertIn("Local PCAP Review", guide)
        self.assertIn("SBOM", guide)

    def test_startup_tool_selection_shows_status_skips_ready_apps_and_supports_updates(self) -> None:
        consent = (ROOT / "consent.ps1").read_text(encoding="utf-8-sig")
        source = (ROOT / "scan.py").read_text(encoding="utf-8")
        for feature in (
            "function Get-OptionalToolStatus",
            "return 'INSTALLED'",
            "return 'DOWNLOADED'",
            "Write-OptionalToolCell",
            "Start-Sleep -Seconds 3",
            "Write-PreDownloadSelection 'NONE'",
            "Green = installed or downloaded",
            "Action [I/U/D/Q]",
        ):
            with self.subTest(feature=feature):
                self.assertIn(feature, consent)
        self.assertIn('if action in ("i", "u")', source)
        self.assertIn('verb = "upgrade" if action == "u" else "install"', source)
        self.assertIn('if raw in ("i", "d", "u")', source)

    def test_consent_catalog_and_loop_are_syntactically_separated(self) -> None:
        source = (ROOT / "consent.ps1").read_text(encoding="utf-8-sig")
        self.assertNotIn(")    while ($true)", source)
        self.assertRegex(source, r"@\{N=16; Name='Ruff'; PackageId='astral-sh\.ruff'\}\s*\)\s+while \(\$true\)")
        self.assertRegex(source, r"for \(\$row = 0; \$row -lt 8; \$row\+\+\)\s*\{\s*\$left = \$items\[\$row\]\s*\$right = \$items\[\$row \+ 8\]")

    def test_agree_guide_uses_static_scrollable_windows_form_without_console_redraw(self) -> None:
        source = (ROOT / "consent.ps1").read_text(encoding="utf-8-sig")
        dialog = source.split("function Show-ConsentDialog {", 1)[1].split("\ntry {", 1)[0]
        self.assertIn("System.Windows.Forms.RichTextBox", dialog)
        self.assertIn("RichTextBoxScrollBars]::Vertical", dialog)
        self.assertIn("Add_CheckedChanged", dialog)
        self.assertIn("$agree.Enabled = $false", dialog)
        self.assertIn("$agree.Enabled = $ack.Checked", dialog)
        self.assertNotIn("[Console]::Clear()", dialog)
        self.assertNotIn("Animate-RainbowBanner", dialog)
        launcher = (ROOT / "SCAN.bat").read_text(encoding="utf-8-sig")
        consent_line = next(line for line in launcher.splitlines() if '-File "%~dp0consent.ps1"' in line)
        self.assertIn("-STA", consent_line)

    def test_powershell_syntax_preflight_runs_before_consent_ui(self) -> None:
        launcher = (ROOT / "SCAN.bat").read_text(encoding="utf-8-sig")
        self.assertIn("validate_scripts.ps1", launcher)
        self.assertIn("POWERSHELL_SYNTAX_CHECK_EXIT", launcher)
        self.assertLess(launcher.index('-File "%~dp0validate_scripts.ps1"'), launcher.index('-File "%~dp0consent.ps1"'))
        validator = (ROOT / "validate_scripts.ps1").read_text(encoding="utf-8-sig")
        self.assertIn("Parser]::ParseFile", validator)
        self.assertIn("POWERSHELL_PARSE_ERROR", validator)


if __name__ == "__main__":
    unittest.main(verbosity=2)
