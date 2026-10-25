# 12 Import and Assets: re-evaluation against the "verified" bar (v2-michal-verified-bar)

Source: critic-final.md (stage D2, d3881fe41) + the committed pairs. No new shots. Lead decisions applied: contract over board, "From this Mac..." row stays, Browse takes the island box (tab row covered is not a blocker), SVG-only logo import stays "SVG", inspector per 14, fold per C1.

## Per id

- ia-drop-photos · VERIFIED (both) · none. Outline + chip draw on the artboard; chip wording ("fill 6 empty frames in order" vs board "place 6 photos in <artboard>") is no v1 word and a behaviour wording for empty frames: polish. Panel tab shown is Canvases not Assets: harness state, polish.
- ia-placed · differs (both) · MUST: after the place, the six photos are not selected as a group with the "6 photos" tag; the Frame inspector of the artboard is open instead (board: no inspector, tag on the group).
- ia-more-ways · UNREACHABLE (both) · not built (prepare-in-place clip card, "3 clips · Assemble", logo-cleaned-up notice, paste entry); needs product work + video/logo/paste fixture.
- ia-assets-panel · VERIFIED (both) · none.
- ia-assets-keys · differs (both) · MUST: "Rename..." is not built in the tile menu (no `POST /_api/assets/rename`). The menu itself is not in the frame and no artboard is selected, so "Place in <artboard> ↵" is not evidenced.
- ia-assets-browse · differs (both) · MUST: the selection state the board draws (pick circles filled, "N selected · size · Clear · Place N in <artboard> ↵" foot bar) is not shown/evidenced. Tab row covered = lead decision, not a blocker.
- ia-assets-find · VERIFIED (both, state 1) · none. Dark: match-name labels only visible on the third tile = fixture (bright plasma photos), polish. States 2-4 are side rows (need an AI stub).
- ia-assets-tidy · differs (both) · MUST: tidy mode lists all 17 tiles (board: two-row cap with the count); the foot is two stacked lines and "Move 17 to the trash..." runs off the panel bottom (board: one line, inside the panel).
- ia-asset-details · VERIFIED (both) · none. Light: grey cover squares / raw "EXPORT/01 · ARTIFACT" line come from the 8x8 fixture and canvases with no thumbnail in the harness = fixture; no avatar / AI-saw chips / Place artboard name = data.
- ia-photo-inspector · differs (both) · MUST: the Placement Fill / Fit / Crop segment is missing; Light / Colour rows carry an extra numeric field the board does not draw. (Image / Photo tab pair: inspector per 14, not counted; "Remove background" not accent-outlined: polish.)
- ia-photo-steps · differs (both) · MUST: the crop step is not built/reachable (no "4:5 · from the artboard" pill, crop handles, Fill/Fit/Crop seg with Crop active, "The whole photo stays..." line).
- ia-gen-ask · differs (both) · MUST: the ask is the inline card in the Assets panel, not the AI chat island (header, mode chips, option chips, scope chip, round send); red "No image provider is ready..." replaces the cost + SynthID lines.
- ia-gen-placed · UNREACHABLE (both) · needs a generation-provider stub / recorded takes.
- ia-figma-sheets · VERIFIED (both, sheets 1-2) · none. Accent focus ring on the link field = visible focus (a11y good), placeholder instead of a typed link = fixture. Sheet 3 is a side row.
- ia-figma-sheets-connect · VERIFIED (both) · none (Connect disabled with no token typed = harness).
- ia-figma-arrived · UNREACHABLE (both) · needs a Figma file fixture via an API stub.
- ia-figjam · UNREACHABLE (both) · needs a FigJam fixture + arrival surface.
- ia-brand-steps (+ -1, -2, -3) · differs (both) · MUST: copy "1 colours" (plural bug, step 3 "Read ... 1 colours"); an extra amber "Couldn't read studio-brno.cz" row that duplicates the callout (board has the logo row + callout only).
- ia-brand · UNREACHABLE (both) · needs a readable site / recorded brand-read fixture.
- ia-missing · UNREACHABLE (both) · needs a two-peer sync fixture or seeded "waiting" asset.
- ia-missing-gone · differs (both) · MUST: "Replace..." (next to Relink... in the inspector Missing box) is not built. (Frame hatch + warning card + Relink... match; "Added by Tereza on 1 Oct..." needs who/when from a second person = unreachable part.)
- ia-edges · UNREACHABLE (both) · nine conditions need harness stubs.
- ia-advanced · VERIFIED (both) · none. Mid-word wrap equals the board's own anywhere-wrap CSS; "kept open" chip = fold decision (C1); Original / Edits / Cut-out rows and the Terminal import command card depend on original-path / edit data the fixture photo lacks (data-conditional).

## Polish list

- ia-drop-photos · chip wording "Drop to fill 6 empty frames in order" vs board "Drop to place 6 photos in <artboard>"; left panel on Canvases not Assets.
- ia-assets-find · dark: match-name label not visible on first two tiles (bright fixture photos).
- ia-asset-details · grey Used-in covers and raw artboard label (fixture / no thumbnails).
- ia-photo-inspector · "Remove background" plain, spec accent-outlined; header is the sha name (data).
- ia-figma-sheets · accent focus ring on the link field (spec caret only).
- ia-brand-steps · amber warning glyph (spec neutral); callout reason "It couldn't be reached." vs "It didn't answer in 20 s." (fixture); opening state shows an empty drop well (harness did not choose a logo); step 2 shows "Reading..." mid-read.
- ia-missing-gone · card line red (spec neutral grey).
- ia-advanced · fold pinned to the foot over a gap (same as board).
- ia-assets-panel · hover tip / selected tile transient, one group only (fixture).
- ia-gen-ask · "4 variants" select looks native.

## Side states

- ia-assets-keys/tile-menu · open tile menu (Place in <artboard> ↵ / Show details ⌘I / Rename... / Copy ⌘C / Move to trash) · reachable (built except Rename...), not in the frame
- ia-assets-browse/selection-foot · "N selected · Clear · Place N in <artboard> ↵" · reachable, not shot
- ia-assets-find/consent-sheet · "Search what's in the pictures" consent · unreachable here (AI stub)
- ia-assets-find/seen-in-picture · results matched by AI description · unreachable (AI)
- ia-assets-find/ai-not-connected · notice · unreachable (AI stub)
- ia-figma-sheets/pick-frames · sheet 3 (pick frames and where they go) · unreachable (Figma API stub)
- ia-photo-steps/remove-background · after the cut-out · reachable only with the model; not shot
- ia-photo-steps/apply-to-every-use · sheet · reachable, not shot
- ia-brand-steps/step-1 · logo chosen chip (tick in an empty tile instead of the logo preview) · reachable
- ia-brand-steps/step-2 · reading ("Read · 4 colours") · reachable, caught mid-read
- ia-brand-steps/step-3 · site did not answer · reachable
- ia-missing-gone/inspector-missing-box · selected frame, inspector Missing box · reachable, not in the shot
- ia-advanced/terminal-card · "Import the same way from Terminal" command card · reachable with an original-path fixture
