# S8 ↔ S9 — asset presence: "Waiting for Jonas's Mac" vs Missing

Writer: **S8.0** (2026-10-18). Signers: S9 (hub lane owner), L4. Built by **S8.19** (studio `sync/asset-state.ts`,
canvas-lib placeholder state on the L1 slot, hub half `apps/hub/src/asset-presence.mjs` on the L4 slot). Sources:
`S8-slices.md` Q8 + row S8.19; CONTRACT §Words "Not here yet vs missing"; `V2-1.16` L5 (presence only of what a session
sees), U1; `V2-1.5` attribution; DDR-222/DDR-225 (sweep out of process, fast lanes); S9 Q12 (hub `routes-v2` table).

## 1. Question

How does any device tell "a file that exists on someone's device but hasn't synced" (quiet: *Waiting for Jonas's
Mac*) from "a file no device has" (*Missing* + Relink…)? Which data does the hub keep, which lanes carry it, and what
does a canvas-only session see?

## 2. What exists today

- The desktop sweep (`sync/asset-push.ts` `probePresent`) asks `POST /_asset-probe {paths}` → `{present:[…]}`
  (≤ `MAX_PROBE_PATHS`, the per-label write bucket, same gates as the asset writes). It asks only about files it holds
  locally (skip-first upload), so **the probe already says "I hold these"** — but the hub keeps nothing from it.
- `GET|HEAD` on the asset door answers presence **only for what the session sees** (V2-1.16 L5; anything else 404).
- Missing files heal by themselves when bytes land: file-plane pull + the `hmr-broadcast.ts` `mode:'asset'` heal
  signal re-points broken `<img>` (2026-08-15 RCA). So *waiting → here* needs no new message.
- Hub routes go through `apps/hub/src/routes-v2/index.mjs` rows `{method, path, cap, scope, handler}` (S9 Q12).
- No device knows who has a file, and no sweep reports that it finished.

## 3. Options

1. **Hub keeps a holder set + per-device sweep completion, fed by the existing probe** (two additive body fields);
   studio asks on demand. *Chosen* — no new socket message, one new GET, the sweep already makes the calls.
2. A presence broadcast over the collab socket. Adds a per-connection ACL filter (L11/L12 surface) for a state that
   changes rarely and already heals through the file plane. Rejected.
3. Infer "missing" on the client from a failed GET. Cannot tell "not uploaded yet" from "gone" — the bug this fixes.
   Rejected.

## 4. Decision (DDR draft)

**Context.** A peer's photo that has not been uploaded yet reads as broken (Missing), which tells people to relink
files that will arrive by themselves.
**Decision.** The hub records, per asset path, which devices hold it (from probe batches flagged `held`) and, per
device, when its last sweep completed (probe flagged `final`). `GET /api/projects/:p/v1/asset-presence?rel=…` answers
`here | waiting{who} | missing | unknown`, filtered by `sees`. The studio merges that with its own upload queue into
`here | uploading | waiting{who?} | missing`, polls while a waiting item is on screen, and tells the canvas over dgn.
**Consequences.** One hub runtime file, one hub route row, two optional probe fields, one dgn message. Unknown always
degrades to quiet *Not here yet*, never to a false Missing.
**Rejected.** Options 2 and 3; querying by sha (the closure rule is path-based — a sha could name an asset outside the
session's closure through another extension); naming a device by e-mail.

## 5. Contract

### 5.1 Hub data (`apps/hub/src/asset-presence.mjs`)

Stored in the hub's own data dir (`<dataDir>/asset-presence.json`; a cell: its data dir) — hub runtime, **not** a
project file, never under the design root, so no DDR-115 list changes.

```ts
type DeviceKey = string;                 // the token label of the session that probed (one per linked Mac)
interface PresenceStore {
  v: 1;
  holders: Record<Rel, Record<DeviceKey, { seenAt: number }>>;   // Rel = checkout-relative asset path
  devices: Record<DeviceKey, { name: string|null; kind: 'mac'|'pc'|'linux'|null; account: string; sweptAt?: number }>;
  firstAskedAt: Record<Rel, number>;     // first in-scope presence query for a path the hub lacked
}
```

Caps: 50 000 paths, 64 devices; a holder entry or device not seen for **30 days** is dropped. `name` = the session
user's display name, `account` = an opaque account id (never an e-mail). Writes are debounced (≤ 1/5 s).

### 5.2 Feeding it — the existing probe, two optional fields

```
POST /_asset-probe { paths: string[], held?: true, sweep?: { id: string /* ≤64, [A-Za-z0-9_-] */, final?: true } }
  → 200 { present: string[] }             // unchanged
```

- `held:true` records the caller's device as holder of each path **it sees and may write** (the probe's existing gate +
  `access.sees(rel)`); other paths are ignored silently. A v1 hub ignores the fields; a v1 desktop never sends them.
- `sweep.final:true` on the last batch of a sweep run sets `devices[d].sweptAt = now` and removes `d` from the holders
  of every path it held before but did not report in this `sweep.id` (it no longer has the file).
- The studio sends `held:true` from the sweep only (not from reference-triggered pulls).

### 5.3 State rule (hub)

For one path, with the hub's existing presence check (journal/cache/R2, as the probe uses):

1. Not in the session's scope → `unknown` (identical to a path the hub has never heard of; nothing recorded).
2. Bytes present → `here`.
3. A holder `d` other than the asking device → `waiting`, `who` = `devices[d]` (most recent `seenAt`).
4. No holder, and some device seen in 30 days has **no** completed sweep after `firstAskedAt[rel]` → `waiting`, `who`
   = that device if it is the one whose session first referenced it (V2-1.5 attribution, when known), else no `who`.
5. Otherwise (every recent device swept after the reference appeared and none holds it) → `missing`.

`firstAskedAt` is set on the first in-scope query that finds no bytes. A reference no device ever sweeps (a v1-only
team) therefore stays *waiting* — the conservative side.

### 5.4 The query route (hub, `routes-v2` row)

```
GET /api/projects/:p/v1/asset-presence?rel=<path>[&rel=…]        (≤ 256 rels; checkoutRelShape on each)
  row: { method:'GET', path:'/api/projects/:p/v1/asset-presence', cap:{safe:'read'}, scope:'filtered' }
  200 { items: [ { rel, state: 'here'|'waiting'|'missing'|'unknown',
                   who?: { name: string|null, kind: 'mac'|'pc'|'linux'|null, self: boolean } } ] }
  400 bad rel · 413 > 256 · 429 (read bucket)
```

- `self: true` when the holder is another device of the caller's own account ("Waiting for your other Mac").
- `who.name` is a display name only (L17). Canvas-only sessions get `unknown` for every rel outside their closure —
  the same bytes as a path the hub has never seen (U1); presence lists are per-rel, so nothing enumerates.
- Self-hosted and cloud hubs answer the same; a hub without the route → 404.

### 5.5 Studio (`sync/asset-state.ts`) and the lanes that carry it

```ts
type AssetState =
  | { state: 'here' }
  | { state: 'uploading'; progress?: number }          // this Mac's own push queue — never asked of the hub
  | { state: 'waiting'; who?: { name: string|null; kind: string|null; self: boolean } }
  | { state: 'missing' };
```

| Situation | State |
| --- | --- |
| file on disk | `here` |
| in this Mac's upload queue | `uploading` |
| linked project, hub says `here` (pull pending) / `waiting` / `unknown` | `waiting` (with `who` when given; `here` = "Syncing…") |
| linked project, hub says `missing` | `missing` |
| linked project, hub offline or route 404 | `waiting` without `who` ("Not here yet") |
| local project (no hub), file absent | `missing` |

- **Shell route:** `GET /_api/asset-state?rel=…` (main origin only — absent from `CANVAS_SAFE_API` and
  `routes/canvas-origin.ts`; `sameOriginRead` + `isTrustedRequestHost`; writer-registry `read`), batched ≤ 256, a
  60 s cache per rel.
- **Refresh:** on canvas open, every 60 s while any `waiting` item is on screen, at reconnect, and after a sweep ends.
  `waiting → here` arrives through the file plane + the existing `mode:'asset'` heal, without a reload.
- **Canvas:** the shell sends dgn `asset-state {items: [{rel, state, who?}]}` (shell → canvas) for rels in the open
  canvas; canvas-lib's placeholder frame (L1 slot) draws *Waiting for Jonas's Mac* quietly or *Missing* with Relink….
  The canvas never calls a presence route.
- **Exports** (S8.4 group items): a unit whose input is `waiting` is `status:'waiting'` with "waits for its <kind> from
  <name>'s Mac"; `missing` → `failed` "<name> is missing".
- **Relink…** appears on `waiting` only when this Mac has a copy (the picker), and on `missing` always; it re-points
  every ref to the chosen file's sha as one undo step (S8.19).

### 5.6 ACL summary

| Session | Feeds holders | Sees |
| --- | --- | --- |
| project editor | paths it sees and may write | every path's state |
| canvas-only editor | only closure paths | closure paths; `unknown` elsewhere |
| viewer / observer | nothing (no write gate) | closure/scope paths as their role sees |
| canvas origin (render token) | nothing | nothing (no route; dgn from the shell only) |

## 6. Evidence

Code reading: `asset-push.ts probePresent` (sweep-only, POST batch), `assets.mjs` presence branch (`access.sees` before
`existsSync`, L5), `server.mjs` `/_asset-probe` dispatch, `hmr-broadcast.ts` asset heal, `routes-v2/index.mjs` row
shape. No prototype: the route is additive and the state rule is pure (testable as a table).

## 7. Tests that will prove it (red first)

- `hub/test/asset-presence-state.test.mjs`: the §5.3 table (holder → waiting{who}; swept-without by every device →
  missing; one device never swept → waiting; 30-day expiry → missing).
- `hub/test/asset-presence-acl.test.mjs`: canvas-only gets `unknown` outside closure, byte-identical to an unheard path;
  a canvas-only `held` claim outside its closure is ignored; no e-mail in any answer.
- `hub/test/asset-probe-held.test.mjs`: v1 body unchanged; `final` prunes stale holders.
- `studio/test/asset-state.test.ts`: the §5.5 table incl. offline/404 → waiting, local → missing; route not reachable
  from the canvas origin.
- Scenario (S8.19 via `multiplayer/`): Jonas adds acko-hero2.png offline → Tereza sees *Waiting for Jonas's Mac* →
  Jonas comes online → it fills in without a reload; Jonas deletes it locally and sweeps → *Missing*.

## 8. Feeds and follow-up work

- **S8.19** builds §5.1–§5.5 (hub half on the L4 slot, merged by the S9/L4 owner; the `routes-v2` row is a shared-table
  patch). **L1 slot**: the canvas-lib placeholder state block. The dgn `asset-state` message needs the dgn bridge
  owner's patch.
- **S8.4** uses `waiting` for group-job items; **S8.11** may show the same state in Assets.
- Must not: add a collab-socket presence message; expose e-mails or device ids; let the canvas origin query presence.

## 9. Open questions (conservative default)

| # | Question | Default |
| --- | --- | --- |
| O1 | Git/Syncthing projects (no hub): can a peer's file be "waiting"? | No — absent = Missing with Relink…; Syncthing heals through the file watcher anyway. |
| O2 | Should the hub push a notice when a path turns `missing`? | No in v2.0 — the 60 s poll while visible is enough. |
| O3 | Holder expiry window. | 30 days, then *Missing* (a Mac gone for a month should not keep a file "waiting" forever). |
