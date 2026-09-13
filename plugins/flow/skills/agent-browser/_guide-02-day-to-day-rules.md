## ⛔ Day-to-day rules

### 1. Persistent profile (already configured)

Env var `AGENT_BROWSER_PROFILE=~/.agent-browser/work-profile` is set in `.claude/settings.local.json` (each user's local copy). Every command auto-uses it — **no re-login between sessions**. The profile collects auth cookies for `localhost:3000` and any other site after a manual login (see "First-time setup" above).

**If you need to log in to a new service (production, GitHub, etc.):**

```bash
agent-browser close --all                       # ensure profile is freshly loaded
agent-browser --headed open <login-url>          # opens visible window
# Ask the user to log in manually in that window. Auth state saves into the profile.
agent-browser close                              # confirm save
# Future commands inherit the auth automatically.
```

### 2. All artifacts go to `.ai/browser/` (gitignored)

Never write to `/tmp` or repo root. The dir layout is fixed:

```
.ai/browser/
├── screenshots/     # PNG/JPEG screenshots
├── snapshots/       # accessibility tree dumps (when persisted)
├── har/             # network HAR recordings
├── video/           # WebM screen recordings
└── eval/            # JS eval output, JSON exports
```

**Naming convention**: `<feature>-<step>-<descriptor>.png` — e.g. `login-1-landing.png`, `materials-2-modal-open.png`. Use timestamps only when running batched scenarios where ordering matters.

```bash
agent-browser screenshot .ai/browser/screenshots/checkout-1-cart.png
agent-browser network har start
# ... actions ...
agent-browser network har stop .ai/browser/har/checkout-flow.har
agent-browser record start .ai/browser/video/regression.webm
```

### 3. Always use compact snapshots

`-i -c` together — interactive elements only, no empty structural wrappers. Saves ~80% tokens vs default `snapshot`.

```bash
agent-browser snapshot -i -c                  # default for AI use
agent-browser snapshot -i -c -d 3             # cap depth for very nested pages
agent-browser snapshot -i -c -u               # add hrefs on links (only when needed)
agent-browser snapshot -i -c --json           # machine parsing
```

### 4. Screenshots are saved-not-embedded by default

`agent-browser screenshot path.png` writes to disk and prints only the path. To actually see the image, use the `Read` tool on the saved path. This gives you control — cheap routine captures stay out of context, only the screenshots you explicitly inspect cost image tokens.

### 5. Don't sleep — wait for what you actually expect

```bash
agent-browser wait @e5                        # element appears (best)
agent-browser wait --text "Success"           # text appears
agent-browser wait --url "**/dashboard"       # URL changes
agent-browser wait --load networkidle         # SPA navigation done
# agent-browser wait 2000                     # only as last resort
```

### 6. Web mobile / tablet via device emulation (Chrome, no simulator needed)

Built-in Playwright-style device presets — emulate viewport + UA + DPR in regular Chrome:

```bash
agent-browser set device "iPhone 16"          # 393×852, iOS Safari UA
agent-browser set device "iPhone 16 Pro"      # 402×874
agent-browser set device "iPad Pro"           # 1024×1366
agent-browser set device "Pixel 9"            # Android Chrome UA
agent-browser set device "Galaxy S25"         # Android Chrome UA
# Supported names: iPhone 15, iPhone 16, iPhone 16 Pro, iPhone 17, iPad, iPad Pro, Pixel 9, Galaxy S25
```

After `set device`, every subsequent `open/snapshot/click/...` runs against that viewport **and** the matching mobile UA + DPR + touch hints. **Reset properly when done** — `set viewport` only resizes; the mobile user-agent / touch flag persists until you re-set the device. Use whichever fits:

```bash
agent-browser set device "Desktop"            # full reset (viewport + UA + DPR + touch)
# or, if `Desktop` is unavailable on your build:
agent-browser set viewport 1280 800           # ⚠️ resets viewport only — UA stays mobile
agent-browser close --all && agent-browser open …   # nuclear reset (re-spawns daemon)
```

**Always prefer `set device "Desktop"`** between back-to-back emulation runs (e.g. the `scenario` skill cycling iPhone 16 → iPad Pro → desktop).

Use this for: responsive layout checks, mobile-only UI flows, touch targets verification, PWA testing. **Use `-p ios` (real Mobile Safari via WebDriverAgent)** only when you specifically need WebKit quirks (Safari-only bugs, iOS-Safari PWA install behavior); emulated Chrome is faster and covers 95% of mobile-web bugs. Mobile Safari requires extra setup beyond this skill — see `agent-browser skills get core --full` for the WebDriverAgent flow.



### 7. `find` for semantic locators (no snapshot needed)

Skip the snapshot+ref dance for known elements:

```bash
agent-browser find role button click --name "Submit"
agent-browser find label "Email" fill "test@test.com"
agent-browser find placeholder "Search..." fill "query"
agent-browser find testid "submit-btn" click  # alias for [data-testid="submit-btn"]
agent-browser click "text=Submit"             # short form
agent-browser click "[data-testid='submit']"  # CSS works too
```

Refs are still preferred for AI loops (deterministic, fast), but `find` is ideal for stable elements like login buttons, primary CTAs.

> **Cross-skill note:** `agent-browser find <kind> <value> <action> [--name X]` (action **after** value) differs from `agent-device find <value> <action>` (no kind, no `--name` flag). When porting a scenario between skills, expect the argument order and the kind keyword to change.

---
