# qa-loop

[![tests](https://github.com/QcyqApps/qa-loop/actions/workflows/test.yml/badge.svg)](https://github.com/QcyqApps/qa-loop/actions/workflows/test.yml)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**An independent AI QA tester for [Claude Code](https://claude.com/claude-code).** Give it a ticket and it works like a good manual tester:

- it reads the acceptance criteria and asks you what is unclear,
- it clicks through your app in a real browser: criteria, exploratory edge cases, regressions, and API calls through the same session,
- it returns a verdict with evidence: **ACCEPTED / REJECTED / NEEDS DECISION / UNTESTABLE**,
- after your confirmation, it posts the result to Jira and moves the ticket.

```
/qa-loop:test PROJ-123
```

## Why

When an agent writes most of the code, verification becomes the bottleneck. A coding agent that checks its own work shares its own blind spots. qa-loop is a separate tester that sees only the ticket, never the developer's reasoning or the source code. Its verdict is computed by code from evidence on disk, not taken from a model's opinion.

On its first real ticket, qa-loop found an unauthenticated data-access bug in a list API that had passed code review, plus an inverted default filter and a missing permission. Each finding came with exact steps, a Playwright trace and a script that replays it.

## How it works

```
/qa-loop:test PROJ-123
   │
   ▼
orchestrator (your Claude Code session)
   • reads the Jira ticket, the PR diff, .qa/config.yml and .qa/knowledge.md
   • asks what's unclear: multiple choice, or type your own answer
   • writes the plan (acceptance, regression and exploratory cases, plus approved data changes)
   │
   ▼
qa-tester agent (separate context, black box: a hook blocks it from reading your code)
   • playwright-cli: a real browser with one saved login per role, verified by an identity marker
   • every case: Playwright trace, screenshots, DOM, console, network, with secrets redacted
   • every failure replayed from a clean state, plus a repro script the developer can run
   • needs a human? it returns questions; the orchestrator asks you and resumes it
   │
   ▼
qa-loop verdict (code, not a model)
   • PASS needs an assertion and evidence on disk; FAIL needs two reproductions
   • only acceptance criteria and confirmed blocking bugs can reject
   │
   ▼
report.md (with screenshots) + Jira comment and status change (after you confirm)
```

See an [example report](docs/example-report.md) from the bundled demo app.

## Install

Requirements:

- a recent Claude Code (developed and tested with 2.1.29x)
- Node.js 18+, plus `zip` and `unzip`
- macOS or Linux
- [playwright-cli](https://github.com/microsoft/playwright-cli), tested with 0.1.22

```bash
npm install -g @playwright/cli@latest
claude plugin marketplace add QcyqApps/qa-loop
claude plugin install qa-loop@qa-loop
```

Optional:

- **Jira**: connect an Atlassian MCP server, e.g. the claude.ai Atlassian connector. Without it, give the ticket as a file or paste it.
- **PR context**: `gh`, logged in. qa-loop reads the changed files of the PR linked in the ticket and uses them to plan regression checks.

## Try it on the demo

```bash
git clone https://github.com/QcyqApps/qa-loop && cd qa-loop
node examples/demo-app/server.mjs                 # http://localhost:4317
```

Then, in Claude Code, run `/qa-loop:test examples/demo-app/tickets/DEMO-1.md`. Expect **REJECTED**: one acceptance criterion fails, and the exploratory charters find several of the planted bugs. See [examples/demo-app](examples/demo-app/README.md).

## Set up your project

Run `/qa-loop:setup` once per project. It does three things:

- **Writes `.qa/config.yml`**: environments and allowed hosts, production hosts to block, roles and how to prove each identity, test data notes, what must never be done, Jira statuses, and budgets ([template](templates/config.yml)).
- **Saves a login per role.** You log in once in a browser window (SSO and MFA work), and the state goes to `.qa/auth/<role>.json`, which is gitignored. No passwords are stored in any file.
- **Optionally pre-approves the commands.** `playwright-cli` and `qa-loop` commands then don't prompt for every click.

## Use

| Command | What it does |
|---|---|
| `/qa-loop:test PROJ-123` | standard run: every criterion, 1–3 regression and 2–4 exploratory checks |
| `/qa-loop:test PROJ-123 --quick` | criteria and a minimal smoke check |
| `/qa-loop:test PROJ-123 --deep` | more regression, exploratory and API checks |
| `/qa-loop:test path/to/ticket.md` | a ticket from a file |
| `/qa-loop:test PROJ-123 --retest` | after a fix: the previous repro scripts and failed cases first, then everything again |

You can also ask in your own words, in any language, e.g. "test PROJ-123" or "przetestuj PROJ-123". Reports and Jira comments are in English or Polish (`language` in the config).

**What a run costs.** On a real ticket with 8 acceptance criteria and 14 cases, the tester worked for about 50 minutes and used about 280k tokens, plus the orchestrator's share. A quick run on the demo (4 cases) took 11 minutes and about 135k tokens. Budgets per mode are in the config.

## Examples

1. **Set up a project once.** Run `/qa-loop:setup`. It asks about environments and roles, writes `.qa/config.yml`, and opens a browser window where you log in once per role.
2. **Test a ticket before you merge.** Run `/qa-loop:test PROJ-123`.
   - qa-loop reads the ticket and its pull request, asks about unclear criteria, and shows the plan for your approval.
   - It tests in the browser and returns a verdict with evidence, for example "REJECTED: AC-2 fails for the store manager role", with steps, screenshots and a repro script.
   - After you confirm, it posts the report to Jira and moves the ticket.
3. **Re-test after a fix.** Run `/qa-loop:test PROJ-123 --retest`. The earlier failures' repro scripts run first, then the whole plan runs again for a new verdict.
4. **Try it without a project.** Start the [demo app](#try-it-on-the-demo) and run `/qa-loop:test examples/demo-app/tickets/DEMO-1.md`. Expect REJECTED, with the planted bugs among the findings.

## Verdict rules

| Verdict | When |
|---|---|
| REJECTED | an acceptance criterion FAILs (reproduced twice, with evidence), a confirmed high/critical bug is related to the change, or you marked a finding as blocking |
| NEEDS DECISION | a criterion couldn't be confirmed (blocked, flaky, no evidence), behavior the ticket doesn't specify raised an open question, or a bug needs your judgment |
| UNTESTABLE | no acceptance criterion could be executed; the report says what's missing |
| ACCEPTED | every criterion passed with evidence and nothing blocking is open |

Exploratory testing produces two kinds of findings:
- **bugs**, which are objective: a crash, a 5xx, a data leak, a contradiction of the ticket,
- **questions** about behavior the ticket doesn't specify.

You answer the questions with one of: blocks the ticket, separate ticket, or works as intended. qa-loop proposes saving the answers to `.qa/knowledge.md`, so it doesn't ask twice.

## Evidence

Every run gets `.qa/runs/<ticket>/<timestamp>/`, which is gitignored:

```
ticket.md  plan.json  env.json  results.json  decisions.json
report.md          ← the full report, with screenshots inline
jira-comment.md    ← what gets posted to Jira
evidence/AC-4/     ← screenshots, dom.yml, console.txt, network.txt, trace.zip, repro.js
```

- **`trace.zip`** is a Playwright trace: every step, the DOM before and after it, screenshots, console and network. Open it with the viewer bundled with playwright-cli. The report prints the exact command.
- **`repro.js`** replays one failure in a logged-in session: `playwright-cli -s=<session> run-code --filename=repro.js`. It returns `{ reproduced, observed, expected }`.

## Safety

**Use qa-loop only on applications and environments you are authorized to test.** The tester probes access control: it checks that roles can't see each other's data, and that requests without a valid session are refused.

Rules that code enforces:

- **Black-box tester.** A hook limits the tester's Read, Grep, Glob and Write to `.qa/runs/`, so it can neither read your source nor change files.
- **Frozen code during a run.** From the start of a run until the verdict, Edit and Write on product files are blocked, so results describe the tested code. `qa-loop run close` ends an abandoned run.
- **Network guard.** `safety.blocked_hosts` (production) are blocked inside the browser. `strict_hosts: true` blocks everything outside `allowed_hosts`.
- **Secrets.** Session cookies, auth headers, JWTs (also in URLs) and token query parameters are redacted from traces, logs and saved request bodies.

Rules the agents follow:

- **Look is not act.** On a non-local environment, the tester performs only the data changes you approved in the plan (`mutations`). Everything it creates is listed in the report.
- **Logins.** The tester only uses saved sessions, and it proves each role's identity before testing as that role.
- **Jira.** Nothing is posted and no status changes without your explicit choice.

Traces and screenshots can contain data from the test environment. Keep `.qa/runs/` local.

## What qa-loop runs, sends and stores

On your machine, qa-loop runs:

- its own Node.js scripts: the `qa-loop` command and the guard hook. They have no dependencies and need no install step.
- [playwright-cli](https://github.com/microsoft/playwright-cli), which you install, to drive the browser.
- `git` for the local diff, `zip` and `unzip` for traces, and `gh` if you use it.

It connects to:

- **Your app under test.** The browser opens the app at the URLs in `.qa/config.yml`, and `qa-loop env` checks that they respond. Pages can load other hosts, as they would for any visitor, except `blocked_hosts`. With `strict_hosts: true`, anything outside `allowed_hosts` is blocked too.
- **Jira**, through the Atlassian connector you added to Claude. It reads the ticket. It posts a comment or changes the status only after you confirm.
- **GitHub**, through `gh`, when a ticket links a pull request. It reads the pull request's latest commit and its list of changed files.

qa-loop has no telemetry and sends nothing to its author. What the tester sees in the browser becomes part of your Claude Code session, like any other tool output: page snapshots, screenshots, and console and network summaries.

It stores everything in your project's `.qa/` folder:

- `config.yml` and `knowledge.md`. Knowledge is saved only after you agree.
- `auth/<role>.json`: the saved browser login for each role (cookies and local storage). Treat these files like passwords.
- `runs/`: plans, reports and evidence, with secrets redacted. They stay until you delete them.
- `.gitignore`, which keeps `auth/` and `runs/` out of git.

It changes Claude Code in two ways:

- The plugin's hook allows or denies file tools, as described under [Safety](#safety).
- `/qa-loop:setup` can add two allow rules to `.claude/settings.local.json`, `Bash(playwright-cli *)` and `Bash(qa-loop *)`, but only after you agree.

See also the [privacy policy](PRIVACY.md) and the [security policy](SECURITY.md).

## Limitations

- **Web apps only.** The UI, plus APIs called through the browser session. Data-model, migration and internal-job changes are checked only through what the UI or the API exposes. Emails and external integrations can't be observed.
- **Evidence isn't attached to Jira**, because the Atlassian MCP can't upload files. The comment carries exact steps and expected vs actual.
- **Questions go through the orchestrator.** Claude Code subagents can't ask the user questions themselves, so the orchestrator relays them.
- **Claude Code only.** qa-loop needs a local shell and a browser. Its executable in `bin/` also keeps claude.ai chat and Cowork from installing it.
- **No Windows.** The scripts use a POSIX shell and `zip`.

## Troubleshooting

- **`playwright-cli: command not found`.** Install it with `npm install -g @playwright/cli@latest`. qa-loop is tested with 0.1.22.
- **A role's login expired.** The tester stops with BLOCKED when a role's identity marker is missing. Run `/qa-loop:setup auth <role>` and log in again.
- **Edits are blocked: "QA run … is in progress".**
  - Product files stay read-only until the run has a verdict. A run that waits for your decisions stays open.
  - To end an abandoned run, ask Claude to run `qa-loop run close`.
- **A permission prompt for every browser step.** Pre-approve the commands in the Permissions step of `/qa-loop:setup`, or add `Bash(playwright-cli *)` and `Bash(qa-loop *)` to your allow rules.
- **Pages break with `strict_hosts: true`.** Their assets or API calls go to hosts outside `allowed_hosts`. Add those hosts to `allowed_hosts` in `.qa/config.yml`.
- **The trace won't open.**
  - Older trace viewers, including trace.playwright.dev, may not read traces from the Playwright version bundled with playwright-cli.
  - Use the command printed at the end of `report.md`, or ask Claude to run `qa-loop trace <path to trace.zip>`.
- **Jira can't be read.** Connect an Atlassian MCP server, or save the ticket to a file and run `/qa-loop:test path/to/ticket.md`.

## What comes from gstack

The QA discipline follows [gstack](https://github.com/garrytan/gstack)'s `/qa` and `/qa-only` (MIT), audited file by file. The ideas are re-implemented here, not copied.

| gstack mechanism | In qa-loop |
|---|---|
| Charters with time budgets; exploratory testing as missions | `plan.json` charters with `budget_min` |
| Replay a failure from the same starting state before reporting it | FAIL and BUG need `reproductions: 2`, **enforced by the verdict code** |
| "Missing expectations or evidence never pass" | PASS needs an assertion and a non-empty evidence file, **enforced** |
| Report-only authority: the tester never changes product code, tests or git | a hook blocks the tester outside `.qa/runs/`; product files are read-only during a run |
| Never read source code during browser discovery | **enforced** by the same hook |
| Functional contract map ("2xx is not completion", identity, idempotency, concurrency) | API cases (`surface: "api"`) through the browser session |
| "Invocation is consent to LOOK, not to ACT" | `mutations` per case, approved with the plan |
| Credentials never pass through the agent; screen secrets in evidence | logins via saved state only; redaction of cookies, headers and JWTs |
| "HTTP 200 never proves login" | a role `marker` (visible text or a JWT claim check) before testing as that role |
| Stay on the named target | browser network guard, enforced by playwright-cli |
| Issue taxonomy, per-page checklist, responsive and links checks | categories and checklist in the planning reference |
| Observed, Expected, Evidence kept apart from Hypothesis | `actual` vs `hypothesis`; hypotheses labeled as unverified |
| Regression proposals that detect the original observation | an executable `repro.js` per failure, re-run first on `--retest` |
| Top 3 to fix, severity counts, console health | report header and console section |
| Diff-aware scoping; learnings across sessions | `qa-loop context`; `.qa/knowledge.md`, written only with consent |
| Late changes invalidate results | the tested PR head commit is recorded; code is frozen while a run is active |

Deliberately left out:

- **The fix loop**, because qa-loop returns work to the developer instead of patching it.
- **The 0–100 health score**: a ticket gets a verdict against its acceptance criteria.
- **gstack's own browser daemon and cookie import**: qa-loop uses Microsoft's playwright-cli with an isolated, saved login per role.
- **Per-probe checkpoint files**: the Playwright trace already records every step.
- **Telemetry and decision-brief formatting.**

## Development

```bash
npm test                              # verdict rules, report rendering, CLI, guard hook, redaction
claude plugin validate --strict .     # manifests, skills and agents
claude --plugin-dir .                 # try local changes without installing
```

The demo app is the end-to-end check. A change that stops the tester from finding its planted bugs is a regression. Issues and pull requests are welcome, especially new report languages, trackers other than Jira, and Windows support.

## Support

- **Questions and bug reports:** [GitHub issues](https://github.com/QcyqApps/qa-loop/issues).
- **Security problems:** report them privately, as described in [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE)
