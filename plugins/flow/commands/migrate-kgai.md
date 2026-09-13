---
name: migrate-kgai
category: setup
description: "Import project decisions into kgai with idempotence and archive preservation."
argument-hint: "[--dry-run]"
---

# /flow:migrate-kgai — import existing decisions into kgai

Follow [host conventions](../HARNESS.md) for Claude Code or Codex.

One-time migration of the file-based decision store (`.ai/decisions/DDR-*.md`) into the kgai knowledge graph, so an existing repo keeps its decision history when it switches the backend on. The old files are **kept as a read-only archive — never deleted** (DDR-044 safety).

> Load the **`flow:kgai-backend`** resolver + the **`flow:kgai-migrate`** skill for the full contract. This command is a thin, safe wrapper over `maude kg import` (DDR-062 — plugin markdown reaches the importer via `maude`, never a raw path).

## Process

### 1. Pre-flight

- Confirm kgai is set up: `maude kg doctor`, and check where the import will land: **`kg config` → `store_root`**. Since kgai v1.5.1 the import targets the store the engine resolves — for a `.kgairc`-enrolled repo that is typically the **shared parent-folder store** (e.g. `../.kgai-shared`), not a per-repo `.kgai/store`. If `kg config` reports `pending_approval`, stop and tell the user to review the committed `.kgairc` (`kg trust --show`) and approve it (`kg trust`) — never approve it yourself. Only a repo with no `.kgairc` at all falls back to `kg init` + a local store.
- Set `knowledgeGraph.scope` (`repo`/`dept`) in `.ai/workflows.config.json` so the migrated decisions are scope-tagged (model A, DDR-189). If the repo is joining the shared graph and doesn't carry the org's `.kgairc` yet, it should get one **committed** as part of this migration (identical values = same trust fingerprint).
- **Always dry-run first** to see the shape:

  ```bash
  maude kg import --dry-run
  ```

  Prints: source dir, resolved scope, decision + mutation counts, cross-ref count, distinct tags, and a sample decision's first mutations. Nothing is written.

### 2. Import

```bash
maude kg import
```

> **Let it finish — it is not instant.** Measured on this repo: **~4 minutes for ~190 decisions** (≈1.2 s each; the cost is per-decision event append + projection, not the batch build). Run it where it won't be interrupted (a 2-minute tool timeout WILL cut it off mid-way). An interrupted run leaves a **partially ingested** store and writes **no marker** — the safe recovery is to delete the store, `kg init` again, and re-run, NOT to re-run on top (deterministic identity converges elements, but decision *events* would duplicate).

- Builds one `{decisions:[…]}` batch (each DDR → a `decision:DDR-NNN` element shaping an `area:<primary-tag>`, remaining tags → `topic:` + `TOUCHES`, typed cross-refs first (`SUPERSEDES`/`EXTENDS`/`REFERENCES` from the `**Supersedes:**`/`**Related:**`/`**Extends:**` markers, then bare `DDR-\d+` mentions as weak deduped `references`), plus `repo:`/`dept:` scope tags from `config.knowledgeGraph.scope`).
- Ingests via `kg ingest --file`. Author is stamped automatically from `git config user.name`.
- Writes an `.ai/.kgai-migrated` marker. **Re-running refuses without `--force`** (deterministic identity converges the elements, but a re-ingest would add duplicate decision *events*).

### 3. Verify

```bash
maude kg query "MATCH (e:Element) RETURN count(e)"                 # element count
maude kg context --about "<a known DDR topic>"                     # spot-check a decision
maude kg query "MATCH (a:Element)-[l:LINK]->(b:Element) WHERE l.kind='SUPERSEDES' RETURN a.name, b.name LIMIT 5"
```

> **Cross-ref links live in the generic `LINK` table** with the kind in `l.kind` (only Decision-level log supersession uses the dedicated `SUPERSEDES` rel table) — query `LINK` + `l.kind`, not a `[:SUPERSEDES]` pattern. See the `flow:kgai-backend` skill.

## Scope + flags

- `--dry-run` — counts + sample, no write.
- `--only "DDR-191"` (or a comma list) — **incremental refresh**: ingest just those files, bypassing the migrated marker. This is the path for "someone wrote a DDR straight to disk and the graph doesn't know" — and for refreshing a DDR whose file changed (re-ingest is safe: deterministic identity converges the element, props merge).
- `--no-logs` — skip `.ai/logs/**`. Included by default: that dir is **gitignored**, so migrating it is what keeps 120 RCA / review verdicts from dying on a clone.
- `--force` — re-ingest past the migrated marker (adds duplicate events — use only after a deliberate reset).
- `--design` — the `.design/` importer (`canvas:`/`ds:`/`footage:`/`reel:`) is a **follow-up, not yet implemented**; the command reports so. Plans, `.design/` and scenarios are deliberately out of scope.

> **kgai is append-only — there is no `remove_link`.** A wrongly-classified edge can only be dropped by rebuilding the store, so prefer `--dry-run` before a bulk run. And a clean rebuild replays **files only**: decisions recorded graph-native (no `.md`) do not survive it.

> **Already have a legacy per-repo `.kgai/store`?** Folding it into the shared store is a shard copy, not a re-import: `cp <old>/log/*.ndjson <shared>/log/` (longest-wins per shard filename — shards are append-only, per-install) then `kg rebuild`. This preserves graph-native decisions too. See `flow:kgai-migrate` for the contract; the company onboarding script does it automatically.

## Notes

- Verified live (2026-07-23): this repo's 188 DDRs → 564 elements, 188 decisions, all scope-tagged, 13 `SUPERSEDES` + 36 `EXTENDS` + 700 `REFERENCES` typed cross-refs in the graph.
- Migration never rewrites in-repo references and never touches CLAUDE.md — grep for the old paths afterwards yourself.

## Step 4 — Offer the cleanup (`--archive`)

Ingest alone leaves the repo carrying **both** stores: the graph and the tree it replaced. Simplifying `.ai/` is most of why someone switches, so offer it once the ingest is verified — never in the same breath as an unverified one.

```bash
maude kg import --dry-run --archive     # prints every planned move, writes nothing
maude kg import --archive               # after the user has read the plan
```

Show the user the dry-run output and ask before the real run. It moves `decisions/` (incl. its README — under an active graph `kg search` is the index), `logs/`, the dead `templates/` seeds, and snapshots `STATE.md`/`HANDOFF.md` into `archive/state/` leaving a pointer-stub. `plans/`, `scenarios/`, `docs/`, `context/` stay live. **Nothing is deleted**, and it only runs after a clean ingest.

Full contract + the "migrated ≠ archivable" tests: **`flow:kgai-migrate`**.
