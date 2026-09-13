## Recipes

### Quick smoke test of localhost:3000

```bash
agent-browser open http://localhost:3000/app
agent-browser snapshot -i -c                         # confirm logged in (sidebar visible)
agent-browser screenshot .ai/browser/screenshots/smoke-1-home.png
agent-browser click @e12                             # primary nav (refs vary, re-check)
agent-browser wait --text "<expected heading>"
agent-browser screenshot .ai/browser/screenshots/smoke-2-page.png
```

### Capture network for a feature debug

```bash
agent-browser network har start
agent-browser open http://localhost:3000/app
# trigger the buggy interaction
agent-browser network har stop .ai/browser/har/bug-XYZ.har
agent-browser network requests | grep -E "500|404"   # quick failure scan
```

### Multi-device emulation flow (run the same flow at desktop + mobile + tablet)

Pattern used by the `scenario` skill. agent-browser shares one daemon, so device variants must run **sequentially**:

```bash
run_at_device() {
  local label="$1" device="$2"
  agent-browser set device "$device" >/dev/null
  agent-browser open http://localhost:3000/app
  agent-browser wait --load networkidle
  agent-browser screenshot ".ai/browser/screenshots/$label-1-home.png"
  # ... actions, screenshots ...
}

agent-browser close --all                                # fresh daemon picks up profile env
run_at_device "desktop"     "Desktop"
run_at_device "mobile"      "iPhone 16"
run_at_device "tablet"      "iPad Pro"
agent-browser set device    "Desktop"                    # full reset (UA + viewport + DPR)
```

Use `agent-browser set device "Desktop"` between variants — `set viewport 1280 800` alone leaves the iOS UA on (responsive sites stay in mobile mode). For native iOS / Android variants of the same flow, hand off to the agent-device skill in parallel processes (separate sims, independent daemons).

### Multi-tab dogfood

```bash
agent-browser tab                                    # list
agent-browser tab new http://localhost:3000/app/social
agent-browser tab 2                                  # switch
agent-browser snapshot -i -c                         # refs scoped to active tab
```

### Record a regression video for a PR

```bash
agent-browser record start .ai/browser/video/PR-1234-flow.webm
# ... full user flow ...
agent-browser record stop
# attach the .webm to the PR or convert to GIF
```

### Extract structured data via eval

```bash
cat <<'EOF' | agent-browser eval --stdin > .ai/browser/eval/materials-list.json
const cards = document.querySelectorAll('[data-testid="material-card"]');
JSON.stringify(Array.from(cards).map(c => ({
  title: c.querySelector('h3')?.innerText,
  href: c.querySelector('a')?.href,
})));
EOF
```

Always use `eval --stdin` (heredoc) for any JS with quotes or backticks — inline `eval "..."` only for trivial expressions.

---
