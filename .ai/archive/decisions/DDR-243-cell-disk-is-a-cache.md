# DDR-243 — A cell's disk is a cache, not the project

- **Status:** Accepted. Implemented on `main`: Phase 0 released as v1.5.3; Phases 0.5 and 1 are in commits `a7d72945` … `e4322f2e`. Plan: `.ai/plans/feature-cell-materializer.md`.
- **Date:** 2026-10-01
- **Scope:** `repo:maude`, `dept:dev`
- **Supersedes:** DDR-226 §6 ("the checkout is the only thing that serves; R2 is durability only"), **on cells**. Also supersedes the kg decision "The cell refills its own checkout from the bucket — hydration is a boot step" (`maude/cell-asset-hydration`).
- **Amends:** "Asset presence means BOTH stores" (on a cell, presence is decided by the journal). DDR-224 (the bucket fallback is normal operation on a cell; the STORE DRIFT alarm now fires only on a sha mismatch).
- **Keeps unchanged:** DDR-195 (no presigned URLs, CSP `'self'`, content addressing, R2 egress $0), DDR-054 (the hub is semi-trusted, receivers re-hash, the canvas origin is untrusted), DDR-115 (runtime-state taxonomy; `_cache/` is added to it).
- **Related:** DDR-199, DDR-226, DDR-239, kg `maude/hub-disk-lost-rows-and-per-pass-credentials`, kg `maude/hub-disk-pressure-gate-and-budgeted-hydrate`.

## Context — the incident

A cloud cell (Cloudflare `standard-1`) has 4 GiB of RAM and an 8 GB ephemeral disk that is wiped on every container restart. Until now a cell had to hold the **entire** synced `.design/` on that disk: every boot hydrated every bucket object back, and every read path served from disk only.

Brno Alligators (2026-10-01) syncs ~7.8 GB. Of that, 6.9 GB is mostly unreferenced raw photo libraries under `system/alligators/assets`, which the user wants kept, synced and **not moved**, and 0.9 GB is `assets/`. The restart loop went like this:

1. Boot hydrate downloads everything.
2. Desktops push on top of it.
3. The disk fills.
4. An ENOSPC escapes as an unhandled rejection, the process exits and the container cold-starts.
5. Repeat.

Observed: hub uptime 14 → 4 → 5 minutes; a sample of 150 live rows went from 142 present to 13 present across one restart; the desktop showed `pushed 0` and hundreds of 409/404s. v1.5.2's `reportLostFiles` amplified it: it marked every row missing from a half-hydrated disk as lost *without asking the bucket*, and every desktop re-pushed gigabytes the bucket already held.

## Decision

**On a cell, the journal says what exists, R2 holds the bytes, and the local disk holds two things:**

- the **checkout for code-module + companion-text**, which is small and which Bun.build needs on disk;
- a disposable, budgeted **blob cache** for inert media, `<DATA_DIR>/cache/blobs/<sha256>`. It lives in the hub-owned data dir, **not** under the design root. The design root is the tenant's git clone, where a committed symlink at `.design/_cache` would aim the cache's create, delete and rename at anything the hub can write; that was security review H1. `_cache/` stays in the runtime-state lists as a belt.

The switch is per tenant: `CELL_MATERIALIZE` (`*` = the whole fleet) sets `MAUDE_CELL_MATERIALIZE=1`. The pilot is alligators. Desktops and self-hosted hubs are unchanged, and so is the wire contract, so no desktop release is required.

### The rules that make it safe

1. **The cache lives outside the watched tree, and outside the tenant's tree.** It sits in the hub-owned data dir. Every cache directory is `lstat`-checked: a link there is removed as a link and recreated, never followed, and unknown entries are skipped, never deleted recursively. Inert media on a cell is never materialized at its checkout path. The studio's fs-watch therefore never sees a cache file come or go, and an eviction can never reach `recordGone` → tombstone → delete-on-every-desktop. This is guaranteed by construction, not by care.
2. **The disk is never evidence.** In cell mode (`journal.setInertCached`):
   - `recordGone` never tombstones inert media because it is absent;
   - `walkImport` never journals the media it finds on disk;
   - `reportLostFiles` marks inert media lost only when its bytes exist nowhere (unmirrored and not pinned).

   At boot, a git-bundle copy whose hash is not the live row's is moved aside to `_trash/stale-inert/`, because the static route serves the checkout first.
3. **Bucket bytes reach a client only after verification.** A miss downloads the object to a temp file, re-hashes it, and only a hash equal to the journal row's sha256 is renamed into the cache. `files/<rel>` is path-keyed and overwritten in place, so streaming bucket bytes straight through would allow substitution (DDR-054). A mismatch is a typed miss plus a loud STORE DRIFT line. A cache path is derived only from a verified 64-hex digest, never from a key or a request path.
4. **Pin until mirrored.** An inert-media upload with no checkout copy lands *in the cache, pinned*, under the sha the door computed. The journal row comes from `recordVerifiedWrite`, which accepts only that door-computed digest and only for inert media; content is still never caller-supplied over HTTP. The write-behind mirrors the pinned blob and then unpins it. Eviction removes only unpinned blobs, least recently used first, using high/low watermarks (80/60 %). Evicting unmirrored bytes is therefore impossible.

   A minimum residency of 10 minutes keeps housekeeping from churning a gallery bigger than the cache, but it is **soft**. It yields when a fill would otherwise not fit, and when released pins leave the cache over its budget. The first cut held it hard, and the Task 15 E2E caught the result: with a cache smaller than the working set, every blob was fresh and every miss answered 503 for ten minutes.
5. **The cache budget leaves the write doors open.** The budget is `min(MAUDE_CACHE_BUDGET_BYTES, free + cache − 2 × floor)`, recomputed per fill. This is the same headroom rule as the boot hydrate: a full cache must not do what the unbounded hydrate did.
6. **Deletes stay recoverable.** A cache-only file is copied to `<scope>/trash/<stamp>/<rel>` in the bucket before its tombstone, or the delete is refused with 503 (DDR-226 §8). `assets/` is content-addressed and needs no copy.

### Every read path

| Path | On a cell |
| --- | --- |
| Studio static route + `/assets/` alias (canvas iframe, `/.design/…`) | A disk miss for inert media calls the loopback-only `GET /_materialize` with a random per-boot token minted for the studio child. The child re-checks that the answer realpaths to `_cache/blobs/<sha>` (DDR-054) and serves it with the **logical** name's headers. A transient miss returns 503 + Retry-After. |
| `/assets/<key>` (hub) | Checkout first, then the materializer, **streamed**. The buffered whole-object GET is removed on cells. |
| `/_project-file/` | Serves the materialized blob, Range included. A fill in progress is a hold (503), never a 404 that the desktop would read as "lost". |
| `/api/files` | Inert media is listed from the journal (sha and size), never hashed off a cache. |
| `/_asset-probe` | Present means journal-live and (mirrored or pinned). |

`/_materialize` is in **neither** canvas allowlist. Requests without the token, or from a non-loopback peer, get a bare 404. Only inert media is served, and the route returns a local path, never bytes.

### Task 9 — CSS `url()` in a canvas build: option (b)

The spike found two things:

- A canvas whose CSS `url()` pointed at a missing file **failed the entire build** with `Could not resolve`. On a cell, that applies to any photo outside the hydrate budget.
- Independently of cells, Bun inlines a small `url()` as a data URI but emits a large one as a hashed `./name-<hash>.ext` output **that nothing serves**. Every CSS background photo and webfont past the inline limit was already a broken reference everywhere.

The two options were:

- **(a)** `onResolve` awaits the loopback hop and returns the cache path. Bun would then read or inline the bytes, which inherits the hashed-output bug and inlines photos into JS.
- **(b)** Rewrite the `url()` to `/<designRoot-from-repoRoot>/<rel>` and keep it external, so the browser fetches it through the static route.

**(b) wins.** It serves any size, materializes on a miss, keeps photos out of the JS bundle, and fixes the existing large-asset bug on desktops too. The rewrite has to happen at **load** time on the stylesheet text, because Bun keeps an external url's *original* text. A relative url inlined into the canvas `<style>` would then resolve against the iframe document, not the stylesheet it came from. `data:` and other scheme urls are untouched, and urls outside the root still meet the import allowlist.

## Phase 0 (v1.5.3, shipped first) — the decisions this rests on

- **Free-space floor.** `max(1 GiB, min(12 %, 4 GiB))`. The 4 GiB cap is a deviation from the plan: 12 % of a 460 GB laptop disk refused writes with 40 GB free.
- **Disk-pressure gate.** Below the floor, every write door answers **503 + Retry-After** before reading the body. It is not 507, because 507 means the hourly quota on the desktop.
- **Crash handlers.** They survive ENOSPC and EDQUOT only. **EIO exits**, another deviation agreed with the plan author: the write-behind re-reads disk bytes, so surviving EIO could make a corrupt copy the durable one.
- **Budgeted hydrate.**
  - The budget is `min(50 % of the disk, free − 2 × floor)`, re-checked uncached before each download.
  - Order: `files/` code + CSS → `assets/` → `files/` media (the last tier is skipped on a cell).
  - Permanent failures do not count as a partial hydrate.
- **`reportLostFiles` asks the bucket first.** It never runs after a partial hydrate, skips the whole pass on any bucket error, and `MAUDE_REPORT_LOST=0` disables it.
- **Public `/health` shows state only.** Bytes and counts are behind the cell secret.

## Phase 0.5 — the desktop conflict storm (a separate defect, found on the same project)

The desktop's conflicts went 43 → 135 in ten minutes and reached 1602, while its cursor sat at 294 against a hub head of ~4875. Three defects in `apps/studio/sync/file-plane.ts` caused it:

1. **One journal page per pass, and no cursor move on `truncated`.** A pass now follows pages to the end of the log, bounded at 20.
2. **`pruneRemotes` after a one-page full read.** It retracted the hub's copy of every path past that page. Only a complete full read prunes now.
3. **A 409 whose `current` is our own hash was recorded as a conflict.** It is agreement and is now adopted.

The cursor also advances past a pass that had failures: remotes are already in the ledger, so a failed file is retried from that memory, not by re-reading its row.

## Security review of Phase 1 (defender + attacker, 2026-10-01) — both NEEDS FIXES, all fixed before release

| Finding | Fix |
| --- | --- |
| **H1.** The cache sat inside the tenant's git clone. A committed `_cache/blobs -> /data` made the boot cleanup delete the journal. | The cache moved to `<DATA_DIR>/cache`. Directories are lstat-guarded, and nothing is deleted recursively. The studio checks answers against `MAUDE_MATERIALIZE_CACHE_DIR`. |
| **Attacker #1.** The write-behind uploaded whatever sat at the checkout path, so a stale copy got marked mirrored under a newer row. | On a cell, the pinned blob is read first. A checkout copy must hash to the row's sha, or the row stays unmirrored and is later reported lost. |
| **M2, attacker #2.** One pin flag per sha leaked on overwrite or delete, released too early for bytes shared by two paths, and leaked on a no-op re-upload. | Pins are released by the journal: a pin stays while any unmirrored row names its sha (`hasUnmirroredSha`). Every sha a settled path named is released, and a door releases right after a no-op append. |
| **M1.** A planted file at a blob's name stood in for a fresh upload. | `pin()` renames the verified bytes over whatever is there. |
| **Attacker #4.** `keepCopy` skipped human-named `assets/`, which are path-keyed. | It skips only content-addressed names. |
| **Attacker #5.** Pins had no cap, and fills had no concurrency limit. | Pinned bytes are capped at 50 % of the budget; past that, the doors answer 503 until the mirror drains. At most 4 fills run concurrently. |
| **L1.** The stale-copy quarantine went through a possibly symlinked `_trash`. | It uses the write door's `resolveProjectFileTarget` guard. |
| **L2.** A fill downloaded up to the project ceiling. | A fill is capped at the row's size, and a size mismatch counts as a sha mismatch. |
| **L3.** The token was inherited by the agent's subprocesses. | `MAUDE_MATERIALIZE_TOKEN` is scrubbed from the ACP env. |

Accepted, not changed: 409-adopt cannot be gated on the hub's mirror state, because the 409 does not carry it. A hostile hub could already answer 200, so adopt gives it nothing new.

## Rejected alternatives

| Alternative | Why not |
| --- | --- |
| A bigger instance type | Raises cost across the fleet, and the disk is still bounded. The next project bigger than it repeats the incident. |
| A per-project "durable, not hydrated" glob | It only controls what gets admitted to the disk. The user wants the data **servable**, and canvases reference media inside those libraries. It is still bounded by the referenced set. |
| Read-through on `/assets/<key>` only | Canvases reference `/.design/system/<ds>/assets/…` paths, which go through the studio's static route, not `/assets/`. |
| Evicting at the checkout path | An eviction is an unlink the studio watches, then a studio report, then `recordGone`, then a tombstone, then a delete on every desktop. This is the plan review's top risk. |
| Streaming bucket bytes straight to the client | `files/<rel>` is path-keyed and overwritten, so the bytes can be newer than, or substituted for, the row (TOCTOU, DDR-054). |
| Option (a) for CSS `url()` | See Task 9 above. |

## Consequences

- A project bigger than the cell's disk is servable, and the cell stays up. What is cached is bounded, verified and disposable.
- **A first open of a gallery canvas pays the bucket latency** for every miss: one GET per sha, with concurrent misses sharing one flight. The minimum residency stops a canvas larger than the cache from thrashing.
- **Residual: unhooked media writes inside a cell go unjournaled.** These are writes not made through a door or the studio's reporting paths, for example an agent writing an image straight into the checkout. `walkImport` ignores inert media on a cell, so such a file is not durable. Writes belong to the doors.
- **The 4 GiB floor cap and the EIO policy are deliberate departures** from the plan's first text. Both were agreed with the plan author.
