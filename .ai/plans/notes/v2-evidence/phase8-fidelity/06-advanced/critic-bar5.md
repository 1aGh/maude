# critic-bar5 — 06 Advanced against the "verified" bar (v2-michal-verified-bar), D7 shots (harness commit 6d062a4d3, after round 10)

_Source: the D7 pairs `<id>-<theme>.jpg` (both themes read for every reachable id; full-size D7 frames opened for ad-inspector, ad-search, ad-timeline, ad-history), critic-bar4b, fix-c7-oboard (rounds 7-10), INDEX D7 section, the Advanced slots in `client/v2/inspector/advanced.jsx`. Read-only, no new shots._

Lead decisions honoured (a board item they overrule is POLISH): owning board wins (07 timeline raw keys + islands, 09 export sheet, 11 Version history seg / Restore row, 13 DS Advanced, 08 artboard Advanced, 14 object-inspector order), nothing-deleted rows at ad-left, Hidden files has no H key, music Fade / Always-allowed / Settings Privacy + Decision memory = not built, Engines as selects, Reset = one row of three buttons (Reset all settings… red), ghosts from canvas layout, provenance clause needs a server signal, v1 raw editor + Inspect facts kept last (nothing-deleted).

Summary: 14 verified (both themes), 0 differ, 11 unreachable (25 ids). All three bar4b MUSTs are closed in the D7 shots.

## Per id
- ad-open-all · VERIFIED (both themes) · none.
- ad-logs · VERIFIED (both themes) · none. Chips, Filter, Copy all, Show in Finder, highlighted warning row, 7-day foot, Server + AI setup cards.
- ad-edge-syntax · VERIFIED (both themes) · none. Card, Advanced open (Error, Where + copy, excerpt with red gutter), Open in editor / Copy error / Last good version, ghost boards, no Reload link.
- ad-inspector · VERIFIED (both themes) · none. The old POS/SIZE/FILL/TEXT/FONT facts are gone from the Element group (now last slot, after the raw editor, out of frame). Element = Tag / Selector (no Classes on a text element = fixture), Used in, CSS with Edit as text / + Property / + Attribute, Element id with copy glyph, Copy CSS / Copy style / Paste style / Copy code. Order is 14's (CSS, id, actions, then Element, Used in), a lead decision. "Tokens bound" is absent because the fixture element binds no tokens.
- ad-left · VERIFIED (both themes) · none. Show file names + Show hidden files ON now draws the one tree: file name under each canvas row, dimmed sidecar rows (`Cut.meta.json`, `Smoke.meta.json`), Trash, fold (Show file names, Show hidden files, Open canvas, Folder, Design system, Trash Empty/Open, 11 of 11 shown, Refresh).
- ad-ai · UNREACHABLE · needs a finished AI run (Model, Effort, Context 38 %, 5-hour limit, Session id). Present rows (Show in chat, Suggestions, AI may, This chat, Raw log / Copy transcript / Open in terminal) match 03. e2e.
- ad-share · UNREACHABLE · cloud-linked card (people, link rules, invite, Where it syncs) needs a hub + a second person. Local card correct. e2e.
- ad-timeline · VERIFIED (both themes) · none. Keyframed fixture: diamonds on the clip lanes, Easing / Keyframe card (curve, easing, opacity, frames, Straight line, Copy timecode), filled "The cut as code" (EDL | Code), Render settings with 07's raw keys, Timecode | Frames seg, ruler in frames, "Advanced · kept open" foot. Islands over the dock = 07 owns.
- ad-export · VERIFIED (both themes) · none. 09-owned sheet: Size by Scale | dpi, Exact scale, Colour profile, JPG quality, Background, Print PDF part, File names pattern + tokens + live example, "The same export from a terminal" (Terminal + Claude Code, Copy).
- ad-history · VERIFIED (both themes) · none. Version selected: banner, filter seg, Now row, Restore + Compare, Advanced open (Project, Branch, Drafts Continue / Dismiss, Remote + Copy, Changed in this version with diff). The git actions and "Not in a version yet" sit below the panel's scroll clip (`git-advanced.jsx` draws them; on screen in the D6 shot).
- ad-ds · VERIFIED (both themes) · none. 13's Advanced fold (CSS | JSON token block, Files, Hand off tokens, Reveal in Finder); the board's specimen view is superseded by 13.
- ad-menus · UNREACHABLE · native menu bar (desktop e2e).
- ad-diag · VERIFIED (both themes) · none. Diagnostics submenu with its Advanced row open (Address, Process, Project folder); Resync now / Download all hidden for a local project (board's "where it hides").
- ad-syncd · UNREACHABLE · cloud-linked project in trouble; needs a hub.
- ad-settings · VERIFIED (both themes) · none. Three columns, Engines selects, Reset one row with "Reset all settings…" now red in both themes (the D6b neutral button is fixed).
- ad-pinned · VERIFIED (both themes) · none. Left panel + artboard Advanced docked flush; Exact size · Look and layout (Kind, Clip content) · In code (08 wins).
- ad-search · VERIFIED (both themes) · none. "copy" lists Copy export command (Export › Advanced), Copy file path, Copy logs, Copy code / CSS / element id (disabled with no selection), the Also group, Ask AI row. "Copy transcript" needs an AI chat, so it is absent here by design (reachable only with a chat).
- ad-code · VERIFIED (both themes) · none. Read-only panel (path, Read only, Copy, Open in editor, marked lines highlighted, Advanced: From the terminal x3, In Claude Code x2).
- ad-edge-sync, ad-edge-hub · UNREACHABLE · hub / cloud-in-trouble fixtures.
- ad-edge-where, ad-edge-remember · UNREACHABLE · viewer-origin / comment-only / offline contexts; per-Mac memory story.
- ad-map, ad-why, ad-trace · UNREACHABLE · documentation boards, no app surface.

## Polish list
- ad-open-all · Inspector / Share / AI folds not in frame (panels closed)
- ad-logs · title row "Diagnostics" + close x; extra Process / Project folder rows; Needs-setup cards and Version 1.9.1 (fixture)
- ad-edge-syntax · provenance clause needs a server signal; fixture file `Broken.tsx` + error text; no tool dock under the card
- ad-inspector · fold sits lower than the board and the scoped Selector wraps to five lines; v1 raw editor (LAYOUT · display · Auto layout) shows under the fold, kept by nothing-deleted; Inspect facts last / below the frame; element is a text element (no Classes, no Tokens bound: fixture)
- ad-left · flat list of 11 canvases instead of the board's folder tree (fixture); `_history/` and `_canvas-state/` drawn once at the root, not under each canvas; "Open canvas" row + Trash Empty/Open inside the fold (nothing-deleted); no H chip (H is Hand); Folder `/tmp/…`, "Make a design system" wraps; foot "11 of 11 shown · updated just now" wraps beside Refresh
- ad-timeline · raw keys + islands above the dock (07); per-clip frame counts ("162f") not drawn; Poster pill on the ruler; clips near-black in light (missing footage fixture)
- ad-export · two columns, Paper / Background / JPG rows, Exact scale "1", File names with token chips (09 owns); no "AI handoff" line; sheet title says "5 artboards" with nothing selected (fixture)
- ad-history · Seg + Now row + Restore row (11 owns); Project and Compare rows inside the fold (S1.15); Remote / Drafts values clip at the left; git actions below the scroll clip
- ad-ds · Folder / Tokens file / Code rows replaced by 13's Files tree + Hand off tokens; "Used by · No canvases yet" and DS "maude" vs "alligators" (fixture, deferred feature)
- ad-diag · Advanced is a flyout, not an in-place fold; Sync "Local project" / AI setup "Needs setup" (fixture); extra Switch project row, no Search row / Help dot (11's menu)
- ad-settings · Update "Up to date", Version 1.9.1, Local server port / Runtime values (fixture); Subtitles "Local whisper.cpp" vs "Auto"; Privacy / Decision memory / Faster canvas engine not built (C34)
- ad-pinned · closed-fold hint "Files, folder, Trash" absent; Theme "Follow chrome" vs "DS default"; Kind + Clip content under Look and layout; In code is the DCArtboard snippet (08 wins)
- ad-search · 17 results vs the board's 7 (registry has more copy actions); Copy code / CSS / element id dimmed with no selection
- ad-code · panel wider than the board's, extra "Artboard post is marked · lines 15–23" line

## Side states
- ad-open-all/palette · ⌘K "advanced" with Open all / Close all + Places · reachable, not in frame
- ad-inspector/closed · closed card ("Code, tokens, CSS") · reachable, not in frame
- ad-inspector/button · button card with Classes / Tokens bound · reachable (needs a button selection), not in frame
- ad-inspector/artboard · artboard Advanced (Exact size, Resolution, Colour, Guides, Look and layout, In code) · reachable, not in frame
- ad-left/closed · closed fold frame · reachable
- ad-left/row-menu · context menu on a canvas row (Reveal in Finder, Open in editor, View code, Copy file path, Rename file…) · reachable, not in frame
- ad-left/trash · Trash view with Restore + "Clear out older than 30 days…" · reachable, not in frame
- ad-left/layers-advanced · Layers fold (Show tags and ids, On this canvas, Select by selector, Element id) · reachable; `extra-impl-ad-left-layers` frames exist
- ad-ai/closed · closed card · reachable
- ad-ai/long-version · 03's ai-advanced reference card · reachable (03 owns)
- ad-share/closed · closed card · unreachable (needs people)
- ad-timeline/closed · closed timeline · reachable
- ad-export/closed · closed sheet · reachable
- ad-export/also-under-export · Exports list + Print PDF + Other formats cards · reachable, not in frame (09 owns)
- ad-history/closed · closed card · reachable
- ad-ds/how-you-get-here · Canvases › Advanced Design system row + ⌘K "design system" card · reachable, not in frame
- ad-logs/reload-pill · "Combine-kampan reloaded." pill · reachable (reload event), absent
- ad-pinned/move-chip · "Drag · double-click resets · ← → move 8" chip on handle hover · reachable, not in frame
- ad-search/shortcuts-sheet · Keyboard shortcuts sheet with Advanced keys + "Keys and tools that moved" · reachable, not in frame
- ad-search/copy-transcript · "Copy transcript · AI chat panel › Advanced" row · reachable only with an AI chat
- ad-edge-syntax/closed · card with Advanced collapsed · reachable
- ad-diag/resync-download · Sync Resync now / Download all · unreachable on a local project (needs a linked hub project)
