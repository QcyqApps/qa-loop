# Security policy

Please report vulnerabilities privately through GitHub: open the repository's **Security** tab and select **Report a vulnerability**. Don't open a public issue for a security problem.

Include what you found, how to reproduce it, and what an attacker could do with it. Fixes go into the latest release.

Security-relevant parts of qa-loop:

- `scripts/guard.mjs`: the hook that keeps the tester inside `.qa/runs/` and freezes product files during a run,
- the secret redaction in `scripts/qa-loop.mjs`: cookies, authorization headers and tokens in evidence and traces,
- the browser network guard that `qa-loop env` writes for playwright-cli.
