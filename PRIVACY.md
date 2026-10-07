# Privacy policy

Last updated: 2026-10-07

qa-loop is an open-source plugin for Claude Code. It runs entirely on your machine. It has no servers, and its author receives no data from it.

## What the author collects

Nothing. qa-loop has no telemetry, analytics or crash reporting.

## What qa-loop stores on your machine

Everything is in your project's `.qa/` folder:

- `config.yml` and `knowledge.md`: your test setup, and the project facts you agreed to save.
- `auth/<role>.json`: a saved browser login (cookies and local storage) for each test role.
- `runs/`: test plans, reports and evidence, such as screenshots, page snapshots, console and network logs, and Playwright traces. Session cookies, authorization headers and tokens are redacted from the evidence.

qa-loop's `.qa/.gitignore` keeps `auth/` and `runs/` out of git. The files stay until you delete them.

## Where data goes

qa-loop sends data only where you point it:

- **The app under test.** The browser opens the URLs in `.qa/config.yml`. The hosts you list as production are blocked.
- **Jira**, through the Atlassian connector you added to Claude. qa-loop reads the ticket. It posts a comment or changes the status only after you confirm.
- **GitHub**, through the `gh` command-line tool, when a ticket links a pull request. qa-loop reads the pull request's latest commit and its list of changed files.
- **Claude.** What the tester sees in the browser becomes part of your Claude Code session, like any other tool output, and is handled like the rest of your conversation with Claude.

## Children

qa-loop is a developer tool and isn't meant for people under 18.

## Changes and contact

Changes to this policy are recorded in the repository's history. For questions, [open an issue](https://github.com/QcyqApps/qa-loop/issues). To report a security problem, see [SECURITY.md](SECURITY.md).
