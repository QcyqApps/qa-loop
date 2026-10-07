---
name: setup
description: Configure qa-loop for the current project. Writes the test environment contract (.qa/config.yml), captures saved login states for the test roles, sets Jira statuses, and optionally pre-approves the browser commands. Run once per project, again when URLs or roles change, or with "auth" when a saved login expired.
when_to_use: Use when the user asks, in any language, to set up qa-loop, configure QA for a project or refresh test logins (e.g. "set up qa-loop", "skonfiguruj qa-loop"), or when /qa-loop:test finds no .qa/config.yml.
argument-hint: "[auth [role]]"
allowed-tools: Bash(qa-loop *) Bash(playwright-cli *)
---

# qa-loop setup

Goal: `.qa/config.yml` tells the tester **where** to test, **as whom**, and **what it must never touch**, and every role has a working saved login. Talk to the user in their language.

Arguments: `$ARGUMENTS`. With `auth`, skip to step 4, for the given role or for all roles.

Use AskUserQuestion: at most 4 questions per call and 2–4 options each, the recommended option first. **Propose values you inferred** instead of asking open questions. The user can always type their own.

`qa-loop` is on PATH while the plugin is enabled. If it is not found, use `node ${CLAUDE_PLUGIN_ROOT}/scripts/qa-loop.mjs`.

## 1. Inspect

- `qa-loop preflight` returns the project root, the existing config, git and tools. If `tools.playwright_cli` is null, offer `npm install -g @playwright/cli@latest`.
- Infer from the repository: how the app starts (package.json scripts, docker-compose, Makefile, README), the local port, staging URLs (README, `.env.example`, CLAUDE.md, deployment config), role names (enums, guards, seeders) and the UI language.
- If you came here from `/qa-loop:test`, use the ticket's hints too: roles, screens and environment.

## 2. Ask

In one or two batches:

- **Environment**: the staging URL you found (recommended when the change is deployed), local with the start command you found, or a different one.
- **Production hosts to block**, e.g. the production app and API domains. They go to `safety.blocked_hosts`, and the browser refuses them during every run. Offer `strict_hosts: true` (block everything outside `allowed_hosts`) when the app loads nothing from CDNs or third parties.
- **Roles**: which ones the tests need, e.g. admin, and a restricted role for permission checks. Ask how each one logs in: SSO, a login form, or none.
- **Data**: what test data exists, what may be created freely (and with which prefix), and what must never be touched.
- **Jira**, when the project uses it: the status after ACCEPT and after REJECT. Propose real names. Run `getTransitionsForJiraIssue` on a ticket of this project if you know one, and use `getAccessibleAtlassianResources` for the `cloud_id`.
- **Language** of reports and Jira comments.

## 3. Write

- Start from `${CLAUDE_PLUGIN_ROOT}/templates/config.yml` and fill in the answers. Show the result and write `.qa/config.yml` after the user confirms.
- If `.qa/knowledge.md` is missing, create it from `${CLAUDE_PLUGIN_ROOT}/templates/knowledge.md`.
- `qa-loop run new` keeps `.qa/.gitignore` with `runs/` and `auth/`. Create it now if it is missing, so saved logins and evidence never get committed.

## 4. Save the logins (one per role)

For each role:

```bash
cd "<project_root>" && playwright-cli -s=qa-auth-<role> open "<login or base URL>" --headed
```

Tell the user, in their language: "Log in as <role> (<description>) in the browser window that just opened. Complete MFA as usual." Then ask "Logged in as <role>?" with the options "Done (recommended)" and "Skip this role".

After "Done":

```bash
cd "<project_root>" && playwright-cli -s=qa-auth-<role> state-save ".qa/auth/<role>.json" && playwright-cli -s=qa-auth-<role> close
```

Verify the login in a fresh headless session: `open about:blank`, `state-load .qa/auth/<role>.json`, `goto <base_url>`. Then find the role's **marker**: text visible only when this identity is logged in, such as the user name or role in the header. Propose a marker from the page, confirm it with the user, and save it in `roles.<role>.marker`. If the app shows no identity on screen, look for a JWT in local or session storage, listing key **names** only, and use a token check instead: `marker: { jwt_storage_key: token, claim: email, equals: <account> }`. Decode it inside the page and print only the claim, never the token. Not landing on a login page, or getting an HTTP 200, does not prove the login. The marker does. Close the session.

- **Never type real passwords yourself.** playwright-cli echoes typed values into the transcript and into traces. The human logs in. The only exception is a role with `demo_login` in the config, or demo credentials the user explicitly gives you for a non-secret test account. You may log in with those yourself, headless, and save the state the same way.
- With SSO, the saved state lives as long as the SSO session, usually hours to days. When it expires, `/qa-loop:test` notices and offers `/qa-loop:setup auth <role>`.

## 5. Permissions (optional)

The tester runs many `playwright-cli` commands. Offer to pre-approve them in `.claude/settings.local.json`, which is per user and not committed:

```json
{ "permissions": { "allow": ["Bash(playwright-cli *)", "Bash(qa-loop *)"] } }
```

Merge with the existing file, show the change, and write it only after the user agrees.

## 6. Done

Run `qa-loop env --url <base_url> --state .qa/auth/<role>.json …` and report: the config path, the roles with working logins, and how to start: `/qa-loop:test <TICKET>`.
