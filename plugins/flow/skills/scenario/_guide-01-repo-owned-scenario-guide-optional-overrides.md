## Repo-owned scenario guide (optional overrides)

Before running or authoring anything below, resolve the repo's scenario guide:

```bash
GUIDE=$(jq -r '.paths.scenarioGuide // ".ai/scenario-guide.md"' .ai/workflows.config.json 2>/dev/null || echo ".ai/scenario-guide.md")
```

If `$GUIDE` exists, read it and apply its sections as deltas over the defaults documented below — device/platform lifecycle, test-account/reset strategy, selector overrides, infra-error classification, platform gotchas, authoring notes. **If it doesn't exist, proceed unmodified** — every default below is sufficient on its own; the guide is optional enrichment, not a hard prerequisite (unlike `/flow:release`'s `release-guide.md`, which refuses to run without one).

**Do not create a project-local `.claude/skills/scenario/` wrapper skill to hold these deltas.** Write them into the guide file instead (scaffolded at `.ai/scenario-guide.md` by `maude init`) — this skill reads it directly, no extra skill package needed.

---
