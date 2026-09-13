## Auth strategies — pick the right one

### A. Persistent profile (default)

**Best for**: OAuth/SSO flows (Auth0, Google, GitHub OAuth), 2FA, magic links, anything that hates being re-driven by automation.

Profile dir is `~/.agent-browser/work-profile` (env-set). User logs in once via `--headed`; cookies + localStorage + IndexedDB persist forever.

```bash
agent-browser --headed open https://app.example.com/login
# user logs in manually, including 2FA
# next session is already logged in:
agent-browser open https://app.example.com/dashboard
```

**Use this for**: your app (dev + prod), any service the user has personal SSO with.

### B. Auth vault (saved credentials)

**Best for**: simple username + password forms with no MFA, no JS-heavy login (e.g. internal tools, basic admin panels). Credentials encrypted at rest.

```bash
# Set encryption key once (add to ~/.zshrc):
export AGENT_BROWSER_ENCRYPTION_KEY=$(openssl rand -hex 32)

# Save creds (password via stdin, not arg, to keep it out of shell history):
echo "$PASSWORD" | agent-browser auth save my-service \
  --url https://my-service.com/login \
  --username user@example.com \
  --password-stdin

# Use it later:
agent-browser auth login my-service           # fills + submits + waits
agent-browser auth list
agent-browser auth show my-service            # metadata only, no password
agent-browser auth delete my-service
```

If the form has non-standard selectors, pass `--username-selector / --password-selector / --submit-selector`.

**Don't use this for**: Auth0, Google, GitHub OAuth, anything with 2FA — use Profile (A) instead.

### C. Saved state file (cookies only)

**Best for**: short-lived headless workers, CI runs, quickly snapshotting a logged-in session for portability.

```bash
agent-browser state save .ai/browser/eval/auth-state.json
# later, on a different machine or fresh profile:
agent-browser --state .ai/browser/eval/auth-state.json open https://app.example.com
```

State files are encrypted if `AGENT_BROWSER_ENCRYPTION_KEY` is set. **Do not commit** — `.ai/browser/` is gitignored.

### D. Multi-account via `--session`

**Best for**: testing multi-user flows (e.g. one user creates a post, another sees it in feed).

```bash
agent-browser --session userA open https://app.example.com
agent-browser --session userB open https://app.example.com
# Each session has isolated cookies / profile / refs.
```

Combine with `--profile` per session for persistent multi-account: copy `work-profile` to `work-profile-b`, then `--session userB --profile /path/to/work-profile-b`.

### Auth quick decision

| Service                        | Strategy                               |
| ------------------------------ | -------------------------------------- |
| Your app dev / prod (OAuth/SSO)| A. Persistent profile (already set up) |
| GitHub web (gh.io login)       | A. Persistent profile                  |
| ClickUp / Linear / Notion      | A. Persistent profile                  |
| Internal admin with form login | B. Auth vault                          |
| CI / GitHub Actions runner     | C. Saved state file (encrypted)        |
| Multi-user E2E test            | D. `--session` per user                |

---
