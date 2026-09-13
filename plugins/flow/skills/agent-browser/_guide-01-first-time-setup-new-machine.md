## 🚀 First-time setup (new machine)

Skip this if `agent-browser --version` already prints a version and `agent-browser open https://example.com && agent-browser get url` works. Otherwise, run through it once — takes ~5 minutes total, then never again.

### 1. Install the CLI

```bash
brew install agent-browser            # macOS — recommended (native Rust, fastest)
# or:
npm install -g agent-browser          # cross-platform
agent-browser install                  # downloads Chrome for Testing (one-time, ~200MB)
agent-browser doctor                   # verify install + Chrome path
```

### 2. Configure the persistent profile env var

Add this to your **local** Claude settings (`.claude/settings.local.json` — gitignored, per-user):

```jsonc
{
  "env": {
    "AGENT_BROWSER_PROFILE": "~/.agent-browser/work-profile",
  },
}
```

Every `agent-browser` command then auto-uses that profile dir. The dir is created on first use; cookies + localStorage + IndexedDB persist there forever (until you delete it).

If you can't / don't want to use Claude settings, just `export AGENT_BROWSER_PROFILE=~/.agent-browser/work-profile` in your shell rc.

### 3. First login to the app (one-time, manual)

Make sure your dev server is running (e.g. `pnpm dev` on `http://localhost:3000`). Then:

```bash
agent-browser close --all                                # fresh daemon picks up the profile env
agent-browser --headed open http://localhost:3000/app    # opens visible Chrome window
```

In the Chrome window: scroll → click **Log In** → complete Auth0 (email/password, Google, Apple, 2FA — whatever you use). When you land on the dashboard with your name visible, the profile has captured the cookies.

```bash
agent-browser close                                      # confirms the save
```

### 4. Verify persistence

```bash
agent-browser open http://localhost:3000/app             # headless, no --headed needed
agent-browser snapshot -i -c | head -5                   # should show sidebar with your name
```

If you see `Create Account` / `Log In` buttons → the profile didn't save. Re-run step 3 with `agent-browser close --all` first.

### 5. (Optional) Log into other services the same way

Repeat step 3 with any URL — GitHub web, ClickUp, Linear, your production site, etc. Each service's auth lands in the same profile and survives.

---
