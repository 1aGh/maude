# S8 — ExportSpec v2 (the one export sheet's contract)

Writer: **S8.0** (2026-10-18). Coded against by S8.1–S8.10, S8.23 and by every neighbour that opens or feeds the
sheet. Sources: `S8-slices.md` §1–§2 (Q1, Q4–Q6, Q13–Q15) and rows S8.1–S8.10; canvas `09 Export` (scope bar,
estimate summaries, Advanced › File names); `S4-slices.md` S4.16 (`annotationsExportPolicy`); `S1-slices.md` S1.11
(historical build overrides); `V2-1.16` L7 (project-class export), `V2-1.14` §8 "S8"; CONTRACT §Roles + Gate 0 A19.

## 1. Question

Fix `ExportSpec` v2 — scopes (Selection · This canvas · Folder · Whole project) with a computed estimate, formats,
file-name tokens, Save to, cloud vs this Mac, colour, a past version, annotations — as the one shape the sheet, the
CLI, Exports-again replay and every neighbour's entry point share, plus the acknowledgement list.

## 2. What exists today

- Wire: `POST /_api/export` (sync) and `POST /_api/export-jobs` (202 `{jobId}`) take `{format, scope, options}`,
  64 KiB cap, `sameOriginWrite` + `isTrustedRequestHost`; `isScopeValidForFormat` refuses a mismatch with 400.
- Engine scopes (`exporters/scope.ts` `Scope`): `selection | artboard | canvas-as-separate | canvas-whole |
  selection-bounds | project-raw`; `CaptureRegion = 'canvas' | {selectors}`; annotations opt-in via
  `options.includeAnnotations === true`. Formats (`exporters/index.ts` `Format`): png, pdf, svg, html, pptx, canva,
  zip, mp4, webm, gif. `format-scopes.ts` `VALID_SCOPES_BY_FORMAT` is the coherence table (first = default).
- Jobs: `exporters/jobs.ts` session-scoped queue + history; `replay.ts` (Exports again). Rust `save_export`.
- Past versions: `http.ts` `serveHistoricalCanvas(?sha=)` + S1.11 `BuildCanvasOptions.overrides` (version's
  same-name CSS); the main origin 307s every `/_canvas-shell` to the capture origin (V2-2.8 L21).
- ACL: `access/request.ts` puts every download/export in the EXPORT class (`can('export')`); S9.9 refuses observer.

## 3. Options

1. **v2 spec beside v1 on the same routes** (`{v:2, spec}` body; v1 `{format, scope, options}` unchanged), mapped
   onto the engine scopes by one resolver. *Chosen* — the CLI, `replay.ts` history rows and the e2e lanes keep
   working, and the engine table stays the single coherence source.
2. Replace the engine scopes with the four user scopes. Breaks `exports again` for every stored history row and the
   CLI's `--scope artboard`. Rejected.
3. A separate `/_api/export/v2` route. Doubles the CSRF/ACL/writer-registry surface for no gain. Rejected.

## 4. Decision (DDR draft)

**Context.** The v2 sheet speaks in four scopes and per-kind groups; the engine speaks in six capture scopes. Nine
neighbours open the sheet or feed it data.
**Decision.** `ExportSpecV2` (§5.1) is the only client and agent shape; `resolveSpecV2` (S8.1, `exporters/scope.ts`)
expands it into engine `{format, scope, options}` units inside one group job; v1 bodies still pass. `openExport(spec)`
opens the sheet, `quickExport(spec)` runs without it; registry `export.open` carries the same params. The estimate is
a route that returns numbers only. Annotations go through `annotationsExportPolicy` in the resolver.
**Consequences.** One new route (`/_api/export-estimate`), one retry route (`/_api/export-jobs/retry`), `jpg` and
`audio` adapters, `CaptureRegion` gains `{rect}`. History rows store the v2 spec so Export again replays it exactly.
**Rejected.** Options 2 and 3; client-computed estimates (copy would invent numbers); a per-element preset store (Q5).

## 5. Contract

### 5.1 Types (`apps/studio/exporters/spec-v2.ts`, shared by server, client and CLI parser)

```ts
export type ExportScopeV2 = 'selection' | 'canvas' | 'folder' | 'project';
export type ExportFormatV2 =
  | 'png' | 'jpg' | 'pdf' | 'svg' | 'html' | 'pptx' | 'canva' | 'zip'
  | 'mp4' | 'webm' | 'gif' | 'audio';
export type ArtboardKindKey = string;              // the artboard `kind` (fixed, print, video, web, …)

export interface ExportSpecV2 {
  v: 2;
  scope: ExportScopeV2;
  canvas?: string;                                 // designRoot-rel .tsx; default = active canvas (selection|canvas)
  folder?: string;                                 // designRoot-rel folder; required when scope = 'folder'
  selection?: { artboards?: string[]; elements?: string[] };   // DCArtboard ids · V2-1.4 element ids (≤ 256)
  region?: { rect: { x: number; y: number; w: number; h: number } };  // WORLD coords (S2.13 Export area)
  unit?: 'each' | 'one';                           // each artboard its own file (default) | one image/page
  format: ExportFormatV2;                          // the default for every kind…
  byKind?: Record<ArtboardKindKey, { format: ExportFormatV2; options?: Partial<ExportOptionsV2> }>; // …overridden per kind
  options?: ExportOptionsV2;
  at?: { sha: string };                            // a past version (S1.11 ref); absent = now
  wait?: 'ai';                                     // defer until the AI run on the target ends (S8.9)
}

export interface ExportOptionsV2 {
  size?: { scale: number } | { dpi: number };      // scale 0.25–4 (default 1; social 1|2); dpi 72–600 (print 300)
  colorProfile?: 'srgb' | 'display-p3';            // default srgb; p3 forces lane 'this-mac' (Q6)
  jpgQuality?: number;                             // 1–100, default 85
  background?: 'artboard' | 'transparent' | 'white';   // default artboard; jpg + transparent → white (degradation line)
  annotations?: boolean;                           // default false; subject to annotationsExportPolicy
  print?: { bleed?: boolean; marks?: 'none' | 'crop'; back?: boolean };
  video?: { fps?: number; quality?: 'draft' | 'standard' | 'high'; captions?: boolean /* default false, C19 */;
            linked?: boolean /* include S7 linkedFormats */; allowLonger?: boolean /* up to maxFrames, C22 */ };
  audio?: { codec: 'm4a' | 'wav' };                // format 'audio' only; default m4a
  nameTemplate?: string;                           // §5.4; default '{canvas} — {artboard}@{scale}'
  saveTo?: 'downloads' | 'remembered' | 'ask';     // desktop only (S8.23); browser shell = download
  lane?: 'auto' | 'this-mac' | 'cloud';            // default auto (§5.6)
}
```

Validation (`validateSpecV2`, server-authoritative, the client reuses it): unknown keys → 400 `bad-spec`; numbers out
of range → 400 with the field name; `folder` / `canvas` pass the designRoot-relative path rules (no `..`, no
runtime-state path — `isRuntimeStateRel`); `at.sha` `/^[0-9a-f]{7,40}$/`; `region` finite, `w,h > 0`, ≤ 32 768.

### 5.2 Scope × format, and the mapping onto the engine

| v2 scope (+ unit/region) | engine scope per unit | Formats |
| --- | --- | --- |
| `selection` artboards, `each` | `selection` per artboard | png jpg pdf svg html mp4 webm gif audio |
| `selection` elements | `selection` with `selectionAll` (element-id → css via the V2-1.4 snapshot) | png jpg pdf svg |
| `selection` + `region`, or elements + `one` | `selection-bounds` (region `{rect}` or `{selectors}`) | png jpg pdf |
| `canvas`, `each` | `canvas-as-separate` | png jpg pdf svg html pptx canva (video/audio: every temporal artboard as `artboard`) |
| `canvas`, `one` (or `region`) | `canvas-whole` (region `canvas` or `{rect}`) | png jpg pdf |
| `folder` | every canvas under `folder` the session `sees` → as `canvas` | as `canvas`; `zip` → `project-raw` limited to the folder |
| `project` | every canvas the session `sees` → as `canvas` | as `canvas`; `zip` → `project-raw` |

`VALID_SCOPES_BY_FORMAT` gains `jpg` (= png's row) and `audio` (`['artboard']`). `CaptureRegion` gains
`{ rect: {x,y,w,h} }`. A kind whose format cannot take the unit is skipped with a reason in the estimate (§5.5), never
silently.

### 5.3 ACL (V2-1.16 L7, S9.9/S9.10)

- Observer (Can view): every export route 403 (A19). Viewer (Can comment) and up: allowed (`can('export')`).
- `folder` and `project` are **project-class**: a canvas-only session → 403 `{reason:'not-in-scope'}` with the same
  body as a missing file; it never learns the folder's contents. `selection`/`canvas` are checked per canvas with
  `sees`. Expansion uses `sees`, never the raw tree, and `zip` uses `RAW_EXCLUDES` + `isRuntimeStateRel` as today.
- `at` renders only on the capture origin through the existing 307 (main origin unchanged, `acl-l21-capture` green).

### 5.4 File names

Tokens: `{project} {folder} {canvas} {artboard} {kind} {size} {scale} {date}` (09 Advanced). `{size}` = `1080×1350`
(px) or `A5` (print); `{scale}` = `2x` or `300dpi`; `{date}` = local `YYYY-MM-DD`; `{folder}` = the canvas's parent
folder name (project name at the root). Rendering: unknown `{x}` stays literal; then strip `/ \ : * ? " < > |` and
control characters, collapse whitespace, trim, cap 120 characters before the extension, never empty
(→ `export`); duplicates in one job get ` (2)`, ` (3)` before the extension. Multi-file results: desktop writes into
`<chosen folder>/<project> <date>/` (one level); the browser shell downloads one zip.

### 5.5 Estimate — `POST /_api/export-estimate {spec: ExportSpecV2}`

EXPORT class (`READ_ONLY_ALLOWED_WRITES` += it: it writes nothing), same CSRF gates, ≤ 50 ms from the V2-1.17 index.

```ts
200 {
  counts: { selection: number|null; canvas: number|null; folder: number|null; project: number|null }; // artboards; null = "—"
  files: number; bytes: number; seconds: number;            // for the spec as given
  lane: 'this-mac' | 'cloud';                               // what 'auto' resolves to
  byKind: Record<string, { artboards: number; files: number; format: ExportFormatV2 }>;
  skipped: Array<{ name: string; reason: 'shared-part' | 'format-unit' | 'not-in-scope' }>;
  basis: { bytes: 'history' | 'table'; seconds: 'history' | 'table' };  // history = this Mac's past throughput
}
```

The sheet builds its words from these numbers ("21 files · about 140 MB · about 20 seconds on this Mac"); rounding:
bytes to 2 significant figures in KB/MB/GB; seconds → "a second" (<2), "a few seconds" (<10), "about N seconds"
(<60, to 5), "about N min". A canvas-only session gets `folder:null, project:null`.

### 5.6 Lanes, jobs, retry

- `lane:'auto'`: images, PDF, SVG, HTML always this Mac; video ≥ 4K or > 60 s suggests cloud (the sheet asks; Settings
  can pin "always the cloud · always this Mac"). Offline: this-Mac exports run; a cloud job becomes an outbox
  `export.cloud` record whose id **equals** the job id (V2-1.14 dedupe). P3 never goes to the cloud/browser lane.
- A spec is one **group job**: `{id, spec, items: [{id, name, status:'queued'|'running'|'ok'|'failed'|'waiting', reason?, path?}]}`
  (`waiting` e.g. "waits for its music from Jonas's Mac", fed by `S8-S9-asset-presence.md`).
  `POST /_api/export-jobs/retry {id, items?: string[]}` re-runs only failed/waiting items; session-scoped.
- Body on the existing routes: `{v:2, spec}`; the v1 body stays accepted byte-for-byte. History rows store
  `{v:2, spec}` so `export.rerun-last` / Export again replay the identical spec.
- `wait:'ai'`: the job stays `waiting` until `ai/run-lifecycle.ts` reports the run on the target ended, fires once,
  and dies with the run when cancelled. Without `wait`, an artboard under an AI run exports its last finished version.

### 5.7 Client and agent entries

```ts
// client/v2/export/use-export-spec.js (S8.2)
openExport(spec?: Partial<ExportSpecV2>): void      // opens the sheet pre-filled; ⇧⌘E with nothing selected → {scope:'canvas'}
quickExport(spec: ExportSpecV2): Promise<{jobId}>   // no sheet; lands in the Exports panel (inspector one-click, ⇧⌘C path)
```

Registry `export.open` params: `{scope?, format?, canvas?, folder?, region?, at?}` (S8.1 adds them; agent
`cli('maude design export')`). CLI flags (S8.1/S8.3, round-trip tested against `validateSpecV2`):
`maude design export <format> --scope selection|canvas|folder|project [--folder <rel>] [--canvas <rel>]
[--region x,y,w,h] [--unit each|one] [--at <sha>] [--name '<template>'] [--option k=v]…`; the v1 `--scope artboard|…`
spellings keep working.

### 5.8 Annotations

`annotationsExportPolicy(format: ExportFormatV2, ctx: { kind?: string; print?: boolean }): 'optional' | 'never'`
(S4.16 builds it in `exporters/scope.ts`). `resolveSpecV2` applies it per unit: `'never'` forces annotations off and
adds the degradation line `annotations-print` ("Print never includes annotations.") — the export still succeeds.
`'never'` for: pdf of a print-kind artboard or with `print` options, mp4/webm/gif/audio, zip, pptx, canva.

## 6. Evidence

Code reading only: route bodies (`http.ts` `/_api/export`, `/_api/export-jobs`), `exporters/{index,scope,format-scopes,jobs}.ts`,
`canvas-build.ts` overrides (S1.11 present on feat), `09 Export.tsx` tokens + summaries.

## 7. Tests that will prove it (red first)

`export-spec-v2.test.ts` (validate: unknown key, ranges, path escape, runtime path); `export-scope-v2.test.ts` (mapping
table rows, jpg/audio coherence, `{rect}` region); `export-file-names.test.ts` (sanitize, cap, ` (2)`, path escape);
`export-estimate.test.ts` (numbers from index, `null` counts for canvas-only); `acl-l7-export` rows (folder/project
403 `not-in-scope` for canvas-only, same body as missing); `export-print-annotations.test.ts` (S4); `exports-again-parity`
(v2 spec replays identically); CLI round-trip (`--scope folder --name …` ≡ the sheet's spec bytes).

## 8. Feeds and acknowledgements

| Neighbour | What they code against | Ack needed for |
| --- | --- | --- |
| **S2** (S2.13 Export area, S2.10 world menu D6, S2.15 Figma paste, S2.4 inspector slot) | `openExport({scope:'canvas', region:{rect}, unit:'one'})`; `openExport({scope:'project', format:'zip'})`; inspector slot calls `quickExport` | region is world coords; D6 entry ids |
| **S3** (S3.11 inspect) | "Export PNG 1×/2×/SVG" → `quickExport({scope:'selection', selection:{elements:[id]}, format, options:{size:{scale}}})`; "Handoff…" → `handoff.open` | element ids, not CSS |
| **S4** (S4.16) | `annotationsExportPolicy` signature §5.8 | the `'never'` list |
| **S7** | selectors `linkedFormats(artboardId)`, `hasCaptions(artboardId)`, `maxFrames(artboardId)` (from `artboardMeta`) + stored print geometry; S7 never edits `client/v2/export/*` | selector names and return shapes |
| **S1** (S1.11, S1.14) | `at:{sha}` renders through `serveHistoricalCanvas` + overrides on the capture origin; Version history's "Export this version" → `openExport({at})` | ref grammar |
| **S9** (S9.9, S9.10) | §5.3 rows; estimate in `READ_ONLY_ALLOWED_WRITES`; observer 403 on estimate too | `not-in-scope` body parity |

Must not: add a second export sheet; compute estimate copy from anything but §5.5's numbers; let `folder`/`project`
expand outside `sees`; send P3 to the browser lane.

## 9. Open questions (conservative default)

| # | Question | Default |
| --- | --- | --- |
| O1 | Folder scope: recurse into sub-folders? | Yes, the whole subtree the session sees (the count shows it). |
| O2 | `{date}` time zone on a cloud-lane job. | The requesting Mac's local date, stamped into the spec at submit. |
| O3 | A selection that mixes artboards of several canvases (⌘K multi-select). | Not in v2.0 — selection is one canvas; the sheet says "Pick one canvas". |
