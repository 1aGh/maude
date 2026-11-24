---
'@1agh/maude': minor
---

Team server and Maude Cloud administration.

- **Team server (self-hosted hub):** an invite rides through your own sign-in (OIDC) and is the approval — no waiting room, no token. People is one list (invited, asks to join, here, turned off) with role change, turn off, remove and sign-out. An Admin opens `/admin` with their own account; the admin key stays for passwords, links, tokens and key rotation. "Who can join" is a setting (invite-only, ask, domain). Activity is a persistent 90-day log with filters and CSV, included in backups.
- **Maude Cloud operator:** an account page with every project of the account, and actions with a required reason and an audit row each: free time, Promo, pause and wake, a project for anyone with no checkout, move to another owner, sign out everywhere.
- **Maude Cloud owner:** usage numbers on the dashboard, People across all projects with requests and unopened invites, invite resend and cancel.
- **Fixes:** the redirect to Stripe Checkout and the customer portal is no longer blocked by the page's own content security policy; owner forms no longer answer 403 in Chromium (`Origin: null`); a cancelled subscription now starts the pause ladder (the debounce clock was dropped); waking a paused project restarts its retention clock.
