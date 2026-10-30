# critic-bar2 — 06 Advanced re-read against the "verified" bar (v2-michal-verified-bar)

_Source: critic-final.md (D2, d3881fe41) + committed pairs (read: share, logs, history, edge-syntax, search, left, export dark). No new shots. Read-only._

Summary: 1 verified (both themes), 14 differ, 10 unreachable.

## Per id
- ad-open-all · VERIFIED (both themes) · none
- ad-inspector · differs (cannot confirm) · open fold body (Element / Used in / Tokens bound / CSS / Copy code) not in frame; fold sits under ~20 rows, board under 5 (order/anchoring)
- ad-left · differs · extra "Open canvas" row and Trash Empty/Open row inside the fold (board: Show file names, Show hidden files, Folder, Design system)
- ad-ai · differs · selects not the 140x28 kit select; "AI may" heading orphaned above Folders row; Raw log / Copy transcript / Open in terminal without glyphs; composer is the 03 shape; Model/Effort/Fast/Ask before/Images/Context/5-hour rows absent (needs a configured agent run — that part unreachable)
- ad-share · unreachable · board draws a cloud-linked card (people, link rules, invite, "Where it syncs") = hub + second person; local-project card also has an extra "Open in the Mac app" line (check in e2e)
- ad-timeline · differs · raw keys (fps, durationInFrames, codec) instead of Frame rate / Size / Codec / Length (copy); frame ruler, keyframe diamonds, Easing readout absent; extra tool row; light beat clips render solid black (clip fill token does not flip)
- ad-export · differs · Advanced body two columns (board one); no File names pattern + live preview; no "From the terminal" blocks; Exact scale single field 2.5x missing; sheet is the 09 sheet
- ad-history · differs · extra All / Named / Made by AI / People seg above the list (board draws none) and no Compare + Restore row under it; fold shows only Compare / Project (Branch, Drafts, Remote, changed files, git actions absent)
- ad-ds · differs · board is the full specimen view under "Design system > Advanced"; app shows the system card with raw CSS block, file list, text-glyph fold "▼"; light frame has canvas bleed at the panel foot
- ad-menus · unreachable · native menu bar (desktop-e2e lane)
- ad-diag · differs · board is the Menu > Diagnostics submenu; shot is the sheet, submenu (status words, Logs, Reload canvas, Check AI setup again, Advanced rows) not captured
- ad-logs · differs · "Show in Finder" ghost absent, extra Refresh icon, extra title row + close x; source filter, log well, ARow Copy, three boxes match
- ad-syncd · unreachable · needs a cloud-linked project in trouble (Get latest, conflict rows, Sync stopped)
- ad-settings · differs (cannot confirm) · frame opens General, not Advanced; three columns, Restart now, Copy install command, Reset not shown
- ad-pinned · differs · only AI pinned; board pins Canvases left + Inspector right with folds open; Canvases collapses while pinned (display:contents wrapper bug)
- ad-search · differs · rows with chevron fallback glyph (Allow longer videos, Hidden files, Keep timeline open, Layers as a panel, Open/Close all Advanced sections, Use my own plugin copy)
- ad-code · differs (cannot confirm) · read-only code panel never opened (path, Read only, Copy, Open in editor, highlighted lines, terminal + Claude Code blocks); palette still has chevron-fallback rows
- ad-edge-syntax · differs · "Ask AI to fix it" primary button absent; Advanced body (Error / Where, excerpt, Open in editor / Copy error / Last good version) not shown; dimmed last-good boards absent; provenance clause needs a server signal
- ad-map, ad-why, ad-trace · unreachable · documentation boards, no app surface
- ad-edge-sync, ad-edge-hub · unreachable · hub / cloud-in-trouble fixture
- ad-edge-where · unreachable · viewer-origin, comment-only, offline fixtures
- ad-edge-remember · unreachable · multi-day per-Mac memory story

## Polish list
- ad-left · foot line "12 of 12 shown · updated just now" wraps next to Refresh (wrap, no overflow)
- ad-share · app link / This Mac only values in bordered boxes, truncated (board: plain mono + icon copy)
- ad-search · query "advanced" vs board "copy" (fixture)
- ad-logs · Needs-setup card + "All checks" larger than board (fixture)
- ad-history · local project, not git-backed with remote (fixture)
- ad-ds · "Advanced · Tokens · files" fold wording differs (copy-level, keep until specimen view lands)
- ad-ai · Context % / 5-hour values (fixture, needs agent)

## Side states
- ad-left/closed · board frame "Closed" · reachable (fold shut)
- ad-left/row-menu · context menu on Combine-kampan (Reveal, Open in editor, View code, Copy path, Rename) · reachable, not in frame
- ad-left/trash · Trash view with Restore + "Clear out older than 30 days" · reachable, not in frame
- ad-left/layers-advanced · Layers fold (Show tags and ids, On this canvas, Select by selector, Element id) · reachable, not in frame
- ad-export/closed · board frame "Closed" · reachable
- ad-export/also-under-export · Exports list + Print PDF card + Other formats cards · reachable, not in frame
- ad-history/closed · board frame "Closed" · reachable
- ad-search/shortcuts-sheet · Keyboard shortcuts sheet with Advanced keys · reachable, not in frame
- ad-logs/reload-pill · "Combine-kampan reloaded." pill · reachable (reload event), absent
- ad-pinned/move-chip · "Drag · double-click resets · left right move 8" chip · reachable, not drawn
- ad-edge-syntax/closed · card closed, Advanced collapsed · reachable (shown in app)
- ad-share/closed · closed card · unreachable (needs people)
