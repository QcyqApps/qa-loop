# Changelog

## 0.2.2 — 2026-10-07

More fixes for the plugin directory's validation findings.

- No text file names a bundled image any more.
- The tester's instructions describe how to call an API from the page in words, without inline code that sends requests.

## 0.2.1 — 2026-10-07

Fixes for the plugin directory's validation findings.

- A listing icon, with its SVG source in the docs folder.
- The tester writes each API call as a script in the case's evidence folder and runs it from there, so the call can be replayed later.
- The example report's screenshots moved to a flat folder, so test fixtures no longer look like references to bundled images.
- The demo server no longer builds URLs from the request's Host header, and the tests no longer use credential-like variable names.

## 0.2.0 — 2026-10-07

Watch the tester work, and lend it a hand.

- `--watch` (or `watch: true` in the config) opens playwright-cli's dashboard: a live view of every browser session of the run, headless ones included.
- Assist: when a step needs a person, such as a code from an SMS, a CAPTCHA or a state the tester can't reach, the tester asks for help. You take control of its session in the live view. `qa-loop assist start/stop` records your steps as a replayable `human-steps.js`, with values typed into password, PIN and code fields masked.
- Reports and Jira comments list the cases done with human help up front.
- Failure replays are recorded as video (`replay.webm`) with each action labeled. `qa-loop end` finishes a recording the tester left running.
- New CLI commands: `qa-loop watch` and `qa-loop assist`.

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
