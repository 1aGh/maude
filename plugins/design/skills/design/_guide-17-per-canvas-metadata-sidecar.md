### Per-canvas metadata sidecar

Every canvas project under `<designRoot>/<newCanvasDir>/` has a sibling `<Canvas>.meta.json` (schema: `${CLAUDE_PLUGIN_ROOT}/dev-server/canvas-meta.schema.json`). It captures things that aren't readable from the HTML alone — section/artboard labels, brief, platform, iteration count, tokens used.

**`/design:new`** bootstraps the sidecar from the brief:

```jsonc
{
  "title":    "<Name>",
  "subtitle": "<one-line summary from brief>",
  "brief":    "<full brief>",
  "platform": "desktop|mobile|...",
  "created":  "<ISO>",
  "last_modified": "<ISO>",
  "sections": [
    { "id": "main", "label": "<from brief>", "artboards": [
      { "id": "primary", "label": "<from brief>", "platform": "desktop", "width": 1280, "height": 820 }
    ]}
  ],
  "iteration_count": 0,
  "tokens_used": []
}
```

**`/design:edit`** updates the sidecar after every successful edit:
- `last_modified` ← now
- `iteration_count` ++
- `tokens_used` ← `grep -oE 'var\(--[a-z0-9-]+\)' <canvas> | sort -u`
- If a new `<DCSection>` or `<DCArtboard>` was added/removed/relabeled, sync `sections[]` accordingly. Read the JSX `id` and `title` props.

**Why a sidecar (not embedded in HTML):** the file tree in the dev server browser, the handoff bundle, and `/design:handoff` route mapping all need this metadata without parsing JSX. The sidecar is also human-editable (rename a section by editing one JSON field, no need to touch the canvas).

**Handoff bundle includes the sidecar** at the canvas's path, so consuming agents (production code authors) don't have to parse the canvas just to learn what each artboard is.

#### Present order, skipped artboards and speaker notes (`present`, `artboardMeta.<id>.notes`)

Present plays a canvas's artboards one by one in **canvas order** (row by row, left to right) unless the sidecar says otherwise. "Order and notes…" in the studio writes the same keys you may write:

```jsonc
{
  "present": {
    "order": ["cover", "reel", "poster"],  // optional; artboards it leaves out follow in canvas order
    "skip": ["banner-fb"]                   // optional; stays on the canvas, left out of the run and the counter
  },
  "artboardMeta": {
    "cover": { "notes": "Last year 86 players came." }  // speaker notes, plain text, ≤ 20 000 chars
  }
}
```

Rules (V2-1.12 R1/R6; strict schema `apps/studio/schema/canvas-meta.v2.schema.json`):
- Both are **top-level** keys. Never put notes or an order under `layout` or inside `layout.artboards[]` — a v1 peer's layout write erases anything there.
- Every id is the `id` of a `<DCArtboard>` in the canvas `.tsx` (`^[A-Za-z0-9_-]{1,64}$`), once per list. `maude design check --strict <Canvas>.meta.json` reports an unknown id or a duplicate.
- Absent means the default: no `present` = canvas order, nothing skipped; no `notes` = no note. Remove a key rather than writing `[]` or `""`.
- Keep every other `artboardMeta[id]` field (`poster`, `snap`, `maxFrames`, `madeFrom`, `markers`, `madeBy`, `exports`) and every other top-level key as you found it. Don't stamp `last_modified` for this — it marks layout changes only.

#### An artboard's export sizes (`artboardMeta.<id>.exports`)

The Inspector's Export section keeps each artboard's own sizes — set once, one click from then on. You may write the same list:

```jsonc
"artboardMeta": {
  "post": { "exports": [ { "format": "png", "scale": 1 }, { "format": "jpg", "scale": 2 }, { "format": "svg" } ] }
}
```

- `format` is `png`, `jpg` or `svg`; raster formats carry a `scale` from 0.25 to 4, `svg` carries none. At most 8 sizes. Nothing else goes in an entry.
- Absent means the kind's default (Fixed size and Web page: PNG 1×). Remove the key rather than writing `[]`. Print and video artboards keep their one format in the export sheet, not here. Element sizes are never stored.
- It is an `artboardMeta` member like `notes`: keep every other field of the entry as you found it. To export without storing anything: `maude design export png --scope selection --canvas <rel>`.

#### Video and change-kind keys (`artboardMeta.<id>.poster`, `snap`, `maxFrames`, `madeFrom`, `markers`)

The Timeline, the video exporter and "Change kind" keep five more per-artboard keys in the same map:

```jsonc
{
  "artboardMeta": {
    "recap-reels": {
      "poster": 120,         // poster frame (a comp frame): the canvas picture and the export poster
      "snap": "beat",        // "beat" | "off": Snap to the beat in the Timeline
      "maxFrames": 5400,     // "Allow longer": this artboard's length cap, an integer up to 18 000
      "markers": [{ "frame": 420, "name": "Výkop" }, { "frame": 1320, "name": "TD 1" }], // ruler markers, see below
      "madeFrom": { "artboard": "recap-feed", "label": "Recap · Feed" } // this copy came from that artboard
    }
  }
}
```

- Absent means the default. Without `poster` the poster is at 35 % of the length. Without `snap`, snapping is on when the comp has a music clip with a beat grid. Without `maxFrames` the cap is 3 600 frames (2 min at 30 fps). Remove a key instead of writing a default value.
- These keys are **top-level only**, like `notes`. A v1 peer's layout write erases anything under `layout`. The strict schema refuses these keys anywhere else, and it refuses any other field inside `madeFrom`.
- `markers` are the flags on the Timeline's ruler ("Výkop", "TD 1"): a list of `{ frame, name }`, `frame` a whole number ≥ 0 of the comp, `name` plain text up to 60 characters (no line breaks, no `<` or `>`), one marker per frame, at most 200 per video, in frame order. Write the whole list; remove the key to clear it. The studio saves them through `PATCH /_api/present-meta` (Can edit and up); you edit the file.
- Set `madeFrom` only on a copy made by Change kind. It names the source artboard and that artboard's label at the time of the copy. Leave it in place if the source is later renamed or deleted, because it records history and is not a link.
