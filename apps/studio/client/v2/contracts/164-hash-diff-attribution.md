# #164 T5.1: attribute a call that cannot claim by what it changed

Spike for issue #164 / plan `feature-issues-burndown-2026-11.md` T5.1 (D11). Status: **decided, ready to build**.
Builds on `maude/v2-p8-a1-claims-bytes-not-time` (every run is claim-only),
`maude/v2-michal-a1-hold-save-during-interpreter` (studio save held, then lands as the person's) and
p8-sec2-attrib A1 (all-canvas window, `designLaneHashes`).

## 1. The question

Some AI Bash calls cannot claim their bytes: `python3 -c`, `node -e`, `bash -c`, `sed -i`, a script file,
or a terminal-lane verb with no `MAUDE_CHAT_ID`. For those calls, how does Maude bind exactly the files the
call changed to the run? A person's save during a long call must never fold into the run, and the call's
own writes must never land as "outside".

## 2. What a pre/post hash diff can and cannot do

**Measured (and argued): a pre/post diff tells you which files changed during the call. It cannot tell
you who changed them.** Suppose an outside process (another editor, `git` in another terminal,
Syncthing) writes file F while the call runs. The diff shows F as changed whether the call wrote it or
not. Neither the watcher (FSEvents carries no pid) nor the hook can tell the two writers apart, and
process tracing is still rejected (`fs_usage` needs root, EndpointSecurity needs an entitlement, and SIP
strips `DYLD_*`). The writer can only come from three signals:

1. **Claims.** The bytes were announced before they landed. Tools and verbs already do this (A1).
2. **Studio request provenance.** A studio save carries `Origin`, so it is the person's. It is never
   stageable, and on a named file it is held (save-hold).
3. **Coverage.** Which files a call can plausibly write, judged from its command text.

So the diff is adopted **as the binding, not as the discriminator**. At the call's end it turns the time
window into an exact byte claim, and it lets every failure fall to "outside". Who wrote what still comes
from 1–3, and this note narrows 3.

### Gaps in today's code that this closes

| Today (main, 2.0.8) | Effect |
| --- | --- |
| A call that names no canvas opens an **all-canvas window** (`pnpm test`, `npm run build`, `git pull`). | For the whole call, every outside write to any canvas joins the run. This is the issue's example. |
| A write that lands within `SHELL_SETTLE_MS` (1 s) after the window closes joins the run. | A save 0.5 s after the call is folded into the run. |
| A PostToolUse that never arrives (killed call, hook crash) leaves the window open until `WINDOW_STALE_MS` (10 min) or the run's end. | Failure falls **to the AI**. |
| Hook-side `bindBashWrites` records `touched.json` for every file whose mtime is ≥ `at`. | A person's studio save during the call is listed as the AI's touch (Stop gate, `markShellWrite`). |
| `namedDesignFiles` walks only files that exist. | A new canvas created by an interpreter is never covered, so it lands as outside (an open #164 item). |
| `designLaneHashes` stops at 4000 files / 64 MB, and `designWritesSince` returns at most 64 files. | Big projects are judged by mtime alone. |
| Pre-hashes are stored in `<designRoot>/_runs/<s>/bash/<id>.json`. | Hook state lives in the project (#168). |

## 3. Decision

1. **Coverage first.** `callCoverage(designRoot, cwd, command)` returns one of three modes:
   - `named` — files the command text names, plus the text of any script file it runs (≤ 256 KB,
     inside the project), plus **lane paths that do not exist yet** (a create). Candidates resolve
     against the effective cwd.
   - `all` — nothing is named, but the text references the design root (its path or `.design`
     segment), or the cwd is inside it.
   - `none` — anything else. A `none` call gets **no snapshot and no window**. If it does write a
     canvas, that write lands as outside.
2. **Pre-snapshot (PreToolUse).** Stat every lane file. The key is
   `(mtimeNs, ctimeNs, size, ino)`; `ctime` catches a `touch -r` restore (measured). Hash only on a
   cache miss, within a budget. The manifest is stored **outside the project**.
3. **Park, don't stage.** While a `named` or `all` window is open, the stage **parks** each unclaimed
   outside watcher write to a covered file. A parked write is neither staged into the run nor proposed.
   A person's UI edit made on top of parked bytes waits, the same way it waits behind staged bytes.
   Studio saves are unchanged: never parkable, and held on named files.
4. **Settle (PostToolUse).** Take the post-snapshot (prefiltered by the manifest) and diff it against
   the manifest. `POST /_api/agent/bash/settle` sends the changed files with the sha256 of their
   post-call bytes. The studio re-reads each file. If the disk sha equals the hook's sha, it claims
   those bytes for the run (`claimWrite` computes the lane hash).
   - A parked file whose bytes match a claim joins the run as **one** write (pre → post), including
     a create (`doc.create`).
   - Every other parked write is released **as outside**, in arrival order.
   - A later watcher delivery of the claimed bytes (watcher lag) still matches the claim
     (the existing `byHash` path).
   - The 1 s settle stops taking unclaimed writes. Only claimed bytes join the run.
5. **Fail closed to outside.** Each failure ends in the same place: no claim, so parked writes go out
   as outside. The failures are:
   - pre-hook fails, so no window opens;
   - settle never arrives — released at window close + `SETTLE_WAIT_MS` (3 s), or at stale / run end;
   - the studio is unreachable at settle;
   - the manifest is missing or corrupt;
   - a file is past the budget with no pre-hash and its stat changed — it is sent with `hash: null`,
     which never claims;
   - the disk sha no longer matches at settle (a later save).

   Nothing ever falls to the AI.
6. **The ACP tracker's own shell window** (`acp/index.ts` `shellWindow`) becomes **parking only**. It
   can never claim. Claims come only from the hook's settle, and the hook is always present in ACP
   (DDR-168).
7. **The terminal lane gets the same path.** A terminal-lane verb call is `named` (its canvas words) or
   `none` (`import-asset x.png`). It is never `all`. The "whole turn" fallback is gone.

**Named residual (Michal's A1 ruling stands; this is what is left).** One case still joins the run: an
**outside-process** write (not a studio save) whose bytes are the final bytes of a file the call covers,
made while that call runs. That needs an `all` call, or the person editing in another app the very file
the call is rewriting. Attribution protects the undo of a cooperative agent. It is not a security
boundary: a hostile agent can always make an outside write, for example after the turn ends. The
permission tiers and C4 are the boundary.

### Rejected

- **Diff alone as the discriminator** (D11 as written). It cannot separate writers (§2): an outside
  save inside the window is in the diff too.
- **"Final write only, earlier parked writes go outside."** `sed -i a F && sed -i b F` would turn the
  AI's first write into an outside row on every chained edit. That is a frequent regression bought to
  fix a rare case.
- **Process tracing** (`fs_usage`, EndpointSecurity, `DYLD_INSERT_LIBRARIES`, `sandbox-exec` reports).
  Each needs root, an entitlement, or a SIP bypass. Already rejected in A1.
- **Wrapping the command through PreToolUse `updatedInput`.** The wrapper sees no more than the hooks
  do and changes the command the person approved.
- **Holding every canvas during an `all` window.** Already rejected by sec2-attrib (every save would
  wait).
- **Storing the manifest in studio memory only.** The hook must still bind `touched.json` with no
  studio running. The studio does not need the manifest anyway, only the claims.

## 4. Measurements

Machine: Apple M5, 16 GB, APFS, warm page cache, Node `process.execPath`. Synthetic design roots:

| Tree | Lane files | Lane size | Other files | Folders |
| --- | --- | --- | --- | --- |
| 5k | 5,000 (1,700 `.tsx` at a log-normal median of 12 KB with a 1.5 MB cap; 1,700 `.meta.json`; 1,600 `.annotations.json`) | 62 MB | 2,000 assets | 60 |
| 15k | 15,000 (the 5k tree copied three times) | 186 MB | 6,000 assets | 180 |

Each figure is 25 iterations (10 for 15k) after 2 warm-ups. The bench scripts are throwaway, in the
spike's scratchpad.

| Operation (ms, p50 / p95) | 5k | 15k |
| --- | --- | --- |
| today's `designLaneHashes` (stops at 4000 files / 64 MB) | 229 / 309 (hashes 4000 of 5000) | 357 / 458 (hashes 4000 of 15000) |
| full hash, unbounded | 319 / 424 | 1018 / 1300 |
| prototype, cold (no manifest: stat + hash all) | 317 / 513 | 1030 / 1540 |
| **prototype, stat-only (prefilter, nothing changed)** | **50 / 70** | **79 / 93** |
| **post-call vs manifest, 20 (15k: 60) files changed** | **65 / 87** | **117 / 167** |
| `laneDiff` | 2.4 / 3.3 | 7.8 / 8.5 |
| manifest write / read (447 KB / 1.4 MB JSON) | 3.4 / 4.8 · 4.4 / 8.8 | 8.8 / 11 · 7.7 / 13 |
| node process start (hook baseline) | 61 / 77 | — |

What the numbers mean:

- With the prefilter, pre + post costs **~0.12 s at 5k and ~0.2 s at 15k**, against the 3 s hook timeout.
- Without the prefilter, the pre-snapshot alone reaches 1.5 s p95 at 15k.
- The hash cache is what keeps pre cheap. It is **non-authoritative**: a wrong cache can only mis-list
  `touched.json`, never stage a write. A claim joins the run only when the studio re-reads the disk sha
  *and* a watcher delivery carries those bytes.

Coverage prototype, run over representative calls:

| Call | Mode |
| --- | --- |
| `pnpm test`, `bun test`, `npm run build && git status`, `git pull`, `python3 scripts/other.py` | `none` |
| the S7 heredoc (`cd <D>/ui && python3 - <<EOF p='Alligators Cinematic Cut.tsx'`) | `named` |
| `python3 -c "open('.design/ui/New Board.tsx','w')"` (a new file) | `named` |
| `node -e …'Home.tsx'` with cwd `.design/ui` | `named` |
| `sed -i … .design/ui/*.tsx` | `all` |
| `python3 scripts/gen.py` (the script mentions `.design`) | `all` |
| `cat … \| wc -l` | read |

Over-coverage seen in the prototype: unresolved `cd` produced extra root-level candidates. The builder
drops a candidate that does not exist at post and was not created.

## 5. Interface (hook ↔ studio)

### Hook state, outside the project

- Directory: `hookStateDir(root) = $MAUDE_HOOK_STATE_HOME || ~/.claude/maude-hook`, then
  `/<rootIdentity(root)>/`. Directories are 0700 and files 0600, written tmp + rename. The precedent is
  `~/.claude/flow-runs`.
- `<session>/bash/<toolUseId>.json` holds `{ v: 1, at, mode, files: string[], bg?, verbOnly?, snaps,
  manifest: LaneManifest }`.
- `lanes.json` is the non-authoritative hash cache for the root.
- `_runs/<s>/bash/` keeps only what Stop needs today, minus `hashes`. The `snap/` and `base/` bytes stay
  under `_runs` for now (open question 3).

### `cli/lib/bash-guard.mjs` (leaf, node built-ins only)

```js
/** @typedef {{ v: 1, complete: boolean, files: Record<string, [mtimeNs: string, ctimeNs: string, size: number, ino: string, sha: string|null]> }} LaneManifest */
export function laneSnapshot(designRoot, { prev = null, cache = null, budgetMs = 800, maxEntries = 50_000, maxFiles = 20_000 } = {}) // → LaneManifest
export function laneDiff(pre, post) // → Array<{ path, sha: string|null, created: boolean, deleted: boolean }>; a same-bytes rewrite is not listed
export function callCoverage(designRoot, cwd, command, { scriptMaxBytes = 262_144 } = {}) // → { mode: 'named'|'all'|'none', files: string[] }
export const READERS_PIN // the frozen READERS list the pinned test compares against
```

### Studio routes (`routes/agent.ts`)

Both are hook-class routes: non-browser (`hookBody`), main origin only, in no canvas allowlist, and
classified in `sync/writer-registry.ts`.

- `POST /_api/agent/bash/window` — **unchanged body**. Its meaning is now "park": open/close covers
  `files` or `all`.
- `POST /_api/agent/bash/settle` — **new**.
  - Body: `{ session, toolUseId, chat?, changed: [{ path, sha: string|null, created?, deleted? }] }`.
  - Validation: `path` passes `designPathRel` + `CLAIM_LANE_RE` (`.jsx` is added to the lane set) and
    is not under `_*`. At most `CLAIM_MAX_FILES` entries; a longer list is refused 400, and the hook
    splits it into batches.
  - Handling: for each entry with a non-null `sha` that equals `sha256(disk bytes)`, call
    `hookClaims.settle → claimWrite(control, run, rel, diskText)`. A `deleted` entry calls
    `claimDelete`. Then `stage.settleShellCall(toolUseId)` runs: parked writes are moved or released,
    and the window closes.
  - Response: `{ bound: string[], person: string[] }`. `person` lists files whose current bytes are a
    person's landed save (`saveHold().landedByPerson`).
  - Compatibility: against an older studio that answers 404, the hook falls back to today's
    `edit/touched {via:'bash', files}`.

### `sync/action-stage.ts`

- `shellWindow(open)` marks a call as parking, keyed by call id.
- `captures(...)` returns `park` for an unclaimed outside write to a covered slug, creates included.
- `settleShellCall(call)` moves parked lanes whose bytes match a claim into the claimed run as one
  write, then releases the rest as outside actions (no `runId`).
- `releaseShellCall(call, reason)` runs on close + `SETTLE_WAIT_MS` without a settle, on stale, and at
  the run's end.
- Constants: `SHELL_SETTLE_MS` stops admitting unclaimed writes. `SETTLE_WAIT_MS = 3_000` is new.

### Hook side (`touched.json`)

The hook binds `bound − person` only, never mtime-only files.

## 6. Test plan (fail-first; revert the fix once and see each test go red again)

### Hook — `node --test`

`cli/lib/lane-snapshot.test.mjs` (new), `cli/lib/bash-guard-readers.test.mjs` (new), and updates to
`plugins/design/hooks/hooks.test.mjs`.

- **H1** The prefilter: a stat-only pass hashes 0 files. A same-size rewrite restored with `touch -r` is
  seen as changed (through `ctime`). Past the budget, `sha: null` and `complete: false`.
- **H2** `laneDiff`: covers created, deleted and changed. A same-bytes rewrite (`sed -i` with no match)
  is not listed.
- **H3** `callCoverage`, over the §4 table: `pnpm test` is `none`, the S7 heredoc is `named`, a new file
  is `named`, a glob is `all`, a script that mentions the design root is `all`, and a cwd inside the
  design root is `all`.
- **H4** State location: after pre-bash, nothing under `<designRoot>/_runs` contains `manifest` or
  `hashes`. The manifest is under `$MAUDE_HOOK_STATE_HOME/<rootId>/…` with mode 0600.
- **H5** Fail closed: a missing or corrupt manifest at post-bash sends no claim (the settle carries
  `changed: []`) and binds no touch. A `none` call opens no window.
- **H6** READERS pinned: `READERS` equals `READERS_PIN`. Each reader with plain arguments is
  `bashMayWrite → false`, and with `> f` it is `true`. Adding a reader means changing the pin and
  passing a "cannot write" check (no write flag in `man`) — the test names the rule from #164.

### Studio — `bun:test`

`apps/studio/test/164-hash-diff-attribution.test.ts` (new).

- **S1** A parked write during the window, then a settle that claims its bytes: the write is in the
  run, as one write.
- **S2** An outside write to G during an `all` window, while the settle claims only F: G is released as
  outside and is not in the run.
- **S3** No settle (hook failure): released as outside at close + `SETTLE_WAIT_MS`, never in the run.
  Stale or run end gives the same result.
- **S4** A person's studio save during an `all` window is never parked or staged (pin). A save on a
  named file is held, then lands as the person's (the existing save-hold tests stay green).
- **S5** An interpreter creates a new canvas: the parked create plus the settle claim produce the
  run's `doc.create`. This closes the #164 item.
- **S6** An outside write 0.5 s after the settle, with other bytes, lands as outside. This test is red
  on today's code (`SHELL_SETTLE_MS`).
- **S7** A window opened by ACP alone, with no hook, is parked and then released as outside.
- **S8** The settle route:
  - a browser `Origin` and the canvas origin are refused;
  - a bad path, `_*` or a non-lane file gets 400;
  - more than 32 entries gets 400;
  - a disk sha mismatch is not claimed;
  - a foreign chat or no live run gives `bound: []`.

### Kept green

`acp-shell-write-stage`, `p8-a1-save-hold*`, `p8-a1-write-claims*` and `canvas-origin-gate`. Where one of
them asserts that a "window takes the write", it is updated to "parked, then claimed". Also the S7 and
S1 ACP journeys and `hooks.test.mjs`. Run the full studio suite on the mini before the freeze.

## 7. Inventory: auto-tier verbs that write to disk (v2-scout, on main 0d8572e50)

Claim codes:
- **R** — writes through a studio route that is wrapped in `withWriteClaim`, sending `X-Maude-Chat`.
  `_studio-verb.mjs` `chatWriteHeaders` :92-96 skips GET/HEAD; `curl-local` sets it itself.
- **D** — posts its bytes to `_write-claim.mjs` before writing them.
- **T** — a run tag in the body (`annotations/run-tag.ts`, staged explicitly).

| Verb | Writes | Claim |
| --- | --- | --- |
| canvas-edit | canvas `.tsx` (disk) | D (`canvas-edit.ts:6252`); its other write sites (3443, 4381, 5189) are **unchecked** |
| reel-place | canvas (disk) | D |
| ds-check --fix | canvas `.tsx` (disk) | D (`ds/canvas-cli.ts:304`) |
| captions add, cut-words, cut-to-beat | canvas, via `/_api/edit-op` | R |
| trash move / restore | canvas, via `DELETE /_api/canvas` and `/_api/trash/restore` | R (`.tsx` only) |
| annotate | `.annotations.json`, via the legacy `/_api/annotations/ops` | T |
| photo-adjust | photo-edit sidecar, via the legacy `PUT /_api/photo-edit` (not wrapped) | **none** — sidecar not a lane |
| handoff --emit | `<Slug>.registry.json` | **none** (non-lane) |
| import-asset (CLI path) | `assets/**` | **none** (non-lane) |
| import-tokens | system CSS | **none** (non-lane) |
| ingest-footage | `assets/<sha8>.*` | **none** (non-lane) |
| transcribe-local | `assets/*.transcript.json` | **none** (non-lane) |
| beats | `assets/*.beats.json` | **none** (non-lane) |
| ds-check --emit | `<system>/tokens.json` | **none** (non-lane) |
| exports again, export, captions export | a file at `--out` | N/A (export output) |
| runs stop | nothing on disk | N/A |
| ds-upgrade stage / prove / discard / cancel | `_state/ds-upgrade/**` (runtime) | N/A |

What this shows:

- **Every lane writer already claims.** The 8 that do not claim write non-lane files (assets, tokens,
  registry, sidecars).
- The stage stages lanes only, and `claimHashOf` returns null for those 8 files, so claiming them
  changes nothing today.
- The real follow-up is therefore (a) a pinned test that no auto-tier verb writes a lane file
  unclaimed, and (b) a canvas-edit audit of its other write sites.
- The issue's "~40 verbs should claim" collapses to that, until the file plane attributes runs
  (open question 2).

## 8. Synced history: "the version before"

- **Today, by position.** `bin/_history.mjs` `syncedDiff` defaults `from` to `rows[1]`. The guide
  `_guide-versions-and-trash.md` tells the AI that the version before "is the row just below".
- **Where that breaks.** If a person (or another run) saved between the run's actions, or if the run
  wrote several versions, the row below is not the state before the run.
- **What "by run" needs:**
  - Rows already carry `runId?` / `chatId?` (`history/versions.ts` `HistoryRowLike`). The builder
    verifies that hub rows keep them.
  - The default `from` becomes the row just below the **oldest** row of the newest AI row's run group
    on that canvas.
  - New selectors: `--run <runId>` and `--run @mine`. `@mine` is this chat's newest run, through
    `MAUDE_CHAT_ID`.
  - `history list --json` exposes `runId`.
  - The guide changes to "the version before your run: `history diff <canvas> --run @mine`, then restore
    its `from`".
  - Rows naming the actual agent: label the AI part from the run record's actor (`maude-chat` →
    "Maude chat", a session → "Claude Code"), never the placeholder label.

## 9. Builder slices (≤ 3)

**B1 — hook side** (Sonnet; Opus if H3 grows).
- Owns `cli/lib/bash-guard.mjs` (`laneSnapshot`, `laneDiff`, `callCoverage`, `READERS_PIN`), a new
  `cli/lib/hook-state.mjs`, `cli/lib/design-hook.mjs` (pre-bash and post-bash), and the tests
  `cli/lib/lane-snapshot.test.mjs`, `cli/lib/bash-guard-readers.test.mjs` and
  `plugins/design/hooks/hooks.test.mjs`.
- Calls settle with a 404 fallback, so it merges before B2.
- Done when: H1–H6 go red → green, and no `hashes` remain under `_runs`.

**B2 — studio side** (Opus: sync and stage risk).
- Owns `apps/studio/sync/action-stage.ts` (parking, `settleShellCall`, `releaseShellCall`),
  `apps/studio/ai/write-claim.ts` (`hookClaims.settle`), `apps/studio/routes/agent.ts` (the settle
  route), and the plumbing in `apps/studio/sync/index.ts` + `sync/local-kernel.ts`.
- Also owns `apps/studio/acp/index.ts` (the ACP window becomes parking only), the route class in
  `apps/studio/sync/writer-registry.ts`, the new test `test/164-hash-diff-attribution.test.ts`, and the
  test updates listed in §6.
- Done when: S1–S8 go red → green, the kept-green list is green, and the full studio suite passes on
  the mini.

**B3 — verbs + history** (Sonnet).
- Owns `apps/studio/bin/_history.mjs` (`--run`, default `from` by run, agent label),
  `plugins/design/skills/design/_guide-versions-and-trash.md`, and `routes/history.ts` (only if hub rows
  lack `runId`).
- Adds the new pinned test `apps/studio/test/164-lane-writers-claim.test.ts`, a static scan saying
  every auto-tier verb that writes a lane file is R, D or T.
- Audits canvas-edit's other write sites and adds `claimWrites` where they write a lane.
- Done when: the history tests cover the "save between run actions" fixture red → green, and the pin
  test is green.
- Regenerate the plugin surfaces only if a command's frontmatter changes.

## 10. Open questions (each has a recommended default)

1. **Is ACP's `toolCallId` the hook's `tool_use_id`?** Default: assume yes and assert it in S7. If not,
   key the ACP window by command hash plus time.
2. **Non-lane files (assets, tokens, registry) in runs.** Default: they stay outside until the file plane
   learns run attribution. That is a separate plan row; this slice adds no claims for them.
3. **`_runs/<s>/{snap,base}` bytes (#168).** Default: move them to `hookStateDir` in a later #168
   slice. This spike moves only the hash and manifest marks.
4. **`SETTLE_WAIT_MS`.** Default 3 s, measured against the hook's 5 s post timeout. Lower it if S3
   shows parked writes held too long.
5. **A background call (`bg`).** Default: it parks until its Stop-time settle (`drainBackground`), with
   the same release rules.
