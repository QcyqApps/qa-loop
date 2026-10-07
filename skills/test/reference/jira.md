# Jira

These instructions use the Atlassian MCP server's tools. Tool name prefixes differ between installations, e.g. `mcp__atlassian__getJiraIssue` or a claude.ai Atlassian connector. Use whichever Jira tools are available. If none are available, ask the user to paste the ticket or save it to a file.

## Site (cloudId)

Use `config.jira.cloud_id`. If it is missing, call `getAccessibleAtlassianResources` and pick the site that has Jira scopes; ask the user if there are several. Then offer to save it to `.qa/config.yml`.

## Fetch the ticket

`getJiraIssue` with:

- `issueIdOrKey`: the key
- `fields`: `summary, description, status, issuetype, comment, issuelinks, parent, subtasks, attachment, labels, components`
- `responseContentFormat`: `markdown`
- `updateHistory`: `false`

Large responses are saved to a file. Extract what you need with `python3 -I` or `jq` instead of reading everything.

**Acceptance criteria.** Look for a heading at any level, or a bold line, such as "Kryteria akceptacji", "Acceptance criteria", "AC", "Definition of Done", "Warunki akceptacji" or "Oczekiwany rezultat", and take its items up to the next heading. Also look for Given/When/Then blocks and checklists. Comments sometimes clarify or change the criteria, e.g. answers from the product owner. Include those and mark where they come from.

**PR links** appear in comments and the description (`https://github.com/<org>/<repo>/pull/<n>`) and in `getJiraIssueRemoteIssueLinks`. The `Development` field only gives counts, so get the URLs from comments or remote links.

**Linked tickets** (`issuelinks`): when a "blocks" or "is blocked by" ticket defines the behavior, for example the backend part of a frontend ticket, fetch its summary and criteria as context. Test them only if the user agrees.

**Attachments** such as mockups: list their names in `ticket.md`. Ask the user if a mockup is needed to judge the result.

## Post the result

Only after the user has chosen what to do in step 7 of the skill.

- Comment: `addCommentToJiraIssue` with `commentBody` = the content of `jira-comment.md` and `contentFormat` = `markdown`.
- Status: call `getTransitionsForJiraIssue`, then find the transition whose `name` or `to.name` matches `config.jira.on_accept` or `on_reject`, ignoring case. Then call `transitionJiraIssue` with `transition: { "id": "<id>" }`. If nothing matches, show the available transitions and ask.
- Tell the user what was posted and the new status.

Evidence stays in the run directory: the Atlassian MCP cannot upload attachments. The comment already contains the exact steps and expected vs actual for every problem, which is what a developer needs to reproduce it.
