# A11y audit: Maude v2 studio shell (Phase 4 gate)

Auditor: a11y-auditor. Target: http://localhost:4418/ (scratch fixture `e2e-fixture`, local browser shell), agent-browser session `p4a11y`, 1440x900.
Method: axe-core 4.12 (`agent-browser a11y`) per state, own contrast pass (computed colours, both themes), scripted keyboard sweeps, ARIA dumps. No source files edited. Evidence PNGs: `a11y/` next to this file.
States covered: empty shell, canvas open (iframe contents NOT audited), project pill menu + submenus, Cmd+K, Settings (3 tabs), "?" sheet, Diagnostics sheet, Share dialog, mode switch / Present / Hide panels, Layers + Assets tabs; light AND dark shell theme (theme restored to light afterwards).
Not run: mobile emulation (desktop studio shell, brief fixed 1440x900); canvas iframe contents; Inspector / Comments / Export panels.
Harness note: `Shift+Slash` through agent-browser sends "/" (focuses canvas search); the "?" sheet was opened with a literal "?" key.

## Result: 8 blockers, 12 warnings

### Blockers (WCAG 2.1 A/AA, reproduced)

B1. Cmd+K palette has no combobox/listbox semantics (4.1.2, 4.1.3; hard-stop #3).
  `[role=dialog][aria-label="Command palette"] [data-testid=palette-input]` has only `aria-label`: no `role=combobox`, `aria-expanded`, `aria-controls`, `aria-activedescendant`. `[data-testid=palette-list]` has no `role=listbox`; rows `button.st-pal-item` have no `role=option`/`aria-selected`. The ArrowDown highlight is only the CSS class `is-active`, so a screen reader never hears which row is active. "3 results" (`[data-testid=palette-count]`) is not in a live region.
  Fix: combobox on the input + listbox/option on list/rows + `aria-activedescendant`; put the count in `role=status`. Evidence: 10-cmdk.png, 11-cmdk-typed.png.

B2. aria-modal dialogs do not contain focus; palette Esc is row-blind (2.4.3; hard-stop #3).
  Palette and `[data-testid=shortcuts-sheet]` are `aria-modal=true` but Tab leaves them onto the background (callout "Start" / "Dismiss") while the scrim is up. In the palette, Esc does nothing when focus is on a result row (`palette-row-*`); only the input handles it. Settings and Share dialogs trap correctly (reuse that).
  Fix: trap or `inert` the background; document-level Esc as the shortcuts sheet already does.

B3. Settings tablist contains a non-tab control (1.3.1/4.1.2; axe critical `aria-required-children`).
  `.v2s-rail[role=tablist]` also contains `<p class=v2s-title>`, `<span class=v2s-foot>` and `button[data-testid=settings-close]`. Present in General, Connections and Advanced, both themes.
  Fix: make the rail a wrapper; put only the three `role=tab` buttons in the tablist.

B4. Label in Name (2.5.3) at two controls.
  `[data-testid=project-pill]`: aria-label "Project menu", visible "e2e-fixture / Smoke". Screen-reader users also never hear which project/canvas is open (only the pill shows it).
  `[data-testid=settings-close]`: aria-label "Close settings", visible "Done".
  Fix: drop the aria-label or start it with the visible text ("e2e-fixture / Smoke, project menu"; "Done").

B5. Settings > General > Layout: seven identical radiogroup names (1.3.1/4.1.2, borderline).
  `[data-testid^=panel-side-]` (Canvases, Layers, Assets, Inspector, Comments, Changes, Assistant) are all `aria-label="Panel side"`; the visible row label (`.st-pref-label`) is an unlinked sibling. Tab/forms mode announces "Panel side, Left" x7. Evidence: 13-settings-layout.png.
  Fix: `aria-labelledby` the row label or "<Panel> panel side".

B6. Colour contrast below 4.5:1 (1.4.3), mostly one muted-text token at 9-11px.
  Muted token: light #8f9298 = 3.0-3.1:1, dark #5f6469 = 2.8-3.0:1. Hits: Settings `.st-pref-note`, `.st-engine-radio-note`, `.st-provider-notes`, `.st-settings-intro`; palette `.st-pal-group` + footer hints ("move", "open", count); shortcuts `.so-or`, `.so-note` (27 nodes); Layers `.st-layer-type`, `.st-rp-hint`, `.st-layer-caret` (9-10px); empty state `.st-empty-sub` 2.83:1; placeholders (`canvas-search` 2.73 light / 2.52 dark, palette input 3.01).
  Other: Diagnostics ok-status words `.dg-word[data-tone=ok]` / menu `.st-pm-status` #008e58 = 4.04-4.19:1 (light); Diagnostics selected tab `diag-tab-logs` 3.74:1 (dark, #b7bbc0 on #3e5495); Present exit pill (`.st-present-exit`, opacity .72 at rest) label 4.24:1 and `kbd` "Esc" 2.16:1 (passes on focus/hover).
  Shell chrome itself (pill, share cluster, tree, tabs, menus, callout) passes in both themes. Icon-only controls pass 3:1. Evidence: 12-settings.png, 22-settings-dark.png, 24-dark-cmdk.png, 20-present.png.

B7. Diagnostics sheet tabs covered by the first-run callout (2.4.7, pointer operability). Conditional: only while a callout is showing.
  `.st-callouts` z=8990 vs `.dg-sheet` z=40. `elementFromPoint` on `diag-tab-logs` / `diag-tab-server` / `diag-tab-ai` returns the callout; focus ring on them is a 4px sliver. Dismissing the callout clears it. Evidence: 08-diagnostics-sheet.png, 09-diag-focus-covered.png.
  Fix: callout stack must yield to floating sheets (or sheets must not overlap the top-centre callout zone).

B8. Character-key shortcuts with no off/remap (2.1.4, level A).
  Global single-key shortcuts fire with focus on the page: verified "/" (focuses canvas search) and "?" (opens the sheet); the sheet/palette also list N, S, V/H/F/T/I. Settings (3 tabs) has no shortcut toggle or remap.
  Fix: add a "single-key shortcuts" off switch (or require a modifier).

### Warnings

W1. No `<main>`/`<header>` landmark, no skip link, zero headings in the shell (only `nav "Canvases"`; axe `landmark-one-main`, `page-has-heading-one`, `region` x8-11). Violates project hard-stops #10/#11; classed as warning because axe tags it best-practice and the shell is a single-page app. Lead's call. First tab stop is the callout "Start".
W2. "?" sheet layout broken at 1440x900: `.so-columns--3` grid is 1074/519/1027px inside an 830px container (scrollWidth 2707 vs 878). Key combos and the File / Panels and AI / Objects columns are off-screen; "Step back" and "Go to artboard" lists ~25 modifier permutations ("esc or opt-esc or shift-esc ..."). Not a WCAG failure (DOM complete), but it defeats the sheet; recommend gating on product grounds. Evidence: 16-shortcuts.png, 16b-shortcuts.png.
W3. Focus return is inconsistent (2.4.3; hard-stop #3). Esc/close lands on `canvas-frame` (Settings, Share, palette, "?" with a canvas open) or BODY (Diagnostics always; palette and "?" in empty shell) instead of the opener. Settings in the empty shell restores correctly. Hide/Show panels and Present exit also drop focus to BODY.
W4. `role=tablist` without tab behaviour: left panel (`panel-tab-*`) has no arrow/Home/End, all three tabs tabindex=0, no aria-controls/tabpanel; Diagnostics tabs are four separate tab stops. Settings tablist is correct (roving, arrows, Home/End, aria-controls).
W5. Hide panels (`share-cluster-panels`): label flips "Hide panels" to "Show panels" while `aria-pressed` flips to true, announced "Show panels, pressed" (contradicts the state). Keep one label with aria-pressed.
W6. Count chip `.st-pill` ("4") in the UI CANVASES header is `position:absolute` at (40,218) 19x38, overlapping the header text and the Cut row icon (visible in every screenshot); can intercept clicks.
W7. Layers tree: every `treeitem` tabindex=0 (no roving) plus Lock/Hide buttons, so tab stops scale with layers; item names concatenate child button labels ("Collapse div BOX Lock div Hide div"). Settings Left/Right radios are 14 separate tab stops (no roving radiogroup).
W8. Headings: Settings and "?" sheet start at h3 with no h1/h2 (axe `heading-order`); the "?" title is a span.
W9. Assets tab: `img` alt duplicates adjacent text (axe `image-redundant-alt`, minor).
W10. Palette Esc/close and "?" filter give no result-count announcement (4.1.3) beyond B1's count.
W11. Tab order: tour callout precedes the project pill; 2 tab stops per tree row (Actions, Delete) always focusable, revealed on focus (fine) but 8 extra stops for 4 canvases.
W12. Diagnostics submenu: informational Sync/Server/AI rows are `menuitem`s.

### Notes
- Passes: project pill menu is a correct WAI-ARIA menu (Enter/Space/Down open, wrap, Home/End, Right opens submenu and focuses first item, Left/Esc close one level, Tab closes, Esc returns focus to pill, `menuitemcheckbox` for Version history). Mode switch = toggle buttons with `aria-pressed`, keyboard-operable, group labelled. Canvas tree: roving treeitems with arrows/Home/End/Left/Right. Panel grip resizes by keyboard (Arrow +-8px, Home/End). Settings tabs, Share dialog trap + labels. No keyboard trap in the canvas iframe (leaves after ~7 stops). Focus ring is 2px solid accent in both themes. Reduced motion collapses animations (`st-pop` 0.001s under emulation). `html lang=en`; document title set.
- Small targets (no WCAG 2.1 AA minimum; desktop): Start 43x21, Dismiss 23x24, row actions 22x22, mode buttons 30x28.
- Cosmetic: tour callout still shows in Present mode.

## Keyboard-reachability map
- Empty shell: whole shell reachable by Tab, no trap; Present disabled (not tabbable), Share `aria-disabled`.
- Canvas open: ... tree, grip, canvas iframe (~7 internal stops), Open Inspector, wrap. Hidden panels are removed from the tab order; reveal buttons `panel-icon-left/right` reachable.
- Gaps: B2 (Tab leaves palette / "?" modal), W3 (focus drops to BODY), W4 (tabs without arrows).
