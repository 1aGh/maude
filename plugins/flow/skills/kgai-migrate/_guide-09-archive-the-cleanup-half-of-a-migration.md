## `--archive` — the cleanup half of a migration

```bash
maude kg import --archive
```

Runs **only after a clean ingest** (archiving on a failed one would move the sources out from under a graph that never received them — the one way this migration could lose decisions). Not the default: it rewrites the tree. Preview with `--dry-run --archive`, which prints every planned move and writes nothing.

What it moves:

| From | To | Why |
| --- | --- | --- |
| `.ai/decisions/**` (incl. `README.md`) | `.ai/archive/decisions/` | full body is in the graph; under an active graph `kg search` IS the index, so the README has no job left |
| `.ai/logs/**` | `.ai/archive/logs/` | gitignored — the graph is now their only inheritable copy |
| `.ai/templates/{STATE,HANDOFF,PROJECT}.md` | `.ai/archive/templates/` | seeds for the two files the graph replaced; `PROJECT.md` had zero references even classically |
| `.ai/state/STATE.md` | `.ai/archive/state/STATE-pre-kgai-<date>.md` **+ pointer-stub in place** | the path stays live (flow commands read it), so it is snapshotted, not moved |
| `.ai/state/HANDOFF.md` | `.ai/archive/state/HANDOFF-pre-kgai-<date>.md` | under the graph it never gets refreshed again — a stale handoff `/flow:resume` might trust |

`plans/`, `scenarios/`, `docs/`, `context/`, `dev-logs/`, `business/` stay **live** — narrative or procedural, not an event stream the graph owns.

**Three things it does NOT do, deliberately:**

1. **It never deletes.** Every source is *moved* (DDR-044). An entry already present in the archive is kept alongside, never overwritten.
2. **It does not rewrite in-repo references.** Grep for the old paths afterwards and fix them. Critically: leave the **plugin's own** `.ai/decisions/` mentions alone (`plugins/**`, `site/content/docs/**`, doc canvases) — those describe where DDRs live in *any* repo, and rewriting them exports one repo's archival choice into everyone else's convention.
3. **It does not gate the writers for you.** Archiving while an ungated command still writes `STATE.md` just resurrects it next run — see "Gate the writers first" below. The flow commands ship gated; a *downstream* repo with custom commands needs its own pass.
