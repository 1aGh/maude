# S2 edit ops: the one dispatch route (frozen by S2.1)

Status: **frozen** (S2.1, 2026-10-18). Source: `S2-slices.md` §2 Q1–Q3, §3a; decisions
`maude/v2-S2-edit-op-dispatch`, `maude/v2-S2-editing-mount`. Code: `edit-ops/types.ts` (the types below,
verbatim), `edit-ops/dispatch.ts` (the op table + the refusal order), `edit-ops/revert.ts` (the legacy-link
undo), `routes/edit.ts` (the route). Changing a field here is a contract change: say it on the team channel
and bump this note; adding an op is not.

Callers that bind to it: S2.2 `element.set-id` (inspector id field), S2.3–S2.17 structural writes,
S3.0 `element.set-link` / `element.clear-link`, S12 (the design skill's "same result by hand"), S5 (⌘/ scope:
targets are `ElementRef[]`).

## 1. Route

`POST /_api/edit-op` — a table route (`routes/edit.ts`, `allSpecs` += `createEditRoutes`).

| Property | Value | Why |
| --- | --- | --- |
| origin | `main` only — in **neither** canvas allowlist (`CANVAS_SAFE_API`, `routes/canvas-origin.ts`): the canvas origins refuse it at the gate (403, never a reached handler); the main origin answers a `GET` with 405 | a source write; the untrusted canvas iframe asks through the shell (§3), DDR-054 |
| readOnly | `refused` → a viewer / Can comment session / format-gated project gets the standard 403 `read-only` | `minRole: edit` (V2-1.7 rule 12: what the UI hides, the server refuses) |
| guards | `guardTableRoute` (same-origin write + DNS-rebind) like every table route | — |
| body | JSON ≤ 64 KiB, `EditOpRequest` | — |
| writer class | `lane` (rows S2-ops) in `sync/writer-registry.ts`; `{ safe: null, unsafe: 'edit' }` in the hub manifest | the write reaches the project as a `lane.replace` (watcher import, base announced by `activity:suppress`) |

## 2. Types (`edit-ops/types.ts`)

```ts
type ElementRef = { artboard: string; element: string; occurrence?: number }; // V2-1.4 §7, canvas implied by `file`
interface EditOpRequest {
  file: string;              // canvas path: designRoot-relative (`ui/Foo.tsx`) or `.design/ui/Foo.tsx`
  op: EditOpId;              // == registry action id, e.g. 'object.frame'; or 'revert' (§5)
  targets: ElementRef[];     // 0–200; `element` may be a computed (8-hex) id: the dispatcher stamps it (V2-1.4 rule 3)
  params?: Record<string, unknown>;
  expectRev?: string;        // revOf(file bytes) the caller saw; refuse with 'stale' when the file moved
}
type EditOpResult =
  | { ok: true; actionId: string | null; writeId: string; rev: string; refs: ElementRef[]; created?: ElementRef[] }
  | { ok: false; code: 'held-by-ai' | 'locked' | 'stale' | 'invalid' | 'forbidden'; message: string };
// edit-ops/<op>.ts — pure, no IO
interface EditOp {
  id: EditOpId;
  /** default 'refuse': a locked target refuses the op. 'allow' only for ops that ARE the lock (object.lock). */
  locked?: 'refuse' | 'allow';
  apply(source: string, req: ResolvedEditOp): { source: string; created?: ElementRef[] };
}
```

Additions over `S2-slices.md` §3a (additive, optional for a reader):
- `rev` — the file's revision after the write (`revOf`: the first 16 hex of SHA-256 of the bytes), so the next
  request can send `expectRev`.
- `refs` — the targets as written: same order as `targets`, every `element` now an **authored** id (stamped
  in this write when it was a computed one). The canvas keeps its selection on these.
- `ResolvedEditOp` = the request with `targets` replaced by the stamped `refs` and `file` by the
  designRoot-relative path; an op never sees a computed id.

HTTP status per result: `ok` 200; `invalid` 400; `forbidden` 403; `held-by-ai`, `locked`, `stale` 409. A
viewer never reaches the handler (the read-only gate answers 403 `read-only` first); the client maps both
403 shapes to "forbidden".

## 3. Refusal order (the dispatcher, one request)

1. body shape → `invalid` (unknown key ignored; `op` not in the op table → `invalid` "Unknown edit"; a target
   outside the ElementRef shape, > 200 targets → `invalid`).
2. `file` → resolves inside the design root to an existing `.tsx` (realpath-contained) else `invalid`.
3. `expectRev` given and ≠ `revOf(current)` → `stale`.
4. stamp every target (`ensureStamped`, canvas-edit.ts); a target that cannot be found → `invalid`.
5. any target held by a live AI run (`heldByAi`, V2-1.15 §4 #13 — a running run's `objects` + scope
   elements) → `held-by-ai` with the S5.4 copy "<element> is AI's until it's done · Stop in the AI chat".
   A **person's** hold is never checked (advisory, DDR-120 / Q10).
6. any target carries `data-cd-locked` and the op is not `locked: 'allow'` → `locked`.
7. `op.apply` throws a `CanvasEditError` → `invalid` with its message (never a stack).
8. write (`activity:suppress` → bytes → pre-op snapshot in `_history/`) and answer `ok`.

Writes to one file are serialized in the route. `apply` returning the same bytes answers `ok` with no write
and `actionId: null`.

## 4. One write = one action

One request = one file write = one kernel action (V2-1.5). In accepted-revisions mode the write is imported
as one `lane.replace`; `actionId` is that action's id when the runtime already knows it
(`acceptedActionForContent`), else `null` (the projection picks it up later; S2.20). The id the canvas keeps
for an undo record is `writeId`, never a positional id.

## 5. Undo on a legacy link (the revert fallback, Q3)

Op-log projects undo through S5 (`/_api/project/undo {actionIds}`); nothing here. A legacy-hub link (no
transactions mode) or an unlinked project records, per edit-op, a CommandRecord whose undo is:

```json
{ "file": "<same>", "op": "revert", "targets": [], "params": { "writeId": "<the write's id>" } }
```

and whose redo is a `revert` of the revert's own `writeId`. `revert` is a three-way merge (`sync/source-merge.ts`
`mergeSource(base = after, ours = current, theirs = before)`): a teammate's later change elsewhere in the file
survives, a change that touches the same bytes answers `stale` ("Someone changed this since — undo
skipped"). The write log is in memory, capped at 200 writes per server; a restarted server answers `stale`.
`revert` is not a registry action (it is the undo of one) and is refused for a `writeId` of another file.

## 6. Shell relay (dgn)

The canvas (untrusted origin) never calls the route. It posts `edit-op` to the shell; the shell answers
`edit-op-result`:

| dgn | dir | gate | payload |
| --- | --- | --- | --- |
| `edit-op` | c2s | `active` | `{ requestId, op, targets, params?, expectRev? }` |
| `edit-op-result` | s2c | `parent` | `{ requestId } & EditOpResult` |

The shell **sets `file` to the active canvas itself** — a canvas can only edit its own file — and refuses
`op` values that are not in the op list it knows (`EDIT_OP_IDS`, shared from `edit-ops/types.ts`) before any
request. The shell's role gate is the registry's (`enabled: EDITS`); the server refuses anyway.

## 7. Selection payload (`select-set`)

`select-set` (the live selection message; `select` is a legacy no-sender row) gains three optional fields
the canvas computes once per selection (`editing/selection.tsx`, `editing/crumbs.ts`):

```ts
refs?: ElementRef[];           // the selection as refs (computed ids stay transient; never stored)
crumbs?: Array<{ label: string; ref: ElementRef | null }>; // artboard › … › selected, outermost first; ref null = the artboard
kind?: 'frame' | 'text' | 'image' | 'path' | 'shape' | 'instance' | 'artboard' | 'multi';
```

The inspector reads `crumbs` (`client/v2/inspector/crumbs.jsx`) and `kind` (S2.2 kind chip); clicking a crumb
posts `select-by-id` with that ref. An old canvas bundle sends none of them; the inspector then shows no crumbs.

## 8. Agent path (rule 14)

Every op has a `canvas-tsx.md` section, "the same result by hand", and a parity test: the route result ≡ the
documented file edit, as goldens. An agent never calls `/_api/edit-op`; it edits the TSX (the design skill).
