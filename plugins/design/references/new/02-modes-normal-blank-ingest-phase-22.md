## Modes: normal · blank · ingest (Phase 22)

`/design:new` runs in one of three modes, resolved in **step 1.6**:

| Mode | Trigger | What it does |
|---|---|---|
| **normal** (default) | a `<Name>` (+ optional brief), no `--blank`, active canvas is not an annotated brief canvas | Make a new canvas, then draft its artboards one at a time. The full flow below (steps 2 → 12). |
| **blank** | `--blank` flag | Make an **empty brief canvas** (the one New brief makes: a single framed artboard to annotate) and exit. **Zero model cost**: skips UX research / envelope / generation / critic. The person then annotates it (Sticky `N`, Text `T`, Arrow `A`) and re-runs `/design:new` to ingest. See **step 3.5**. |
| **ingest** | the **active** canvas is a brief canvas whose `<slug>.annotations.json` is non-empty (or `--from-annotations` on any active canvas) | Read the canvas's annotations as a **verbatim brief**, draft artboards, and **Edit them into the same canvas** below the brief frame — the annotations are never touched and stay floating on top. See **step 6b**. |

**Escape hatches:**

- `--from-annotations` — force **ingest** on ANY active canvas, even one that is not a brief canvas.
- `--fresh` — force **normal** behavior (a brand-new canvas) even when the active canvas IS an annotated brief canvas (ignore its annotations).
- `--blank` **+** a `"<brief>"` are **not** mutually exclusive: in blank mode the brief is **not** a generation input — it becomes the **seed hint** (the faint line under the title on the empty frame, a reminder of intent). To generate from a brief, drop `--blank`.

**Not a mode, but check it first.** When the person has just asked for a canvas in the AI chat panel with one sentence (Home's "Ask AI for a new canvas…") the canvas already exists and is open with no artboards: do not make another. Draft into it as skill `design` § "A first draft from Home" says, which is the same stages as step 6 below.

This is the brief loop: `--blank` to sketch intent on an empty surface, then plain `/design:new` to have AI read the sketch and lay out the matching artboards in place. The canvas `kind` field + ingest-mode overload are recorded in **DDR-085**; the annotation vocabulary it reads comes from Phase 21 (Sticky + Text) and the media elements (Image / link / mediaref) from Phase 23; since DDR-242 it reads them as v2 elements through `read-annotations`, where `text` is each element's text slot and a section nests its `members`.
