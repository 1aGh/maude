# 12 Import and Assets: re-evaluation (bar 5) on the D7 merged-tip shots (0d2eab1d6)

Judged fresh from the D7 pairs (both themes read for every id marked verified; raw impl frames opened where borderline). critic-bar4.md used as the checklist. Lead decisions applied: owning board wins, contract over board, "From this Mac..." row stays (04 owns), Browse takes the island box (tab row covered), SVG-only logo says "SVG", inspector per 14 (Image/Photo tab, extra image sections, crop tag words), ia-gen-ask stays inline (v2-p8-c9-ask-stays-inline), arriving skeleton deferred, round 10 light-fixed logo tile (v2-p8-c10-misc-brand-logo-tile-light-scope).

Round-10 change checked: ia-brand-steps dark is now closed (logo tile light-fixed, wordmark legible in both themes; also -1/-2/-3).

## Per id

- ia-drop-photos · VERIFIED (both) · none. Accent outline + solid chip on the artboard, both themes. Chip words, left panel on Canvases, no OS drag ghost = polish / side.
- ia-placed · DIFFERS (both) · MUST: the Photo inspector's actions (Remove background, Replace…, Reset, Apply to every use…) are set in the mono face (`.st-btn` in `styles/3-shell-maude.css` sets `font-family: var(--font-mono)`; `.ph-wide` in `photo/photo.css` does not override it); the board draws them in the body face. Everything else matches: six photos selected as one group with "6 photos" tag, toast "Placed 6 photos in … They're in Assets too." + Undo, Just added group.
- ia-more-ways · UNREACHABLE · native picker / video / paste fixtures.
- ia-assets-panel · VERIFIED (both) · none. Chip row, group head, foot, From this Mac... row. Other groups and hover tip are fixture / side.
- ia-assets-keys · VERIFIED (both) · none. Tile menu: Place in Hero ↵ · Show details ⌘I · Rename… · Copy ⌘C · Move to trash; artboard selected.
- ia-assets-browse · VERIFIED (both) · none. Six picked, foot "6 selected · size · Clear · … Place 6 in Hero ↵", sort + Large/Small. Tab row covered = lead decision.
- ia-assets-find · VERIFIED light, DIFFERS dark · MUST (dark, a11y contrast): the match-name label on each tile (`.lp-tile-match`, `left-panel/left-panel.css`) is `color: var(--bg-2)` over a scrim of `--object-ink` (ink in both themes). In light that is white on ink (fine); in dark `--bg-2` is dark, so dark grey text sits on a bright photo / thin scrim, about 1.5:1, unreadable on the bright tiles. Not a fixture issue: the token pairing is wrong in dark. Rest of state 1 matches both themes (group "In the name or tags", offer card with Turn on…).
- ia-assets-tidy · VERIFIED (both) · none. Not used chip on, one-line foot with Move N to the trash…. "Not counted" note and Video / Generated groups are data-conditional.
- ia-asset-details · VERIFIED (both) · none. Back crumb, More, cover, name, Size, Added, Place ↵, Advanced. AI-saw chips, avatar, Used in rows are data-conditional.
- ia-photo-inspector · DIFFERS (both) · MUST: same root cause as ia-placed, the four action buttons are mono where the board is sans. The rest matches: Placement Fill/Fit/Crop, Look tiles, Light/Colour tracks, Remove background, Replace… / Reset, "Only this use changes", Apply to every use…, Advanced.
- ia-photo-steps · VERIFIED (both, crop column) · none. Crop mode tag "photo · crop", ↵ done · esc cancel, Placement › Crop active, "The whole photo stays — only the frame moves." The mono action buttons in the inspector are not part of the board's column (polish, same root cause).
- ia-gen-ask · UNREACHABLE (board state) · needs a configured BYOK provider (AI island with cost line and SynthID line); inline card deferred by v2-p8-c9-ask-stays-inline.
- ia-gen-placed · UNREACHABLE · AI generation result.
- ia-figma-sheets · VERIFIED (both, sheets 1-2) · none. Link field with visible focus ring, "Figma isn't connected yet" row with Connect…, FigJam line, Cancel / Import disabled.
- ia-figma-sheets-connect · VERIFIED (both) · none. Four-step text, Access token field, keychain line, Cancel / Connect (disabled until a token is typed).
- ia-figma-arrived · UNREACHABLE · Figma API stub.
- ia-figjam · UNREACHABLE · FigJam fixture.
- ia-brand-steps · VERIFIED (both) · none. Chosen logo legible in both themes, Website field with focus ring, helper line, Cancel / Import. Reading (-2) and failed-site (-3) columns match in both themes (side rows).
- ia-brand · UNREACHABLE · readable site / recorded brand-read fixture.
- ia-missing · UNREACHABLE · two-peer sync fixture.
- ia-missing-gone · VERIFIED (both) · none. Hatched frame + warning card with Relink…, inspector Missing box with Relink… / Replace…. Second-person line is a side row.
- ia-edges · UNREACHABLE · nine separate conditions.
- ia-advanced · VERIFIED (both) · none. Stored as / In canvases + Copy, "kept open" chip. Original / Edits / Cut-out rows and the Terminal command card are conditional on original-path / edit data the fixture photo lacks.

## Polish list

- ia-drop-photos · chip says "Drop to fill 6 empty frames in order" (board "Drop to place 6 photos in <artboard>"); left panel on Canvases, not Assets; no OS drag ghost (harness limit).
- ia-assets-find · scrim fade is thin on very bright tiles even in light (name legible; only the dark pairing is a MUST).
- ia-assets-tidy · all unused tiles listed per group (board shows a 6-tile sample); foot drops the size in a narrow panel (decision).
- ia-asset-details · "Place" without the artboard name when nothing is selected; no cover crop of canvases (fixture).
- ia-photo-inspector · "Remove background" plain, board accent-outlined; header is the sha name (data); Light/Colour read 0 (fixture); Look selected Original vs Punchy (fixture).
- ia-photo-steps · "4:5 · from the artboard" pill not built (14 owns the tag words); crop frame is the whole photo, no dimmed surround; the size tag is partly under the hint chip; mono action buttons in the inspector (same cause as the ia-placed MUST).
- ia-figma-sheets · accent focus ring on the link field (board caret only); placeholder instead of typed link (fixture).
- ia-brand-steps · extra "Choose logo file…" button beside the chosen logo (needed so the picker is keyboard-operable; board says "or drop another"); logo drawn smaller in its tile; "1 colour" vs "4 colours" and the warning wording are fixture.
- ia-brand-steps/-3 · amber warning glyph in the callout vs board neutral (shade).
- ia-brand-steps/-2 · progress bar is an indeterminate sweep (board freezes at ~45 %).
- ia-gen-ask · "4 variants" select looks native; inline card instead of island (lead decision).
- ia-missing-gone · card line red (board neutral grey in the inspector card); impl shows the Image-kind inspector sections (per 14).
- ia-advanced · fold pinned to the foot over a gap (same as board).
- ia-assets-browse · "Place 6 in Hero" without the "Fotky ze zápasu" artboard (fixture); group heading is a date, not an event name (fixture).

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
- ia-brand-steps/reading · column 2 (Reading…, progress, "Usually under 10 seconds…") · reachable, shot, matches both themes
- ia-brand-steps/site-did-not-answer · column 3 (callout + Try again + Continue with the logo) · reachable, shot, matches both themes
- ia-missing-gone/second-person-line · "Added by Tereza on 1 Oct…" · unreachable (second person)
- ia-advanced/terminal-card · "Import the same way from Terminal" · reachable with an original-path fixture, not shot
