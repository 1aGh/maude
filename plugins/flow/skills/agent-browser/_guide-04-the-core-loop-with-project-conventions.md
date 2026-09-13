## The core loop (with project conventions)

```bash
agent-browser open http://localhost:3000              # 1. navigate (uses profile env)
agent-browser snapshot -i -c                          # 2. compact snapshot
agent-browser click @e3                               # 3. act on @eN ref
agent-browser screenshot .ai/browser/screenshots/X.png # 4. capture if needed
agent-browser snapshot -i -c                          # 5. re-snapshot (refs renumber!)
```

Refs (`@e1`, `@e2`, ...) are **fresh per snapshot** — they go stale the moment the page changes. Always re-snapshot after a click that navigates, opens a modal, or triggers re-render.

---
