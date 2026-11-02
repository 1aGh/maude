# critic-bar3 — 06 Advanced against the "verified" bar (v2-michal-verified-bar), D5 shots on the merged tip

_Source: D5 pairs `<id>-<theme>.jpg` (both themes read for every id), D5 impl frames + spec images at the last line of `full-size-path.txt` for the borderline ones, the board `.design/ui/v2/06 Advanced.tsx`, critic-bar2, fix-c7-oboard. Read-only, no new shots._

Lead decisions honoured (a board item they overrule is POLISH, not MUST): owning board wins (07 timeline raw keys + panels above the dock, 09 owns the export sheet, 11 owns Version history seg / Restore row, 03 owns the AI fold, 14/08 own the inspector), `nothing-deleted.json` rows drawn at ad-left (Open canvas, Trash Empty/Open), "Canvases panel is quiet by state" (Trash row + foot only as state), toast dock/top rule, Hidden files has no H key (H is Hand), music Fade not built, Always-allowed row not built (no store).

Summary: 1 verified (both themes), 13 differ, 11 unreachable. (25 ids.)

## Per id
- ad-open-all · VERIFIED (both themes) · none. Canvases fold open (Show file names, Show hidden files, Folder, Design system, "kept open" chip), kit toast docked above the toolbar "All Advanced sections are open." + accent "Close all", all tokens flip, no overflow. Inspector / Share / AI folds are not on screen (those panels are closed in the shot) → polish, e2e confirms.
- ad-inspector · differs · the open Advanced body (artboard `Post` text element) starts at CSS then Element id + actions; Tag / Classes / Selector, "Used in" (Edits apply to / Detach) and "Tokens bound" rows are not in the frame (panel cut at Copy code, scroll mid-panel) — board draws all of them; shot must scroll the fold into full view or the rows are missing.
- ad-left · differs · the board's main frame is Show file names ON + Show hidden files ON (tree with file names under each row, dimmed `_history` / supporting files, `_canvas-state/` at the root); the shot has both switches OFF so the behaviour the board draws is not demonstrated (toggle both on and re-shoot).
- ad-ai · unreachable · the board's state is a finished AI run (Model Opus, Effort, Fast mode, Ask before, Context 38 %, 5-hour limit 64 %, Session id) — needs a configured agent run. What is drawn matches the owner (03): Show in chat, AI may rows, Folders AI may read, Raw log / Copy transcript / Open in terminal carry glyphs. Images / video / voice block and "Suggestions" row are 03's decisions (S5.17b). Verify in e2e.
- ad-share · unreachable · the board is a cloud-linked card (people, link rules, invite, "Where it syncs") = hub + second person. Local-project card is drawn correctly (Advanced "kept open", App link, This Mac only, "Opens the folder on this Mac only.") but has an extra "Open in the Mac app" link the board has not.
- ad-timeline · differs · (1) lane gutter collides with the clip text — "Video" label overprinted by "beat-three" in BOTH themes (text overlap, a11y/layout); (2) keyframe diamonds + Easing readout/curve not drawn (the Keyframe card sits empty, "Pick a keyframe on a clip" — fixture has no keyframe; reachable); (3) light: the three beat clips are solid near-black (clip fill does not flip with the theme, board has coloured clips). Raw keys (fps / durationInFrames / codec) and the islands above the dock follow 07 → deviation.
- ad-export · differs · File names pattern with the live preview and the "From the terminal" blocks (maude design export …, Claude Code /design:export, AI handoff) are not in the Advanced body — 09's board draws both, so not an owner conflict; Exact scale is a plain field `1` + "×" (board 2.5×). Two-column body, "Size by Scale | dpi" and the extra Paper / Background rows follow 09 → deviation.
- ad-history · differs · the selected-version state the board draws — "Changed in this version" (file list with +/- counts, diff excerpt) — is absent: the shot selects "Now" with one version, so the changed-files block never renders (reachable with a second version selected). Branch / Drafts / Remote / git actions match. Seg + Restore row = 11 → deviation.
- ad-ds · differs · the board is the Design system › Advanced specimen view (colours, type, components, Advanced folder / tokens file / code, Copy token names, Open in editor); the app draws the DS inspector card (Check the system, Which way changes flow, Version history). The specimen view has not landed (13).
- ad-menus · unreachable · native menu bar (desktop-e2e lane).
- ad-diag · differs · the Diagnostics submenu is open but its Advanced row is a closed chevron: Address, Process, Project folder, Resync now, Download all (board ③, drawn open) are not on screen; the shot must open the Advanced row. Sync "Local project" / AI setup "Needs setup" are fixture (polish). The project-menu Search row + Help dot the board draws are 11's menu (polish).
- ad-logs · differs · an extra Refresh icon in the Logs header (the board has Filter, Copy all, Show in Finder only). Dialog title + close x kept (name and a way out) = deviation. Wrap of "Copy all" / "Show in Finder" onto two lines = polish.
- ad-syncd · unreachable · needs a cloud-linked project in trouble (the shot is the Logs dialog, not Sync details).
- ad-settings · differs · Advanced tab is now shown, but Engines is drawn as a radio-card list + models block instead of the board's Subtitles / Video keyframes selects with whisper.cpp / Gemma rows; "Reset all settings…" (red) is missing from Reset; Privacy (usage data, Logs in bug reports) and Decision memory are below the clipped fold so not confirmable; an extra "Open now, on this Mac" switch list is not in the board (V2-4.10 model — needs a recorded decision or the board).
- ad-pinned · differs · panels are docked flush with their Advanced at the foot (matches), but the artboard inspector's Advanced body shows Theme / Clip content / Kind select + raw `kind digital` / width / height rows; the board draws Exact size (Artboard 1080 × 1080 px), Look and layout (Theme), In code (Element id, CSS rows). The duplicated Kind rows are extra. The "Drag · double-click resets · ‹ › move 8" chip is a side state.
- ad-search · differs · "Close all Advanced sections" appears twice (Also + Settings groups); the list scrolls and the last row (Ask AI — ⌘↵) is not in the frame, so the board's Ask AI row is unconfirmed (re-shoot scrolled to the end or with the board's query "copy").
- ad-code · differs · the read-only code panel never opens (path, Read only, Copy, Open in editor, highlighted lines, the From the terminal + In Claude Code blocks); the shot stays on the ⌘K palette with "View code" selected. Reachable.
- ad-edge-sync, ad-edge-hub · unreachable · hub / cloud-in-trouble fixture.
- ad-edge-syntax · differs · (1) the dimmed last-good boards behind the card (three ghost rectangles) are not drawn; (2) an extra "Reload canvas" link under the actions row. The card, Ask AI to fix it, Error / Where / excerpt with caret, Open in editor / Copy error / Last good version match in both themes. The provenance clause ("changed outside the app 2 min ago…") needs a server signal → polish.
- ad-edge-where, ad-edge-remember · unreachable · viewer-origin / comment-only / offline fixtures; multi-day per-Mac memory story.
- ad-map, ad-why, ad-trace · unreachable · documentation boards, no app surface.

## Polish list
- ad-left · "Open canvas" row and Trash Empty/Open inside the fold: contract rows (`nothing-deleted.json`, drawnAt ad-left) → deviation, kept
- ad-left · no "H" key chip on Show hidden files (H is Hand) → deviation
- ad-left · Folder value `/tmp/…`, "Make a design system" instead of `system/alligators Open` (fixture, no DS); foot "11 of 11 shown · updated just now" wraps beside Refresh
- ad-left · different canvas list / thumbnails per theme (fixture)
- ad-share · app link / This Mac only truncated in bordered boxes; extra "Open in the Mac app" link
- ad-ai · Show in chat / Suggestions order, Images / video / voice block absent (03 S5.17b decision)
- ad-timeline · raw keys fps / durationInFrames / codec + islands above the dock (07 owns)
- ad-export · two columns, Paper / Background rows, "Size by Scale | dpi" (09 owns)
- ad-history · Seg + Now row + missing Restore row (11 owns); local project vs git-backed with remote fixture
- ad-ds · "Advanced · Tokens · files" fold wording until the specimen view lands
- ad-diag · Sync / AI setup status words (fixture); project menu without Search row / Help dot (11's menu)
- ad-logs · Needs-setup card, larger "All checks", Version 1.9.1 / Process / Project folder rows, "Copy all" / "Show in Finder" wrapping onto two lines
- ad-logs · dialog title row + close x (needed for a name and a way out)
- ad-inspector · fold sits lower than the board (≈20 rows above vs 5); element is a text element, board a button
- ad-search · query "advanced" vs board "copy" (fixture); count 33 hidden tools vs 6
- ad-edge-syntax · left panel open (board closed); fixture file `Broken.tsx`, error text
- ad-open-all · Inspector / Share / AI panel folds not in frame (panels closed)
- ad-settings · Update "Up to date" vs "2.0.1 is ready" (fixture); version 1.9.1

## Side states
- ad-inspector/closed · Advanced closed card · reachable, not in frame
- ad-inspector/button · button card with Element / Used in / Tokens bound / CSS · reachable, not in frame (counted in the main id)
- ad-inspector/artboard · artboard Advanced (Exact size, Resolution, Colour, Guides, Look and layout, In code) · reachable, not in frame
- ad-left/closed · board frame "Closed" · reachable (fold shut)
- ad-left/row-menu · context menu on Combine-kampan (Reveal in Finder, Open in editor, View code, Copy file path, Rename file…) · reachable, not in frame
- ad-left/trash · Trash view with Restore + "Clear out older than 30 days…" · reachable, not in frame
- ad-left/layers-advanced · Layers fold (Show tags and ids, On this canvas, Select by selector, Element id) · reachable; `extra-impl-ad-left-layers` frame exists, not a pair
- ad-ai/closed · closed card · reachable
- ad-ai/long-version · 03 ai-advanced reference card · reachable (owned by 03)
- ad-share/closed · closed card · unreachable (needs people)
- ad-timeline/closed · closed timeline · reachable
- ad-export/closed · board frame "Closed" · reachable
- ad-export/also-under-export · Exports list + Print PDF card + Other formats cards · reachable, not in frame
- ad-history/closed · board frame "Closed" · reachable
- ad-ds/how-you-get-here · Canvases › Advanced Design system row + ⌘K "design system" card · reachable, not in frame
- ad-logs/reload-pill · "Combine-kampan reloaded." pill · reachable (reload event), absent
- ad-pinned/move-chip · "Drag · double-click resets · ‹ › move 8" chip · reachable, not drawn
- ad-search/shortcuts-sheet · Keyboard shortcuts sheet with Advanced keys + "Keys and tools that moved" · reachable, not in frame
- ad-open-all/palette · ⌘K "advanced" with Open all / Close all hits · reachable (the ad-search frame shows the same list)
- ad-edge-syntax/closed · card with Advanced collapsed · reachable
