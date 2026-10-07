# Demo app

A small users list with a status filter, built to give qa-loop something real to test. It has no dependencies.

```bash
node examples/demo-app/server.mjs        # http://localhost:4317, accounts admin/demo and manager/demo
```

Then, in Claude Code with the plugin enabled:

```
/qa-loop:test examples/demo-app/tickets/DEMO-1.md
```

The expected verdict is **REJECTED**. One acceptance criterion fails, and the exploratory charters should surface several bugs. The demo doubles as a regression test for qa-loop itself. If a change to the plugin stops it from finding bugs 1–4 below, the change made the tester worse.

In the first runs, the tester found bugs 1–4 and three issues nobody planted:

- an unknown `?status=` value crashes the page,
- the counter says "1 users",
- logout doesn't end the session on the server.

See [an example report](../../docs/example-report.md).

<details>
<summary>Planted bugs (spoilers)</summary>

1. **Data scope leak (acceptance).** A store manager who selects "Disabled" sees disabled users from every store, so AC 4 fails. See `visibleUsers` in `server.mjs`.
2. **Race on fast filter changes (exploratory).** The "all" request is slow and the client never cancels older requests. Switching from "All" to "Disabled" right after load shows all users while the select says "Disabled".
3. **API error = blank table (exploratory).** A 500 from `/api/users` leaves an empty table, no message, and a `TypeError` in the console.
4. **Expired session (exploratory).** After the session cookie is gone, changing the filter gets a 401 that the client treats as data. The result is an empty table and a `TypeError`, with no redirect to the login page.
5. **Empty state (judgment call).** An empty result shows only the table headers and "0 users". The ticket doesn't specify this, so a tester may raise it as a question or accept it. It must never come back as a bug.

</details>
