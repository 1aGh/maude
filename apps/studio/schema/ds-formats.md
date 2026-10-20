# Design-system files — `tokens.json`, `dsPending`, revisions, `head.json`

Contract V2-1.6 §5.3 / §5.5–§5.7 / §5.11 / §5.14 (S10). This doc ties together the four files a **converted** design
system keeps, says who writes each one, and gives the code that defines it. The JSON Schemas stay the source for the
shapes; `schema/formats.ts` lists them for the agent (`tokens`, `ds-revision`, `ds-head`).

Paths are relative to `apps/studio/`. Line numbers are those of the commit that adds this doc. The code wins if the
two ever disagree.

## Where they live

All four are **versioned** (Plane B, they sync). None is under a `_*` runtime folder (DDR-115).

| File | What it is | Written by | Shape | An agent… |
| --- | --- | --- | --- | --- |
| `system/<ds>/tokens.json` | the token manifest: every token, its value per theme, the designer's data | the DS engine, on publish (and convert, make, library) | `schema/ds-tokens-v1.schema.json` | reads it; changes a token with `maude design ds pending --set` |
| `system/<ds>/design-system.meta.json` → `dsPending` | the changes that wait for "Update N canvases" | the DS engine (`mergePending`) | `schema/canvas-meta.v2.schema.json` `$defs/dsPending` | `maude design ds pending <ds> --set <file.json>` · `--cancel` |
| `system/<ds>/revisions/<id>.json` (+ `<id>.tokens.css`, `<id>.components.css`) | one published state, frozen and content-addressed | the DS engine; never rewritten | `schema/ds-revision-v1.schema.json` | reads it; never writes it (the hook refuses) |
| `system/<ds>/revisions/head.json` | the pointers (`head`, `base`), drafts, the log, the library link | `ds/head.ts` `writeHead`, always last | `schema/ds-head-v1.schema.json` | reads it (`maude design ds status --json`); never writes it |

The design plugin's hook refuses a hand edit of `revisions/*` and `head.json` (`ds-managed`,
`cli/lib/design-hook.mjs:482-509`).

## `tokens.json`

- Emitted, not edited. Phase α (an unconverted folder): `ds/emit.ts:143` `emitTokensJson`, from the CSS, with
  `source: "css"`. Converted: `ds/generate.ts:664` `emitTokensJson(model)`, from the token model, with
  `source: "canvas"` (`ds/generate.ts:729`). Same model → same bytes (`stableJson`, `ds/emit.ts:39`: sorted keys,
  2-space indent, LF, one trailing newline).
- DTCG groups: each leaf is `{ $value, $type?, $extensions: { "sh.maude": { css, tier?, kind?, index?, own?,
  alias?, modes?, … } } }` (`ds/generate.ts:672-711`). `$value` is the default theme's value, or a `{group.path}`
  reference when that value is exactly `var(--other)`. The other themes' values go in `modes`.
- The designer's data is kept, matched by `css`: `label`, `valueNames`, `locked`, `darkFollows`, `trashed`
  (`ds/emit.ts:25` `KEPT_LEAF_FIELDS`; on the model, `ModelToken.data`, `ds/generate.ts:52-53`). Unknown keys are
  kept at every level. Labels and value names are display data (DDR-172 D8) and never reach the CSS.
- `trashed` is `{ replacement, at, by, previous }` (`ds/engine.ts:843-848`). Its `at` is the time of the trash, so
  two projects that trash the same token a few milliseconds apart hold **different** revision ids. That is by design.
  `test/ds-agent-parity.test.ts` compares revisions by their bodies with ids and times taken out.
- On publish, the engine writes it into the new revision next to the generated CSS (`ds/engine.ts:883-891`
  `generateFrom`). The key is `TOKENS_JSON_KEY` (`ds/engine.ts:78`).

## `dsPending` — the waiting changes

Lives in the Design system canvas's own meta, `system/<ds>/design-system.meta.json` (`DS_META`,
`ds/engine.ts:77`). Nothing in it reaches a canvas or a token file until a publish.

```ts
DsPending { base?: string | null; tokens?: Record<css, PendingToken>; components?: PendingComponents }
PendingToken { [theme]: value; valueNames?; darkFollows?; trash?: { replacement }; add?: { tier?, type?, label? }; by?; at? }
PendingComponents { [Master]: { [selector]: { [property]: { value, by?, at? } } } }
```

(`ds/engine.ts:199-220`.)

- **One door.** `POST /_api/ds/pending` → `mergePending` (`ds/engine.ts:1144`, locked body at `:1061`). Each token
  entry **replaces** that token's entry (`null` deletes it). The input is checked by `checkEntry` (`:1038`): a token
  name, a value per theme, display-safe value names and labels. A locked token refuses (`ds-token-locked`). A
  Tier-1 role can't go to the trash.
- **`expect`.** Per token, the `at` of the entry the editor read (`null` = none). If the entry moved since, the
  write refuses with `ds-pending-conflict` (`PendingInput`, `ds/engine.ts:1030-1036`). The page sends it. An agent
  should send it too.
- **`from`.** `{ canvas, elementId, target }`: the server reads the element's own overrides and turns them into
  component patches (`ds/override-map.ts`). No CSS comes from the client.
- Empty sections are dropped. An empty `dsPending` is removed from the meta (`withPending`, `ds/engine.ts:797-809`).
  Read back by `pendingOf` (`:490`).
- **Applied at publish** by `applyPending` (`ds/engine.ts:828`). A value on a trashed token takes it out of the trash
  (`:860-862`). `darkFollows` is stored only when it is a boolean (`:870-871`).
- **Dark follows is derived by the page, not the server.** When Light changes on a token whose Dark follows, the
  token editor computes the new Dark (`client/v2/ds/token-write.js` `buildEntry`) and sends both. The engine does
  not derive it for a plain pending edit (only `ds/edges.ts` does, for fix-contrast). So an agent that writes Light
  alone leaves Dark where it was. The test pins this as a finding (`test/ds-agent-parity.test.ts`, "findings").

## Revisions — `revisions/<id>.json`

- **Body** (`ds/revision.ts:31-37`): `{ format: "maude.ds-revision", v: 1, schemaVersion: 1, system, files }`, where
  `files[<path relative to the system folder>] = { sha256, text }` (`:26-29`). The four working files:
  `colors_and_type.css` (or the system's tokens CSS), `components.json`, `preview/_components.css`, `tokens.json`.
- **Id** = sha256 of the canonical JSON of the body (`revisionId`, `ds/revision.ts:90`). Canonical = keys sorted by
  UTF-16 code unit at every depth, no whitespace (`canonicalJson`, `:64`). The bytes on disk are the same sorted
  keys with 2-space indent (`serializeRevision`, `:111`). `buildRevision` (`:116`) builds both and refuses a body
  over 2 MiB (`REVISION_MAX_BYTES`, `:16`).
- **Verified, never repaired.** `verifyRevision` (`ds/revision.ts:182`) checks the shape, that the id names the
  canonical body, and that every file's sha256 names its text. A hub- or peer-supplied revision is untrusted until
  this passes (DDR-054). An invalid file under an id refuses the publish (`revisionWritePlan`, `:245-262`).
- **Siblings** (`revisionSiblings`, `ds/revision.ts:225`): `<id>.tokens.css` and `<id>.components.css` are copies of
  the tokens CSS and `preview/_components.css`. They are not authoritative; the canvas origin serves them to a canvas
  that was left out at that revision.
- **Write order** (§5.6, `revisionWritePlan`, `ds/revision.ts:245`): `<id>.json`, then the siblings, then the working
  files. Each is skipped when its bytes are already right, so an empty publish writes nothing. `head.json` is last.

## `head.json`

- **Shape** (`HeadDoc`, `ds/head.ts:78-89`): `{ format: "maude.ds-head", v: 1, system, head, base, drafts, log,
  library }`. Unknown keys are kept at every level, and a later `v` is unreadable rather than guessed (`ds/head.ts`
  header, V2-1.12 R1).
  - `head`: the published revision canvases follow. `base`: what the working files were generated from. Either is
    `null` (a system being made has `head: null`).
  - `drafts[]`: `{ rev, label?, direction?, by, at }`, the directions of a system being made (`:69-76`; direction
    `^[a-z]{1,8}$`).
  - `log[]`: newest first, capped at 50 (`LOG_MAX`, `:25`). Each is `{ rev, parent?, action, at, by, summary?,
    updated?, leftOut?, actionId?, was?, is? }` (`:52-66`). `action` is one of `publish keep pick convert make
    library upgrade restore` (`:27-36`). `was`/`is` are the pointers an undo moves between. `by.kind` is one of
    `person ai agent import peer` (`:38`).
  - `library`: `null`, or the link to a team library: `{ hub, project, system, label, linkedAt, linkedBy,
    upstreamHead, checkedAt }` (`LibraryRecord`, `ds/library.ts:237-246`; read back by `libraryOf`, `:259`, which
    drops anything a peer rewrote into a non-address). The grant is never in it. It lives on this Mac, keyed by
    the hub origin.
- **The one writer** (`writeHead`, `ds/head.ts:243`): it takes `expect`, the pointers the caller read (`'absent'` for
  a first write). Anything else on disk refuses with 409 `ds-head-moved` and writes nothing. The shape is checked
  (`headShapeError`, `:134`), then the file is written with tmp + rename. `newHead` (`:225`) is the record that
  conversion and making start from.
- **Published in two places.** Two Macs publishing from the same head end up with a renamed copy
  (`head.maude-conflict-*.json` / `head.sync-conflict-*.json`). `publishedInTwoPlaces` (`ds/head.ts:310`) reads those
  copies, and the canvas then offers the pick (`ds.pick --head`).

## The canvas side

A canvas's `.meta.json` says which system it follows and at what (`schema/canvas-meta.v2.schema.json`):

- `designSystem`: the system. Absent means the project's default.
- `dsRev`: present means the canvas was **left out** at that revision. Absent means it follows `head`. Only the verbs
  set it, never by hand (`ds/engine.ts:970-978` publish, `:1356` `canvasUpdate`, `:1377` `canvasLeave`).
- `dsPinned: true` (or `opt_out_scope: "full"`): never offered an update (`canvasRows`, `ds/engine.ts:543-555`).
- In the TSX, `data-ds-rev="head"` on one instance makes it take the current look while the rest of the canvas keeps
  its version (`edit-ops/ds-instance-update.ts`).

## How the AI changes them

Through `maude design ds …` (`ds/ds-verb.ts`, `DS_USAGE` at `:26`). It goes through the running studio when there is
one, or in-process otherwise. In-process, a write that needs the project's version log refuses with 503
`ds-kernel-unavailable` instead of writing behind it. The parity rule (rule 14): every `ds.*` action the page takes,
the verb takes too, with the same result on disk. This is held by `test/ds-agent-parity.test.ts` (and the read
shapes by `test/ds-verb-json.test.ts`). `ds.upgrade`'s verb is `maude design ds-upgrade`
(`test/ds-upgrade-sheet-flow.test.ts`). `ds.check-system` is `maude design ds check-system`
(`ds/check-system-verb.ts`), and it keeps its answer in `_state/ds-check/<ds>.json` (runtime, per Mac).
