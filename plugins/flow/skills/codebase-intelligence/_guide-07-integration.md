## Integration

### How Other Commands Consume the Snapshot

Commands that benefit from codebase context should:

1. Compute `FILES_SHA` and run the sidecar-cache check (above). On a hit, the map reflects the current tree — read it and skip any freshness re-analysis.
2. On a miss, check if `.ai/context/codebase-map.md` exists; if it does, read the relevant sections, then refresh it and record the new `FILES_SHA` key.
3. If the map doesn't exist at all, either:
   - Suggest running `/flow:setup-codebase-map` first
   - Fall back to ad-hoc analysis (slower but functional)

### Commands That Read the Snapshot

| Command      | Sections Used                               |
| ------------ | ------------------------------------------- |
| plan-feature | Architecture, Stack, Key Files, Constraints |
| execute      | Stack, Conventions, Test Surface            |
| verify-work  | Test Surface, CI/CD                         |
| review       | Constraints, Conventions                    |
| context      | All sections (supplements live analysis)    |
