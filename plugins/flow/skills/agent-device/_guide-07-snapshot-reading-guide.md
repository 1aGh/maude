## Snapshot reading guide

```
@e1 [application] "<App>"
@e2 [window]
@e3 [other] "Home  Good evening, ...  ..."             ← composite container, prefer leaf refs
@e7 [other] "Home"                                      ← tab item (tap target)
@e10 [text] "Home"                                      ← label inside item
@e14 [scroll-area] "..." [scrollable]                   ← scroll, then re-snapshot
  [content below scroll-area hidden]                    ← scroll hint, not a ref
```

- **Tap on the smallest meaningful container** (`@e7`, not the parent `@e3`) — otherwise XCUITest may dispatch to wrong child.
- **Composite text on one node** is normal for RN — accessibility labels concatenate descendants. Use `snapshot -s @e3` to expand.
- **`[content below scroll-area hidden]`** = scroll hint. Do `agent-device scroll down 400` then re-snapshot.

---
