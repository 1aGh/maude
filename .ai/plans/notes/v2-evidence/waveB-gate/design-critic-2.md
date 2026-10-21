# design-critic — wave-B gate, part 2 of 2 (canvases 08 · 09 · 10 · 12 · 13)

_2026-10-21 · read-only review · opt_out_scope: palette (full DS enforcement) · evidence: `waveB-gate/shots/` (branch `gate-b-shots`, base `feat/maude-v2` 0ac68fb3d, release client, Playwright Chromium 1600×1000, `window.__TAURI__` stub, dark + light, JPEG q70). No server booted, nothing edited._

Same method as the wave-A gate (`waveA-gate/design-critic.md`). The specs are `.design/ui/v2/{08,09,10,12,13}*.tsx` + `.css` + `_kit.css`. The DS references are `.design/system/maude-v2/{README, CONTRACT §3–§5, colors_and_type.css}`. File:line citations are against HEAD (`gate-b-reach` fffc1a6aa).

**The shots predate the a11y fixes.** None of `697561224` / `c3a0ed1ab` / `d2f3b7ab0` is in the shot base. Where the a11y re-check proves a fix (`waveB-gate/a11y-recheck.md` B1–B9), I say **(fixed by gate-b-a11y, re-checked there)** and don't count it as a blocker. The a11y lane re-shot those states; I don't re-judge them.

**Unscored.** A board state that no frame shows is unscored. That covers INDEX "Artboards not reachable", and also frames whose picture doesn't show the state they are named after. Those are listed per canvas, not scored.

## TL;DR

| Area | Canvas | Score | Blockers | Gate (≥ 4.0, 0 blockers) |
| --- | --- | --- | --- | --- |
| Artboard kinds | 08 | **3.4** | 1 | fail |
| Export | 09 | **3.3** | 4 | fail |
| Share and collaboration | 10 | **3.3** | 3 | fail |
| Import and assets | 12 | **3.6** | 2 | fail |
| Design system (Make only) | 13 | **3.7** (shown states only) | 1 | fail |

**Blockers: 11 · Warnings: 34 · Verdict: fix-and-retry.**

The new v2 surfaces are good where the specs drew them: the F size picker, Assets (panel, browse, details, Not used, the AI-search offer), the Comments panel, the Export sheet's Scope bar and Advanced fold, and the Make-a-design-system sheet. All four wave-A root causes are fixed in these frames:
- RC1: the artboard label is now a constant 11 px sans label, an azure pill with the size when selected.
- RC2: `island--pad` has a rule (`floating-panels.css:45`).
- RC3: the inspector segments are the right size.
- The `--accent-text` contrast fix came through gate-b-a11y.

Two new root causes drag every canvas down. **Every sheet mounted outside `.st-shell` renders in the v1 mono face with no v2 tokens** (RC-A), and **kit class names were lifted from `_kit.css` that the shell never defines** (RC-B). Five of the 11 blockers are these two causes, and one fix each clears them. Three surfaces are still v1 and weren't redone in wave B: the Layers tree, the comment composer and the Interaction note's canvas reference.

### Root causes worth fixing once (they hit several areas)

- **RC-A — v2 overlays sit outside the v2 token scope.**
  - The mechanism: `body` takes `font-family: var(--u-font-sans)` (`styles/0-reset.css:14`), which resolves at `:root` to the v1 `--font-body`, the Berkeley Mono / ui-monospace stack (`styles/1-tokens.css:134-142`). `.maude` (`3-shell-maude.css:20`) sets no family, so it inherits that computed mono. Only `.st-shell` resets to `var(--font-body)` (`3-shell-maude.css:31`).
  - Who inherits mono: everything mounted as a sibling of `.st-shell` inside `.maude`. That is the Export sheet (`app.jsx:3207`), the Share sheet (`app.jsx:3198`), the Handoff sheet, the Exports panel, and the Figma and brand import sheets.
  - The missing tokens: the v2 tokens (`--scrim`, `--island-*`, `--w-semibold`, `--object-*`) live only under `.maude-v2[data-theme]` (`1-tokens-maude-v2.css:30,150`). So `.ex-scrim { background: var(--scrim) }` (`v2/export/export.css:15`, no fallback) paints no veil.
  - Prior art: `v2/annotations/v2-scope.js:1-21` documents exactly this and opts the annotation panels in one by one; the rest never did.
  - Fix: one line, `font-family: var(--font-body)` on `.maude`, plus `v2Scope()` (or the `.maude-v2` class) on each overlay root. Better still, scope `.maude` itself, which is the lead's call.
  - Hits 09 B1, 10 B1, 12 B1 and the 09 veil warning.
- **RC-B — kit classes with no shell rule.** These are dead in the client CSS:
  - `.k-adv`, `.k-adv-btn`, `.ex-adv-hint`, `.k-adv-count`, `.k-seg-b`, `.k-sw`, `.k-dialog-a`, `.k-mono`, `.k-ic`.
  - `.icon-btn` and `.k-icon-sm` outside `.home-root` and `.v2-code-hd`.

  Each renders as a UA button or bare text. Found in `v2/handoff/handoff-sheet.jsx:274-282`, `ready-card.jsx:42-50`, `v2/ds/make-sheet.jsx:218`, `review-sheet.jsx:268`, `switch-sheet.jsx:202`, `v2/export/exports-panel.jsx:55`, `job-row.jsx`, `v2/import/figma-sheet.jsx:338` and `brand-result.jsx:122-143`. It is the same failure class as wave-A RC2, so a source pin that fails on a `className` token with no CSS rule would stop the next one. Hits 09 B2, 13 B1, and warnings in 09 and 12.
- **RC-C — v1 surfaces still in the v2 shell.**
  - The Layers tree: `inspector/inspector-panel.jsx:666-700`; `.st-rp-hd` mono uppercase at `3-shell-maude.css:957`, `.st-layer` mono at `:2065`, `.st-layer-type` 9 px at `:2110`, `.st-rp-hint` 10 px mono at `:2259`, plus a `#a78bfa` fallback at `:2174`.
  - The in-canvas comment composer: `comments-overlay.tsx:1460-1495` + `client/comments-overlay.css:88-190`, with `--maude-chrome-*` hex fallbacks and mono uppercase buttons.
  - `.st-btn` "Replace…": `inspector/css-knobs.jsx:1289`.

  Hits 08 B1, 10 B3 and a 12 warning.

---

## 08 Artboard Kinds — 3.4

Layers:
- **Task 4.** The picker is faithful: App · Web page · Social · Print · Video with Fixed size / Grows as you add / mm, with bleed / Has a timeline badges, three sizes up front, All N › / Fewer, the bleed-dashed print shapes and "Or press F and drag to draw any size."
- **IA 3.** Layers is the v1 DOM tree.
- **States 3.** Four of the ten shot states don't show their state.
- **Interaction 3.5.**
- **Microcopy 4.**
- **Parity** n/a.
- **A11y 3.5.**

RC1 is visibly fixed: "A · přední (FLAG) ⚠ 105 × 148 mm" is the sans azure pill drawn in `_kit.css:427-451`.

**Blockers**
1. **[ia · ds-typography]** (RC-C) `ak-layers-dark/light.jpg`: Layers lists one artboard's DOM ("div BOX / h2 HEADING / p TEXT"), not the canvas's 21 artboards by kind.
   - What's off-system: the header "LAYERS 21 artboards" is mono uppercase, and under it a mono 10 px developer key strip reads "Drag or ↑/↓ select · Alt+↑/↓ move · Alt+Shift+↑/↓ move across". It uses `Alt`, not ⌥, and the README rule is no dev chrome in the default view. The type tags are 9 px caps; 9 and 10 px are off the `--type-xs` 11 floor.
   - What 08 draws (ak-mixed-fit, note 10): artboard rows with the kind glyph and name. The new kind chips (All 21 · 0 · 21 · 0 · 0) sit correctly on top of the old tree.
   - Files: `client/inspector/inspector-panel.jsx:666-700`, `styles/3-shell-maude.css:957, 2065, 2110, 2259`.
   - Fix: an artboard-level list (kind glyph + label, one row per artboard, the element tree under a disclosure) in `--font-body`. Move the key hint to "?" / Advanced.

**Warnings**
- **[ux · interaction]** `ak-mixed-select-*`: ⌘A over the shell text-selects every word of the chrome, so the whole window turns blue. The canvas's ⌘A (`canvas-shell.tsx:798`) only runs with the iframe focused. Trap ⌘A at shell level as "select all artboards", and give chrome text `user-select: none`. The "two kinds selected" inspector itself is unscored.
- **[ux]** `ak-mixed-fit-*`: ⌘0 ignores the chrome insets. The 21-artboard grid starts under the top band and its last row is cut by the toolbar.
- **[ux]** `ak-mixed-filter-*`: the Canvases-panel Print chip dims the open canvas's artboards. 08 dims only from Layers (note 10), and the Canvases hit list doesn't touch the canvas. It's deliberate in `v2/kinds/KindDimHost.jsx:1-5`; confirm with the lead.
- **[microcopy]** "1 of 93 canvases have print" should be singular "has" (`v2/kinds/kind-filter-model.js:90`); CONTRACT §4 says counts read for 1 and many.
- **[ux · states]** `ak-video-*`: the click selected the inner `div` ("Clip · 320×180 › div", "div Frame") and no timeline came. The board's state (artboard selected → timeline slides out) isn't in evidence; re-shoot selecting by the label. The same frame repeats the wave-A carry-overs:
  - a tag-name title;
  - native `<select>` chevrons ("Top & Bottom▾" collides with its chevron);
  - a raw `rgb(19, 32, 56)` fill instead of swatch + token.
- **[a11y · ds-status]** `ak-print-letak-light`: the orange warning triangle sits on the azure selected pill, which is low non-text contrast. 08 draws the warning mark beside the label (`LabelWarn`), not inside it.
- **[ds-typography]** `ak-picker-full-*`: the placement ghost label "A2 420 × 594 mm" is mono. 08's `.ak-ghost-name` is sans with a kind icon. The ghost also lands off-screen right for a big preset.
- **[ux]** Frames that don't show their state (re-shoot):
  - `ak-picker-custom-*`: picker closed, no mm form (the form exists: `SizePicker.jsx:175`).
  - `ak-picker-search-*`: picker closed. The dark frame has the Rectangle tool armed, which suggests the typed letters reached tool keys; worth a repro.
  - `ak-picker-light`: no picker.
  - `ak-print-letak-*`: inspector folded, so "the inspector speaks mm" and the print guides are unseen.

Unreachable (INDEX): `ak-web-hug`, `ak-web-widths`, `ak-social`, `ak-safe-zones`, `ak-print-view`, `ak-convert`, `ak-convert-after`, `ak-warnings`, `ak-advanced`, `ak-real-*`.

## 09 Export — 3.3

Layers:
- **Task 4.** One sheet. Scope always shown with counts (Selection — · This canvas 1 · Folder 11 · Whole project 11). Kind-aware formats (PNG/JPG; Print PDF/PDF/PNG; MP4/GIF/Sound only). Bleed and crop marks ticked. "RGB — the print shop converts to CMYK."
- **IA 4.** Advanced holds Size by / Colour profile / file-name tokens with an example / the terminal + Claude Code command, which is exactly 09's Advanced.
- **States 3.**
- **Interaction 3.**
- **Microcopy 3.5.**
- **Parity** n/a.
- **A11y 3.5.** Other-formats `role=menu` and `--accent-text` are fixed by gate-b-a11y B5/B2.
- **DS type 2.** The whole sheet is mono.

**Blockers**
1. **[ds-typography]** (RC-A) Every 09 frame (`ex-social`, `ex-print`, `ex-video`, `ex-canvas`, `ex-batch-pick`, `ex-formats`, `ex-advanced`, `ex-handoff`, `ex-history`, both themes):
   - In mono: the Export sheet, the Handoff sheet and the Exports panel ("Export 1 artboard", Scope, rows, summary, the Other… list, "Hand off “Video” to production", "No exports yet.").
   - Still sans: only `.btn` buttons ("Cancel", "Export ↵"), because `.btn` sets its own family.
   - README: "Mono only in Advanced and code"; CONTRACT §5 type roles.
   - Files: `client/app.jsx:3207` (mounted outside `.st-shell`), `styles/0-reset.css:14`, `styles/1-tokens.css:134-142`.
   - Fix: see RC-A.
2. **[ds · microcopy]** (RC-B) `ex-handoff-dark/light.jpg`: the Handoff Advanced fold is a UA grey button whose text runs together as "AdvancedTargets, the command, the registry file". `.k-adv-btn` and `.ex-adv-hint` have no rule. Files: `v2/handoff/handoff-sheet.jsx:274-282` (and `ready-card.jsx:42-50`, the same classes). Fix: use the Export sheet's own fold (`ex-sheet-a` Advanced + hint), which renders correctly in the same frames.
3. **[ux · interaction]** `ex-formats-*`: the Other… list is clipped by the sheet's `overflow: auto` (`v2/export/export.css:24`). It shows Image + the first Document row and is cut mid-line at the sheet edge, while sitting over Cancel. 09 ex-formats draws the full grouped list with the disabled formats and their reasons. Fix: portal or position the popover outside the scroll box (or `overflow: visible` with the body scrolling on an inner element).
4. **[ux · states]** `ex-print-dark/light.jpg`: the preview column, "the PDF the print shop gets" (crop marks, tinted bleed, page stack, pager), is an empty 280 × 30 grey bar in both themes. It is the one thing 09 ex-print is about. `v2/export/preflight/paper.jsx` draws from the artboard's numbers, so the paper is missing either for This-canvas scope (nothing was selected in the shot) or for a fixture print artboard without `print` geometry. Either way an unlabelled empty box ships. Fix: draw the first page for any print scope, or say why there's no preview; re-shoot with the artboard selected.

**Warnings**
- **[ds]** (RC-A) No veil behind the sheet. `--scrim` is undefined outside `.maude-v2` and `export.css:15` has no fallback, so in light the canvas stays full-bright (`ex-batch-pick-light`, `ex-print-light`). 09 draws `<Veil />` under every sheet.
- **[ux]** `ex-video-dark`: the timeline island's header ("…2f ── Expand ×") sits at the same height as the sheet's Cancel / Export and reads as part of the sheet. The filmstrip is an empty band with ticks "0:00 0:00 0:01 0:01 0:01" (a 1 s clip rounded); deduplicate the ticks or show frames.
- **[microcopy]** "Instagram resizes anything larger." under Size for a Custom 480 × 320 artboard (`v2/export/export-copy.js:115`, used unconditionally at `sections/image.jsx:60`). Show it for social presets only.
- **[ux]** The image sheet drops the preview and the pixel sizes on the Size segment ("1× · 2×" vs 09's "1× 1080 × 1350"). File name and Save to moved under Advanced. That's allowed, but 09 draws them up front.
- **[ds]** (RC-B) The Exports panel's collapse button is a UA grey button. `.icon-btn` / `.k-icon-sm` have no rule outside `.home-root` (`v2/export/exports-panel.jsx:55`; `job-row.jsx` has the same). The panel also lies over the Inspector's top rows (`ex-advanced-dark`).
- **[ux]** Batch groups carry no thumbnails (09 `Group arts=`), and "Other format" wraps to two lines in the key column (`ex-batch-pick`).
- **[microcopy]** Video timeline empty state "No clips on clip yet." The artboard name "Clip" is lower-cased and unquoted (`v2/empty/empty-copy.js:144`). Use: No clips on “Clip” yet.
- **[ds]** Native `<select>` with UA chevrons in the group rows and the inspector Export row (wave-A carry-over).

Unreachable (INDEX): `ex-progress`, `ex-states`, `ex-batch`, `ex-offline`, `ex-huge` (render), `ex-share-vs`, `ex-edges` (hub), `ex-handoff-ready`, `ex-handoff-edges`, `ex-print-warn`, `ex-web` (not shot).

## 10 Share and Collaboration — 3.3

Scored on 8 of 20 artboards; 13 are hub-only.

Layers:
- **Task 3.5.** The local project's Share opens on the CONTRACT §6 "Move to cloud" offer, with Cancel / Move to cloud and the Export hint, as 10 co-local-cloud draws it.
- **IA 3.5.** The Comments panel is right: Open · Mine · Resolved · All, grouped by canvas, right side.
- **States 3.**
- **Interaction 3.5.**
- **Microcopy 3.**
- **Parity** n/a.
- **A11y 3.5.** The comment-row nested-interactive issue is fixed by gate-b-a11y B1.

The mm comment line "52 mm from the left · 70 mm above the trim" and the video "at 0:00" chip are good and match 10.

**Blockers**
1. **[ds-typography]** (RC-A) `co-share-sheet-*`, `co-share-advanced-*`: the Share sheet is mono end to end (title, question, body, hint, Advanced). It's mounted at `app.jsx:3198`, outside `.st-shell`.
2. **[microcopy · ds]** `co-share-sheet-*`: the title reads "Share Smoke.tsx", a file name with its extension. README: no paths in the default view; 10 titles it "Share Combine-kampan". The source is `hooks/use-tabs.jsx:188` (`label: basename(path)`) feeding `v2/share/share-model.js:126`. Fix: pass the canvas name (strip the extension, as the pill does).
3. **[ds-typography · microcopy]** (RC-C) `co-comment-compose`, `co-comment-video`, `co-comment-print`: the composer is still v1.
   - What's on screen: a mono uppercase "NEW COMMENT" header with a raw element id chip "cd:566b4b33", mono uppercase CANCEL / SAVE, a UA resize grip, and hex fallbacks on `--maude-chrome-*`.
   - What 10 draws (co-comment-thread): the thread card, an avatar, "Reply…" with a send arrow, and the @ menu with each person's role.
   - Wave A listed this as "v1 composer (wave B, known)", and wave B didn't land it.
   - Files: `apps/studio/comments-overlay.tsx:1460-1495`, `apps/studio/client/comments-overlay.css:88-190`.

**Warnings**
- **[ux · states]** `co-comment-thread-*`: after ⌘↵ the thread doesn't open, and only a square numbered azure pin "1" is left. 10 draws an avatar pin and the open thread with Resolve.
- **[ux]** `co-comments-panel-*`: your own comment shows author "?" and the filter says Mine 0.
- **[ds · presence]** `co-presence-*`: "You" is a grey-azure "YO" disc. CONTRACT §6 says "You" is yellow locally; the kit draws `you` as the person's initial on yellow (`_kit.tsx:276`).
- **[microcopy]** The composer placeholder says "Esc to cancel". CONTRACT §6 wants key names in lower case in running copy (esc).
- **[ux]** The Share sheet stacks two titles ("Share Smoke.tsx" + "Move “e2e-fixture” to the cloud?"). 10 co-local-cloud shows the question only.
- **[ds]** Share › Advanced fields and the Invite button are UA inputs and a UA button (white wells with a black border).
- **[ux]** `co-comments-panel-light`: the zoom chip "100%" overlaps the project switcher at the foot of the Canvases panel in Preview.
- **[ux]** The composer covers the video's time readout (`co-comment-video`), and "NEW COMMENT" wraps to two lines beside the mm chip (`co-comment-print`).

Unreachable (INDEX, hub): `co-roles`, `co-browser-view`, `co-follow`, `co-bring`, `co-spotlight`, `co-mention-notify`, `co-sync-offline`, `co-sync-back`, `co-conflict`, `co-trashed`, `co-twelve`, `co-ask-edit`, `co-access-ends`. Also the "two AIs" part of `co-presence` (ai).

## 12 Import and Assets — 3.6

Layers:
- **Task 4.** Assets is the left panel's third tab. The Photos group with a count, the Not used chip, + / From this Mac…, the browse view with Newest first + Large/Small, and details in place of the list (size, Added, **Place ↵**, Used in 2 canvases, Advanced with "Stored as" + the `<img>` snippet) all match 12.
- **IA 4.**
- **States 3.5.** The AI-search offer "Search what's in the pictures too? … Turn on…" with the foot "Searched 19 assets — names and tags" is 12 ia-assets-find verbatim.
- **Interaction 3.5.**
- **Microcopy 3.5.**
- **Parity** n/a.
- **A11y 4.**
- **DS 3.** The two import sheets are mono.

**Blockers**
1. **[ds-typography]** (RC-A) `ia-figma-sheets-*`, `ia-brand-steps-*`: Import from Figma and Import a brand are mono (title, labels, body, the "Figma isn't connected yet" callout, the logo drop well), on UA inputs.
2. **[microcopy]** `ia-photo-inspector-*` (and every inspector with an Interaction section): "Preview plays it; the link shows on the canvas while this is selected — as in 04 Modes." Product copy cites a design canvas. Source: `v2/inspector/sections/interaction.jsx:191`. Fix: drop "— as in 04 Modes".

**Warnings**
- **[ux · states]** `ia-photo-steps` is identical to `ia-photo-inspector`. There's no Photo tab, so Look / Light · Colour / ✦ Remove background / Apply to every use are unreachable. The tab needs a content-addressed `src` (`inspector/inspector-panel.jsx:528-533`), and the fixture's `Matchday-01.jpg` is a named asset that the Assets panel lists. If named assets are meant to get the Photo tab, this is a defect; otherwise it's the fixture. Unscored either way.
- **[ds-status · ux]** `ia-gen-ask-*`:
  - The error-red line "Select an artboard first — it sets the picture's shape." shows before anything was tried, while Hero is visibly selected.
  - The controls are a UA textarea, a native select, a UA `▸ Advanced` disclosure, and Generate as an outline button.
  - The time / billing line and the licence line that 12 draws are missing.
- **[ux]** `ia-assets-browse-*`: the browse view runs to the window bottom and covers the toolbar's left half; 12 stops it above the toolbar (`leftStyle` height). The back control "Assets" has no chevron.
- **[ux]** `ia-assets-keys-*`: a selected tile shows its name and "Used in 2 c…" (truncated) but no "↵ places it" hint or tile menu (12 note 5).
- **[ux]** `ia-assets-tidy-*`: a cramped foot. "2 assets · 247 / KB" and "Move 2 to the / trash…" both wrap.
- **[ds]** (RC-B) `k-sw` status words in `v2/import/figma-sheet.jsx:338` and `brand-result.jsx:122-143` have no shell rule. They aren't on screen in these frames but will render unstyled.
- **[ds-typography]** (RC-C) "Replace…" is the v1 `.st-btn` in mono (`inspector/css-knobs.jsx:1289`). The inspector title "img Image" is a tag name (wave-A carry-over).
- **[ux]** Search hits don't carry the matched name under the tile (12 ia-assets-find `Tile match=`).

Unreachable (INDEX): `ia-drop-photos`, `ia-placed`, `ia-more-ways` (desktop), `ia-missing`, `ia-missing-gone`, `ia-edges` (hub), `ia-gen-placed`, `ia-figma-arrived`, `ia-figjam`, `ia-brand` (network), `ia-advanced` (not shot as a whole).

## 13 Design System — 3.7 (Make-a-design-system states only)

**The board itself is unscored.** In the browser lane the S10 seeds render "design-system can't be drawn right now", so every board, edit, reach, review, truth, switch, library, migrate and edge state is unscored. The scored states are `ds-make-entry`, `ds-make-inputs` and `ds-make-sentence`.

Layers:
- **Task 4.5.** The Canvases panel offers "Make a design system" in place of the pinned row. The sheet has 13's three numbered inputs, the spark line "AI puts three directions on a new Design system canvas, each in Light and Dark. Your canvases don't change until you choose.", and "✦ Make three directions", disabled until the sentence is typed.
- **IA 4.**
- **States 3.5.** 3 of ~40 states.
- **Interaction 3.**
- **Microcopy 4.5.**
- **Parity** n/a.
- **A11y 3.5.**

The sheet is sans and on-token, unlike 09/10/12's sheets.

**Blockers**
1. **[ds · a11y-adjacent · interaction]** (RC-B) `ds-make-inputs-*`, `ds-make-sentence-*`: "Mostly for" is four unstyled UA buttons. In dark they are 15 px grey slabs; in light, black-bordered boxes. **No pressed state is visible**: `aria-pressed` carries it for AT, but a sighted user can't tell which audience is chosen. 13 draws the `.seg` with Websites pressed. `.k-seg-b` has no rule. Files: `v2/ds/make-sheet.jsx:208-224`; the same markup is in `review-sheet.jsx:268` and `switch-sheet.jsx:202`, so the Update-N and Switch reviews will show it too. Fix: style `.seg` / `.k-seg-b` once in the shell from the tokens (the Export sheet already rebuilt its own segment, `export.css`).

**Warnings**
- **[ux]** No audience reads as pre-selected; 13 defaults to Websites. Confirm the default once B1 makes the state visible.
- **[ux]** In the empty project the Share button reads dimmed (`ds-make-entry-dark`); check that's intended.

Unreachable (INDEX): ds-board covers `ds-where-*`, `ds-board-*`, `ds-edit-*`, `ds-truth-*`, `ds-many-*`, `ds-multi-*`, `ds-edge-*`, `ds-advanced`; ai covers `ds-make-directions`, `ds-make-mix`, `ds-make-filling`, `ds-make-done`. The DS board needs the desktop lane or a converted project.

---

## Pass B quick scan (all five)
- **Hardcoded values.** The new `v2/*` CSS is clean: tokens, `--space-*`, `--type-*`. The hard-coded and off-ladder values are confined to v1 survivors:
  - `comments-overlay.css` `--maude-chrome-*` with hex fallbacks;
  - `.st-layer-type` 9 px and `.st-rp-hint` 10 px;
  - `#a78bfa` instance purple at `3-shell-maude.css:2174`.
- **Type roles.** Shell chrome and the new panels are sans; Advanced mono is correctly mono. Mono leaks come from RC-A (sheets) and RC-C (Layers, composer, `.st-btn`). Weights stop at 600.
- **Surfaces / radii.** Islands, chips and tiles are on the 14 / 10 / 6 ladder; I saw no raw radii. The Export veil is missing (RC-A).
- **Icons.** Line and monochrome in Edit; Preview tools carry colour as allowed; no emoji in chrome.
- **Hard stops.** Glass: none. Decorative gradient: none. Pastel: none (the swirl photos are fixture content). Neumorphism: none. 3D: none. Mascot: none.
- **Motion.** Not testable from stills.

## Verdict

```json
{
  "agent": "design-critic",
  "iter": 1,
  "gate": "wave-B part 2",
  "scores": { "08-artboard-kinds": 3.4, "09-export": 3.3, "10-share-collab": 3.3, "12-import-assets": 3.6, "13-design-system": 3.7 },
  "gate_bar": 4.0,
  "areas_passing": [],
  "blockers": 11,
  "warnings": 34,
  "root_causes": [
    { "id": "RC-A", "summary": "Sheets mounted outside .st-shell inherit the v1 :root mono --font-body and miss the .maude-v2 tokens (no --scrim veil)", "file": "apps/studio/client/styles/1-tokens.css:134 + 0-reset.css:14 + app.jsx:3198/3207", "hits": ["09 B1", "10 B1", "12 B1"] },
    { "id": "RC-B", "summary": "Kit classes lifted from _kit.css with no shell rule (k-adv*, k-seg-b, k-sw, icon-btn, k-icon-sm, k-dialog-a, k-mono)", "file": "v2/handoff/handoff-sheet.jsx:274, v2/ds/make-sheet.jsx:218, v2/export/exports-panel.jsx:55", "hits": ["09 B2", "13 B1"] },
    { "id": "RC-C", "summary": "v1 surfaces not redone: Layers tree, in-canvas comment composer, .st-btn", "file": "client/inspector/inspector-panel.jsx:666, comments-overlay.tsx:1460, client/comments-overlay.css:88", "hits": ["08 B1", "10 B3"] }
  ],
  "top_blockers": [
    { "category": "ds-typography", "area": "09,10,12", "file": "apps/studio/client/app.jsx:3207 + styles/1-tokens.css:138", "summary": "Export, Handoff, Exports, Share, Figma and brand sheets render in the v1 mono face, no veil", "fix": "font-family: var(--font-body) on .maude and put each overlay root under the maude-v2 token scope." },
    { "category": "ia", "area": "08", "file": "apps/studio/client/inspector/inspector-panel.jsx:666", "summary": "Layers is the v1 DOM tree of one artboard (div/h2/p, 9-10px mono caps, Alt+key hint), not 21 artboards by kind", "fix": "Artboard rows with kind glyph + label, element tree under a disclosure, body font; key hint to ?/Advanced." },
    { "category": "ds", "area": "09", "file": "apps/studio/client/v2/handoff/handoff-sheet.jsx:274", "summary": "Handoff Advanced is a UA button reading 'AdvancedTargets, the command, the registry file'", "fix": "Use the Export sheet's styled Advanced fold." },
    { "category": "ux", "area": "09", "file": "apps/studio/client/v2/export/export.css:24", "summary": "Other... format list clipped by the sheet's overflow, over Cancel", "fix": "Render the popover outside the scroll box." },
    { "category": "ux", "area": "09", "file": "apps/studio/client/v2/export/preflight/paper.jsx", "summary": "Print PDF preview is an empty grey bar in both themes", "fix": "Draw page 1 for any print scope, or say why there is no preview; re-shoot with the artboard selected." },
    { "category": "microcopy", "area": "10", "file": "apps/studio/client/hooks/use-tabs.jsx:188", "summary": "Share title 'Share Smoke.tsx' shows a file name with extension", "fix": "Pass the canvas name, not basename(path)." },
    { "category": "ds-typography", "area": "10", "file": "apps/studio/comments-overlay.tsx:1460 + client/comments-overlay.css:88", "summary": "v1 comment composer: mono caps header, raw id chip cd:566b4b33, CANCEL/SAVE, hex fallbacks", "fix": "Rebuild as 10's thread card composer (avatar, Reply..., send, @ menu with roles)." },
    { "category": "microcopy", "area": "12", "file": "apps/studio/client/v2/inspector/sections/interaction.jsx:191", "summary": "Inspector copy cites a design canvas: '- as in 04 Modes.'", "fix": "Drop the reference." },
    { "category": "ds", "area": "13", "file": "apps/studio/client/v2/ds/make-sheet.jsx:218", "summary": "'Mostly for' segment is unstyled UA buttons with no visible pressed state", "fix": "Style .seg/.k-seg-b once in the shell from tokens (also fixes review-sheet and switch-sheet)." }
  ],
  "unscored": {
    "08": ["ak-picker-custom", "ak-picker-search", "ak-picker (light)", "ak-print-letak inspector + guides", "ak-video timeline", "ak-mixed-select inspector", "ak-web-hug", "ak-web-widths", "ak-social", "ak-safe-zones", "ak-print-view", "ak-convert", "ak-convert-after", "ak-warnings", "ak-advanced", "ak-real-*"],
    "09": ["ex-progress", "ex-states", "ex-batch", "ex-offline", "ex-huge", "ex-share-vs", "ex-edges", "ex-handoff-ready", "ex-handoff-edges", "ex-print-warn", "ex-web"],
    "10": ["co-roles", "co-browser-view", "co-follow", "co-bring", "co-spotlight", "co-mention-notify", "co-sync-offline", "co-sync-back", "co-conflict", "co-trashed", "co-twelve", "co-ask-edit", "co-access-ends", "co-presence two AIs"],
    "12": ["ia-photo-steps", "ia-drop-photos", "ia-placed", "ia-more-ways", "ia-missing", "ia-missing-gone", "ia-edges", "ia-gen-placed", "ia-figma-arrived", "ia-figjam", "ia-brand", "ia-advanced"],
    "13": ["every ds-board / edit / reach / review / truth / switch / library / migrate / edge state", "ds-advanced", "ds-make-directions", "ds-make-mix", "ds-make-filling", "ds-make-done"]
  },
  "fixed_since_wave_a": ["RC1 artboard label (sans 11px, azure pill + size)", "RC2 island--pad rule", "RC3 inspector segment font", "--accent-text contrast (gate-b-a11y B2)"],
  "opt_out_applied": "palette",
  "ds_blockers_downgraded": 0,
  "passed": false
}
```
