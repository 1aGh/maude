# critic-final — 06 Advanced · V2-8.5 stage D2 (one critic, four lenses)

_Board `.design/ui/v2/06 Advanced.tsx`; shots = FINAL (D2, d3881fe41) full-size pairs, every reachable id read. Dark read for all; light read for ad-inspector, ad-left, ad-ai, ad-share, ad-timeline, ad-export, ad-history, ad-ds, ad-diag, ad-logs, ad-settings, ad-open-all, ad-edge-syntax (the rest differ structurally in dark, same frame in light). Read-only._

Summary: 1 id matches in both themes (ad-open-all), 15 differ, 9 unreachable. Nothing new matches since critic-d3.

| id | theme | verdict | remaining blockers |
|---|---|---|---|
| ad-map, ad-why, ad-trace | both | unreachable | documentation boards, no app surface |
| ad-menus | both | unreachable | native menu bar; desktop-e2e lane only |
| ad-edge-sync, ad-edge-hub | both | unreachable | needs a hub-linked / cloud-in-trouble fixture |
| ad-edge-where | both | unreachable | needs viewer-origin, comment-only and offline fixtures |
| ad-edge-remember | both | unreachable | multi-day per-Mac memory story |
| ad-inspector | both | differs (cannot confirm) | D: the open fold body (Element / Used in / Tokens bound / CSS / Copy code) is below the crop, only "Element" peeks; fold still sits under ~20 plain rows (board: under 5). |
| ad-left | both | differs | D: extra "Open canvas" row and Trash Empty/Open row inside the fold (board: Show file names, Show hidden files, Folder, Design system); foot line wraps ("12 of 12 shown · updated just now" + Refresh); row menu, Trash card, Layers fold not in frame. |
| ad-ai | both | differs | D: Model, Effort, Fast mode, Ask before, Images/video/voice, Context % and 5-hour rows absent (needs a configured agent); selects are small auto-width, not the 140x28 kit select; "AI may" heading stands alone above the Folders row; Raw log / Copy transcript / Open in terminal without glyphs; composer is the 03 shape. |
| ad-share | both | differs | D: app link / This Mac only values in bordered boxes, truncated (board: plain mono + icon copy); extra "Open in the Mac app" line; link rules, people, invite-by-username, "Where it syncs" not drawn (local project, C2). |
| ad-timeline | both | differs | D: raw keys (fps, durationInFrames, codec) not "Frame rate / Size / Codec / Length"; frame ruler, keyframe diamonds, Easing readout absent; extra tool row; light beat clips render solid black (clip fill token not flipping). |
| ad-export | both | differs | D: Advanced body two columns, not one; no File names pattern + live preview, no "From the terminal" blocks; Exact scale "1 ×" not 2.5×; sheet is the 09 sheet, not the three-card board. |
| ad-history | both | differs | D: All / Named / Made by AI / People seg above the list; no Compare + Restore row; fold shows only Compare / Project (Branch, Drafts, Remote, changed files, git actions not drawn; local project). Container now floating (fixed). |
| ad-ds | both | differs | D: board draws the full specimen view (Colours, Type, Components and specimens, Advanced rows + token rows) under "Design system > Advanced"; app shows the right-panel system card with raw CSS text block and file list, a "▼" text-glyph fold, no specimen view; light frame also shows stray canvas bleed at the panel foot. C: "Advanced · Tokens · files" is a different fold wording. |
| ad-diag | both | differs | D: board is the Menu > Diagnostics submenu (status words, Logs, Reload canvas, Check AI setup again, Advanced Address/Process/Project folder/Resync now/Download all); shot is the sheet, the submenu is not captured. |
| ad-logs | both | differs | D: "Show in Finder" ghost absent, extra Refresh icon; "Combine-kampan reloaded." pill absent; sheet carries a title row + close x and a large Needs-setup card + "All checks" (fixture). Source filter, log well, ARow Copy, three boxes match. |
| ad-syncd | both | differs (cannot confirm) | frame is the Logs sheet again; none of Get latest, conflict rows (Keep mine / Use theirs / Keep both / Compare), Moving now, Counts, "Sync stopped" is visible. Needs a cloud-linked fixture in trouble. |
| ad-settings | both | differs (cannot confirm) | frame opens General (single column, Account / Look / Canvas and view), not Advanced; the three columns (This Mac · Engines · This project), Restart now, Copy install command, Reset are not shown. |
| ad-pinned | both | differs | D: only the AI panel is pinned; board pins Canvases left + Inspector right with folds open and the "Drag · double-click resets · ← → move 8" chip; Canvases is the floating panel; Inspector column and chip not drawn. A (cannot confirm): pinned Canvases/Inspector state. |
| ad-search | both | differs | D: query "advanced" not "copy"; no Keyboard shortcuts sheet / Advanced keys; fallback chevron glyph on Allow longer videos, Hidden files, Keep timeline open, Layers as a panel, Open/Close all Advanced sections, Use my own plugin copy. |
| ad-code | both | differs (cannot confirm) | shot is the palette only; the read-only code panel (path, Read only, Copy, Open in editor, highlighted lines, terminal + Claude Code command blocks) never opened; palette still has chevron-fallback rows. |
| ad-edge-syntax | both | differs | D: card shown closed; Advanced body (Error / Where, 210-213 excerpt, Open in editor / Copy error / Last good version) not shown; "Ask AI to fix it" primary button absent from the card; no dimmed last-good boards. C: provenance clause ("changed outside the app 2 min ago") absent. |
| ad-open-all | both | **match** | none. One-line toast pill with done glyph, "All Advanced sections are open.", "Close all" in accent, kit close x; panel fold opens with kept-open pill. Copy, a11y (role=status) and signature stage-B rows were verified. |
