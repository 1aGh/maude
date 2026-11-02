# S8 — asset sidecars: per-use photo edits, `.gen.json`, artboard export presets, per-Mac origins

Writer: **S8.0** (2026-10-18). Coded against by S8.8, S8.13, S8.15, S8.16, S8.21, S8.22 and the S12 skill text.
Needs a lead patch to the V2-1.12 table (§5.5) and to two shared classifier files (§8). Sources: `S8-slices.md` §2
Q2, Q3, Q5, Q7; `V2-1.12-file-formats.md` §5.1 (R1–R8), §5.3; `V2-1.7` G2 (photo-sidecar write rule);
`schema/formats.ts` (FormatIds, V2-1.11 §5.2).

## 1. Question

Fix the on-disk shape of four additions — the per-use photo edit, the generation provenance sidecar, per-artboard
export presets and the per-Mac "Original" path — each with its R1–R8 audit, migration step, mixed-peer behaviour,
ACL rule and FormatId.

## 2. What exists today

- `photo-store.ts`: one `assets/<sha8>.photo.json` per asset (every use); `assetSha8` + `SHA_RE /^[0-9a-f]{8,64}$/` is
  the traversal guard; `/_api/photo-edit` is canvas-safe (both allowlists) behind the cap stack; `validatePhotoEdit`
  is a strict v1 reader (unknown keys → invalid).
- Classifier (`sync/file-membership.ts` + byte-identical `apps/hub/src/file-membership.mjs`):
  `COMPANION_SIDECAR_SUFFIXES = .photo.json .audio.json .footage.json .registry.json .edl.json .transcript.json
  .beats.json`; `FILE_SEGMENT = /^[A-Za-z0-9_][A-Za-z0-9 ._-]*$/`.
- ACL closure (`access/closure.ts`): a closure asset `assets/<base>.<ext>` admits `assets/<base><suffix>` for each
  `ASSET_SIDECAR_SUFFIXES`; `access/scope.ts writes()` G2: a canvas-only editor may write `<base>.photo.json` only when
  it may edit **every** referrer; create-only under `assets/` refuses any name whose stem (before the first dot) is an
  existing asset's.
- FormatIds (`actions/types.ts`): `photo-edit` covers `*.photo.json` (`check/index.ts`); `canvas-meta`; no `gen`.

## 3. Options — the per-use file name (measured, §6)

| Name | Studio plane | Hub plane | ACL stem | Verdict |
| --- | --- | --- | --- | --- |
| `assets/<img8>~<edit8>.photo.json` (the S8 plan's spelling) | `never` | `never` | — | **Rejected: would never sync** |
| `assets/<img8>-<edit8>.photo.json` | companion-text | companion-text | stem `<img8>-<edit8>` ≠ the image's | Rejected: falls out of the asset's closure and trash-with-asset |
| **`assets/<img8>.<edit8>.photo.json`** | companion-text | companion-text | stem `assets/<img8>` = the image's | **Chosen** |

## 4. Decision (DDR draft)

**Context.** Per-use edits, AI takes and export presets must reach every peer, survive copy/rename/duplicate, and
leave v1 readers (strict PhotoEdit, R8) untouched. A home-directory path must never reach a synced file.
**Decision.** (1) Per-use edit = a content-addressed v1 PhotoEdit at `assets/<img8>.<edit8>.photo.json`, referenced
by `data-photo-edit="<edit8>"` on the element; `assets/<img8>.photo.json` keeps meaning "every use". (2) Provenance =
`assets/<sha8>.gen.json`, format `maude.gen` v1, one file per take, lenient reader. (3) Presets =
`.meta.json` `artboardMeta[id].exports`. (4) Original path = `_canvas-state/asset-origins.json`, per Mac.
**Consequences.** `.gen.json` must be added to both classifier copies and to the closure suffix list; the closure and
G2 learn the per-use shape; one new FormatId (`gen`); no new `_*` path, no DDR-115 list change, no `maude migrate v2`
step (everything is additive or a new file).
**Rejected.** The `~` and `-` spellings (§3); a `uses` map inside `.photo.json` (strict v1 reader rejects it — R8
trap); keying per-use edits by `canvas#artboard` (breaks on duplicate, rename, two uses in one artboard); one
`.gen.json` per group (a take's "Made by AI" would not ride with its own asset); `photo-use` as a second FormatId for
the same schema (two ids, one schema, drift).

## 5. Contract

### 5.1 Per-use photo edit

- **File:** `assets/<img8>.<edit8>.photo.json`; body = a v1 `PhotoEdit` exactly (`validatePhotoEdit`, no new keys).
  `edit8` = first 8 hex of `sha256(canonicalJson(edit))` (keys sorted recursively, no whitespace,
  `JSON.stringify` numbers). Collision (same name, different canonical bytes) → the writer lengthens to 12 hex;
  readers accept `/^[0-9a-f]{8,16}$/`. Same name ⇒ same bytes: a rewrite is a no-op, never an overwrite.
- **Reference:** the authored attribute `data-photo-edit="<edit8>"` on the `<img>`/`<image>` whose `src` is
  `assets/<img8>.<ext>` (canvas-tsx convention; distinct from the runtime tag `data-photo-asset`).
- **Render order** (canvas-lib `PhotoLayer` / `PhotoPreviewBridge`, L1 slot): `data-photo-edit` present and its file
  valid → that edit; else `assets/<img8>.photo.json` (every use); else the original. Not stacked: a per-use edit is a
  full PhotoEdit, seeded from the every-use values when the person starts editing one use.
- **Route:** `/_api/photo-edit` gains `GET ?asset=<img8>&edit=<edit8>` and `PUT ?asset=<img8>&perUse=1` (body =
  PhotoEdit) → 200 `{edit:'<edit8>'}` (the server computes the name; the client then writes the attribute through the
  edit route — one undo step). `edit` outside `/^[0-9a-f]{8,16}$/` → 400 before any path is built. Same cap stack and
  64 KiB limit; stays canvas-safe.
- **Apply to every use:** writes `assets/<img8>.photo.json` and removes `data-photo-edit` from every use; the sheet
  names each canvas; if the session cannot edit every referrer (G2) the action is disabled with that reason.
- **Lifecycle:** removing the attribute leaves the file (tiny; Version history may reference it). Move to the trash of
  the asset takes every `assets/<img8>.*` sidecar with it (stem rule).

### 5.2 Generation provenance — `assets/<sha8>.gen.json`, `maude.gen` v1

```json
{ "format": "maude.gen", "v": 1,
  "prompt": "night touchdown, stadium lights, 4:5",
  "provider": "fal", "model": "flux-pro-1.1",
  "at": "2026-10-18T09:12:00Z",
  "licence": "You own the output; provider terms apply.",
  "group": "g_3f9a1c2e7b40",
  "takes": ["a1b2c3d4", "e5f60718", "9a0b1c2d", "3e4f5a6b"],
  "by": "Tereza" }
```

- One file per take, named by that take's own sha8; all takes of a group carry the same `group` and `takes` (in
  generation order, including itself). `by` = the asker's display name (V2-1.5 attribution), never an e-mail; optional.
- Limits: `prompt` ≤ 4 000 chars; `provider`/`model` `/^[A-Za-z0-9._\/-]{1,80}$/`; `licence` ≤ 300; `takes` 1–8 entries
  of `/^[0-9a-f]{8}$/`; `at` ISO-8601 UTC; file ≤ 16 KiB. **Reader keeps unknown keys** (lenient; R8 does not apply).
  `v > 1` → treated as absent (no "Made by AI" line), never rewritten.
- ← → (S8.16) reads the placed asset's `takes`, rewrites the element `src` to the neighbour take through the edit
  route (one undo step). Unplaced takes count as "today's AI takes" and are exempt from Not used (S8.11).
- The prompt is project content: it syncs with the project like the canvas does. Media generation stays non-queued
  offline (V2-1.14 Q1).

### 5.3 Artboard export presets — `.meta.json` `artboardMeta[id].exports`

```json
{ "artboardMeta": { "ab-poster": { "exports": [ { "format": "png", "scale": 2 }, { "format": "pdf", "dpi": 300 } ] } } }
```

- `format ∈ png | jpg | svg | pdf`; exactly one of `scale` (0.25–4) or `dpi` (72–600); ≤ 8 entries. Absent = the
  kind's default buttons (08). Element presets are **not** stored (PNG 2× · SVG fixed).
- Top-level reserved map (R6): a v1 `patchCanvasMeta` keeps it (probe H). Written through the existing meta PATCH
  (layout split unchanged); never under `layout`.

### 5.4 Per-Mac original path — `_canvas-state/asset-origins.json`

```json
{ "v": 1, "origins": { "a1b2c3d4": { "path": "/Users/jonas/Pictures/acko-hero2.heic", "importedAt": 1760000000000 } } }
```

- Written by the import paths (`asset-upload.ts`, `_import-asset.mjs`) on this Mac only; ≤ 10 000 entries (oldest
  dropped). `_canvas-state/` is an existing ignored, never-synced class on all four DDR-115 lists — no list changes.
- Read only by the main-origin details route for this Mac's own session; never served to the canvas origin, a hub
  peer, an export (`isRuntimeStateRel`), or a bug-report bundle. Other Macs show no Original row. Not a FormatId.

### 5.5 V2-1.12 table rows (lead patch) and FormatIds

§5.1 reserved keys — `artboardMeta` contents become `{ notes, poster, maxFrames, madeBy, exports }` (owner of
`exports`: S8). §5.3 per-file rows to add:

| File | Version field | Format-2 addition | Today's reader | Rules |
| --- | --- | --- | --- | --- |
| `assets/<img8>.<edit8>.photo.json` | none (v1 PhotoEdit) | new file | v1 classifier: companion-text (syncs); v1 never opens it | R1, R2 |
| canvas `.tsx` `data-photo-edit` | none | new attribute | v1 render ignores it (every-use look); v1 edits preserve source text | R2 |
| `assets/<sha8>.gen.json` | `"v": 1` | new file | 1.x classifier: `never` (a v1 hub or peer neither stores nor sends it) | R1 |
| `<canvas>.meta.json` `artboardMeta[id].exports` | none | inner key of a reserved map | v1 keeps top-level keys (H) | R1, R6 |

FormatIds: **`photo-edit`** covers both photo sidecar shapes (one schema); the attribute is documented in
`schema/canvas-tsx.md` (S8.15). **New `gen`**: `schema/gen.v1.schema.json`, `$id https://maude.sh/schema/gen/v1`,
source `hand`, check `validateGen (generation/gen-sidecar.ts)`, skill `design:ai-generation` — a `FormatId` union
member + a `FORMAT_SCHEMAS` row (registry agent / lead). `canvas-meta` schema (hand) gains `artboardMeta.*.exports`.

### 5.6 ACL (V2-1.7 G2, lead patch to S9-owned `access/{closure,scope}.ts`)

- **Read closure:** a closure asset `assets/<img8>.<ext>` additionally admits `assets/<img8>.<edit8>.photo.json`
  **only when an owned file of a granted canvas carries `data-photo-edit="<edit8>"`** for that asset (static scan,
  like `staticAssetRefs`) — another canvas's per-use edit stays invisible (U1). `ASSET_SIDECAR_SUFFIXES` += `.gen.json`.
- **Write (G2 extension):** a canvas-only editor may **create** `assets/<img8>.<edit8>.photo.json` when it may edit a
  canvas that references `assets/<img8>.*`, and only if the body hashes to `edit8`; never overwrite different bytes.
  The every-use file keeps the "every referrer" rule. `.gen.json` is written only by the generation route
  (editor-or-better on the target canvas).

## 6. Evidence

Probe `scratchpad/probe-sidecar.mjs` (imports `classifyProjectFile` / `isProjectFileShape` from both classifier copies
on `feat/maude-v2` c5826697):

```
assets/0a1b2c3d.photo.json           studio:companion-text shape:true | hub:companion-text shape:true
assets/0a1b2c3d~9f8e7d6c.photo.json  studio:never          shape:false| hub:never          shape:false
assets/0a1b2c3d.9f8e7d6c.photo.json  studio:companion-text shape:true | hub:companion-text shape:true
assets/0a1b2c3d-9f8e7d6c.photo.json  studio:companion-text shape:true | hub:companion-text shape:true
assets/0a1b2c3d.gen.json             studio:never          shape:true | hub:never          shape:true
```

So the plan's `~` spelling and today's `.gen.json` would both silently never sync — the exact bug class the
file-membership module exists to end. Closure stem rule read from `access/scope.ts assetStem` / `closure.ts`.

## 7. Tests that will prove it (red first)

- `sync-file-membership.test.ts` fixture rows: `<img8>.<edit8>.photo.json` and `<sha8>.gen.json` → companion-text on
  both copies (`.gen.json` red today).
- `photo-per-use.test.ts`: edit8 = canonical hash; same edit twice → one file; `edit=../x` → 400; render order;
  survives duplicate + rename (the attribute travels with the element).
- `photo-sidecar-v1-compat.test.ts`: a frozen 1.9.x `validatePhotoEdit` accepts every per-use file; v1 render shows
  the every-use look; a v1 edit of the TSX keeps `data-photo-edit`.
- `acl-l5-photo-use.test.ts`: canvas-only A sees its per-use edit, not B's; may create a hashing one, not overwrite.
- `gen-sidecar.test.ts`: lenient reader keeps unknown keys; limits; `v:2` → absent; takes ← → is a src rewrite.
- `meta-artboard-exports.test.ts`: presets round-trip; v1 `patchCanvasMeta` keeps them (probe H).
- `asset-origins.test.ts`: never in an export zip, a report bundle, a canvas-origin answer or a file-plane manifest.
- Mixed sync both directions (V2-1.12 §5.11): v2 desktop → v1 hub refuses `.gen.json` **once** and the file plane
  does not retry it in a loop; a v1 peer edit leaves per-use files and attributes intact.

## 8. Feeds and follow-up work

- **Lead / shared files:** add `.gen.json` to `COMPANION_SIDECAR_SUFFIXES` in `sync/file-membership.ts` **and** the
  byte-identical `apps/hub/src/file-membership.mjs` (+ the tripwire fixture); V2-1.12 rows §5.5; FormatId `gen`.
- **S9 (access owner):** §5.6 closure + G2 extension, with `acl-l5-photo-use`.
- **S8.15** uses `photo-edit`, not a new `photo-use` FormatId, and the `.` spelling (its row says `~`).
- **S8.16 / S8.21 / S8.22 / S8.8** code against §5.2–§5.4. **S12** writes the `design` (per-use attribute) and
  `ai-generation` (`.gen.json`) skill sections from §5.1–§5.2.

## 9. Open questions (conservative default)

| # | Question | Default |
| --- | --- | --- |
| O1 | Garbage-collect orphan per-use sidecars? | No in v2.0 — they are tiny and history may point at them. |
| O2 | Should "Made by AI" show for a take whose `.gen.json` did not sync (v1 hub)? | No line; the picture is just a picture there. |
| O3 | `licence` wording source. | The provider adapter's one line (DDR-164); empty → the line is omitted. |
