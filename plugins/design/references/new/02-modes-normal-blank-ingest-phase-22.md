## Modes: normal · blank · ingest (Phase 22)

`/design:new` runs in one of three modes, resolved in **step 1.6**:

| Mode | Trigger | What it does |
|---|---|---|
| **normal** (default) | a `<Name>` (+ optional brief), no `--blank`, active canvas is not an annotated brief-board | Generate a new multi-artboard canvas file. The full flow below (steps 2 → 12). |
| **blank** | `--blank` flag | Write an **annotation-only brief board** — one empty framed artboard, `kind: "brief-board"` in `.meta.json` — and exit. **Zero model cost**: skips UX research / envelope / generate / critic. The user then annotates it (sticky `N`, text `T`, arrow `A`) and re-runs `/design:new` to ingest. See **step 3.5**. |
| **ingest** | the **active** canvas is a `brief-board` whose `<slug>.annotations.svg` is non-empty (or `--from-annotations` on any active canvas) | Read the board's annotations as a **verbatim brief**, generate artboards, and **Edit them into the same canvas** below the brief frame — the annotation layer is never touched and stays floating on top. See **step 6b**. |

**Escape hatches:**

- `--from-annotations` — force **ingest** on ANY active canvas, even one not marked `brief-board`.
- `--fresh` — force **normal** new-file behavior even when the active canvas IS an annotated brief-board (ignore its notes; scaffold a brand-new file).
- `--blank` **+** a `"<brief>"` are **not** mutually exclusive: in blank mode the brief is **not** a generation input — it becomes the board's **seed hint text** (printed faint on the empty frame as a reminder of intent). To generate from a brief, drop `--blank`.

This is the "brief board" loop: `--blank` to sketch intent on a blank surface, then plain `/design:new` to have Claude read the sketch and lay out the matching artboards in place. The canvas `kind` field + ingest-mode overload are recorded in **DDR-085**; the annotation vocabulary it reads comes from Phase 21 (sticky + text), the media strokes it forward-reads from Phase 23.
