# Planning the test run

A good plan reads like a tester's notes: every case says what to do, as whom, and what you expect to see. The tester follows it literally, so vague cases produce vague results.

## Acceptance cases (`AC-n`)

- Write one case per criterion. Split a criterion that hides several checks, and record the original criterion in `source`.
- `expected` must be observable: text or count of elements, URL, a value persisted after reload, a network response, a disabled action. Avoid "works correctly".
- `setup` names the preconditions and data, e.g. "an order of store Berlin in status New and one in status Shipped".
- When a criterion limits visibility or permissions ("a store manager sees only their store's…"), add the negative check to the same case: other scope's records are absent, and a direct URL or ID of another scope's record is refused.

## API cases (`surface: "api"`)

Use them for backend tickets (`[BE]`, data model, endpoints, jobs) and wherever the UI could hide a problem: data scope, permissions, validation the frontend already enforces. The tester calls the API from a page of the app, in the role's session. Pick the contracts that matter for the ticket. This is gstack's functional contract map:

| Contract | Check |
|---|---|
| Success | The business effect happened, confirmed by a follow-up read. A 2xx alone is not completion |
| Invalid or missing input | The declared rejection and status, and no state change |
| Identity | No session gets a 401 or a redirect. The wrong role or owner is refused, with no effect |
| State transitions | Allowed transitions work, forbidden ones are refused, history entries are written |
| Repeat / idempotency | Repeating the request doesn't duplicate the effect, unless the ticket says so |
| Concurrency | Two competing requests in both orders: the final state still holds |
| Async work | Acceptance, processing and the final effect are separate: wait for and check the final state |

Black-box limits: data-model, migration and internal-job tickets can only be checked through what the API or the UI exposes. List the rest as not testable here instead of guessing.

## Data changes (`mutations`)

Invocation is consent to look, not to act. On a non-local environment (staging is shared), every case that will create, change or delete data lists those changes in `mutations`. The user approves them with the plan, and the tester performs nothing else. Prefer cases that create their own `QA-` data over cases that change existing records. Never plan bulk deletes, real payments or messages to real people.

## Regression cases (`RG-n`)

Sources, in order:

1. Criteria that protect existing behavior, e.g. "The legacy `/reports` view works as before (no regression)".
2. Areas from `context.json`:

| Area | Re-check |
|---|---|
| routing | sibling routes and menu entries, deep links, legacy routes with similar names |
| permissions | role matrix for the affected screens and actions: an allowed role can act; a restricted role doesn't see the menu, a direct URL is blocked, and the API refusal is handled |
| api | other screens using the same endpoint; list / detail / export consistency |
| data | create, edit, list, detail of the entity; import / export; history |
| ui (shared component) | one or two other screens that use the same component |
| styles | visual smoke of the main screens that use the changed styles |
| i18n | the changed texts in every supported language |
| config | the app starts, main flows work, feature flags behave |

3. When the changed repository is checked out locally, Grep for importers of changed shared modules and routes that use them, and name **concrete screens** in the case. A regression case that says "check the app" is useless.

With no explicit expected result, the regression oracle is: the flow completes, data is consistent, and there are no console errors or 4xx/5xx responses that a user would hit.

## Exploratory charters (`EX-n`)

A charter is a mission with a time box: *Explore <area> with <heuristics> to discover <risk>*. Put the mission in `charter` and the stated expectation in `expected`. Pick the heuristics that fit the change:

**Lists, tables, filters**
- empty result, a single item, many items, pagination boundaries
- each filter alone and combined, reset, default state vs explicit selection
- filter state after refresh, back/forward and a shared URL
- rapid changes (switch 5 times quickly): the last selection must win
- counters and totals match the visible rows; export follows the active filters
- sorting stability, long texts, non-ASCII characters (e.g. ąęłńóśźż, üß, é) in search
- selection (checkboxes) across filter changes and pages

**Forms and actions**
- required fields, boundaries (length, numbers, dates), invalid formats
- double submit, submit on a slow network, a 500 on submit (is the message clear and the input kept?)
- unsaved changes on navigation, back after submit
- special characters, whitespace, paste

**Permissions and data scope**
- a role without the permission: menu hidden, direct URL, API refusal handled in the UI
- a read-only role: actions disabled or refused
- scope (tenant / store / user): another scope's data never appears, including through filters, search, direct IDs and exports

**Session and tabs**
- session expired mid-action (`cookie-clear`, then act without reloading)
- two tabs: change in one, act in the other (stale data, conflicts)
- refresh in the middle of a flow

**Errors and network**
- 500 / 403 / 404 for the main request (route mock): understandable message, no blank screen, recovery possible
- slow responses: loading state, no duplicate requests, no stale response overwriting a newer one
- offline, then back online

**Statuses and history**
- allowed vs forbidden transitions, mass actions on mixed selections, history entries, repeating the same action

**Dates and time**
- inclusive / exclusive range boundaries, midnight and timezones, DST

**Per-page checklist** (gstack's, for every page a UI charter touches): screenshot and look; use every interactive element; forms with empty, invalid and edge-case input; navigation (back, refresh, deep link); states (empty, loading, error, overflow); console and failed requests; mobile at 375 px when the layout changed; the other roles' view, each in its own session.

**Finding categories**: functional, security, ux, content, visual, performance, console, accessibility, links.

**Framework hints**:
- SPA (React, Vue): stale state after returning to a view, back and forward history, requests that overwrite each other.
- Next.js: hydration errors and `_next/data` 404s.
- Forms with CSRF: the token after a long idle period.

**Links** (local environments only, because requests carry cookies): HEAD every same-origin link on the changed pages. Skip logout, delete, remove, cancel and unsubscribe links.

Integrations the browser can't observe (sent emails, external systems): check only what the UI and API show, and list the rest in `coverage_notes`.

## Budgets and order

Use `config.budget` for the mode. Defaults:

| Mode | Regression | Exploratory | Total |
|---|---|---|---|
| quick | 0–1 | 0–1 | ~10 min |
| standard | 1–3 | 2–4 | ~25 min |
| deep | 3–6 | 5–8 | ~60 min |

Per case `budget_min`: acceptance 3–5, regression 3–6, exploratory 6–10.

Order cases as acceptance, then regression, then exploratory. Destructive cases and cases that log out go last.
