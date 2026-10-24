# critic-final-d3 - 05 Empty States - V2-8.5 FINAL D3 (merged tip 63592219a; one critic, four lenses)

Read-only. Every id judged fresh from the "final (D3)" full-size pairs, light and dark, against the D2 report (critic-final.md) as checklist. Rules: Home = board 11 owns (stacked layout, Recent canvases row, no dot grid); AI chat = 03; panel chrome = 04/11/14; inspector = 14/08; CONTRACT over board ("All" comments filter, "New artboard"); lead decisions (+ New canvas row, switcher in pill, Connect modal without API-key row, undo toast) are not blockers.

Fixed since D2 (seen in the shots): empty block centred on the free canvas (es-canvas-ai); empty-artboard hint + "Ask AI to fill Desktop" + compact inspector + selection + "No layers on Desktop yet." (es-artboard-new); Exports names the project; "Searched 1 chat"; start-here row "New canvas"; layer names Heading/Text/Frame; "a fixed size artboard" wording; project-new prompt is a definite box with azure send; landing frames light show the real stickies animation.

| id | theme | verdict | remaining blockers |
|---|---|---|---|
| es-home-cloud | L+D | match | none |
| es-home-local | L+D | differs (cannot confirm) | the drawn "No projects on this Mac yet." + "Open project..." card is not shot (impl lists a registered Studio site row); sign-in link bare without its island |
| es-home-shared | L+D | match | none (stacked + Recent canvases = 11 wins; words, ghosts, card present) |
| es-project-new | L+D | differs | left panel: "Studio site" label line + a SECOND "+ New canvas" row under the empty block (spec one row + "0 canvases"), search row, Advanced row; prompt azure focus ring, not the spec's raised white card (`v2/create/empty-project.css`, `tree/tree.jsx` empty branch) |
| es-canvas-ai | L+D | match | none (block now on the free canvas; panel extras are 04/11/14 chrome) |
| es-landing | L | match | none |
| es-landing | D | differs (cannot confirm) | all four dark impl frames are loading cards ("Opening Untitled canvas..."), landing never captured - harness |
| es-canvas-three | L+D | differs (cannot confirm) | "Drafting / Queued" after-send cards not shot; third frame (Connect) is a faint panel on a grey field, no centred Connect card visible; online frame ok, offline word ok |
| es-artboard-new | L+D | match | none (Layers shows canvas tree above the empty line + kind chips = 14/04 chrome) |
| es-panels-canvas | L+D | differs | "Comments - all resolved" frame is blank (no "All done." + confetti shot); Version history shows "Changed this canvas / changed outside the app" row not "Versions appear here as you work." (fixture, cannot confirm); Comments has extra "All" segment (CONTRACT, ok) |
| es-panels-make | L+D | differs | Trash: no "Studio site" chip in the header, extra line "Kept until you clear it out." (`left-panel/trash-view.jsx`); AI chat per 03 (ok); Assets + Exports ok |
| es-timeline | L+D | differs | only "No clips on Reel . 9:16 yet." under a transport bar: no ruler, no drop track with "Cut 15 s" AI chip, no Captions/Music lanes (`v2/timeline/timeline-empty.jsx`); inspector Poster frame/Sound/Export vs Preset/Size/Length/Frame rate (08) |
| es-search-k | L+D | match | none |
| es-search-more | L+D | differs | Assets no-hits block ("Nothing called ...", "Let AI describe your pictures", "Searched N assets") not shown - impl answers "No images or footage yet."; the (K) start-here frame itself now matches |
| es-search-panel | L+D | match | none |
| es-filter | L+D | differs | filter chip truncated "Pr... 0" without x; "Clear filter" without the x glyph; layer tree sits under the empty block (`canvas-shell.tsx`, `kinds/layers-kind-model.js`) |
| es-viewer | L+D | unreachable | needs a view/comment-only member session (hub / workspace cell vouching a role) |
| es-arriving | L+D | differs | no skeleton artboards ("4 artboards on their way", pulse), foot has the words but no progress bar, canvas shows one centred "Smoke is on its way." card (`v2/empty/skeleton.jsx` has no caller; needs artboard names/sizes in the sync manifest) |
| es-offline-uncached | L | differs | block centred on the window (x~0.50), not the free canvas (spec ~0.59); status word "Local project" vs "Offline - kept on this Mac"; panel kind chips |
| es-offline-uncached | D | differs | wrong state shot: panel "Loading canvases..." + "No canvases yet.", canvas empty, no "isn't on this Mac yet" card |
| es-all-trashed | L+D | unreachable | card never reached (pair shows "Your canvas is ready."); needs a canvas whose artboards are all in the Trash via sync / second person |
| es-edge-panels | L+D | differs | chat search ok ("Searched 1 chat"); "team of one" Share sheet not shot (needs a cloud project) |

Match both themes: es-home-cloud, es-home-shared, es-canvas-ai, es-artboard-new, es-search-k, es-search-panel. Match one theme: es-landing (light).
