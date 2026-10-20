### Iteration record

Version history is the record of why a canvas changed. Every auto-critic iteration lands as one AI version, labelled with what it did, so there is no separate transcript file to keep. `maude design history list <canvas>` prints the versions, newest first, and `maude design history show <ref>` prints who made one, when, and what changed. Each version's label is the edit summary: write it as one line a person would recognise (for example "Added a presence dot before each name").

What an iteration adds beyond the version itself goes in your reply to the person, in this order:

```markdown
## Iteration {N}

**Feedback:** {the person's feedback verbatim, or "/design:new <brief>"}

**Selection:** {the selected element, or "the whole canvas"}

**Version:** {r12, from `maude design history list`}

**Critic verdict:** {panel members} · blockers {X} → {X'} · {pass | fix-and-retry | divergent}

**Top blockers:** (if X' > 0)
- [{category}] {summary}
```

A project from before v2 may still hold `_history/<slug>/chat.md` (pre-v2). Read it for the intent behind older changes; do not add to it.
