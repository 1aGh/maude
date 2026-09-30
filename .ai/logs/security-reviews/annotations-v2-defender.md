# Security defender audit — annotations v2 (DDR-242)

Branch `worktree-annotations-v2`, base `fa3290bf`. Agent: `flow:security-auditor`. The agent returned the report inline
(read-only role); this file records it together with how each finding was resolved.

**Original verdict: NEEDS FIXES.** 3 blockers (1 high, 2 medium), 5 warnings, 0 dependency flags.
**After fixes: PASS WITH SUGGESTIONS.** All blockers are fixed and covered by tests. One warning is deferred with a
reason.

`severityFloor` defaults to `medium` (no `security` block in `.ai/workflows.config.json`).

## Blockers

| # | Finding | Severity | Resolution |
|---|---|---|---|
| 1 | `annotations/legacy/mini-dom.ts` — the tokenizer regex went quadratic on an unterminated `<!--` / `<?` / CDATA / DOCTYPE (measured 1.7 s at 160 KB; about 15–20 min at the 4 MB cap). Reachable from the canvas-origin PUT, hub lane proposals, and a peer's legacy `svg` key. | high | **Fixed.** `parseMiniDom` is a linear `indexOf` scanner (quote-aware tag scan); a missing terminator returns `errorDoc()`. The legacy-SVG branch is capped at `MAX_LEGACY_SVG_BYTES` (2 MB) in `canonicalAnnotations`, `readReplica` and `isEmptyBoardText`. |
| 2 | `annotations/ops.ts` — every delete rebuilt a `Scene` over the whole board (O(ops × board)); text merges had no per-batch budget. | medium | **Fixed.** Reverse indexes `byHost` / `byParent` are built once per batch and maintained on commit. The scene rebuilds lazily and only when geometry changes. `MAX_TEXT_MERGES_PER_BATCH = 50`. The op route returns 413 past `MAX_ELEMENTS` and never truncates. Test: 5,000 deletes on a 20k board with arrows in < 1.5 s. |
| 3 | `annotations/migrate-boot.ts` — the boot migration followed symlinks, wrote through a symlinked `_history` / `_state` / `_trash`, and read with no size cap (the hub runs it on tenant checkouts). | medium | **Fixed.** `lstat` accepts regular files only. The size is checked before reading. Every write directory is realpath-contained in the design root, and the deepest existing ancestor is checked *before* `mkdir`, so a recursive mkdir can't follow a symlink out. The lock file gets the same check. Tests: a symlinked source is not read, and a `_trash` that escapes the root receives no write. |

## Warnings

| Finding | Resolution |
|---|---|
| `__proto__` in a patch's `set` reaches `next[k] = val` (not exploitable today) | **Fixed.** `DANGEROUS_KEYS` are skipped in `applyPatch`. |
| Whole-board PUT body cap is `2 × MAX_ANNOTATIONS_BYTES` | **Kept.** The body legitimately carries a board *and* its base, each capped at 4 MB after parsing. |
| Unknown element types: no count, length or charset cap on top-level keys | **Fixed.** Keys must match `^[A-Za-z_][A-Za-z0-9_-]{0,63}$`, with at most 64 keys (`registry.ts`). |
| `sync/codec.ts` `readLocalAnnotations` falls back to raw text | **Deferred.** Returning `null` instead would not help: accepted cold start materializes the accepted value over an unreadable local file either way. The real fix (snapshot before materializing) is tracked in the follow-up task "Harden annotation write surface (F1–F3)". |
| A hostile peer can delete `~v` and resurrect a legacy `svg` value | **Accepted (info).** Adds no capability beyond deleting elements, which a peer can already do. |

## Also fixed from the attacker pass (F4)

`loadAnnotations` read the whole file before any size check. The new `readBoard` (`api.ts`) checks `f.size` against
`MAX_ANNOTATIONS_BYTES` before reading. An oversized or unparseable board is `ok: false` (HTTP 409), never an empty
board (code review H2).
