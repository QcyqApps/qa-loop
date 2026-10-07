# Changelog

## 0.1.1 — 2026-10-07

Preparation for Anthropic's plugin directory.

- Trace hints point to `qa-loop trace` and to the viewer bundled with playwright-cli. They used to suggest downloading a separate viewer, which can be too old to read the traces.
- README: examples, troubleshooting, and what qa-loop runs, sends and stores.
- New `PRIVACY.md` and `SECURITY.md`, plus the directory listing links (documentation, support, privacy policy) in `plugin.json`.
- The tests build their fake JWT at runtime, so the repository contains no token-shaped strings.

## 0.1.0 — 2026-10-07

First public release.

- `/qa-loop:test`: reads a Jira ticket (or a ticket file), asks for missing context, plans acceptance, regression, exploratory and API cases, and gets the user's approval for any data changes. It runs a separate black-box tester and returns a rule-based verdict with a report and a Jira comment.
- `/qa-loop:setup`: writes `.qa/config.yml` (environments, roles, identity markers, safety, Jira statuses), saves a login per role, and optionally pre-approves the commands.
- `qa-loop:qa-tester` agent: drives a real browser with playwright-cli. It keeps evidence for every case (trace, screenshots, DOM, console, network), replays failures before reporting them, and writes a repro script for each failure.
- `qa-loop` CLI: deterministic verdict rules, evidence packing, secret redaction (cookies, auth headers, JWTs including in URLs), a browser network guard, identity checks for apps without an on-screen identity, and a trace viewer launcher.
- Hooks: the tester is a black box limited to `.qa/runs/`, and product files are read-only while a QA run is active.
- Demo app with planted bugs that doubles as an end-to-end check.
