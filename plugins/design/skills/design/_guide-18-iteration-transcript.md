### Iteration transcript

Every auto-critic iteration appends to `<designRoot>/_history/<slug>/chat.md` — the project's "intent record" (à la Claude Design's `chats/`). The chat is the canonical record of *why* the canvas evolved the way it did. Format:

```markdown
## Iteration {N} — {ISO ts}

**Feedback:** {user feedback verbatim, or "/design:new <brief>"}

**Selection:** {selected.selector or "canvas-wide"}

**Snapshot:** {NNN-ts.bak}

**Edit summary:** {1-line — e.g. "added presence dot before each .roster-row .name"}

**Critic verdict:** {panel members} · blockers {X} → {X'} · {pass | fix-and-retry | divergent}

**Top blockers:** (if X' > 0)
- [{category}] {summary}

---
```

`chat.md` is **committed** (not gitignored) — it's project documentation, like the canvas itself. The plugin runs in the same repo as the implementation, so the chat is always available to anyone reading the source.
