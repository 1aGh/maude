# #113 — Checklist: a sticky with ticks

Issue 1aGh/maude#113 ("Todo list in Maude canvas", reported on 1.0.11). Burndown T7.1 (this note) feeds
T7.3 (build + e2e + What's New + docs). Plan: `.ai/plans/feature-issues-burndown-2026-11.md`.

## 1. Question

A to-do list on the canvas, as an annotation kind: its data shape in `<slug>.annotations.json`
(versioned — do the DDR-115 lists change? does the board schema bump?), how it syncs, how it undoes, how
it exports, its keys (through the action registry, no new key handlers), its a11y, and how the AI reads
and writes it through the whiteboard verbs.

## 2. What exists today

- **Board model (DDR-242).** `annotations/registry.ts` — one `ElementDef` per type; a new type is one
  definition file plus a line in `DEFS`. Unknown types are kept verbatim by every reader (V2-1.12 R4); typed
  per-type extension fields ride after the tail (R5). `FORMAT2_TYPES` names the types format 2 added
  (stamp, vote, ballot), which a format-1 reader keeps as unknown.
- **Schema.** `annotations/board-schema.ts` generates `schema/annotations.v2.schema.json` from the registry
  (`scripts/gen-actions.mjs`, `--check` is the drift gate). `BOARD_FORMAT = 'maude.annotations'`,
  `BOARD_VERSION = 2` (`annotations/schema.ts`).
- **Sync granularity.** `annotations/replica.ts`: `Y.Map('annotations2')` = element id → `Y.Map(field →
  JSON value)`. A field is last-writer-wins; an **array field is one value**, so two people ticking two
  entries of one array at once lose one tick. Text fields merge through `patch.expect` (`ops.ts`).
- **Precedent for "records with no geometry".** `ballot` names its vote by a reference field (`vote:
  id(true)`), not `parent` (which makes `x`/`y` relative to a container). `caps.metadata: true` makes
  `strokesToElements` (`annotations/v1-adapter.ts`) carry the record untouched, so the stroke-view UI never
  deletes what it does not draw.
- **The UI still edits a `Stroke[]` view** (`annotations-layer.tsx` through `v1-adapter.ts`, DDR-244).
  Copy / cut / paste of annotations is the layer's own `{"maudeElements":2}` text payload
  (`copySelection` / `pasteStrokesText`); clones get fresh ids.
- **Roles.** Annotating sits with `edit`, not `comment` (`access/roles.ts`; S4.16: "Stickies need Can
  edit."). Annotations are quiet and click-through in Edit mode; they are worked in Preview.
- **Export.** PNG / PDF / video exports render the canvas shell with the annotation layer
  (`exporters/scope.ts` `annotations`); print formats never carry annotations (`annotationsExportPolicy`).
- **AI.** `maude design annotate` (ops: create / update / resolve / …, types described from the registry)
  and `maude design read-annotations`; the `design:whiteboard` skill. Votes and ballots are refused there
  (vote door, `annotations/vote-guard.ts`).
- **A fake checklist already ships.** `annotations/templates.ts` `checklist` = one section of four stickies
  whose text is `☐` (canvas 15 `an-templates`: "Checklist — One section, ticks").
- **Version history words.** `history/describe-annotations.ts` names element types.

kg: DDR-242 (element model), DDR-244 (stroke view), DDR-246 (lock is a UX guard), DDR-151 (whiteboard AI
toolkit), DDR-155 (sticky author identity), `v2-p8-leftovers-canvas-menu-paste-rests` (the frame reads no
clipboard).

## 3. Options

1. **A sticky with `checkitem` records** (chosen). New type `checkitem { list, text, done }`; `list` names a
   sticky. A sticky that has items draws as a checklist: its own text is the title, the items below.
   Per-element sync, so concurrent ticks merge. An older reader keeps the items verbatim (unknown type, no
   geometry → not drawn) and still shows the sticky with its title — graceful.
2. **An `items` array field on the sticky** (typed ext). One record, simplest UI. **Breaks sync**: the array is
   one LWW value (two ticks at once, one lost; an add during a reorder, one lost). Rejected.
3. **A new container type `checklist` + items.** Same sync as 1, but a second card type with its own colours,
   tilt, author line, resolve, stack, fan-out, convert-to-comment… all re-implemented, and an older reader
   shows nothing at all (unknown container with no known geometry). Rejected.
4. **Keep the `☐` text convention** (Markdown task lines inside sticky text). No schema, but a tick is a text
   edit (text merge noise, no "who ticked"), the AI parses prose, nothing is countable. Rejected — it stays
   only as an import path (§5.6 "Turn into checklist").

## 4. Decision (DDR draft)

**Title:** A checklist is a sticky with `checkitem` records — one element per entry, per-element sync, no
board version bump.

**Context.** #113 asks for to-do lists on the canvas. The board syncs per element and per field; an array
field loses concurrent ticks. The stroke-view UI must not delete records it does not draw.

**Decision.**
1. New format-2 element type `checkitem` (`annotations/elements/checkitem.model.ts`), `caps.metadata: true`,
   no geometry. Fields: `list` (the sticky's id, required), `text`, `done` (`{by, at}`, absent = open).
   `index` (HEAD) is the list order.
2. A sticky with ≥ 1 genuine item **is** a checklist. No new sticky field. "Turn into checklist" adds items;
   removing the last item makes it a plain sticky again.
3. **No board version bump, no DDR-115 change.** `BOARD_VERSION` stays 2; `checkitem` joins
   `FORMAT2_TYPES`; the generated schema gains `el-checkitem`. The file is still `<slug>.annotations.json`
   (VERSIONED, already in all four lists) — nothing new under `_*`.
4. Writes go as ops (`put` / `patch` / `delete`), never through the stroke diff. Every gesture is one op
   batch = one action = one ⌘Z.
5. Ticking needs Can edit (annotations are edit-level) and happens in Preview. A **locked** checklist can
   still be ticked (lock guards move / resize / text / delete — DDR-246 is a UX guard); adding, removing and
   rewording entries of a locked checklist are refused with the lock line.
6. Every key is an action-registry entry (§5.5); the layer adds no key handler.
7. The AI writes items through `maude design annotate` like any element (not a vote-door type).

**Consequences.** One new type file + registry line; the layer draws items inside the sticky card; the
`checklist` template becomes a real checklist; cloud gets it with the hub release that bundles the registry
(the hub imports `apps/studio/annotations/*`), and until then a hub keeps items as unknown records (R4).

**Rejected.** Items array on the sticky (concurrent ticks lost); a separate `checklist` container type
(duplicates the whole sticky surface, older readers show nothing); `☐` text convention (unstructured);
`parent` for membership (makes x/y relative and turns the sticky into a container); letting Can comment tick
(annotations are edit-level everywhere; see Q1).

## 5. Contract

### 5.1 Element (`annotations/elements/checkitem.model.ts`)

```ts
export const MAX_CHECK_ITEMS = 200;        // genuine items per list drawn / accepted by the verb
export const MAX_CHECK_TEXT = 2_000;       // chars, one line (no '\n'; ↵ makes the next entry)

export const checkitem: ElementDef = {
  type: 'checkitem',
  fields: {
    list: id(true),                         // the sticky this entry belongs to
    text: str({ max: MAX_CHECK_TEXT, plain: true }),  // '' allowed (drawn as the placeholder "To do")
    done: resolvedField(),                  // { by: <person|'AI'>, at: ISO } — absent = open
  },
  caps: { box: false, rotatable: false, resizable: false, bindable: false, container: false,
          textSlot: 'text', metadata: true },
  bounds: () => null, hitTest: () => false, translate: () => ({}), resize: () => ({}),
  meaningful: () => true,
};
```

Board line (canonical form, one element per line, parents before children — `serializeBoard`):

```json
{"id":"s-7f2a","type":"sticky","index":"a3","x":120,"y":80,"w":220,"h":176,"text":"Launch"}
{"id":"ck-91c0","type":"checkitem","index":"a0","list":"s-7f2a","text":"Write the post"}
{"id":"ck-3b11","type":"checkitem","index":"a1","list":"s-7f2a","text":"Record the demo","done":{"by":"Jonas","at":"2026-11-08T10:12:00Z"}}
```

Pure helpers in the same file (DOM-free, tested): `itemsOf(elements, listId) → AnnotationElement[]` (genuine
items: `list` names an existing **sticky**, sorted by `compareOrder(index, id)`, capped at
`MAX_CHECK_ITEMS`); `isChecklist(elements, stickyId)`; `progressOf(items) → {done, total}`;
`fromTaskLines(text) → {title, items: {text, done}[]}` (lines starting `☐ ☑ ✓ - [ ] - [x] * [ ]`);
`toTaskLines(title, items) → string` (Markdown task list, for text exports and the comment conversion).

Orphans (an item whose list is gone or is not a sticky — a concurrent delete) are inert: not drawn, not
printed by `read-annotations`, kept by every reader, reported by `maude design check` as an info line.

### 5.2 Sticky sizing

`fitSticky(cur, text, items?)` (sticky.model.ts) adds one row per item: `wrapLines(item.text, fontSize,
innerW − CHECK_INDENT)` lines at the sticky line height + `CHECK_ROW_GAP`, and a footer row for the
progress chip. Grows only (the existing rule); a checklist past `STICKY_MAX_GROWN_H` clips with a fade and
"+N more" (no scrollbar).

### 5.3 Ops (one batch per gesture, `annotations/checklist-ops.ts`)

| Gesture | Ops | ⌘Z label (describe-annotations) |
| --- | --- | --- |
| Tick / untick | `patch {id, set:{done:{by,at}}}` / `patch {id, unset:['done']}` | "Ticked “Write the post”" / "Unticked …" |
| Add entry (↵ at end of an entry, "+ Add an item") | `put checkitem` with `index = keyBetween(this, next)` | "Added an item to “Launch”" |
| Reword | `patch {set:{text}, expect:{text}}` (text merge) — one entry per edit session | "Edited an item" |
| Remove entry (⌫ on an empty entry, row ⋯ › Remove) | `delete` | "Removed an item" |
| Reorder (drag the row grip) | `patch {set:{index}}` | "Reordered “Launch”" |
| Turn into checklist | `patch sticky {text: title}` + N × `put` (from `fromTaskLines`) | "Turned “Launch” into a checklist" |
| Delete / cut the sticky | the sticky's `delete` + every item's `delete` in the same batch | (existing label) |
| Duplicate / copy / paste the sticky | items travel; fresh ids, `list` remapped to the copy | (existing label) |

`annotations-layer.tsx` `copySelection` expands a checklist sticky to its items (as it already expands a
shape to its anchored label); `pasteStrokesText` remaps `list` with the id map. A pasted item whose `list`
is not in the payload is dropped.

### 5.4 Drawing (`annotations/ui/checklist.tsx`, mounted by the sticky node)

- Inside the sticky card, under the title: one row per item — a 16 px box drawn in SVG (never a font glyph,
  so exports match), the text; done = check mark + strikethrough in `--fg-2`. A footer chip "3/5" sits beside
  the author line. "+ Add an item" row only for Can edit in Preview.
- Edit mode (annotations click-through), Present, Can view / Can comment: drawn, not interactive.
- The AI's ticks wear the spark like resolved-by-AI (`done.by === 'AI'`).
- Export: PNG / PDF / video capture draw it through the same layer (no exporter change); print formats still
  carry no annotations. `toTaskLines` is the text form wherever a sticky's text is written out (comment
  conversion S4.7, `read-annotations` text mode).

### 5.5 Keys and actions (action registry only — `actions/defs/annotation.ts`)

New closed-set fact `checkItemFocused` (`actions/types.ts` `Fact`): keyboard focus is on a checklist row or in
its text. New entries (all `exec: 'canvas'`, `enabled: { minRole: 'edit', selection: ['annotation'] }`, answered
by the layer on the `run-action` lane):

| id | label | keys | notes |
| --- | --- | --- | --- |
| `annotation.make-checklist` | Turn into checklist | — (menu, small toolbar, ⌘K) | on a sticky without items; converts its task lines |
| `checklist.toggle` | Tick / untick | `Space` (row focused, not typing) · `⌘↵` (`inText`) | when `facts: ['checkItemFocused']`; ⌘↵ outside an entry stays `annotation.chain`; Space sits on the `selection` layer, so it wins over hold-Space-to-pan (`tools`) only while a row has focus |
| `checklist.add-below` | Add an item | `↵` (`inText`) | splits at the caret like a list editor |
| `checklist.remove-empty` | Remove the empty item | `⌫` (`inText`, entry empty) | focus moves to the previous entry's end |
| `checklist.move-up` / `checklist.move-down` | Move item up / down | `⌥⌘↑` / `⌥⌘↓` | one reorder op each |
| `checklist.focus-prev` / `checklist.focus-next` | (hidden from ⌘K) | `↑` / `↓` (row focused) | roving focus between rows |

`node scripts/gen-actions.mjs` regenerates `keymap.gen.ts`, the manifest and the help tier block; the canvas
iframe key table comes from `keymap.gen.ts` as today. No new chord shadows an existing one at the same
layer (`actions/uniqueness.ts` test).

### 5.6 A11y

The item list is `role="group"` labelled by the sticky's title; each row is `role="checkbox"` with
`aria-checked`, its accessible name the entry text (or "Empty item"), roving `tabIndex` (one tab stop per
list). The progress chip is `aria-live="polite"` ("3 of 5 done") only for the person's own tick. Hit target
≥ 24 × 24 CSS px at 100 % zoom (WCAG 2.5.8) — the row, not only the box. Reduced motion: the tick has no
animation. Contrast: done text in `--fg-2` on the sticky fills meets 4.5:1 (checked per fill in the test).

### 5.7 AI (whiteboard verbs — `bin/annotate.mjs`, `bin/read-annotations.mjs`, skill `design:whiteboard`)

- `annotate` create: `{ "op":"create", "type":"checkitem", "list":"<sticky id>|@ref", "text":"…", "done"?: true }`
  (`done: true` is written as `{by:'AI', at:<now>}`; `false`/`null` unsets). Shorthand on a sticky create:
  `{ "op":"create", "type":"sticky", "text":"Launch", "items":["Write the post", {"text":"Demo","done":true}] }`
  — the verb expands it into item puts (`items` is never stored). `{ "op":"update", "id":"<item>", "done":true }`
  ticks. A list past `MAX_CHECK_ITEMS` or an item whose `list` is not a sticky exits 2, nothing written.
- `--board` cards accept `{ text, items }`; the `checklist` template becomes one checklist sticky titled
  "Checklist" with three empty items inside its section (canvas 15 `an-templates` thumb unchanged).
- `read-annotations` prints a checklist sticky with `items: [{ id, text, done, doneBy? }]` and `progress: "1/3"`;
  `--type checkitem` lists items with their `list`. Items have no geometry, so `canvas-rects` is unchanged and
  arrows bind to the sticky, not an item.
- Under an AI run the ops carry the run tag (S4-S5 §2), so "Undo this chat" covers the AI's ticks.
- `validate-board` (strict) accepts `checkitem` like any registered type.

## 6. Evidence

- Sync granularity read from `annotations/replica.ts` (field-level `Y.Map`); the array-field loss is the same
  class the ballot type was built to avoid (one element per voter, `ballot.model.ts`).
- The layer already carries metadata types it does not draw (`v1-adapter.ts` `caps.metadata`), so a
  `checkitem` survives every stroke-diff write without UI changes in the diff path.
- Today's "Checklist" template writes `☐` text stickies (`annotations/templates.ts`) — the convention §5.1
  `fromTaskLines` imports.

## 7. Tests that will prove it (red first)

| Test | Proves |
| --- | --- |
| `test/checkitem-model.test.ts` | validate / canonical form; `list` required; `done` shape; `itemsOf` order + cap + orphan filtering; `fromTaskLines`/`toTaskLines` round trip; schema regenerated (`gen-actions --check`) |
| `test/checklist-sync.test.ts` | two replicas tick two items at once → both ticks land; tick vs reword of one item → both land; add during reorder → both land (fails with an `items` array) |
| `test/checklist-ops.test.ts` | every §5.3 gesture is ONE batch; sticky delete takes its items; copy/paste remaps `list`; locked list: tick ok, add/remove/reword refused |
| `test/checklist-format1-reader.test.ts` | under `withFormat1Reader` items are unknown and kept byte-for-byte; a stroke-diff write from the v1 UI path keeps them (`strokesToElements`) |
| `test/checklist-undo.test.ts` | tick → ⌘Z unticks; "Turn into checklist" → one ⌘Z restores the plain sticky text; run-tagged AI ticks undone by Undo this chat |
| `test/checklist-keys.test.ts` | registry entries resolve under `checkItemFocused`; ⌘↵ in an entry = toggle, outside = `annotation.chain`; no uniqueness clash |
| `test/checklist-a11y.test.tsx` | roles / names / `aria-checked`; one tab stop; ≥ 24 px targets; done contrast per sticky fill |
| `test/annotate-checklist.test.mjs` | verb create / shorthand / update / refusals; read-annotations projection |
| `test/annotations-role-matrix` row | Can comment: toggle → 403 locally and hub |
| e2e `test/e2e/annotations-checklist.e2e.mjs` | make a checklist, tick, reload, second browser sees it, ⌘Z, export PNG shows the ticks |

## 8. Feeds — builder slices (T7.3)

| Slice | Owns | Model | Done when |
| --- | --- | --- | --- |
| **113-A Model + ops + AI verbs** | new `annotations/elements/checkitem.model.ts`, `annotations/checklist-ops.ts`; `annotations/registry.ts` (DEFS + `FORMAT2_TYPES`), `annotations/elements/sticky.model.ts` (`fitSticky` items), `annotations/templates.ts`, `history/describe-annotations.ts`, `annotations/ai-write.ts` (item puts, `done` as `{by: AI_RESOLVER, at}`, the `items` shorthand), `bin/annotate.mjs`, `bin/read-annotations.mjs`, `plugins/design/skills/whiteboard/SKILL.md`; regen `scripts/gen-actions.mjs` (schema) | Sonnet | §7 model / sync / ops / format-1 / verb tests green; schema `--check` green |
| **113-B Layer UI + keys + a11y** | new `annotations/ui/checklist.tsx`; `annotations-layer.tsx` (mount, copy/paste remap, ops writes), `annotations-context-toolbar.tsx` + sticky menu row, `actions/defs/annotation.ts`, `actions/types.ts` (fact); regen `gen-actions.mjs`; testids in `client/TESTIDS.md` + `testids.json` (`checklist-row-<id>`, `checklist-add`) | Opus (6.4 k-line layer, stroke-view seam) | keys / a11y / undo tests green; boot check (`check-client-boots-source`) green; needs client rebuild |
| **113-C e2e + What's New + docs** | `test/e2e/annotations-checklist.e2e.mjs`, `whats-new.json` entry (lead-owned: patch request), `site/content/docs` whiteboard page (+ `gen:stats`) | Sonnet | e2e run once alone, green; docs + stats regen committed |

Builders must not: add an `items` field to the sticky; write items through `strokesToElements`; add a key
handler in the layer; bump `BOARD_VERSION`; touch the DDR-115 lists.

## 9. Open questions (default the run takes)

- **Q1 — Can Can comment tick?** Default **no** (annotations are edit-level; one rule everywhere). A
  product call for Michal if reviewers should tick a QA list.
- **Q2 — Does ticking the last entry resolve the sticky?** Default **no** — "resolved" means the note was
  answered; done-ness is the chip "5/5".
- **Q3 — Nested entries (Tab to indent)?** Default **no** in this build; the shape allows a later `depth`
  ext field without a version bump.
