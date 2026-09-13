## What in `.ai/` migrates, what is noise, what stays — the full sweep

A migration is only "done" when every folder has been *classified*, not just when the DDRs are in. Audited on this repo (2026-07-28); the same four classes apply anywhere:

| `.ai/` folder | Class | Treatment |
| --- | --- | --- |
| `decisions/**` | **A — migrate** | full body → `decision:` nodes + typed edges. Then `--archive`. |
| `logs/**` (rca · reviews · execution-reports) | **A — migrate** | full body → `rca:`/`*-review:` nodes + `EVIDENCE_FOR` edges. Usually **gitignored**, so the graph becomes their only inheritable copy. Then `--archive`. |
| `state/STATE.md` | **A — migrate (event stream)** | `## Execution Progress` blocks + `\| date \| phase \| note \|` History rows → dated `milestone:` nodes linked `PROGRESS_ON` → `plan:`. 930 KB on this repo → a ~1 KB pointer-stub, original kept under `archive/state/`. Archive only AFTER gating the writers (see below). |
| `docs/**`, `dev-logs/**`, `release-guide.md`, `context/studio-shell-parity.md` | **B — narrative, keep** | prose a human reads start-to-finish. A node + `path` pointer is the most that helps. |
| `plans/**`, `scenarios/**` | **B — keep, owner's call** | procedural / test specs; excluded here deliberately. |
| `device/**` (80 MB!), `browser/**`, `cache/**`, `context/codebase-map.md`, `reviews/README.md`, `INDEX.md`, `README.md` | **D — noise** | per-run screenshots, regenerable snapshots, scaffold cruft. **Never migrate.** `device/` alone was 582 files / 80 MB — the single biggest thing that looks like content and isn't. |
| `templates/**` (the repo's OWN copy) | **A — dead under kgai** | `STATE.md`/`HANDOFF.md` seed files that the graph now replaces → archive. `PROJECT.md` had 0 refs even classically. **Not the same thing as `plugins/flow/templates/ai-skeleton/`** — that scaffold ships to downstream repos and MUST keep its templates for the classic backend. Grep before deleting either. |
| `workflows.config.json` | keep | config, not knowledge. |

**Rule of thumb:** migrate what is *dated and append-only* (decisions, verdicts, progress). Keep what is *narrative and re-read*. Skip what is *regenerable or per-run*.

### "Migrated" ≠ "archivable" — two tests, not one

Ingesting a folder does **not** license moving it. Archive only when BOTH hold:

1. **The graph replaced its function** (you'd query the graph, not open the file), and
2. **Nothing writes it any more.**

| | in the graph | archivable? |
| --- | --- | --- |
| `decisions/`, `logs/` | ✓ | **yes** — write-once, superseded by the graph. Archived. |
| `state/STATE.md` + `templates/` | ✓ (216 milestone events) | **yes, once the writers are gated** — see below |
| `docs/`, `context/`, `dev-logs/` | ✓ (`doc:` nodes, full body) | **no** — LIVE workspace dirs in the plugin contract: `paths.codebaseMap` defaults to `.ai/context/codebase-map.md`, and `/flow:setup-prd`/`/flow:plan`/`/flow:maintain-docs` write real prose into them. The graph makes them searchable; it does not replace them. |

### The trap: test #2 against the ACTIVE behavior, not the classic one

"Nothing writes it any more" must be evaluated for the backend you are ON. `STATE.md` and `templates/` *look* live because `/flow:execute`, `/flow:pause`, `/flow:setup-prd` and `/flow:maintain-ai-health` touch them — but every one of those steps is **classic-path only**. Under an active graph: pause writes a `session:` event, execute checkpoints into the graph, and `STATE.md` is a pointer-stub. So they are dead, and archivable.

They only became *genuinely* dead once those four commands were explicitly gated (`skip when active`). **Gate the writers first, then archive** — archiving while an ungated command still writes the file just resurrects it on the next run, and worse, forks the handoff across two stores (a stale `HANDOFF.md` that `/flow:resume` might trust over the graph).

Under kgai a migrated repo therefore keeps: `plans/`, `scenarios/`, `docs/`, `context/`, `dev-logs/`, a stub `STATE.md`, `workflows.config.json` — and an `archive/` holding everything the graph took over.
