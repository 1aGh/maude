# S1: Canvases panel row and foot slots, and the Trash surface S9 reads

Status: **contract** (Phase 5 contracts spike, 2026-10-18). Writer: S1 planner role. Needed by **S9.21**
(access states, trashed while open), **S9.24** (offline, back online), **S5.13** (the "Needs you" row meta,
already a patch request in S5's plan). Built panel: `client/v2/canvases/canvases-panel.jsx` +
`tree-model.js` (S1.1–S1.4, on `feat/maude-v2`). Trash shape: `S1-trash.md` (S1.6, branch `s1-6`, commit
c45266ef). Canvases: `10 Share and Collaboration` (co-share-roles "This canvas", co-sync-offline,
co-sync-back, co-trashed), `_kit.tsx` `CanvasItem { meta?, sub?, dim? }`.

## 1. What a row and the foot can carry

The kit draws two different places on a canvas row, and the panel keeps them apart:

| Place | Kit field | Examples (verbatim from the canvases) | Look |
| --- | --- | --- | --- |
| **meta** — one short word at the row's right, before the badges | `meta` | "not sent" · "sending" · "Needs you" | `cv-meta`, tone per source |
| **sub** — the second line under the name | `sub` | "Shared with you · Can view" · "Shared with you · Can comment" · 🗑 "In the trash · open here" | `cv-sub` (the line search already uses) |
| **dim** — the row fades | `dim` | the trashed-while-open row | `is-dim` |
| **foot** — the panel's last line | `foot` | "14 changes since yesterday 18:20 — kept on this Mac" · "Sending 14 changes · 9 sent" · "Only Combine-kampan was shared with you." | `cv-foot` |

## 2. Interface: `client/v2/canvases/row-slots.js` (S1 owns, new)

A tiny external store. Providers publish whole maps; the panel subscribes with `useSyncExternalStore`, so a
provider never re-renders the panel per row and never imports a panel component.

```ts
type Source = 'ai' | 'sync' | 'access' | 'trash';
interface RowSlot {
  meta?: { word: string; tone?: 'quiet' | 'warn' | 'azure'; title?: string };
  sub?: { text: string; icon?: 'trash' | 'eye' | 'comment' };
  dim?: boolean;
}
interface FootSlot { text: string; tone?: 'quiet' | 'warn' }
interface GhostRow {          // a canvas that is not in the index any more but is open in a tab
  path: string;               // its last path (from the trash item), where the row is drawn
  name: string; cover?: string;
  slot: RowSlot;              // e.g. { sub: { text: 'In the trash · open here', icon: 'trash' }, dim: true }
  onOpen(): void;             // focus that tab (the banner + Restore are S9.21's)
}

setRowSlots(source: Source, slots: ReadonlyMap<string /* designRoot-relative path */, RowSlot> | null): void;
setFootSlot(source: 'sync' | 'access', foot: FootSlot | null): void;
setGhostRows(source: 'trash', rows: readonly GhostRow[]): void;
useRowSlots(): { slotFor(path: string): RowSlot | null; foot: FootSlot | null; ghosts: readonly GhostRow[] };
```

**Precedence** (the panel merges; providers never coordinate):
- **meta:** `ai` ("Needs you" — it asks for you) > `sync` ("not sent" > "sending"). One word per row, never two.
- **sub:** a search's own sub ("artboard in **LetakA6**") while searching > `trash` > `access`. Outside a
  search, the trash line wins: a trashed canvas you can view is first of all in the trash.
- **dim:** any source.
- **foot:** `sync` > the jump foot ("21 artboards · 19 digital, 2 print", S1.3) > `access` > the default
  ("93 canvases · ⌘K searches every project"). The offline foot is transient and the most urgent; the
  canvas-only foot comes back when it clears.
- **Ghost rows** sit at their `path` in the tree (folder counts do not include them) and in no other group.

**Test ids:** `canvas-row-meta-<slug>`, `canvas-row-sub-<slug>`, `canvas-row-trashed-<slug>` (ghost),
`canvases-foot` keeps its id and gains `data-slot="<source>|jump|default"`. The Pinned copy gets the same
slots (`canvas-pinned-*` rows), so a pinned canvas that goes offline says "not sent" in both places.

**Change to the built S1.1 panel** (`canvases-panel.jsx`, `tree-model.js`): `PanelCanvasRow` reads
`slotFor(row.path)` for meta / sub / dim; `buildTree` takes `ghosts`; `panelFoot` takes the foot slot and the
precedence above. One small slice (task T-S1a below).

## 3. Who provides what

| Slot | Provider (slice) | Data it reads | Words (copy owner) |
| --- | --- | --- | --- |
| meta "not sent" / "sending" per canvas | **S9.24** | the outbox (V2-1.14) per canvas path: queued → "not sent" while offline, in flight → "sending" | S9 |
| foot "N changes since <time> — kept on this Mac" / "Sending N changes · M sent" | **S9.24** | the outbox totals | S9 |
| meta "Needs you" | **S5.13** | `GET /_api/ai/runs` `needsYou` per canvas | S5 |
| sub "Shared with you · Can view / Can comment" | **S9.21** | the session's access (`/api/access/me`, V2-1.7): canvas-scoped grant rows, role word from `levelOf` | S9 |
| foot "Only <canvas> was shared with you." / "Only these <n> canvases were shared with you." | **S9.21** | the same, when the session is canvas-only | S9 |
| ghost row 🗑 "In the trash · open here" (dim) | **S9.21** | `useTrash()` (§4) ∩ the open tabs | S9 |

A canvas-only session also hides **New canvas** (co-share-roles: "no New canvas"): the panel already reads the
role gate for New canvas; S9.21 makes canvas-only fail it (`project`-level capability), no slot needed.

## 4. The Trash surface S9 reads (S1.7 / S1.8)

Item ids are `S1-trash.md` §1: **`canvas:<entry>`** and **`artboard:<actionId>/<artboardId>`** — strings, stable
across moves; `entry` is the stable canvas id.

| Route (S1.7, `routes/trash.ts`, main origin only, never canvas-safe) | Body | Gate | Answer |
| --- | --- | --- | --- |
| `GET /_api/trash` | — | `read` | `{ items: (CanvasItem \| ArtboardItem)[], canClear: boolean, seq }` (canvas-only: only items whose canvas is in the closure, L18) |
| `POST /_api/trash/restore` | `{ id }` | `trash` (edit) | `{ ok, path }` · 409 `cleared` · 409 `taken` → restored as "<name> 2" |
| `POST /_api/trash/clear` | `{ items?: string[] }` | `delete` (owner) | `{ ok, cleared, skipped? }` · 403 `forbidden` · 403 `not-in-scope` (any canvas-only session) |

- **Hub door** `POST /api/trash/clear` (V2-1.7 §5.6): a row in the hub's one table, new
  `apps/hub/src/routes-v2/trash.mjs`, `cap: { unsafe: 'delete' }`, `scope: 'project'`, **no** `canvasDoor`
  (the access gate then refuses every canvas-only session, fail closed). S1.7 writes the row and its handler
  (the kernel op `trash.clear`, S1.6, which re-checks the role per op); S9 owns the gate it runs behind. Two
  checks, one matrix.
- Bus event **`trash:changed { seq }`** (S1.7) on every accepted `trash` / `trash.restore` / `trash.clear`
  action; `client/v2/left-panel/use-trash.js` (S1.8) exposes `useTrash() → { items, canClear, seq }` and
  refetches on it. S9.21 reads `useTrash()`; it never calls the routes itself except Restore from its banner
  (`POST /_api/trash/restore { id: 'canvas:<entry>' }`).
- **Version history** (S1.12, `routes/history.ts`) answers through **`visibleHistoryRows(rows, access)`**
  from `apps/studio/access/filters.ts` (S9.10). Until S9.10 lands, S1.12 imports a pass-through with that
  signature and refuses canvas-only sessions with 403 at project level; S9.10 replaces the body, not the call.

## 5. Tests that pin this contract

- `v2-canvases-row-slots.test.ts` (T-S1a): precedence tables above (meta, sub, foot), ghost rows at their
  path and not counted, Pinned copy carries the slots, a provider clearing (`null`) restores the default,
  test ids.
- `v2-canvases-tree-model.test.ts` (S1.1, extended): `buildTree` with ghosts.
- S9.24 / S9.21 / S5.13 assert their words through the ids above, not through panel internals.
- `acl-l18-trash.test.ts` (S1.7, planned) + `access-trash-clear.test.mjs` (S1.6, planned) cover the gate.

## 6. Open questions (default the run takes)

1. A canvas both trashed and shared with you canvas-only: **trash wins** (§2), the access word moves to the
   banner.
2. Meta for a canvas with an AI run *running* (not needing you)? **None** — the AI badge already says it.
3. Should the foot ever show two facts ("Offline — …" and "Only … was shared")? **No**, one line; precedence.

## 7. Follow-up slice

**T-S1a — row and foot slots** (sonnet, ~50 turns, L2, after S1.4 merged). Files owned: new
`client/v2/canvases/row-slots.js`; `canvases-panel.jsx` (`PanelCanvasRow` meta / sub / dim, the foot),
`tree-model.js` (`buildTree` ghosts, `panelFoot` precedence), `canvases.css` (`cv-meta`, `is-dim`). Lead
patch: release-minified rebuild. Done when §5's first two tests are green and every existing panel test id
still resolves. Providers (S9.21, S9.24, S5.13) can be built against the store before it renders.
