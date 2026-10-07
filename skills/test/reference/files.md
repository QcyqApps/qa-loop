# Run directory files

`qa-loop run new` creates `.qa/runs/<KEY>/<YYYYMMDD-HHMMSS>/` with `run.json` and `evidence/`. Paths inside JSON files are relative to the run directory, except the login state files in `env.json`, which are absolute.

| File | Written by | Purpose |
|---|---|---|
| `run.json` | `qa-loop run new`, `qa-loop context` | ticket, mode, language, git and PR context |
| `ticket.md` | orchestrator | the requirement: the tester's only source of expected behavior |
| `context.json` | `qa-loop context` | changed files and the areas they touch (orchestrator only) |
| `plan.json` | orchestrator | the cases |
| `env.json` | orchestrator | environment, roles and safety, for the tester |
| `results.json` | tester | facts with evidence (schema in the qa-tester agent) |
| `decisions.json` | orchestrator | the human's decisions on findings and unresolved cases |
| `verdict.json`, `report.md`, `jira-comment.md` | `qa-loop verdict` | the outcome |

## plan.json

```json
{
  "ticket": "SHOP-142",
  "key": "SHOP-142",
  "title": "Orders list for store managers",
  "mode": "standard",
  "base_url": "https://shop-staging.example.com",
  "budget_min": 25,
  "cases": [
    {
      "id": "AC-3",
      "level": "acceptance",
      "source": "AC 3: A store manager sees only their store's orders in status New by default.",
      "title": "Default store view: only the store's own orders in status New",
      "role": "store_manager",
      "setup": "Orders of store Berlin in statuses New and Shipped; orders of another store",
      "steps_outline": ["Open /orders as the store manager of Berlin"],
      "expected": "The list contains only orders of store Berlin in status New; the status filter shows New; an order of another store opened by ID is refused",
      "budget_min": 5
    },
    {
      "id": "AC-4",
      "level": "acceptance",
      "surface": "api",
      "source": "AC 4: After the status changes to Shipped, the order disappears from the default view.",
      "title": "A shipped order leaves the default view",
      "role": "store_manager",
      "setup": "An order QA-… of store Berlin in status New",
      "mutations": ["Creates order QA-<run> for store Berlin", "Changes its status to Shipped"],
      "expected": "After the status change, the default list request no longer returns the order; its details show the new status and a history entry",
      "budget_min": 6
    },
    {
      "id": "EX-1",
      "level": "exploratory",
      "source": "heuristic: lists and filters",
      "title": "Filters under fast changes, refresh and empty results",
      "charter": "Explore the list filters with rapid changes, refresh/back and empty results to discover stale or inconsistent states",
      "role": "store_manager",
      "expected": "The last selection wins; no blank screens or console errors; a clear empty state",
      "budget_min": 8
    }
  ]
}
```

Required: `cases[].id` (unique), `level` (`acceptance` | `exploratory` | `regression`) and `title`. Acceptance cases also need `expected`. Optional: `surface` (`browser`, the default, or `api`) and `mutations` (the data changes the user approved). Use the IDs `AC-n`, `RG-n` and `EX-n`.

## env.json

```json
{
  "key": "SHOP-142",
  "environment": "staging",
  "base_url": "https://shop-staging.example.com",
  "api_base_url": "https://api.shop-staging.example.com",
  "local": false,
  "allowed_hosts": ["shop-staging.example.com", "api.shop-staging.example.com", "sso-staging.example.com"],
  "blocked_hosts": ["shop.example.com", "api.shop.example.com"],
  "strict_hosts": false,
  "roles": {
    "admin": { "description": "Full access", "state": "/abs/project/.qa/auth/admin.json", "marker": "Admin" },
    "store_manager": {
      "description": "Store manager of Berlin",
      "state": "/abs/project/.qa/auth/store_manager.json",
      "marker": { "jwt_storage_key": "token", "claim": "email", "equals": "manager.berlin@example.com" }
    }
  },
  "safety": { "never": ["real payments", "emails to customers", "bulk deletes"], "test_data_prefix": "QA-" },
  "data_notes": "Staging has orders of store Berlin in statuses New and Shipped.",
  "language": "en"
}
```

Copy only what the tester needs from `.qa/config.yml` for the chosen environment: `blocked_hosts` and `strict_hosts` come from `config.safety`, `marker` from `config.roles.<role>.marker`, and `state` is the absolute path to `.qa/auth/<role>.json`. Never put passwords here. Roles log in through their saved state files.

- **`local`** is true only for localhost, 127.0.0.1, ::1 and `*.localhost` / `*.test` hosts. Anywhere else, data changes need approved `mutations`.
- **`marker`** is the tester's positive proof of identity. It takes one of two forms:
  - text visible only when that role is logged in, e.g. the user name in the header,
  - for apps that show no identity on screen, a token check: `{ "jwt_storage_key": "token", "claim": "email", "equals": "manager.berlin@example.com" }`. For this form, `qa-loop env --run` writes `identity-<role>.js`, and the tester runs it.
- **`api_base_url`** (optional) is where the API lives when it differs from `base_url`.
- **`blocked_hosts`** (production) are blocked in the browser for every run. **`strict_hosts: true`** also blocks everything outside `allowed_hosts`. Use it when the app loads nothing from CDNs or other domains.

## decisions.json

```json
{
  "findings": {
    "F-2": { "decision": "expected", "note": "The filter doesn't need to survive a refresh, confirmed by the product owner" },
    "F-3": { "decision": "follow_up", "note": "Separate ticket: the message shown on a 500" },
    "F-4": { "decision": "block" }
  },
  "cases": {
    "AC-6": { "decision": "waive", "note": "CSV export checked manually by the product owner" },
    "AC-2": { "decision": "fail", "note": "The counter shows the count before filtering" }
  }
}
```

Findings take one of three decisions:
- `block`: rejects the ticket,
- `follow_up`: a real issue for a separate ticket,
- `expected`: behaves as intended.

Cases take one of two:
- `waive`: the human accepts the risk,
- `fail`.

## results.json additions

Besides the fields shown in the qa-tester agent:

- `hypothesis` on cases and findings: a suspected cause, kept apart from the observed `actual`.
- `repro`: `evidence/<ID>/repro.js`, a playwright-cli `run-code` function that replays the failure and returns `{ reproduced, observed, expected }`.
- `category` on findings.
- `created_data`: everything the run created or changed.
- `assisted` on cases: what a human did in the tester's session during an assist, in one sentence.
- `human_steps`: `evidence/<ID>/human-steps.js`, the recorded steps of that assist, written by `qa-loop assist stop`. It is a `run-code` function, and typed secrets are masked.
- `evidence/<ID>/replay.webm`: a video of a failure's replay, listed in `evidence` like screenshots.
