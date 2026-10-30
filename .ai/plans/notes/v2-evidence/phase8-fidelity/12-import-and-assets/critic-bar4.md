# 12 Import and Assets: re-evaluation (bar 4) on the D6 merged-tip shots (3d58f57df)

Judged fresh from the D6 pairs (both themes read for every id marked verified); critic-bar3.md and the round-7/8 fix notes used as the checklist. Lead decisions applied: owning board wins, contract over board, "From this Mac..." row stays (04 owns), Browse takes the island box, SVG-only logo says "SVG", inspector per 14 (extra image sections, Image/Photo tab, crop tag words), ia-gen-ask stays inline (v2-p8-c9-ask-stays-inline), arriving skeleton deferred.

## Per id

- ia-drop-photos · VERIFIED (both) · none. Accent outline + solid chip on the artboard in both themes; chip words, panel tab and the OS drag ghost are polish / side.
- ia-placed · VERIFIED (both) · none. Six photos selected as one group with the "6 photos" tag, Photo inspector, toast "Placed 6 photos in … They're in Assets too." with Undo.
- ia-more-ways · UNREACHABLE · prepare-in-place clip card, logo-cleaned-up notice, paste entry need native picker / video / paste fixtures.
- ia-assets-panel · VERIFIED (both) · none. Chip row (All kinds, Not used, spark, +), foot "N assets · size", group head, From this Mac... row (lead decision). Groups beyond Photos and the hover tip are fixture / side.
- ia-assets-keys · VERIFIED (both) · none. Artboard selected, tile menu open: Place in Hero ↵ · Show details ⌘I · Rename… · Copy ⌘C · Move to trash, board order.
- ia-assets-browse · VERIFIED (both) · none. Six picked (circles filled), foot "6 selected · size · Clear · … Place 6 in Hero ↵", sort + Large/Small. Tab row covered = lead decision.
- ia-assets-find · VERIFIED (both, state 1) · none. "In the name or tags" group with match name on each tile, "Search what's in the pictures too?" offer card with Turn on…. States 2-4 are side rows (AI).
- ia-assets-tidy · VERIFIED (both) · none. Not used chip on, one-line foot with the Move N to the trash… button. "Not counted: …" note and Video / Generated groups are data-conditional (fixture has none).
- ia-asset-details · VERIFIED (both) · none. Back crumb, More, cover, name, Size, Added, Place ↵, Advanced. AI-saw chips, avatar and Used in rows are conditional on data the fixture asset lacks.
- ia-photo-inspector · VERIFIED (both) · none. Placement Fill/Fit/Crop, Look tiles, Light/Colour track + value, Remove background, Replace… / Reset, "Only this use changes", Apply to every use…, Advanced.
- ia-photo-steps · VERIFIED (both, crop column) · none. Crop mode on the frame (tag "photo · crop", ↵ done · esc cancel), Placement › Crop active, "The whole photo stays — only the frame moves." Pill "4:5 · from the artboard" not built by lead decision (14 owns the tag words).
- ia-gen-ask · UNREACHABLE (board state) · The board's state needs a configured BYOK provider: AI island with mode chips, option chips, scope chip, send, cost line "About 30 s · billed to your Google key" and the SynthID line. The island is deferred by v2-p8-c9-ask-stays-inline; the inline card shows the no-provider state (red "No image provider is ready…") instead of the cost + SynthID lines. Container is a lead-decision deviation; the provider-ready state needs a provider stub, so it is verified later in e2e.
- ia-figma-sheets · VERIFIED (both, sheets 1-2) · none. Focus ring on the link field is visible focus (a11y plus); placeholder instead of a typed link is fixture.
- ia-figma-sheets-connect · VERIFIED (both) · none. Four-step text, Access token field, keychain line, Connect disabled until a token is typed (harness).
- ia-figma-arrived · UNREACHABLE · needs a Figma API stub.
- ia-figjam · UNREACHABLE · needs a FigJam fixture.
- ia-brand-steps · VERIFIED light only · DIFFERS in dark. MUST (dark): the chosen logo is shown on a theme-token checker (`brand.css .bi-drop-ic--logo`, var(--bg-3)/var(--bg-2)), so in dark the logo's dark wordmark disappears (only the pink dot is readable); the board draws the logo tile light-fixed (`data-theme="light" k-fixed` on `.ia-logo`) so the user's logo stays legible in both themes. Everything else matches in both themes: chosen logo drawn (round-8 MUST closed), Website field, helper line, Cancel / Import. Reading column (-2) and Edge column (-3) now caught and match in both themes (side rows).
- ia-brand · UNREACHABLE · needs a readable site / recorded brand-read fixture.
- ia-missing · UNREACHABLE · needs a two-peer sync fixture.
- ia-missing-gone · VERIFIED (both) · none. Hatched frame + warning card with Relink…, inspector Missing box with Relink… and Replace…. "Added by Tereza on 1 Oct…" needs a second person (side row); extra image sections in the inspector are per 14.
- ia-edges · UNREACHABLE · nine separate conditions.
- ia-advanced · VERIFIED (both) · none. Stored as / In canvases + Copy, "kept open" chip (C1). Original / Edits / Cut-out rows and the Terminal command card are conditional on original-path / edit data the fixture photo lacks.

## Polish list

- ia-drop-photos · chip says "Drop to fill 6 empty frames in order" (board "Drop to place 6 photos in <artboard>"); left panel on Canvases, not Assets; no OS drag ghost (harness limit).
- ia-assets-find · dark: match-name label clipped on the first tiles (bright fixture photos).
- ia-assets-tidy · all unused tiles listed per group (board shows a 6-tile sample; the board's title says nothing unused hides); foot drops the size in a narrow panel (decision).
- ia-asset-details · "Place" without the artboard name when nothing is selected; no cover crop of canvases (fixture).
- ia-photo-inspector · "Remove background" plain, board accent-outlined; header is the sha name (data); Light/Colour values read 0 (fixture).
- ia-photo-steps · "4:5 · from the artboard" pill not built (14 owns the tag words); crop frame is the whole photo, not the artboard's aspect.
- ia-figma-sheets · accent focus ring on the link field (board caret only).
- ia-brand-steps · extra "Choose logo file…" button beside the chosen logo (needed for keyboard users; board says "or drop another"); amber warning glyph in the callout vs board neutral; callout reason wording and "1 colour" vs "4 colours" are fixture; logo tile 48 px vs board 56 px area (within ±4 px class).
- ia-gen-ask · "4 variants" select looks native; inline card instead of island (lead decision).
- ia-missing-gone · card line red (board neutral grey in the inspector card).
- ia-advanced · fold pinned to the foot over a gap (same as board).

## Side states

- ia-drop-photos/os-drag-ghost · "IMG_2231.jpg + 5 more" drag image · unreachable in a synthetic drag (desktop e2e)
- ia-assets-panel/hover-tip · tooltip "IMG_2231.jpg · Used in 4 canvases" · reachable (hover), not shot
- ia-assets-panel/drop-replace · "Drop to replace the photo" over a photo on the canvas · reachable (synthetic dragover), not shot
- ia-assets-find/seen-in-picture · results matched by AI description · unreachable (AI)
- ia-assets-find/consent-sheet · "Search what's in the pictures" consent sheet after Turn on… · unreachable (AI stub)
- ia-assets-find/ai-not-connected · notice · unreachable (AI stub)
- ia-photo-steps/remove-background · AI at work, then "Done — the original is kept" · unreachable (local model)
- ia-photo-steps/apply-to-every-use · sheet naming each canvas · reachable, not shot
- ia-figma-sheets/pick-frames · sheet 3, pick frames and where they go · unreachable (Figma API stub)
- ia-brand-steps/reading · column 2 (Reading… two rows, progress bar, "Usually under 10 seconds…") · reachable, shot, matches in both themes
- ia-brand-steps/site-did-not-answer · column 3 (callout + Try again + Continue with the logo) · reachable, shot, matches in both themes
- ia-missing-gone/second-person-line · "Added by Tereza on 1 Oct…" · unreachable (second person)
- ia-advanced/terminal-card · "Import the same way from Terminal" · reachable with an original-path fixture, not shot
