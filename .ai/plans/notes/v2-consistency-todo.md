# v2 canvases — final consistency pass (collected while building)

Kit promotions:
- ModeSwitch in every Share cluster (`ShareCluster mode="edit"`; viewers `canEdit={false} access="Can view"`) — 01, 02, 03, 05, 06, 07, 08, 09, 12 (04 local → kit, 10/11 already).
- [DONE kit CSS] Project avatar = rounded square (people stay circles) — from 02 `.ob-` / 11 `.pn-sq` → kit `Window` tabs + Home project cards.
- [DONE terminal] `terminal` glyph, music glyph, pause/sound glyphs → kit Icon.
- Empty canvas block (`EmptyCanvas`) from DS empty-state specimen — 01, 02, 05 draw it three ways.
- Assets = third tab of the left panel (Canvases · Layers · Assets) — 12 draws it so; 05 drew a separate panel → align 05.
- Timeline compact (07 is source of truth; 08 ak-video aligned in fix07).

Canvas alignments:
- 01: offline = Ask AI enabled + queued (CONTRACT §7); Combine-kampan = 21 artboards (real), not 15.
- 02: Figma sheet says "Text stays editable" — wrong (frames arrive as pictures until "Make editable", per 12).
- 03: Advanced fold add "Images, video and voice" group (06 has it).
- 08: artboard Advanced add "Look and layout" section (06 has it).
- 05: Assets as left-panel tab, not separate panel.
- 06 ad-export → match 09: RGB line (no CMYK option), file-name pattern `{canvas} — {artboard}@{scale}`, Scope lives in the main sheet, "Exports" not "Recent exports", colour profile as segmented control, slash command `/design:export png --scope artboard --option scale=2`.
- 07 export sheet → match 09: row label "Format" (not "File"), add the Scope row.
- Exports icon with progress ring in the Share cluster (09) — kit candidate `ShareCluster exports` slot.
- 10's ShareSheet is the canonical Share sheet (02, 05, 06, 09 lift it).
- CONTRACT §7 new: Assets tab (kit CanvasesPanel tab="assets" + `assets` slot — DONE in kit), search-in-pictures opt-in, Figma frames as pictures, Waiting-for vs Missing, photo edits per use. Apply to 02 (Figma), 05 (Assets tab, search copy), 07 (waiting), 12.
