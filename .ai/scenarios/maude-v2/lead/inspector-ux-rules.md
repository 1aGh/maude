# Inspector UX rules (rc.1 finding 7)

_2026-10-31 · UX research spike, branch `r1-inspector-ux` (cut from feat/maude-v2 `13298803b`) · no product code_

Michal, verbatim: "inspector panel chce trosku jeste preskladat a dodelat, neni tam zadny color picker, drag to change,
fonty atd. Pusobi to docela slozite, treba fill jsme hned nepochopil ze je vlastne background atd. At na to nejaky ux
research udela jasne dana pravidla". Evidence: images 10 and 12 of the rc.1 brief. A Rectangle shows Fill =
`currentColor`, and its menu offers only "A colour, no token…" and "None".

**Rule sources, in precedence order** (ux-patterns §Precedence):
1. The maude-v2 DS, meaning `CONTRACT.md` words and voice plus DS schema v1.
2. Accessibility.
3. `plugins/design/skills/ux-patterns`.

Every rule below cites the UX-\* rule it applies. Where the skill has no rule, it says **new rule, no UX-\* yet** and
proposes wording in the skill's style (§6).

**The owning board.** Board 14 *Editing* owns the Inspector (kg `maude/v2-p8-owning-board-wins`,
`maude/v2-p8-inspector-full-per-14`). Any rule here that changes what board 14 draws needs board 14 updated in the
same package. §5 lists those rules.

---

## 1 · What exists now

### 1.1 Sections per selection kind (as built)

Sources:
- Kinds: `client/v2/inspector/kinds/index.js` (`registerKind`).
- Section order: `sections.js:194` `KIND_SECTIONS`, otherwise the `SECTIONS` table order.
- Bodies: `registerSlot`.
- Paths below are under `apps/studio/client/v2/inspector/`.

| Kind | Section order on the face | Notes |
| --- | --- | --- |
| **Artboard** (Web page · Fixed size · Print · Video) | One headless card: Size / kind rows · Layout (web only) · **Fill** row · Other widths · Formats / Safe zones (video) · Export | The Fill row is labelled **"Fill"** (`kinds/artboard.jsx:38`), but the file's own header says "Fill = Background". Board 14 draws the row as **Background** (`14 Editing.tsx:691,735,776,809`). This is drift from the owning board. |
| **Multi-artboard** | Size · Fill · Safe zones · Export | Its row already says "Background" (`kinds/multi-artboard.jsx:81`). The two artboard cards disagree. |
| **Frame** (a div) | Position · Size · Layout · Fill · Corners · Border · Effects · Type (only if it holds text) · Interaction · Export | A frame in auto layout that sits in no layout puts Layout · Size · Position first (`frame.jsx:~185`). Type here = Style, Size · weight, Colour. It has **no Font row**. |
| **Text** | Type · Fill · Position · Size · Interaction · Export | Type = Style (DS type roles `.t-*`) · Font · Size · weight · Line · letter · Align · Colour · Resizing · Case · Language. **There are two colour rows:** Type › Colour writes `color`, Fill › Fill writes `background`. Board 14 draws only *Fill › Colour* (`14 Editing.tsx:1191`). |
| **Shape** | Size (+ Kind) · Corners · Fill · Border · Effects · Position · Interaction · Export | This matches board 14 `ed-shape`, except Position comes last. Image 10 is this path. |
| **Picture** | Image (From · Fit · Zoom) · Adjust (Look · Background → Photo) · Position · Size · Interaction · Export | "Background" here means *remove background*. That is a third meaning of the word. |
| **Sticky note** | **Not in the Inspector.** It uses the board's floating toolbar (`annotations-context-toolbar.tsx`), with the fixed five-front `STICKY_PALETTE`. | This is by decision (kg "One sticky front five…"; stickers per kg "a sticker selected … shows the annotation toolbar"). Annotations are not DS objects. |
| **Multi-select** | Position · Size · Fill (opacity only) · Type (all text) · Combine shapes · Export | Values that differ read "Mixed" with up to four swatches (`color-control.jsx`). |

**Advanced** (`advanced.jsx:131`):
- **Elements:** Element (Tag · Classes · Selector · id) · Used in · Tokens it uses · CSS · Copy / Paste style / Copy CSS / Copy code.
- **Artboards:** Theme · Clip · Kind · exact size · print rows.
- **Default:** closed, because `FOLD_DEFAULTS = { help: true }` (`fold/fold-store.js:46`) and the per-Mac fold store wins once the person toggles it.
- **Exception:** the design-system inspector draws Advanced open (kg `v2-p8-c7`). Package C owns that default. These rules keep "closed" for the element Inspector.

### 1.2 Measured against Michal's list

The sentence below each claim is the measurement.

**M1 · The colour picker exists only as a token menu, and it is empty in a new project.**
- `ColorControl` (`sections/color-control.jsx`) lists the system's colour tokens, then "A colour, no token…" (a bare text field with the placeholder `oklch(…) or #…`), then "None".
- The list comes from `useAllDsTokens` (`client/inspector/ds-tokens.js:59`), which fetches nothing when `cfg.designSystems` is empty.
- A project made with **Create a local project** has no design system, because `home/create-local.ts` → `scaffold-design.ts` seeds none. So the menu is empty, which matches images 10 and 12.
- "+" then writes **`currentColor`** as the new fill (`sections/fill.jsx:76-77`, and the gradient at `:87`).
- No drawn picker, no recent colours and no eyedropper exist in the Inspector. The drawn OKLCH picker `client/v2/ds/colour-picker.jsx` and the off-system question `client/v2/ds/off-system.jsx` ("Use Accent" / "Add it to the system", `POST /_api/ds/add-colour`) exist only on the Design system canvas.

**M2 · With a system, the menu is long, flat and incomplete.**
- I ran `parseTokensCss` over the repo's two systems (scratch probe):
  - maude-v2 offers **77 colour tokens in one unordered list** and drops **7** role tokens.
  - maude offers 41 tokens and drops **9** role tokens.
- The dropped tokens are written as `color-mix()` or `light-dark()`: `--scrim`, `--selection` and the `--status-*-soft` tokens.
- The parser also keeps only the **first** declaration of each name, so the swatch shows one theme's value.
- DS schema v1 defines **41 colour roles in 9 groups**: surfaces 5 · text 4 · borders 3 · accent 7 · status 16 · presence 3 · focus · selection · overlay (`schema/ds-schema-v1.json`). The picker uses none of that grouping.

**M3 · Drag-to-change is built and switched off.**
- The shared `NumberField` (`client/inspector-controls.jsx:161`) scrubs: a leading grip, a 3 px dead zone, Shift ×10, Alt ×0.1 (`:72-135`, DDR-169).
- **Every v2 call site passes `scrub={false}`**:
  - `position.jsx:172,186,201`
  - `size.jsx:30`
  - `kinds/text.jsx:439,452`
  - `color-control.jsx:111`
  - `opacity-row.jsx:26`
  - `point.jsx:80,91`
  - `border.jsx:89`
  - `kinds/artboard-rows.jsx:80`

**M4 · Font controls exist only on a text, and they write raw values.**
- A text has Font (from `--font-*` tokens, `kinds/text.jsx:357`), Size (token or length) and Line · letter (raw % and px).
- Weight is a fixed raw select of 400 / 500 / 600 / 700 (`sections/type.jsx:24`). It ignores the four `--weight-*` roles the schema guarantees, and it offers Bold even though CONTRACT §5 stops weights at semibold for the shell. A canvas DS may differ.
- A frame or button that holds text gets only Style, Size · weight and Colour, with no Font row. Michal probably had a shape or frame selected, so he saw no font at all.

**M5 · "Fill" means four things, and "Background" means three.**
- "Fill" is:
  - the paint section and row (`background`) on frames and shapes;
  - the artboard's page colour;
  - a Size mode (`Hug · Fill · Fixed`, `size.jsx:13`);
  - an image Fit option (`image.jsx:24`).
- "Background" is:
  - the multi-artboard paint;
  - the Picture › Adjust "remove background" hand-off;
  - Advanced's CSS label for `background-color`, which shows as "Fill" (`advanced-rows-default.jsx:252`).

**M6 · currentColor is shown in the Inspector's own colour.**
- The chip swatch is `swatchCss('currentColor')`, painted inside the shell. So it shows the panel's text colour (the dark grey in image 10), not the object's resolved colour.
- The word comes from `colourWords`, which reads `currentColor` back as raw code ("currentColor" in image 10, "currentcolor" in image 12).

**What is fine and stays:**
- token-first writes (`var(--x)` only, `color-control.jsx:8`);
- "Mixed" with swatches;
- text Styles as DS type roles with override and detach (`edit-ops/text-style.ts`);
- "+" to add Fill, Border and Effects;
- Advanced at the foot;
- the hug-height 264 px card (kg `v2-p8-c2`).

---

## 2 · Research — principles, not a product to copy

| # | Principle (what the tools agree on) | Evidence |
| --- | --- | --- |
| P1 | **Where → how big / how it flows → how it looks → hand-off.** Position and size, then layout, then appearance (opacity, corners), then the paint stack (fill → stroke → effects), then export. A type-specific section (text, image, component) comes just before the paint stack. A section a kind cannot use is **hidden, never greyed**. | [Figma design panel](https://help.figma.com/hc/en-us/articles/360039832014) · [Sketch Inspector](https://www.sketch.com/docs/interface-and-settings/the-mac-app-interface/the-inspector.md) · [Webflow Style panel order (mirror)](https://webflow.tenten.co/en/overview-of-style-panel/) · [Penpot interface](https://help.penpot.app/user-guide/the-interface/) |
| P2 | **One label covers two code properties.** Canvas-first tools say "Fill" everywhere. CSS-first tools say "Backgrounds" for boxes and put text colour under Typography. A fill on text becomes `color`, and a fill on a box becomes `background-color`. Neither convention is "right". A tool has to say which one it means, in one place. | [Figma](https://help.figma.com/hc/en-us/articles/360039832014) · [Webflow Backgrounds](https://help.webflow.com/hc/en-us/articles/33961278898323) · [Grida, color vs background-color](https://grida.co/docs/@designto-code/css-color-vs-background-color) · [Framer "Fill"](https://www.framer.com/dictionary/fill) |
| P3 | **Disclose, at most two levels deep, behind a label that previews what is there.** Paint lists start empty and grow with "+". A non-default hidden value surfaces inline. Hiding a frequent control behind a click measurably slows people down. Figma brought "Clip content" back as a checkbox for that reason. | [NN/g progressive disclosure](https://nngroup.com/articles/progressive-disclosure/) · [Figma UI3 write-up](https://www.figma.com/blog/our-approach-to-designing-ui3/) · [Penpot fills](https://help.penpot.app/user-guide/designing/color-stroke/) |
| P4 | **A constrained picker has a tokens part and a custom part.** Tokens are grouped by collection or group and can be searched. A bound value looks different from a raw one (pill or square versus plain). Unbinding is an explicit "Detach". A raw value is allowed, then **flagged by a separate check** that suggests the nearest token. It is not blocked at entry. | [Figma variables in the picker](https://help.figma.com/hc/en-us/articles/15343107263511) · [Figma Check designs](https://help.figma.com/hc/en-us/articles/39592284074263) · [Penpot tokens](https://help.penpot.app/user-guide/design-tokens/) · [Sketch colour variables](https://www.sketch.com/docs/symbols-and-styles/color-variables/) · [Webflow variables](https://help.webflow.com/hc/en-us/articles/33961268146323) |
| P5 | **Scrub from the label, with arrows ±1 and Shift ±10.** Dragging the label or icon changes the value. Arrows step by 1, Shift by 10, and a fine modifier (Alt = 0.1) is common but not universal. Fields accept arithmetic. Penpot turns drag **off** on a token-bound field, and Figma made opacity type-only because a drag clashed with the fields around it. | [Figma nudge](https://help.figma.com/hc/en-us/articles/4404575206295) · [Figma forum on opacity scrub](https://forum.figma.com/report-a-problem-6/bug-scrub-drag-percentage-opacity-values-broken-58377) · [Sketch maths in fields](https://go.sketch.com/docs/designing/layer-basics/resizing-and-rotating-layers.md) · [Webflow Shift ±10 / Alt-drag](https://wishlist.webflow.com/ideas/WEBFLOW-I-1698) · [Penpot Shift+arrow](https://ark.sudovanilla.org/Penpot/penpot/commit/f8491e96311d4614e893976f11b4649677ca92f3) · [Penpot tokens disable drag](https://help.penpot.app/user-guide/design-tokens/) |
| P6 | **A style first, then family · weight · size · line height · letter spacing · align.** Paragraph, case, OpenType and variable axes sit one level deeper. A style and per-property overrides exclude each other, so an override is marked and Detach is explicit. | [Figma text](https://help.figma.com/hc/en-us/articles/360039956634) · [Figma forum, paragraph spacing](https://forum.figma.com/ask-the-community-7/where-has-the-paragraph-spacing-setting-gone-24602) · [Penpot typography tokens](https://help.penpot.app/user-guide/design-tokens/) |
| P7 | **A value that is not set here says where it comes from.** "Mixed" covers a multi-selection, and typing sets all of them. An inherited value looks different from a local one, can be traced to its source, and can be reset. Colour across a mixed selection gets its own deduplicated list. | [Webflow style labels](https://help.webflow.com/hc/en-us/articles/33961332425875-Style-labels) · [Figma selection colours](https://help.figma.com/hc/en-us/articles/360042553434) · [Penpot mixed](https://help.penpot.app/user-guide/designing/color-stroke/) |

**Unverified:**
- Figma's exact UI3 section names, because its help page would not load.
- Sketch's and Figma's official scrub modifiers. Only third-party sources describe them.
- Any study of people confusing Fill with Background. Only anecdotes exist, and Michal's report is one of them.
- How any tool shows `currentColor`. I found no source.

---

## 3 · Rules

Each rule has a **Check**: a yes/no test a builder can automate. IR = Inspector rule.

### A · Order and visibility

**IR-1 · One order for every kind.** Sections follow **Kind-specific → Position → Size → Layout → Corners → Fill →
Border → Effects → Type → Interaction → Export**: appearance, then the paint stack (P1).
- The one kind-specific section comes first:
  - Artboard: kind rows.
  - Text: Type, which also moves Type up for this kind.
  - Shape: Kind.
  - Picture: Image · Adjust.
  - Clip / caption / music: their own sections.
- Today's shape puts Position last and the frame puts Corners after Fill. Both move, which is a board 14 change (T0).
- Applies UX-HIER-1 (one region = one content group) and UX-HIER-2 (rank by order). It extends P1.
- *Check:* `v2-inspector-sections-order.test.ts` asserts `sectionsFor(kind)` for all seven kinds against one table in `sections.js`. The comment at `sections.js:183` is deleted or made true.

**IR-2 · A section a kind can't use is absent.** It is not greyed out and not empty. A section whose only rows are
"+" add buttons shows its title with "+" and no rows: Fill, Border and Effects on a new object.
- Applies M2 and UX-CONT-3. It extends P1 and P3.
- *Check:* for each kind's fixture, no rendered section has zero rows unless it has a "+" button.

**IR-3 · The face holds what a designer changes every day.** Advanced holds what code reads: tag, classes, selector,
id, raw CSS, Copy CSS / code, Theme, the exact kind. Advanced starts **closed** for the element and artboard
Inspector. The per-Mac fold store remembers a person's choice (V2-4.10). Package C owns the design-system
inspector's default and is not changed here.
- Applies UX-ACT-7 (tier, then disclose behind "More"/Advanced) and the CONTRACT §3 word *Advanced*.
- *Check:* `FOLD_DEFAULTS.inspector !== true`. A fresh-prefs render has `aria-expanded="false"` on the Inspector fold. No face row reads a CSS property name (a regex over rendered face labels against a list of CSS property names).

**IR-4 · A frequent control is never behind a click.** Any value that differs from the system default shows on the
face, even when its control normally lives in Advanced. Example: a non-default blend mode, or a theme override on an
artboard, shows as one quiet row with a reset.
- Extends UX-ACT-7 (new clause). P3.
- *Check:* a fixture whose element sets `mix-blend-mode` renders a face row for it while Advanced is closed.

### B · Words

**IR-5 · "Background" for a box, "Colour" for text, "Fill" for a shape. One word, one meaning.**

| Selected | Section title | Row label | Writes |
| --- | --- | --- | --- |
| Artboard, multi-artboard | Fill | **Background** | `background` |
| Frame, button, instance | Fill | **Background** | `background` |
| Shape, path | Fill | **Fill** | `background` / SVG `fill` |
| Text | Type | **Colour** (the one colour row) | `color` |
| Text with a box behind it | Fill | **Background** (a "+" add only, never shown by default) | `background` |

- The section keeps the title **Fill**, so the paint group is found in the same place on every kind, as board 14 draws it.
- The row says what the colour is *of*.
- Size mode "Fill" stays: it is CONTRACT-adjacent and board 14 draws it.
- Picture › Adjust: today's row reads label "Background" with the button "Remove background" (board 14 `:1353`). The row becomes the button alone, with no label, since it is an action and not a value (UX-FORM-1 is about inputs). That way "Background" as a row label means only paint. This is a board 14 change (T0).
- Image Fit "Fill" stays. It is a Fit option, inside a picture's own section, and it means the same as Size › Fill.
- Applies UX-COPY-1 (precise, consistent words), M4 (one control per action) and CONTRACT §3 ("use exactly these").
- *Check:* a label test lists every rendered row label per kind, with no row label "Fill" on artboard, frame or text. `TESTIDS.md` keeps `ab-background` / `insp-ctl-fill`, because the testids do not change.

**IR-6 · A text has exactly one colour row.** Type › Colour is the text's colour. The text kind's Fill section is
reached only through a "+ Background" button at the foot of the Type section, and is not drawn by default.
- Applies M4, UX-ACT-5 and P2.
- *Check:* the text fixture renders one `ColorControl` before any "+" is pressed.

**IR-7 · Labels stay visible and read as words, never code.**
- A row label is always present.
- A placeholder is an example ("Example: #1E6BFF or oklch(0.6 0.2 255)"), never a bare code template like "oklch(…) or #…".
- No ALL CAPS.
- Applies UX-FORM-1 (blocker), UX-FORM-2, UX-COPY-2, and CONTRACT §4 voice.
- *Check:* no rendered `placeholder` matches `/…\)|e\.g\./`, and every `insp-ctl-*` has an associated visible `Row` label.

### C · Colour

**IR-8 · The colour picker is one popover, opened from the chip.** From top to bottom:
1. **Search** (filters by token name and role word).
2. **Recent**: the last 8 colours used in this project, tokens and raw colours, shown as a row of swatches.
3. **The system's colours as a swatch grid grouped by role**, in the schema order: Surfaces · Text · Borders · Accent · Status, then "More" (Presence · Focus · Selection · Overlay), then the system's expressive slots, then its own `--x-*` tokens, then "Other tokens" (a colour token the registry doesn't name).
4. **Other colour…**: the drawn OKLCH picker (`client/v2/ds/colour-picker.jsx`), plus a field that takes hex or `oklch()`.
5. **None**, where a value may be absent.

**Grid rules:**
- Equal cells. Each swatch has a hover or focus name and its role word.
- The selected token is ringed.
- In a two-theme system each swatch is split diagonally Light | Dark (CONTRACT §7 A15: "shows both on each swatch").

**Arrow-key navigation:** ↑↓ jump between groups, ←→ move within a group, ↵ picks, esc closes.

- Applies UX-TOK-1/2 (semantic tokens by element), UX-HIER-7 (equal cells), UX-ACT-6 (consistent anchors), UX-FORM-4 (pickers carry decision data: role word, both themes) and UX-A11Y-2. It extends P4.
- *Check:*
  - With the maude-v2 fixture, groups render in the schema order.
  - Every registry colour role the system declares is present, including `color-mix()` / `light-dark()` values.
  - Recent shows at most 8, newest first.
  - Keyboard picks a token without a pointer (happy-dom).

**IR-9 · A token is always written as `var(--name)`, and the chip says its name.** A raw colour is said in words
("Blue, not in the system") with a small "not in the system" mark on the chip, never as code.
- Applies UX-TOK-1. It extends V2-8.5 C2 `colourWords` and P4.
- *Check:* `v2-colour-words.test.ts` extends to the "not in the system" mark. No chip text matches `/^(#|rgb|oklch|currentcolor)/i`.

**IR-10 · "Other colour" asks once, at commit, and never blocks.** When the canvas follows a design system and the
person commits a raw colour, the picker shows the existing off-system question inline, under the field, with two
options:
- **Use \<nearest\>**: nearest by OKLab within the role group (kg S10.17 `nearest-group-first`).
- **Add it to the system**: the existing `POST /_api/ds/add-colour`, a waiting add in every mode (kg S10.17 `add-colour-both-modes`).

Rules for the question:
- Ignoring it keeps the raw colour.
- `ds-check` stays structural. The raw literal is the S-rule finding the off-system scan already reports.
- With **no design system** there is no question. The picker says "This project has no design system yet" with one action, **Make a design system**, which goes to the existing setup flow.
- Applies UX-ACT-1 (one primary in the question), UX-DLG-1 spirit (consequence, verb) and CONTRACT §4 (one action per callout). It extends P4. Respects DS schema [A14]: people never map tokens.
- *Check:* committing `#1e6bff` on the maude-v2 fixture renders `ds-offsystem-*` with two buttons, and the write happens before the question. Committing in a no-DS fixture renders the no-system line and no question.

**IR-11 · A new fill is never `currentColor`.** "+" adds the system's default for that slot:

| Slot | Default token |
| --- | --- |
| Background on an artboard or frame | `--bg-1` |
| Fill on a shape | `--bg-3` |
| Border | `--border-default` |
| Text colour | `--fg-0` |
| Gradient | the slot default → `--bg-0` |

With no system, "+" adds the last Recent colour, or a neutral mid grey if Recent is empty, and opens the picker at
once.
- New rule, no UX-\* yet (see UX-TOK-5 in §6). It fixes M1.
- *Check:* in a no-DS fixture, "+" never writes the string `currentColor`. In the maude-v2 fixture, "+" on a shape writes `var(--bg-3)`.

**IR-12 · An inherited colour says where it comes from.** `currentColor`, `inherit`, or no value set reads **"Text
colour"** on a box, or **"Inherited"** on a text.
- The swatch is painted with the object's **resolved** colour, which the canvas already reports (`el.computed`), never with the shell's own `currentColor`.
- Where the resolved colour equals a token, its name follows in grey: "Text colour · Ink".
- Picking a token replaces it, and **None** removes it.
- Extends UX-FORM-1 (the value is labelled) and P7. New clause, see UX-FORM-6 in §6.
- *Check:* a fixture with `background: currentColor` and computed `rgb(20,24,31)` renders the swatch at `rgb(20, 24, 31)` and the text "Text colour". No rendered chip reads "currentColor" or "currentcolor".

### D · Numbers

**IR-13 · Every number field scrubs from its label.**
- The row's leading letter or icon (W, H, X, Y, the rotate glyph, the Line / letter glyphs) is the drag handle, with the `ew-resize` cursor on hover.
- Drag right raises the value and drag left lowers it, by 1 unit per px.
- **Shift ×10, Alt ×0.1** (`NumberField`'s `makeScrubHandler` already does this).
- A 3 px dead zone, so a click focuses the field and never moves the value.
- ↑ / ↓ step 1, Shift+↑ / ↓ step 10.
- The field accepts `+ − × /` arithmetic.
- One scrub = one undo step.

**Exceptions:**
- **Opacity and %** fields are type and arrow only, because a drag there clashes with the fields around them.
- **A token-bound value** is not scrubbed. Its chip opens the token menu, and the value can be detached to a number through "A number, no token…" (CONTRACT §6 C15).
- New rule, no UX-\* yet: see UX-FORM-5 in §6. P5, DDR-169.
- *Check:*
  - A happy-dom drag of 20 px on the W handle raises it by 20, Shift raises it by 200, Alt by 2.
  - A 2 px drag changes nothing.
  - One ⌘Z restores the start value.
  - Fields that keep `scrub={false}` are listed by name in one allowlist test (opacity, %, token-bound).

### E · Type

**IR-14 · Type rows, in order: Style · Font · Size · Weight · Line height · Letter · Align · Colour.** Resizing,
Case and Language sit after them, and Paragraph spacing, OpenType and tabular figures sit under Advanced.
- **Style** is the system's type roles (`.t-title` … `.t-code`), read through `roleName`.
- **Font** offers the system's `--font-display / -body / -mono` (plus extensions such as `--font-rounded`), shown as each family's first name.
- **Weight** offers the `--weight-*` roles by name (Regular · Medium · Semibold · Bold, where the system's bold differs from semibold).
- **Size** and **Line height** offer the `--type-*` / `--lh-*` steps, with "A number, no token…".
- A value that differs from the Style shows the existing override dot plus "from \<Style\>". **Reset** and **Detach** stay as they are (S2.12).
- Applies UX-TOK-1, UX-HIER-2 and UX-FORM-1. P6.
- *Check:*
  - The weight menu items equal the system's `--weight-*` tokens and write `var(--weight-*)`.
  - No raw `400–700` list remains.
  - The Font menu equals the `--font-*` roles.

**IR-15 · Text inside a frame gets the same type rows as a text.** A frame, button or instance that holds text shows
Type with Style · Font · Size · Weight · Colour, writing to the element that holds the text, as `type.text` already
targets. A shape or frame with no text has **no Type section**.
- Applies UX-HIER-1, M4 and P1.
- *Check:* the frame-with-text fixture renders `insp-row-font`, and the empty-frame fixture renders no Type section.

### F · Density and state

**IR-16 · One row = label · control (· unit).** The label column has one width across the whole card. Rows within a
section are 4-step apart, and sections are separated by one divider plus an 8-step gap. Inputs read recessed, darker
than the card.
- Section titles use the panel title role (CONTRACT §5: `--type-xs`, semibold, `--fg-2`).
- Live numbers use tabular figures.
- Applies UX-FORM-3 (4/8 scale, bound to DS space tokens), UX-HIER-4, UX-HIER-5 (one alignment anchor), UX-HIER-9 and CONTRACT §5.
- *Check:* a computed-style test asserts that every row's label `offsetWidth` is equal, and that number inputs carry `font-variant-numeric: tabular-nums`.

**IR-17 · Read-only follows access, not each control.** A viewer sees the same face, with readable values and no
editable control (kg `v2-8.4-inspector-readonly-by-role`). This is unchanged and listed so the new picker and scrub
inherit it.
- Applies UX-ACT-5.
- *Check:* with `advancedAccess.readOnly`, the picker popover does not open and a scrub drag changes nothing.

---

## 4 · Taste options for Michal (via the keeper, then debate)

Each option has a one-line trade-off. The recommendation is marked ★.

**O1 · Density of the card** (IR-16)
- **a ★ Calm.** 28 px rows, sections always open, a 264 px card (today's size). Easy to scan, but long kinds such as frame need a scroll.
- **b Compact.** 24 px rows, with two numbers per row wherever a pair exists (W · H, X · Y, Line · letter). Shorter, closer to a pro tool, but harder to hit and denser to read.
- **c Collapsible sections.** Titles fold, and the fold state is remembered per section. Shortest, but it adds a third level of disclosure, which NN/g warns against, and hides values (IR-4).

**O2 · Where the colour picker opens** (IR-8)
- **a ★ Popover from the chip, beside the card.** The grid and the drawn picker open in one floating popover; the canvas stays visible. It is the common pattern, but it is one more floating layer to place against the panels.
- **b Inline, expanding inside the card.** No new layer, but it pushes the rows below it down and doesn't fit 264 px with a drawn square.
- **c Tokens inline, custom in a popover.** The swatch grid unfolds in the card; "Other colour…" opens the drawn picker as a popover. Tokens are one click, but the picker is in two places and the behaviour has two states to learn.

**O3 · Naming the paint** (IR-5)
- **a ★ Section "Fill", row "Background / Fill / Colour" by kind.** It is what board 14 already draws. The section is in a stable place and the row says what is painted, but it uses two words.
- **b "Background" everywhere except shapes.** Section and row match the CSS. Clear to anyone who knows the web, but a shape's "Fill" sits in a section with a different name on other kinds.
- **c "Fill" everywhere, with a hint line.** "Fill — the background of this frame". One word, but this is exactly the version Michal didn't understand.

**O4 · The scrub handle** (IR-13)
- **a ★ The label or icon inside the field** (W, H, rotate glyph). Every field has one and the target is large, but the letter must look draggable (cursor only).
- **b The row label** ("Width"). A larger target, but it fights with label clicks and focus and with the rows that hold two fields.
- **c A grip that shows on hover** (the v1 `NumberField` grip). The handle is explicit, but it is chrome that appears and disappears and costs width in a 264 px card.

---

## 5 · Implementation plan

**Owner rules.**
- Board 14 owns the Inspector. IR-1, IR-5, IR-6, IR-8, IR-13 and IR-14 change what it draws, so **T0 updates board 14 first**, and every builder codes against the updated board.
- CONTRACT §3 gains one row (Background · Fill · Colour), §6 gains one line (scrub), and the keeper signs both off.
- The DS schema registry is **not** changed. The picker only reads `ds-schema-v1.json` groups. Writes go through existing routes: `var()` CSS writes, and `POST /_api/ds/add-colour`.

| Task | Files (owner) | Tests and guards | Done when | Est. |
| --- | --- | --- | --- | --- |
| **T0 · Board and words** (spike/keeper) | `.design/ui/v2/14 Editing.tsx` (picker popover, labels, scrub cursor, type rows), `.design/system/maude-v2/CONTRACT.md` §3 / §6, `plugins/design/skills/ux-patterns/SKILL.md` + `reference.md` (UX-FORM-5/6, UX-TOK-5) | `cli/lib/plugin-v2-words.test.mjs` stays at 0. Regenerate `contract-voice` with `node scripts/gen-plugin-surfaces.mjs`. | The board renders. Michal has picked O1–O4. | 0.5 d |
| **T1 · Token list from the registry** | `client/inspector/ds-tokens.js` (per-theme values, `color-mix` / `light-dark` accepted), new `client/v2/inspector/colour-groups.js` (schema groups, then slots, then own, then other) | Unit test: maude-v2 and maude fixtures offer every declared colour role (0 dropped, against today's 7 and 9), groups in order, both theme values. Fail-first: today's parser drops `--scrim`. | Probe in §1.2 M2 reads 0 dropped. | 0.5 d |
| **T2 · Picker popover** | `sections/color-control.jsx` (chip → popover), new `sections/colour-popover.jsx` (+ css), reuse `client/v2/ds/colour-picker.jsx` + `ds/off-system.jsx`. Recent colours live per Mac in `prefs.json`, keyed by project, on the V2-4.10 fold-store pattern. That adds no new runtime path; a new `_*` path would have to land in all four DDR-115 lists. Testids added to `TESTIDS.md` + `testids.json`. | happy-dom: grid order, keyboard pick, Recent ≤ 8, "Other colour" → off-system question, no-DS line. Browser e2e `apps/studio/test/e2e/inspector-colour.e2e.mjs` picks a token on a shape and reads `var(--…)` from source. Desktop step in `apps/desktop/e2e/scenarios/edit-shapes.e2e.ts`: pick, reopen, Recent shows it. Dead-control crawler: every swatch button does something. | Image 10 cannot be reproduced. | 1.5 d |
| **T3 · Defaults and currentColor** | `sections/fill.jsx` (slot defaults, IR-11), `sections/colour-words.js` + `color-control.jsx` (IR-12, resolved swatch) | Fail-first: "+" in a no-DS fixture writes `currentColor` today (red), then never does (green). The label test covers "Text colour". | — | 0.5 d |
| **T4 · Labels and order** | `sections.js` (one order table, IR-1), `kinds/artboard.jsx:38`, `kinds/text.jsx` / `sections.js` text list (IR-6), `kinds/image.jsx:225` ("Remove background"), `sections/row.jsx` (label column, IR-16) | Update `v2-inspector-sections-order.test.ts`, `v2-inspector-artboard.test.tsx`, `v2-inspector-text.test.tsx`, `v2-inspector-image.test.tsx`. Add a per-kind label snapshot test. Desktop e2e `edit-artboards` / `edit-text` read the row label. | — | 0.5 d |
| **T5 · Scrub on** | every `scrub={false}` call site in §1.2 M3, `client/inspector-controls.jsx` (handle = the leading label/icon, ↑↓/Shift, arithmetic, one undo step per scrub through the existing edit-ops batch) | happy-dom drag and modifier test, dead zone, undo, read-only. The allowlist test for the remaining `scrub={false}`. Desktop e2e step in `edit-layout.e2e.ts`: drag W 20 px → 20, ⌘Z. **WebKit** pointer check (memory: WebKit invalid on a locked screen). | — | 0.75 d |
| **T6 · Type rows** | `sections/type.jsx` (weight tokens, line-height tokens), `kinds/text.jsx` (row order IR-14), Font row registered for `frame` / `button` / `instance` with text (IR-15) | Fail-first: the weight menu reads 400–700 today. Token test. Frame-with-text fixture. Desktop `edit-text.e2e.ts` picks a weight and reads `var(--weight-medium)`. | — | 0.75 d |

**Totals.**
- Estimate: about **5 builder-days**, plus T0 at 0.5 d.
- Order: T0 → T1 → T2 / T3 in parallel, while T4, T5 and T6 run on their own.
- Builders: up to 4 at once. T4 and T6 both touch `sections.js` and `kinds/text.jsx`, so serialize them or give one builder both.
- None of them touch `canvas-lib.tsx`, `input-router.tsx`, `app.jsx` or `actions/`. The picker is local UI, not an action. A "Pick colour…" ⌘K entry, if wanted, becomes a registry entry in a follow-up.

**Risks.**
- **CONTRACT:** low. One words row is added and no word is removed. "Remove background" is already the button text on board 14.
- **DS schema:** none to the registry or `ds-check`. A raw colour stays a schema escape hatch, flagged by the existing off-system scan.
- **Owning-board rule:** medium. Builders must not ship before T0 updates board 14, or the critic's goldens go red (`v2-p8-owning-board-wins`).
- **Testids:** a label changes, an id does not. The new popover ids go into `TESTIDS.md`.
- **Scrub:** pointer capture inside the WKWebView, and a scrub over a token-bound field. Both are handled by IR-13's exceptions plus a WebKit pass.
- **Recent storage:** if it needs a new `_*` path, it must land in all four DDR-115 lists together. The recommendation is to reuse the existing per-Mac prefs store.

---

## 6 · Proposed additions to `ux-patterns` (wording in the skill's style)

- `UX-FORM-5` **Number fields scrub from their label.** Drag the field's label or icon to change it by one unit per px. Shift ×10, Alt ×0.1, a dead zone so a click only focuses, ↑↓ ±1 and Shift ±10, arithmetic accepted, one drag = one undo. Percent and token-bound fields don't scrub. *Check:* a 20 px drag changes the value by 20, Shift by 200, and a 2 px drag changes nothing.
- `UX-FORM-6` **A value not set here names its source.** An inherited, mixed or `currentColor` value reads in words ("Inherited", "Text colour", "Mixed"), shows its resolved swatch, and can be replaced or reset in one step. *Check:* no field shows a CSS keyword as its value.
- `UX-TOK-5` **Pickers are token-first, with one honest escape.** The system's tokens grouped by role → recent → "Other colour…". A raw value is allowed, said in words and flagged once with the nearest token or "Add it to the system". A new value defaults to the slot's role token, never `currentColor` or a hard-coded hex. *Check:* adding a fill in a system writes `var(--…)`.
- `UX-ACT-7` clause: **A hidden control with a non-default value surfaces on the face.** *Check:* a non-default value behind Advanced shows a face row.
