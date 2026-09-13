## When to apply

Use for **any** technical issue:

- `/flow:utils-verify` failures during `/flow:execute` Edit-Verify Loop
- `/flow:validate` failures (typecheck, test, build, scenario, a11y, design-system)
- Scenario report blockers or parity gaps across platforms
- Test failures
- Unexpected behavior in dev / preview / prod
- Performance regressions
- Build failures
- Integration issues across declared boundaries (anything in `boundaries.*`)

**Apply ESPECIALLY when:**

- Under time pressure (emergencies make guessing tempting)
- "Just one quick fix" seems obvious
- You've already tried multiple fixes
- Previous fix didn't work
- Don't fully understand the issue

**Don't skip when:**

- Issue seems simple — simple bugs have root causes too
- You're in a hurry — rushing guarantees rework
- Iteration counter is at 2 of 3 — systematic is faster than thrashing
