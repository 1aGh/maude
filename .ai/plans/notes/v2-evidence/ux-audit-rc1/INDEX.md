# UX audit evidence - Maude 2.0.0-rc.1 (product 20b4215eb)

Dark theme unless named `-light` / `12-light-theme`. 1600x1000 headless Chromium, built release client, throwaway copy of the desktop e2e fixture project (Home driven with a Tauri stub). Observed, not judged. Re-runs overwrote earlier shots of the same name.

## 01-home-new-project (18)

| shot | what a user tried | what happened |
| --- | --- | --- |
| `01-home-new-project/01-home-default-light.png` | opened Home (desktop-shell stub, 3 projects) | Home: ask box, 3 starters, project shelf |
| `01-home-new-project/01-home-default.png` | opened Home (desktop-shell stub, 3 projects) | Home: ask box, 3 starters, project shelf |
| `01-home-new-project/02-home-pill-menu.png` | clicked the Home pill (top-left) | menu opened |
| `01-home-new-project/03-home-target-menu.png` | clicked "Starts a new canvas in a project on this Mac" | menu opened |
| `01-home-new-project/04-home-menu-file.png` | opened the Home pill, pointed at File | File submenu |
| `01-home-new-project/05-home-menu-help.png` | pointed at Help | Help submenu |
| `01-home-new-project/06-new-project-dialog.png` | File > New project… | Create a local project dialog |
| `01-home-new-project/07-new-project-advanced.png` | opened Advanced in the dialog | Location row shown |
| `01-home-new-project/08-new-project-empty-name.png` | cleared the Name field | Create project with an empty name |
| `01-home-new-project/09-new-project-named.png` | typed Tralala | name + Location preview |
| `01-home-new-project/10-new-project-created.png` | pressed Create project | open_project {"root":"/private/tmp/claude-501/-Users-iagh-git-personal-maude/87d978ed-80c9-4461-b6c8-391c975c5c9a/scratchpad/ux/home/homeprojects/Tralala"} |
| `01-home-new-project/11-home-empty-canvas.png` | clicked "Start with an empty canvas" | open_project {"pid":"l604a1852ba4a60d3","intent":{"kind":"create-empty","prompt":""}} |
| `01-home-new-project/12-home-ask-typed.png` | typed a prompt into the ask box | prompt in box, Send enabled |
| `01-home-new-project/13-home-ask-sent.png` | pressed Send | open_project {"pid":"l604a1852ba4a60d3","intent":{"kind":"create-canvas","prompt":"a pricing page for a pencil shop"}} |
| `01-home-new-project/14-home-search-open.png` | opened the search (top right) | search panel |
| `01-home-new-project/15-home-search-typed.png` | typed "smoke" | results |
| `01-home-new-project/18-home-starter-ds.png` | clicked the starter "A design system" | open_project {"pid":"l604a1852ba4a60d3","intent":{"kind":"make-ds","prompt":""}} |
| `01-home-new-project/19-home-whatsnew.png` | Help > What's new | panel |

## 02-first-canvas (10)

| shot | what a user tried | what happened |
| --- | --- | --- |
| `02-first-canvas/01-new-canvas-menu.png` | clicked "New canvas" in the Canvases panel | what opened |
| `02-first-canvas/02-new-canvas-named.png` | typed a name into the brief-board name field | name typed, ↵ button |
| `02-first-canvas/03-empty-canvas.png` | pressed Enter to create the canvas | the new canvas as opened |
| `02-first-canvas/04-zoom-menu.png` | clicked the 95% zoom readout | what opened |
| `02-first-canvas/05-frame-tool.png` | clicked the Frame tool (F) | tool state / flyout |
| `02-first-canvas/06-toolbar-more.png` | clicked "More" in the tool bar | what opened |
| `02-first-canvas/07-shape-tool.png` | clicked Shape (R) | tool state / flyout |
| `02-first-canvas/08-after-pick-size.png` | picked Mobile 390x844 from the size picker | result: see picture |
| `02-first-canvas/09-after-canvas-click.png` | clicked on empty canvas after picking a size | result: see picture |
| `02-first-canvas/10-zoom-to-fit.png` | clicked the zoom readout | view after zoom to fit |

## 03-edit (17)

| shot | what a user tried | what happened |
| --- | --- | --- |
| `03-edit/01-text-click-placed.png` | chose Text (T) and clicked once inside the Mobile artboard | a text object "Text" 1280x19 was selected (Inspector Text shown) - it sits at the left edge of the Brief artboard, not where the click was; no caret visible |
| `03-edit/02-text-typed.png` | chose Text (T), clicked in the artboard, typed "Sharp pencils" with the keyboard | the typed letters did not go into a text box: they fired tool shortcuts (the app flipped to Preview and the sticker picker opened); no text was typed |
| `03-edit/03-shape-tool.png` | clicked Shape (R) | tool state |
| `03-edit/04-shape-drawn.png` | dragged a rectangle inside the artboard | rectangle placed + selected |
| `03-edit/05-pen-drawing.png` | chose Pen (P) and clicked four corners | path in progress |
| `03-edit/06-pen-closed.png` | clicked back on the first point | path closed? |
| `03-edit/07-pen-finished.png` | pressed Enter | finished path |
| `03-edit/08-frame-drawn.png` | pressed F and dragged a frame inside the Mobile artboard | frame placed |
| `03-edit/09-sticky.png` | pressed N (sticky) in Edit and clicked in the artboard | the app switched to Preview mode and placed a yellow sticky (Edit has no sticky tool; N is a Preview-toolbar tool) |
| `03-edit/10-image-tool.png` | clicked Image (I) | the left panel switched to Assets (Photos) - no file chooser opened |
| `03-edit/12-finder-drop-simulated.png` | dropped a PNG file on the artboard (synthetic drop event) | a toast says the photo was placed in Mobile and is in Assets; Inspector shows the photo |
| `03-edit/13-object-outside-artboard.png` | dragged the rectangle below the artboard | object left outside the artboard |
| `03-edit/14-duplicate.png` | pressed ⌘D on the selection | duplicate placed? |
| `03-edit/15-context-object.png` | right-clicked an object | context menu |
| `03-edit/16-context-artboard.png` | right-clicked inside the artboard (empty part) | context menu |
| `03-edit/17-context-empty-canvas.png` | right-clicked empty canvas | context menu |
| `03-edit/18-context-artboard-label.png` | right-clicked the artboard label | context menu |

## 04-inspector (10)

| shot | what a user tried | what happened |
| --- | --- | --- |
| `04-inspector/01-artboard.png` | clicked the Mobile artboard label | Inspector: Artboard (Size, Fill, Safe zones, Export, Advanced) |
| `04-inspector/02-artboard-advanced.png` | clicked Advanced in the artboard Inspector | opened |
| `04-inspector/03-artboard-size-dropdown.png` | opened the Size dropdown | nothing visibly changed |
| `04-inspector/04-artboard-fill-dropdown.png` | opened the Fill dropdown (None) | opened |
| `04-inspector/05-shape.png` | shape is selected | Inspector for the shape |
| `04-inspector/06-path.png` | path is selected | Inspector for the path |
| `04-inspector/07-frame.png` | frame is selected | Inspector for the frame |
| `04-inspector/08-frame-advanced.png` | clicked Advanced in the frame Inspector | opened |
| `04-inspector/09-sticky-inspector.png` | sticky selected? | Inspector |
| `04-inspector/10-object-outside.png` | object outside artboard is selected | Inspector |

## 05-preview-vs-edit (10)

| shot | what a user tried | what happened |
| --- | --- | --- |
| `05-preview-vs-edit/01-edit-mode-smoke.png` | opened the Smoke canvas (Edit mode default) | Edit toolbar, canvas, edit=true preview=false |
| `05-preview-vs-edit/02-edit-marquee-dragging.png` | dragged from empty canvas across the artboard (Edit) | marquee while dragging |
| `05-preview-vs-edit/03-edit-marquee-done.png` | released the marquee | selection result |
| `05-preview-vs-edit/04-edit-shift-multiselect.png` | clicked an object then Shift-clicked another | multi-selection |
| `05-preview-vs-edit/05-preview-mode.png` | clicked Preview | Preview toolbar / banner, edit=false preview=true |
| `05-preview-vs-edit/06-preview-press-v.png` | pressed V in Preview | the app returned to Edit mode (Edit button active again, Edit toolbar back) |
| `05-preview-vs-edit/07-preview-marquee-attempt.png` | dragged a marquee after pressing V in Preview | by now the app was back in Edit (V had switched Preview to Edit, see 06), so this is an Edit marquee, not a Preview one |
| `05-preview-vs-edit/08-preview-click-element.png` | clicked an element after V | back in Edit: the element is selected and the Inspector opened |
| `05-preview-vs-edit/09-preview-shift-click.png` | Shift-clicked a second element after V | back in Edit: Shift-click multiselect |
| `05-preview-vs-edit/10-present-options.png` | opened Present options | menu |

## 06-comments (8)

| shot | what a user tried | what happened |
| --- | --- | --- |
| `06-comments/01-comment-tool-c.png` | pressed C | comment tool state; edit=true preview=false -> edit=false preview=true |
| `06-comments/02-hover-element.png` | hovered an element with the comment tool | hover affordance |
| `06-comments/03-comment-on-element.png` | clicked an element | comment composer |
| `06-comments/04-comment-typed.png` | typed a comment | composer with text |
| `06-comments/05-comment-sent.png` | pressed ⌘↵ | pin on element / thread |
| `06-comments/06-comment-on-empty-space.png` | clicked empty space with the comment tool | composer on empty space |
| `06-comments/07-two-comments.png` | sent a second comment | two pins |
| `06-comments/08-open-pin.png` | clicked the first pin / element | thread |

## 07-ai-chat (4)

| shot | what a user tried | what happened |
| --- | --- | --- |
| `07-ai-chat/01-chat-open.png` | clicked "Ask AI ⌘/" (bottom right) | chat panel |
| `07-ai-chat/02-chat-advanced.png` | clicked Advanced in the chat header/footer | opened |
| `07-ai-chat/05-chat-and-inspector.png` | selected an element while chat is open | chat and Inspector together |
| `07-ai-chat/06-chat-collapsed.png` | clicked the chat collapse control | nothing visibly changed |

## 08-left-panel (14)

| shot | what a user tried | what happened |
| --- | --- | --- |
| `08-left-panel/01-canvases-tab.png` | Canvases tab | canvas list + kind chips |
| `08-left-panel/02-kind-chip-video.png` | clicked the Video chip | list filtered |
| `08-left-panel/03-search-cut.png` | typed "cut" in the search | filtered list |
| `08-left-panel/04-search-no-match.png` | typed "zzzz" | empty result state |
| `08-left-panel/05-sort-menu.png` | clicked the sort control | sort menu |
| `08-left-panel/06-row-actions.png` | clicked "Actions" on the Smoke row | row menu |
| `08-left-panel/07-row-expanded.png` | expanded the Smoke row | artboards under the canvas |
| `08-left-panel/08-new-folder.png` | clicked New folder | inline name field? |
| `08-left-panel/09-canvases-advanced.png` | clicked Advanced at the bottom of Canvases | extra rows |
| `08-left-panel/10-layers-tab.png` | Layers tab on Smoke | layer tree |
| `08-left-panel/11-layers-selected.png` | selected an element on the canvas | Layers row highlight |
| `08-left-panel/12-assets-tab.png` | Assets tab | assets list |
| `08-left-panel/13-assets-dragging.png` | pressed on an asset tile and dragged toward the canvas | drag in progress |
| `08-left-panel/14-assets-dropped.png` | released over the canvas | result |

## 09-share-export-history (4)

| shot | what a user tried | what happened |
| --- | --- | --- |
| `09-share-export-history/01-share-open.png` | clicked Share | share popover |
| `09-share-export-history/02-share-advanced.png` | opened Share > Advanced | extra rows |
| `09-share-export-history/03-export.png` | pressed ⇧⌘E | export sheet / nothing |
| `09-share-export-history/04-version-history.png` | chose Version history in the project menu | history panel |

## 10-design-system (3)

| shot | what a user tried | what happened |
| --- | --- | --- |
| `10-design-system/01-ds-canvas-maude.png` | opened system/maude design-system canvas (copy of the repo DS) | DS canvas + any View-only banner |
| `10-design-system/02-ds-canvas-maude-v2.png` | opened system/maude-v2 design-system canvas | DS canvas |
| `10-design-system/03-ds-click-specimen.png` | clicked a specimen | selection / Inspector / banner |

## 11-palette-settings-menus (12)

| shot | what a user tried | what happened |
| --- | --- | --- |
| `11-palette-settings-menus/01-command-palette.png` | pressed ⌘K | command palette |
| `11-palette-settings-menus/02-palette-typed-new.png` | typed "new" | results |
| `11-palette-settings-menus/03-shortcuts-sheet.png` | pressed ? (Shift+/) | shortcuts sheet or nothing |
| `11-palette-settings-menus/04-project-menu.png` | opened the project menu (top left) | menu root |
| `11-palette-settings-menus/05-menu-file.png` | pointed at file in the project menu | sub-file=File · canvas.new=New canvas · project.new=New project… · project.open=Open project… · canvas.duplicate=Duplicate canvas · canvas.rename=Rename canvas · canvas.move=Move to… · import.figma=Import from Figma… · import.brand=Import a brand… · video.assemble=Assemble clips into a video · expor |
| `11-palette-settings-menus/06-menu-edit.png` | pointed at edit in the project menu | sub-file=File · sub-edit=Edit · edit.undo=Undo⌘Z · edit.redo=Redo⇧⌘Z · edit.undo-history=Undo history… · edit.cut=Cut⌘X · edit.copy=Copy⌘C · edit.paste=Paste⌘V · edit.copy-properties=Copy properties⌥⌘C · edit.paste-properties=Paste properties⌥⌘V · select.all=Select all⌘A · select.none=Deselect all · |
| `11-palette-settings-menus/07-menu-view.png` | pointed at view in the project menu | sub-file=File · sub-edit=Edit · sub-view=View · view.panels=Hide panels⌘\ · view.comments=Comments⇧⌘M · view.assets=Assets · view.exports=Exports · view.annotations=Annotations⇧P · mode.preview=Preview⌥⌘P · present.from-selection=Present⌥⌘↵ · present.from-start=Present from the start⌥⇧⌘↵ · present.c |
| `11-palette-settings-menus/08-menu-help.png` | pointed at help in the project menu | sub-file=File · sub-edit=Edit · sub-view=View · sub-help=Help · help.shortcuts=Keyboard shortcuts? · help.guides=Help and guidesF1 · help.whats-new=What's new3 new · help.tour=Take the tour · help.setup=Set up Maude… · help.intro=Watch the intro · help.sharing=How sharing works · help.report-bug=Rep |
| `11-palette-settings-menus/09-menu-diagnostics.png` | pointed at diagnostics in the project menu | sub-file=File · sub-edit=Edit · sub-view=View · sub-help=Help · history.open=Version history⌥⌘H · share.open=Share… · export.open=Export…⇧⌘E · sub-diagnostics=Diagnostics · diag.sync=SyncLocal project · diag.server=ServerRunning · diag.ai=AI setupReady · diag.logs=Logs · canvas.reload=Reload canvas⌘ |
| `11-palette-settings-menus/20-settings.png` | pressed ⌘, | Settings or nothing |
| `11-palette-settings-menus/21-settings-advanced.png` | opened Settings > Advanced | tab content |
| `11-palette-settings-menus/21-settings-connections.png` | opened Settings > Connections | tab content |

## 12-light-theme (4)

| shot | what a user tried | what happened |
| --- | --- | --- |
| `12-light-theme/01-canvas-light.png` | opened a canvas in the light theme | canvas + chrome in light |
| `12-light-theme/02-selection-inspector-light.png` | clicked an element (light theme) | Inspector in light |
| `12-light-theme/03-project-menu-light.png` | opened the project menu (light) | menu in light |
| `12-light-theme/04-palette-light.png` | pressed ⌘K (light) | palette in light |

## Observations without a picture

- 01-home-new-project / 16-open-project: clicked "Open project…" -> open_project_folder 
- 01-home-new-project / 17-project-row: clicked a project row on Home -> open_project {"pid":"l978ea92959d74f38"}
- 01-home-new-project / 11-file-new-project: File > New project… -> dialog 1
- 03-edit / 09-sticky-mode: pressed N in Edit mode -> mode afterwards edit/preview aria-pressed = false/true
- 05-preview-vs-edit / 11-esc-in-preview: Esc in Preview -> edit=true preview=false
- 08-left-panel / 00-panels-exclusive: selected an element (Inspector opens) while the Canvases panel was open -> the Canvases panel collapsed to a single icon when the Inspector opened at 1600 px; it returned when selection cleared
- 08-left-panel / 10-layers-labels: read the Layers labels -> Layers · All20020Print2 artboardsA · přední (FLAG · All20020 · All20020 · All2 · 0 · 0 · 2 · 0 · Print2 artboardsA · přední (FLAG)FrameVY · 2 artboards · A · přední (FLAG) · Frame · VYZKOUŠEJ FLAG · Frame · B · zadní (FLAG) · Advanced · Advanced

## Controls that did nothing when clicked

- Inspector > Advanced on an artboard, clicked at a fixed coordinate (04-inspector/02): no visible change in the first run; the later `02-artboard-advanced` shot should be read with that caveat (coordinate click, not verified).
- Artboard Size dropdown (04-inspector/03): clicked by coordinate, nothing visibly changed in the signature check; look at the shot.
- Home: choosing the target "a project on this Mac" and then "Start with an empty canvas" did not open the Create-a-local-project dialog (File > New project did). Not a dead button, but two routes behave differently.
- Home in a plain browser: "Open project...", rows and starters call the desktop shell only; with the stub they issued `open_project` / `open_project_folder` (recorded in 01 notes). No real window opens here.
- Several harness click failures (timeouts) are NOT product findings; they came from the panel auto-collapse described below and were re-run.

## Things seen that the critics may want (not clicks)

- Typing in Edit after choosing Text fires tool shortcuts (03-edit/02): letters changed mode and opened the sticker picker.
- V in Preview switches back to Edit (05/06); there is no Preview multiselect/marquee: those happen only after it has left Preview.
- Opening the Inspector (selecting anything) collapses the Canvases panel at 1600 px; deselecting restores it. Clicking the already-active Canvases tab collapses the whole left panel.
- The "What's new" toast and the "You're in Edit" toast overlap (02-first-canvas/03).
- Home shows the two seeded projects both as "x" (index names); that is a fixture artefact.
- Layers on Print: see 08-left-panel/10-layers-tab for labels (Czech fixture content, no Lane/Card in this canvas; the Lane/Card labels Michal saw were not reproduced here).
- AI chat: opened (07/01), Advanced (07/02), with Inspector (07/05), collapsed (07/06). Typing and sending was NOT captured (the run was killed there); resize limits not measured.
- Not captured: pen path on its own canvas in light, Finder drop with a real Finder, desktop-only surfaces (strip, native menus), the Share > role pickers (local project only).

Total 114 shots, 11.9 MB.
