# DEMO-1 [Users][FE] Status filter on the users list

Type: Task · Status: In Testing · App: examples/demo-app (http://localhost:4317)

The users list (`/users`) shows every user at once. Administrators and store managers need to narrow it down to active or disabled accounts quickly.

## Scope

- A "Status" select above the table with the options All / Active / Disabled.
- Filtering happens in the API: `GET /api/users?status=all|active|disabled`.
- The selected filter is kept in the URL (`?status=`), so the view can be linked.
- A counter above the table shows how many users are visible.

## Acceptance criteria

* By default the "All" filter is selected and the list shows every user the logged-in person may see.
* After selecting "Disabled", the list shows only disabled users.
* After selecting "Active", the list shows only active users.
* A store manager sees only the users of their own store, whatever filter is selected.
* The selected filter is kept after a page refresh.
* The counter above the table shows the number of users visible in the table.

## Accounts

Roles and logins are in `examples/demo-app/.qa/config.yml` (an administrator and the store manager of Warsaw).
