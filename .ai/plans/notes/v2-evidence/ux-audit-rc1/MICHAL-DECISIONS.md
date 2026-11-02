# Michal's decisions on the UX audit debate (2026-10-31, via the keeper)

He replied: "1. ★ / 2. Ikony staci / 3. pokud ty zkratky maji alternativu v preview mode tak to udelat stejne jako s V / 4. staci ze se meni toolbar / 5. ★ / 6. ★ / 7. ★ / 8. ★ / 9. ★ / 10. ★ / Zbytek jak pises".

Binding reading for the builders (TD numbers refer to `DEBATE.md` and `REDUCE.md`):

1. **TD1a:** keep the name "Preview". No rename.
2. **TD1b:** the switch stays **icons only** (Edit · Preview · Present), with no text labels. Make the current mode readable without words:
   - a clear active/selected state on the active icon;
   - a tooltip with the mode name + shortcut;
   - an `aria-label` / `aria-pressed`;
   - the read-only "Viewing" state shown.
3. **TD1c:** a crossing key does what it means **in the current mode** if it has a meaning there, and does NOT switch mode, as V now does in Preview. A key with no meaning in the current mode keeps today's crossing. The focus guard while typing text stays: no single-key shortcut fires while text or a field is being edited. P3 produces the per-key table (N C M A E S V H F P I T …, in Edit and in Preview) and puts it in the CONTRACT keyboard map.
4. **TD1d:** a mode switch changes **only the toolbar**. The frame stays put (pill, Share cluster, undo, avatar), with no extra animation and no camera move.
5. **TD2 ★:** New canvas opens an empty "Untitled canvas" with the size picker. The brief stays as ⌘K "New brief canvas", with its `/design:new` and "Claude" copy rewritten.
6. **TD3 ★:** new objects get neutral role tokens with a fixed literal fallback: shape `--bg-3`, frame `--bg-1`, text `--fg-0` + body font / system-ui.
7. **TD4 ★:** Canvases folds only below about 1240 px and restores above about 1320 px. Two widths, no timer. A manual unfold is remembered.
8. **TD5 ★:** What's new never appears as a canvas toast; it lives on the Home line and in Help › What's new. The "You're in Edit" toast is dropped.
9. **TD6 ★:** Export lives in the root menu and in File: one sheet, ⇧⌘E. The Inspector row reads "Export… ⇧⌘E".
10. **TD7 ★:** Inspector O1a, O2a, O3a, O4a, O5b. **T0–T3 before merge**, T4–T6 in the rc patch.

**The rest, as proposed:**
- **TD8:** "Maude Cloud" everywhere, and "Move to Maude Cloud…" inside Share. A self-hosted hub shows its own name.
- **TD9:** before merge, a `:focus-visible` 2 px ring (WCAG) and a 1 px border on menus. The wash-vs-ring split and accent rationing go in the rc patch. Annotations stay quiet in Edit (S4.9).
- **TD10:** a tooltip "Artboard / Frame (F)", and File › New artboard with presets. Image (I) opens a file picker right away: the existing HTML file input, so e2e and agents can drive it. Generate stays one click away.
