# Debate synthesis: taste decisions TD1–TD10 (2026-10-31)

Seats: builder, shipper, breaker and user-advocate, all with blind openings, reduced by the lead. ★ marks the recommended option.

| TD | ★ recommendation | alternative | seats | before merge / rc patch |
| --- | --- | --- | --- | --- |
| TD1a mode name | **keep "Preview"** for v2.0; the labelled switch (TD1b) makes the mode legible | rename it "Review" now (builder, UA). That breaks `mode.preview` / `--mode preview` for agents, about 560 strings and every golden. | shipper, breaker vs builder, UA | the rename, if wanted → 2.0.x |
| TD1b switch | **labelled "Edit · Preview" + the Present icon**, with the read-only "Viewing" shown | — | all 4 | before merge |
| TD1c keys in Edit | **keep the switch (N/C/M/A/E/S → Preview) + the label + the F01 focus guard** | — | all 4 | before merge (with the F01 fix) |
| TD1d crossing motion | **the frame stays: the pill, cluster, undo and avatar never move** | also keep the camera still and stagger the toolbar (builder, UA). That touches the S3.9 engine and adds timing flake. | all 4 for the frame | frame before merge; camera → rc patch |
| TD2 New canvas | **an empty "Untitled canvas" (existing `createBlankCanvas`) with the size picker; the brief stays as ⌘K "New brief canvas"** with its `/design:new` / "Claude" copy rewritten | — | all 4 | before merge |
| TD3 new-object look | **neutral role tokens with a fixed literal fallback** (`var(--bg-3, <neutral>)`, frame `--bg-1`, text `--fg-0` + body font / system-ui); replaces the shipped accent/currentColor | — | all 4 | before merge (F02 blocker) |
| TD4 left panel | **fold Canvases only below ~1240 px, restore above ~1320 px** (two widths, no timer), and remember a manual unfold | — | all 4 (hysteresis details from breaker) | before merge |
| TD5 What's new | **never a canvas toast**: the Home line and Help › What's new only; drop the "You're in Edit" toast, since the label replaces it | one queued toast slot (UA); a timer-based queue, flaky | builder, shipper, breaker vs UA | before merge |
| TD6 Export | **keep it in the root and in File** (one sheet, ⇧⌘E); the Inspector row reads "Export… ⇧⌘E" | — | all 4 | rc patch is OK |
| TD7 Inspector | **O1 calm 28 px · O2 popover from the chip (top layer, collision-aware) · O3 section "Fill", row Background / Fill / Colour by kind · O4 drag the letter or icon in the field · O5 at most one fg-3 line per section** | — | all 4 | **T0–T3 before merge** (board 14 / CONTRACT, the token list, the picker, slot defaults); **T4–T6 (labels, scrubbing, type rows) → rc patch** (shipper, breaker) |
| TD8 cloud name | **"Maude Cloud" everywhere, "Move to Maude Cloud…" inside Share**; a self-hosted hub shows its own name | keep today's mix ("Move to cloud…") (shipper) | builder, breaker, UA vs shipper | the Share verb before merge (F07); the noun sweep can go to rc |
| TD9 chrome language | **a2 now: a `:focus-visible` 2 px ring (WCAG fix F28/F29); then a1 "a wash means selected, the ring means focus" + b1 accent rationing in the rc patch** · c1 menus get a 1 px border · d2 annotations stay quiet in Edit (S4.9), with ⇧P | a1 + b1 before merge (builder, UA). That restyles the whole kit and rebaselines every golden. | split; all 4 on c1; d2 by 3 vs builder | a2 + c1 before merge; a1/b1 → rc |
| TD10 creation | **"Artboard / Frame (F)" tooltip + File › New artboard presets; the Image tool (I) opens a file picker at once** (the existing HTML file input, so DOM e2e and agents can drive it), with Generate one click away | an anchored picker (builder); today's panel switch (breaker) | mixed: a1 3/4, b1 2/4 | before merge |

Breaker's veto list, all respected above:
- TD1c2 and TD9d1: annotations visible in Edit that can't be picked;
- TD10b1 as a native chooser: not drivable;
- TD4/TD5 timers;
- TD6B: stale "File › Export" chips;
- the TD1a rename at rc.
