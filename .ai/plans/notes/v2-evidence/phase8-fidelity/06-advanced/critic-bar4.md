# critic-bar4 — 06 Advanced against the "verified" bar (v2-michal-verified-bar), D6 shots on merged tip 3d58f57df

_Source: the D6 pairs `<id>-<theme>.jpg` (both themes read for every id), the D6 full-size impl frames + spec images (last line of `full-size-path.txt`), the board `.design/ui/v2/06 Advanced.tsx` (+ 08 `ak-advanced`), critic-bar3, fix-c7-oboard (round 8), fix-c8-video. Read-only, no new shots._

Lead decisions honoured (a board item they overrule is POLISH, not MUST): owning board wins (07 timeline raw keys + islands above the dock, 09 owns the export sheet, 11 owns the Version history seg / Restore row, 03 owns the AI fold, 08 owns the artboard Advanced sections), `nothing-deleted.json` rows at ad-left (Open canvas, Trash Empty/Open), toast dock/top rule, Hidden files has no H key (H is Hand), music Fade not built, Always-allowed not built, Settings Privacy / Decision memory / Faster canvas engine = C34 no store, ad-ds specimen view superseded by 13, provenance clause needs a server signal.

Summary: 3 verified (both themes), 11 differ, 11 unreachable. (25 ids.) The round-8 fixes for ad-settings (Engines selects, Reset row), ad-logs (no Refresh), ad-edge-syntax (ghost boards, no Reload link), ad-search (one Close all), ad-timeline (no "Video" label collision) are visible in the pairs. **Six of the 11 remaining MUSTs are harness states from `s06j`/`s06h` that are NOT in the D6 frames** (ad-left toggles ON, ad-diag Advanced row open, ad-history version selected, ad-code panel, ad-search query "copy", ad-inspector/ad-export tall window): the D6 chain used the older layer, so the shots, not the product, are what is missing.

## Per id
- ad-open-all · VERIFIED (both themes) · none. Canvases fold open (Show file names, Show hidden files, Open canvas, Folder, Design system, Trash), kit toast docked above the toolbar "All Advanced sections are open." + accent "Close all"; tokens flip, no overflow. Inspector / Share / AI folds are not on screen because those panels are closed in the app state → polish (e2e).
- ad-logs · VERIFIED (both themes) · none. Diagnostics dialog: Logs with the All / Sync / Server / AI / Export chips, Filter, Copy all, Show in Finder (no Refresh any more), highlighted warning row, "Kept 7 days…" foot; Server card (Showing, Live connection, Address, Version) and AI setup card present. Title row + x, Process / Project folder rows, Needs-setup cards = deviation / fixture.
- ad-edge-syntax · VERIFIED (both themes) · none. Card (icon, "Broken can't be drawn right now.", sentence, Ask AI to fix it), Advanced open with Error / Where (copy) / excerpt with red gutter + caret, Open in editor / Copy error / Last good version; three dashed ghost boards behind; no Reload link; left panel closed. Provenance clause needs a server signal → polish.
- ad-inspector · differs · the shot is the Advanced fold of a TEXT element scrolled mid-panel: only CSS + Element id + Copy CSS / Copy style / Paste style / Copy code (cut at the panel foot) are in frame. The board's Element block (Tag, Classes, Selector), "Used in" (Edits apply to · Detach) and "Tokens bound" are not visible; the artboard card (Exact size … In code) is a side state. Shot must show the fold's top (scroll to the Advanced header or a button selection). Same in both themes.
- ad-left · differs · the board's main frame is Show file names ON + Show hidden files ON (file names under every row, dimmed supporting files, `_canvas-state/`). The D6 shot has both switches OFF, so the behaviour the board draws is not demonstrated (the c8 harness turns them on but the D6 chain did not use it). Re-shoot with both on.
- ad-ai · unreachable · finished AI run (Model, Effort, Fast mode, Ask before, Context 38 %, 5-hour limit, Session id). The shot's fold (Show in chat, Suggestions, AI may rows, This chat, Raw log / Copy transcript / Open in terminal) matches 03's owning board. e2e.
- ad-share · unreachable · the board's card is cloud-linked (people, link rules, invite, Where it syncs). Local card is drawn correctly (App link, This Mac only) with an extra "Open in the Mac app" link → polish.
- ad-timeline · differs · (1) fixed: the "Video" lane label no longer collides with "beat-three"; (2) keyframe diamonds on the clip lanes + the Keyframe card's easing / y / frames readout and the per-clip frame counts ("162f") are not drawn: the shot has a fixture without keyframes, so the Keyframe card sits in its empty state ("Pick a keyframe on a clip") (reachable: re-shoot with a keyframed clip); (3) the cut-as-code card is empty ("Pick a clip") where the board shows a filled EDL. Raw keys, islands above the dock, Poster pill, extra Render settings rows = 07 owns → deviation. Light clip fill near-black = missing footage in the fixture → polish.
- ad-export · differs · the open Advanced body has the two columns (Image / Print PDF) and the Folders row with the live name preview, but the board's "From the terminal" block (maude design export …, Claude Code /design:export, AI handoff) is not in frame (09's own critic confirms the commands exist below the crop). Re-shoot taller or scrolled. Exact scale "1" vs board "2.5×", Paper / Background / JPG quality rows = 09 owns → deviation.
- ad-history · differs · no version is selected, so "Changed in this version" (commit id, changed files with +/-, diff excerpt) is not drawn; the shot shows "Now" + "Version history starts here". Branch / Drafts / Remote / git actions match; Seg + Restore row = 11 owns. Reachable with a second version selected.
- ad-ds · differs · the Design system inspector's Advanced fold is CLOSED in the shot ("Advanced · Tokens · files"), so Folder, Tokens file, Code, Copy token names and Open in editor are not shown. The specimen view itself is superseded by 13 (the DS canvas is the default view) → deviation. Open the fold and re-shoot.
- ad-menus · unreachable · native menu bar (desktop e2e lane).
- ad-diag · differs · Diagnostics submenu open with Sync / Server / AI setup / Logs / Reload canvas / Check AI setup again, but its Advanced row is still a closed chevron: Address, Process, Project folder (Resync now / Download all hidden for a local project) are not on screen. Open the Advanced row and re-shoot. Extra Switch project row, no Search row / Help dot = 11's menu → polish.
- ad-syncd · unreachable · needs a cloud-linked project in trouble; the shot is the Logs dialog, not Sync details.
- ad-settings · differs · Advanced tab: This Mac / Claude Code / Engines (Subtitles + Video keyframes selects, one model box at a time) / This project / Experimental / Reset match the board. Remaining: (1) "Reset all settings…" is a neutral button in both themes (board: danger red; the fix note says red) — token / destructive cue missing; (2) Privacy (usage data, Logs in bug reports) and Decision memory are not in the frame (below the dialog's fold; usage data / Remember decisions rows are C34 not built); (3) This project is the not-linked line (local fixture). Reach Privacy + Decision memory by scrolling the dialog and confirm the red.
- ad-pinned · differs · docked flush panels with the Advanced at the foot match (left fold at the foot, right panel Exact size · Look and layout · In code), but (1) the dock handle bars the board draws between the panels and the canvas are not visible; (2) the artboard fold carries a Kind select and a Clip content switch the board draws nowhere (08's ak-advanced list has neither; builder note keeps Kind as the only place a board's kind is switched) — needs a lead decision or a home; (3) In code is the DCArtboard snippet (08 · ak-advanced, which wins) where 06's pinned frame draws Element id + CSS rows → deviation. Closed-fold hint "Files, folder, Trash" absent → polish.
- ad-search · differs · ⌘K shows the "advanced" query (33 hidden tools, 18 results), one "Close all Advanced sections" (fixed). The board's query is "copy" with its Ask AI row; the list is clipped at the Settings group so the Ask AI row and the "Also" group end are not in frame, and the c8 harness query "copy" was not used. Re-shoot with "copy" or scrolled to the end. The shortcuts sheet half is a side state.
- ad-code · differs · the read-only code panel never opens: the shot is the ⌘K palette (query "code") with "Copy code" selected. Panel (path, Read only, Copy, Open in editor, highlighted lines, Advanced From the terminal + In Claude Code) not shown. Reachable (View code + Enter).
- ad-edge-sync, ad-edge-hub · unreachable · hub / cloud-in-trouble fixture.
- ad-edge-where, ad-edge-remember · unreachable · viewer-origin / comment-only / offline fixtures; multi-day per-Mac memory story.
- ad-map, ad-why, ad-trace · unreachable · documentation boards, no app surface.

## Polish list
- ad-open-all · Inspector / Share / AI Advanced folds not in frame (those panels are closed); ⌘K palette frame not part of the shot
- ad-logs · title row "Diagnostics" + close x (a name and a way out); extra Process and Project folder rows in the Server card; Needs-setup cards and warning wording (fixture); Version 1.9.1 vs 2.0.0 · build 412 (fixture)
- ad-edge-syntax · provenance clause ("changed outside the app 2 min ago", "stops halfway on line 212") needs a server signal; fixture file `Broken.tsx` and error text; error line wraps
- ad-left · "Open canvas" row and Trash Empty/Open inside the fold (contract rows, nothing-deleted.json, drawnAt ad-left); no H chip on Show hidden files (H is Hand); Folder `/tmp/…`, "Make a design system" vs `system/alligators Open` (fixture); foot "12 of 12 shown · updated just now" wraps beside Refresh; What's-new toast over the canvas
- ad-share · app link / This Mac only values truncated in bordered boxes; extra "Open in the Mac app" link
- ad-ai · Show in chat / Suggestions order; Images / video / voice block absent (03 decision)
- ad-timeline · raw keys fps / durationInFrames / codec / bitrate / colour and the islands above the dock (07 owns); Poster pill on the ruler; light-theme black clips (fixture footage missing); clip chips transparent in dark
- ad-export · two columns, Paper / Background / JPG quality / Registration marks rows, "Size by Scale | dpi", Exact scale "1" (09 owns); preview line sits in the Folders row
- ad-history · Seg + Now row + Restore row (11 owns); local project vs git-backed with remote fixture; "Name this version…" link
- ad-ds · "Advanced · Tokens · files" wording until 13's specimen view is the Advanced layer
- ad-diag · Sync "Local project" / AI setup "Needs setup" (fixture); extra Switch project row, no Search row / Help dot (11's menu)
- ad-inspector · fold sits lower than the board (≈20 rows above vs 5); element is a text element, board a button
- ad-search · query "advanced" vs "copy" (fixture), 33 hidden tools vs 6
- ad-settings · Update "Up to date" vs "2.0.1 is ready" (fixture); Version 1.9.1; Local server port / Runtime values
- ad-pinned · closed-fold hint "Files, folder, Trash" absent; Theme "Follow chrome" vs "DS default"; the Export card rows are in the inspector above the fold (board omits)
- ad-code · Settings group rows below the palette list (registry has more matches than the board)

## Side states
- ad-inspector/closed · Advanced closed card · reachable, not in frame
- ad-inspector/button · button card with Element / Used in / Tokens bound / CSS · reachable, not in frame (counted in the main id)
- ad-inspector/artboard · artboard Advanced (Exact size, Resolution, Colour, Guides, Look and layout, In code) · reachable, not in frame
- ad-left/closed · board frame "Closed" · reachable (fold shut)
- ad-left/row-menu · context menu on Combine-kampan (Reveal in Finder, Open in editor, View code, Copy file path, Rename file…) · reachable, not in frame
- ad-left/trash · Trash view with Restore + "Clear out older than 30 days…" · reachable, not in frame
- ad-left/layers-advanced · Layers fold (Show tags and ids, On this canvas, Select by selector, Element id) · reachable; `extra-impl-ad-left-layers` frame exists (Show tags and ids, On this canvas, Select by selector present; no Element id row visible), not a pair
- ad-ai/closed · closed card · reachable
- ad-ai/long-version · 03 ai-advanced reference card · reachable (owned by 03)
- ad-share/closed · closed card · unreachable (needs people)
- ad-timeline/closed · closed timeline · reachable
- ad-export/closed · board frame "Closed" · reachable
- ad-export/also-under-export · Exports list + Print PDF card + Other formats cards · reachable, not in frame
- ad-history/closed · board frame "Closed" · reachable
- ad-ds/how-you-get-here · Canvases › Advanced Design system row + ⌘K "design system" card · reachable, not in frame
- ad-logs/reload-pill · "Combine-kampan reloaded." pill · reachable (reload event), absent
- ad-pinned/move-chip · "Drag · double-click resets · ← → move 8" chip on handle hover · reachable, not in frame
- ad-search/shortcuts-sheet · Keyboard shortcuts sheet with Advanced keys + "Keys and tools that moved" · reachable, not in frame
- ad-open-all/palette · ⌘K "advanced" with Open all / Close all hits · reachable (the ad-search frame shows the same list)
- ad-edge-syntax/closed · card with Advanced collapsed · reachable
