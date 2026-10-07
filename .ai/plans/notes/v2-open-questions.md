# Maude v2 — open questions for Michal (from the canvases-in-practice run, 2026-10-06)

Everything below is drawn on the canvases with a sensible default and marked "Proposed". Answering changes a canvas, not the whole set.

## Product model (biggest)
1. **Project tabs — A or B?** A = native macOS window tabs (the plan as written; project/account/AI shown inside the window). B = Figma-style custom strip (richer state, needs plan amendments + DDR-109 security review). Recommendation: **A for v2.0**. → `11 · pn-ab`
2. **AI = bring your own Claude account?** Cloud doesn't include AI; connect on the first Ask AI (one sheet). → `02`, CONTRACT §7
3. **Cloud trial:** 14 days, no card, starts silently at first sign-in; what happens when it ends? → `02`
4. **One AI per artboard** (second ask waits or "Run on a copy"; whole-canvas ask starts on free artboards). Or a true "Run anyway" (last write wins)? → `03 · ai-queue-rule`
5. **Quitting while AI runs:** AI runs on this Mac and stops; Continue on next launch. Should cloud projects keep AI running server-side? → `03 · ai-quit`
6. **Roles:** Can view = look only, Can comment = look + comment, Ask to edit → owner; editors move to trash, only owners empty it. Hub today has owner/member/viewer (viewer can comment). → `10`, CONTRACT §6
7. **Mode switch** Edit · Preview · Present in the Share cluster (not the toolbar). Proposed keys ⌥⌘P / ⌥⌘↵ / ⇧⌥⌘↵, L = pointer. → `04 · md-model`
8. **AI never changes the artboard under your pointer** while you preview (lands when you move off). → `04`

## Features that don't exist today (drawn as if they did — keep in scope for v2.0?)
- Links between artboards (On click → Go to Pricing), presenter view, presentation links, per-artboard notes → `04`
- Follow / Bring everyone here, mention e-mails from cloud.maude.sh → `10`
- Word-by-word captions, beat detection + Cut to the beat, music ducking, poster frame, per-format reframing, Sound-only export, 4K preset, .srt → `07`
- Video formats linked (one cut, per-format framing; "Edit separately" unlinks) → `07`
- JPG, folder batch export, file-name tokens, cloud vs this-Mac render choice, colour profile, font-licence check, "Export the version from 14:05" → `09`
- 300 dpi default for print PDF (today 96) → `08`
- Search inside pictures (opt-in AI descriptions per project) → `12`, CONTRACT §7
- Brand import from a website (today only from an SVG logo) → `12`
- Prompt queue offline, drag-and-drop attachments, Open in terminal hand-off, per-canvas chat grouping → `03`

## Words, keys, placement
- "Fixed size" as the designer word for the `digital` kind; picker groups App · Web page · Social · Print · Video → `08`
- Print guides: stay in View › Advanced, plus a switch in the print inspector? → `08`
- Split key **S** (⌘B still works); tap Space plays a selected video, hold Space = Hand → `07`
- ⇧⌘C Copy as PNG (new key) → `09`
- Account lives in Settings › General (no Account tab) → `02`
- Status word for "sync stuck but safe" (canvas uses "Syncing…") → `06`
- First project named from the first sentence ("Open studio"); "Untitled project" for a blank start → `02`
- Viewers may export (today's server allows it); Handoff needs Can edit → `09`
- Trash keeps things until you clear them out (no auto-retention) → `05`
- Assets = third tab of the left panel → `12`, CONTRACT §7
- Photo edits apply to one use; "Apply to every use" explicit → `12`

## Found bugs (spun off as separate tasks)
- `fixed` artboards lose ~24px to the label strip (canvas-lib) → task chip
- CLI print-PDF options ignored; `export zip` without scope rejected; ⇧⌘E means two things → task chip
