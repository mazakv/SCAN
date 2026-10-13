# Contributing to SCAN v19

1. Keep integrated workflows read-only by default and require confirmation for file/network actions.
2. Never build shell command strings from user inputs; use argument lists with `shell=False`.
3. Do not store secrets in logs. Secret scanner reports must be redacted.
4. Add unit tests for tool lookup/workflow behavior and keep scan outputs out of source control.
5. The current catalogue has 60 built-in menu actions and 16 curated optional apps. The old 100-item target was intentionally reduced to avoid unnecessary installs.
