# 12 Import and Assets: re-evaluation (bar 3) on the D5 merged-tip shots (e37e7d82a)

Judged fresh from the D5 pairs (both themes read for every id marked verified); critic-bar2.md and fix-c7-oboard.md used as the checklist. Lead decisions applied: owning board wins, contract over board, "From this Mac..." row stays, Browse takes the island box, SVG-only logo import says "SVG", inspector per 14 (so the extra image sections around a photo are not blockers), fold per C1, ia-gen-ask stays inline (v2-p8-c9-ask-stays-inline), crop pill words owned by 14.

## Per id

- ia-drop-photos · VERIFIED (both) · none. Outline + chip on the artboard in both themes; the OS drag ghost ("IMG_2231.jpg + 5 more") cannot be drawn by a synthetic drag (harness), chip wording and the left tab are polish.
- ia-placed · VERIFIED (both) · none. The six photos are one selection with the "6 photos" tag, Photo inspector (not the Frame's), toast with Undo. Round-7 MUST closed.
- ia-more-ways · UNREACHABLE · prepare-in-place clip card, logo-cleaned-up notice, paste entry need native picker / video / paste fixtures.
- ia-assets-panel · VERIFIED (both) · none. Hover tip "Used in N canvases" and "Drop to replace the photo" are side rows; groups beyond Photos are fixture.
- ia-assets-keys · VERIFIED (both) · none. Artboard selected, tile menu open: Place in Hero ↵ · Show details ⌘I · Rename… · Copy ⌘C · Move to trash, board order. Round-7 MUST closed.
- ia-assets-browse · VERIFIED (both) · none. Six picked (circles filled), foot "6 selected · size · Clear · … Place 6 in Hero ↵". Round-7 MUST closed. Tab row covered = lead decision.
- ia-assets-find · VERIFIED (both, state 1) · none. Dark: match-name labels clipped on two tiles is fixture. States 2-4 are side rows (AI stub).
- ia-assets-tidy · VERIFIED (both) · none. Foot is one line inside the panel ("N assets" + "Move N to the trash…", size gives way in a narrow panel by decision). Round-7 MUST closed. The impl lists every unused tile of a group (board shows a 6-tile sample per group): the board's own title says "nothing unused hides", so polish. "Not counted: …" note and Video/Generated groups are data-conditional (fixture has none).
- ia-asset-details · VERIFIED (both) · none. "Place" instead of "Place in <artboard>" (no artboard selected in the shot), no AI-saw chips / avatar / Used in rows (fixture asset is unused, rows are built and conditional).
- ia-photo-inspector · VERIFIED (both) · none. Placement Fill/Fit/Crop, Look tiles, Light/Colour as track + value, Remove background, Replace… / Reset, "Only this use changes" card, Apply to every use…, Advanced. Round-7 MUST closed.
- ia-photo-steps · VERIFIED (both, crop column) · none. Crop mode on the frame (tag "photo · crop", ↵ done · esc cancel), Placement › Crop active, "The whole photo stays — only the frame moves." The "4:5 · from the artboard" pill is not built by lead decision (14 owns the tag words): polish. Columns 2-4 are side rows.
- ia-gen-ask · DIFFERS (both) · MUST: the board draws the ask in the AI chat island (header "Gameweek 5 photos", mode chips Generate an image / a clip, option chips "4:5 · from Gameweek 5" + "4 variants", scope chip, round send, cost line "About 30 s · billed to your Google key", SynthID line). The impl is an inline card in the Assets panel (prompt, two suggestion chips, "4 variants" select, Advanced, Cancel / Generate) with a red "No image provider is ready…" line in place of the cost + SynthID lines. v2-p8-c9-ask-stays-inline defers the island ("a later split"), so the lead may downgrade this to a deviation; as shot it differs in container, controls and copy. The cost/licence lines need a provider stub to evidence.
- ia-figma-sheets · VERIFIED (both, sheets 1-2) · none. Focus ring on the link field is visible focus; placeholder instead of a typed link is fixture.
- ia-figma-sheets-connect · VERIFIED (both) · none. Connect disabled until a token is typed (harness).
- ia-figma-arrived · UNREACHABLE · needs a Figma API stub.
- ia-figjam · UNREACHABLE · needs a FigJam fixture.
- ia-brand-steps · DIFFERS (both) · MUST: once a logo is chosen the drop well shows a ✓ glyph (brand-sheet.jsx `bi-drop-ic`) where the board draws the logo's own preview on the checker tile; the opening shot is the empty drop well (harness did not choose a logo; the chosen state is the -1 shot). Round-7 MUSTs ("1 colour" singular, one failed-site callout) are closed: -3 matches the Edge column in both themes (reason text "It couldn't be reached." vs "It didn't answer in 20 s." is fixture). The Reading column (progress bar, "Reading…", "Usually under 10 seconds…") was not caught in either theme: side row.
- ia-brand · UNREACHABLE · needs a readable site / recorded brand-read fixture.
- ia-missing · UNREACHABLE · needs a two-peer sync fixture.
- ia-missing-gone · VERIFIED (both) · none. Hatched frame + card with Relink…, inspector Missing box with Relink… and Replace…. Round-7 MUST closed. "Added by Tereza on 1 Oct…" needs a second person (unreachable part, not blocking); the inspector's extra image sections are per 14.
- ia-edges · UNREACHABLE · nine separate conditions.
- ia-advanced · VERIFIED (both) · none. Stored as / In canvases + Copy, "kept open" chip (C1). Original / Edits / Cut-out rows and the Terminal command card are built and conditional on original-path / edit data the fixture photo lacks.

## Polish list

- ia-drop-photos · chip says "Drop to fill 6 empty frames in order" (board "Drop to place 6 photos in <artboard>"); left panel on Canvases not Assets; no OS drag ghost.
- ia-assets-find · dark: match-name label not visible on the first tiles (bright fixture photos).
- ia-assets-tidy · all unused tiles listed per group (board: 6-tile sample); foot drops the size in a narrow panel.
- ia-asset-details · "Place" without artboard name when nothing is selected; grey Used-in covers / raw artboard line when no thumbnail (fixture).
- ia-photo-inspector · "Remove background" plain, board accent-outlined; header is the sha name (data).
- ia-photo-steps · "4:5 · from the artboard" pill not built (tag reads "photo · crop", owned by 14); crop frame is the whole photo, not the artboard's aspect.
- ia-figma-sheets · accent focus ring on the link field (board caret only).
- ia-brand-steps · amber warning glyph (board neutral); callout reason wording (fixture); extra "Choose logo file…" button beside a chosen logo.
- ia-missing-gone · card line red (board neutral grey).
- ia-advanced · fold pinned to the foot over a gap (same as board).
- ia-gen-ask · "4 variants" select looks native.

## Side states

- ia-assets-panel/hover-tip · tooltip "IMG_2231.jpg · Used in 4 canvases" · reachable (hover), not shot
- ia-assets-panel/drop-replace · "Drop to replace the photo" over a photo on the canvas · reachable (synthetic dragover), not shot
- ia-assets-find/consent-sheet · "Search what's in the pictures" consent · unreachable here (AI stub)
- ia-assets-find/seen-in-picture · results matched by AI description · unreachable (AI)
- ia-assets-find/ai-not-connected · notice · unreachable (AI stub)
- ia-photo-steps/remove-background · AI at work, then "Done — the original is kept" · reachable only with the local model; not shot
- ia-photo-steps/apply-to-every-use · sheet naming each canvas · reachable, not shot
- ia-figma-sheets/pick-frames · sheet 3 (pick frames and where they go) · unreachable (Figma API stub)
- ia-brand-steps/reading · step 2, Read + Reading… + progress bar · reachable with a slow-site stub, not caught
- ia-brand-steps/site-did-not-answer · Edge column (-3) · reachable, shot, matches (both themes)
- ia-missing-gone/second-person-line · "Added by Tereza on 1 Oct…" · unreachable (needs a second person)
- ia-advanced/terminal-card · "Import the same way from Terminal" · reachable with an original-path fixture
