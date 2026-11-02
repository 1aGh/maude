# P8 C4 — open frame-capability gaps + the 403-only sweep (branch p8-c4)

Source of the open items: `.ai/plans/notes/v2-evidence/V2-phase5-waveB-gate-2026-10-22.txt`
§ "Known gaps to fix BEFORE any rc" (wave-B gate, security pair round 8). V2-8.9 (p8-secfix-a/b/m1)
findings were not redone.

## The five known gaps

| # | finding (round 8) | status | fix | test (red on HEAD sources → green) |
|---|---|---|---|---|
| 1 | defender M — `carriedPass` short-circuit caches a stale proxy answer (3-module re-export cycle, two-grant order) | fixed | `access/closure.ts` `carriedPass` evaluates every import every pass (no `.some`): a module behind a later import was not revisited once an earlier import started to reach, and the fixed point finalized its pass-1 value | `test/p8-c4-closure-gaps.test.ts` "defender M" (both grant orders red → green) |
| 2 | attacker L — per-use photo edit JSON importable when its hash is guessable | fixed | `importable` refuses `PER_USE_PHOTO_RE` (blocks the grant); the attribute path (S8 §5.6) still admits it | "attacker L — a per-use photo edit" |
| 3 | attacker L — specimen-stylesheet exemption covers ui_kits showcase canvases' own .css | fixed | `isDsSurfaceStyle` excludes `isUiKitRel` (`system/<ds>/ui_kits/**`, `preview/ui_kits-*`); the DS board keeps its own surfaces' styles (`ownSurfaceStyle`); c4m M-B test narrowed (its `ui_kits/web/shell.css` import is now refused) | "attacker L — the specimen-stylesheet exemption"; `p8-ds-board-specimens` green |
| 4a | c4n L — macro guard read-then-load swap race | fixed | `canvas-build.ts` `macroPinnedLoad`, the LAST plugin: reads each remaining file once, checks it, returns exactly those bytes with Bun's loader (probed on Bun 1.4.2: `args.loader` is present; a plugin's contents win even under an import attribute) | `test/p8-c4-macro-pin.test.ts` (unit on the plugin + a real build) |
| 4b | c4n note — transpile flag trusts `err.name` in the worker | fixed | `canvas-build-worker.ts`: `instanceof` the pipeline's `TranspileError` (loaded from the same studio dir) | macro-pin "the sandbox worker" (spoofed name → `transpile:false`; real class → true) |
| 5 | canvas-ness for old meta-less canvases: hub doc / stored grant signal not wired (c4k split) | **open — proposed split** | needs the hub's grant/doc set reaching `closureFor` on the hub AND the studio cell (a `ClosureConfig` field fed by the hub manifest); a cross-component task, not a fix | — |

## The 403-only sweep

`test/p8-c4-403-sweep.test.ts` — one table-driven test over `routeInventory()` (http.ts legacy
literal + `routes/index.ts allSpecs` + fall-through + canvas map) × callers, in BOTH fixtures
(cell: proxy-vouched claim; hub-linked desktop: stored claim). Expected per ask:

- observer / viewer / member × every write whose `writeCapability` the role lacks → 403
- A-only grant (main origin) × every `project`-class route (GET + writes) and every `canvas`-class
  write naming B or a missing canvas → 403 (U1/U3)
- A's frame on the canvas origin × every main-only route → 403

Two everyone-alike answers are accepted only when the OWNER hears the same status for the same
request (re-asked): a cell's contained route (`isForbiddenRoute`, DDR-193 §2 → 404 to all) and a
GET of a write-only route (405 to all, before access). Owner re-asks are GETs or contained routes
only — never an owner write that could execute.

### Findings (red on HEAD → fixed)

| fixture | caller | answered | fix |
|---|---|---|---|
| cell | A-only | `GET /_api/describe` → 409 `not-on-mac` (a project-level fact to a refused session) | `routes/describe.ts`: the access refusal (403 `project-only`) before the cell's 409; unit pin in `describe-pictures.test.ts` |
| desktop (hub-linked, canvas-only stored claim) | A-only | `GET` → **200** on `/_api/acp/{status,running,activity,chat}`, `/_api/diagnostics`, `/_api/diagnostics/report`, `/_api/debug-bundle`, `/_api/cloud/move`; 401 on `/_api/cloud/projects`, `/_api/github/repos`; 404 `/_api/acp/attachment`; 400 `/_api/acp/chat/session` — all `project` class (U3: never a 2xx), all desktop-only (contained in a cell, so the cell canary sweep never saw them) | `access/request.ts` `canvasOnlyRefused` (the 13 desktop-only project routes with no scope check of their own) + 3 lines in the http.ts gate: a canvas-only session gets the plain 403 (`not-in-scope`), every method |

Test infra: `_acl-gate.ts canvasOriginKeys` missed the wrapped canvas-origin handler
(`'/_api/canvas-meta': canvasOriginMeta(http…)`), so no canvas-origin sweep covered canvas-meta;
fixed (the canary sweep stays green with it). `bootGateCell` takes `env` (dead-proxy egress).

### Final run (fixed sources)

| fixture | asks | wrong | everyone-alike (owner hears the same) |
|---|---|---|---|
| cell | 1108 | 0 | 175 (160 × 404 contained route, 15 × 405 GET of a write-only route) |
| desktop | 1108 | 0 | 27 (405 GET of a write-only route) |

Red → green: `p8-c4-403-sweep` cell lane red on HEAD `describe.ts`, desktop lane red on HEAD
`http.ts` + `request.ts` (12 rows above), both green fixed. Green alongside: describe-pictures,
access-route-classes, acl-l13-ai, acl-revert-guard, canvas-origin-gate, canvas-origin-parity,
acl-canary-sweep, acl-u7-parity (68/68); closure + c4j/k/l/m/n units, p8-ds-board-specimens(-frame),
access-closure (green). tsc exit 0.

### Accepted, by decision (not 403)

- A cell's contained routes answer 404 to everyone (DDR-193 §2 — a cell looks like it never had
  the feature); checked equal to the owner's answer per row.
- A GET of a write-only route answers 405 to everyone before any access check (no scope or project
  fact in it); checked equal to the owner's answer per row.
