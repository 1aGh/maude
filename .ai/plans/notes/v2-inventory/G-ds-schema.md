# G — Maude design system schema v1 (study + proposal)

_Research study, 2026-10-08. Read-only over 7 systems in 3 projects and 208 canvases. It fills in the "Details pending the schema study" left open by the kg decision **"Maude v2: design-system switching rests on a three-tier schema, never on user token mapping"** (d_622299e3…, Michal 2026-10-08). It also supplies the data behind canvas 13 `ds-multi-switch` / `ds-multi-schema` ("Bring it up to the schema")._

**Constraints carried in from earlier decisions, and not reopened here:**
- **DDR-043:** never rename a contract name, and templates carry no visual priors.
- **The kg decision:** the schema has three tiers (required core roles, expressive slots, a system's own tokens). Users never map tokens by hand (manual mapping lives only in Advanced). The schema checks **structure, never values or aesthetics**.
- **DDR-093:** a canvas resolves its system from `meta.designSystem`.
- **DDR-172:** importer grammar and the theme-block-scoped write path.
- **DDR-141:** brand assets are a Tier-0 prior.

---

## 0. TL;DR

1. **The contract already exists and is mostly honoured.** The DDR-043 template defines 65 names. Add `--accent-hover/-active/-fg` (6 of 7 systems ship them) and the de-facto contract is **68 names**. Of the 36,411 `var()` uses across all canvases, **65.0% already hit those 68 names.**
2. **Switching breaks for reasons other than missing tokens.** The main causes are:
   - **Native aliases** (`--text`, `--surface`, `--w-semibold`, …): 16.9% of `var()` uses.
   - **Colour literals:** 3,856.
   - **Literal type and box metrics:** 38% of font sizes and 45% of padding/margin/gap/radius values are raw numbers.
   - **Hard-coded root-class wrappers:** 78 canvases.
   - **Direct imports of a system's private kit:** 24 canvases.
   - **Canvases pointing at a system the project doesn't declare:** 22 canvases.
   - **Name collisions:** the same name means different things in different systems. The worst is `--accent`, which in studyfi-web is a *pale hover background* (shadcn semantics).
3. **Proposal: three tiers, as the kg decision set out.**
   - **Tier 1 — Core:** the 68 DDR-043 names plus **27 functional roles**: accent soft/on-soft/text, focus ×3, selection, scrim, status fg/soft/text ×12, weight ×4, tracking ×3. Every name is required, with Light + Dark values. A switch swaps them mechanically.
   - **Tier 2 — Expressive slots:** 7 kinds (display ramp, brand colours, illustration palette, chart, texture, graphic device, signature motion). They are optional with no limit on count, named `<kind>-N`, and paired by kind and index on a switch.
   - **Tier 3 — Own tokens/components:** prefixed `--x-*` / `ext.*` and declared in the manifest. Canvases may use them only by that name, and a switch hands them to AI.
   - **Components:** a 14-item core set with one CSS class contract (BEM + ARIA states) and one React surface (`@maude/ds`, a virtual specifier like `@maude/canvas-lib`).
4. **Conformance today (none of the 7 systems is Conformant):**
   - **Missing roles (4):** maude-v2 (14 functional gaps), maude (23), alligators (24 gaps + 3 collisions), project (27, light only).
   - **Private-only (3):** studyfi-v3 (14 core names missing + 3 collisions), studyfi-web (19 missing + the `--accent`/`--primary` collision), studyfi (18 missing, no README/SKILL/preview, and not declared in config).
5. **Enforcement:**
   - One registry file (`ds-schema-v1.json`) and one checker verb (`maude design ds-check`, exit 0/10/11 like `bootstrap-check`).
   - A fallback CSS layer, so a "Missing roles" system still renders.
   - Completeness-critic fixes, including a bug: **C7 false-fails every system except the neutral `project` skeleton.**
   - Keeper Pass C "switchability", a PostToolUse lint hook, and `/design:setup-ds --upgrade-schema` as the "Bring it up" engine.

---

## How this was measured

- **Tokens.** Custom-property *declarations* were extracted from each `colors_and_type.css`. The regex catches same-line declarations such as `--type-xs: 11px; --lh-xs: 16px;`.
- **Contract.** The DDR-043 contract = the names in `plugins/design/templates/design-system-inspiration/core/colors_and_type.css.tpl` (65), plus `{{accent_block}}`.
- **Canvases.** Every `ui/**/*.tsx` plus its sibling `.css`, excluding `_history/` and Syncthing/Maude conflict copies, across:
  - `/Users/iagh/Maude/alligators/.design/ui`: 59
  - `/Users/iagh/git/studyfi/studyfi-design/.design/ui`: 94
  - `/Users/iagh/git/personal/maude/.design/ui`: 55
  - Total: **208 canvases, ~176k lines.**
- **Resolving a canvas's system.** Each canvas resolves to `meta.designSystem`, falling back to the project's `defaultDesignSystem` (alligators / studyfi-v3 / maude) when `.meta.json` has no field or doesn't exist. **56 of 208 canvases have no `.meta.json` at all.**
- **Colour literals:** `#hex`, `rgb[a]()`, `hsl[a]()`, `oklch()`, `oklab()`, `color-mix()` occurrences in TSX + CSS.
- **Type literals:** `fontSize: <number>` / `font-size: <n>`.
- **Box literals:** `padding|margin|gap|borderRadius: <n>`.
- **Scripts:** `scratchpad/scripts/{census,v1,v1b,classes,vals}.py`. These are heuristic regexes; expect ±5% noise, not exact compiler counts.
- **dugmate:** `/Users/iagh/git/personal/dugmate` does not exist on this machine, so it was not studied.

---

## 1. Token census

### 1.1 Systems at a glance

| System | Project | Declared tokens | Template-contract names present (/65) | Extras | Themes | Theme scope selector | Preview specimens (.tsx) | README "Token usage guide" | In `config.designSystems[]` |
|---|---|---|---|---|---|---|---|---|---|
| **maude** | maude | 76 | 65 | 11 | dark + light | `.maude[data-theme]` | 41 | no | yes (default) |
| **maude-v2** | maude | 106 | 65 | 41 | light + dark | `.maude-v2[data-theme]` | 39 | no | yes |
| **alligators** | alligators | 111 (+`brand.css`: @font-face only) | 62 (no presence) | 49 | dark + light | `.app[data-theme]` + bare `[data-theme="light"]` | 46 | **yes** | yes (only) |
| **project** | studyfi-design | 68 | 65 | 3 | light only | `.app[data-theme="light"]` | 1 (motion) | no | **no** |
| **studyfi** | studyfi-design | 140 | 44 | 96 | light + `.dark` | bare `[data-theme]` / `.dark` | 0 (tokens only, no README/SKILL) | — | **no** — yet 15 canvases use it |
| **studyfi-v3** | studyfi-design | 164 | 48 | 116 | dark + light | bare `[data-theme]` (`rootClass: sfv3` in config, **not** in CSS) | 52 (+10 `_*.tsx` kit files) | no | yes (default) |
| **studyfi-web** | studyfi-design | 99 | 43 | 56 | light + dark | `.studyfi-web` / `.app` / `.dark` | 3 | no | yes |

The keeper's Pass B needs a "Token usage guide" section in the README (`agents/design-system-keeper.md` pre-flight step 3). **5 of the 6 READMEs lack it**, so the token-role audit runs *degraded* on every system except alligators.

### 1.2 The DDR-043 contract, per system (grouped)

| Family (template names) | maude | maude-v2 | alligators | project | studyfi | studyfi-v3 | studyfi-web |
|---|---|---|---|---|---|---|---|
| `--bg-0..4` (5) | ✓ | ✓ | ✓ | ✓ | ✓ alias→`--bg/--surface*`; `bg-4`=`surface-3` (duplicate) | ✓ alias; **`bg-4`=`--bg-elevated` (darker than bg-3 in dark: L .225 < .28)** | ✓ alias (`bg-3`=`--card` white) |
| `--fg-0..3` (4) | ✓ | ✓ | ✓ | ✓ | ✓ alias→`--text*` | ✓ alias | ✓ alias; **`fg-3` = `fg-2`** |
| `--border-subtle/default/strong` (3) | ✓ | ✓ | ✓ | ✓ | no `default` (has `--border`) | no `default` | ✓ |
| `--accent` (+ hover/active/fg de facto) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | **`--accent` = `#ede9fe` pale bg (shadcn)** |
| `--status-success/warn/error/info` (4) | ✓ | ✓ | ✓ | ✓ | `warn` is `--status-warning` | same | ✓ alias |
| `--presence-*` (3, family-gated) | ✓ | ✓ | — (family off) | ✓ | — | — | — |
| `--shadow-sm/md/lg` (3) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ alias |
| `--radius-xs..xl, -pill` (6) | ✓ | ✓ | ✓ | ✓ (all `0`) | no `xs`, `pill`→`--radius-full` | same | no `xs` |
| `--space-0..8` (9) | ✓ | ✓ | ✓ | ✓ | **no `7`; Tailwind numbering** | **no `7`; Tailwind numbering** | no `0`, no `7` |
| `--font-display/body/mono` (3) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `--type-xs..3xl` (8) | ✓ | ✓ | ✓ | ✓ | **no `md`** | **no `md`** | **no `md`** |
| `--lh-xs..3xl` (8) | ✓ | ✓ | ✓ | ✓ | **none** (semantic `--lh-tight/snug/normal/relaxed`) | **none** (same) | **none** |
| `--dur-flip/soft/panel/route` (4) | ✓ | ✓ | ✓ | ✓ | **none** (`--dur-fast/base/…`) | ✓ | **none** (`--dur-fast/brand/reveal/loop`) |
| `--ease-out/in-out` (2) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ (out = overshoot spring) | **none** (`--ease-out-brand`) |
| `--layout-max-w/gutter` (2) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | `--layout-max` |
| **Hits / 65** | 65 | 65 | 62 | 65 | 44 | 48 | 43 |

**Intersections:**
- **All 7 systems:** only **40** names (bg×5, fg×4, border-subtle/strong, accent, font×3, layout-gutter, radius sm–xl, shadow×3, space 1–6 + 8, status success/error/info, type xs/sm/base/lg/xl/2xl/3xl).
- **The 6 non-shadcn systems:** 47 names, which adds accent-hover/active/fg, ease×2, layout-max-w and space-0.
- **De-facto contract:** template 65 + accent-hover/active/fg = **68 names.** Every Tier-1 proposal below starts from this.

**Values differ, and that difference is the brand's character, not a defect.** For example:

| | maude | maude-v2 | alligators | studyfi family |
|---|---|---|---|---|
| `--space-8` | 48 | 64 | 96 | 32 |
| `--type-base` | 14 | 14 | 16 | 16 |
| `--radius-md` | 7 | 10 | 6 | 6–10 |
| `--dur-route` | 280 | 280 | 500 | 420 ms |

The schema must not try to normalise these (kg decision: "never values"). **The one exception is meaning.** studyfi's `--space-N` is a Tailwind multiple (N×4px), while every other system's `--space-N` is an *ordinal step*, so the name carries a different contract. See §1.5.

### 1.3 Extras by role, per system

| Role | maude | maude-v2 | alligators | studyfi | studyfi-v3 | studyfi-web |
|---|---|---|---|---|---|---|
| **Accent sub-roles** | `--accent-muted` (α .12), `--accent-tint` (α .22, selection) | `-muted`, `-tint`, **`--accent-text`** | — | `--accent-soft/-softer/-bold` | `--accent-soft/-softer/-on-soft/-glow` | `--brand-soft/-softer`, `--accent-foreground` |
| **Extra accents** | — | `--spark*` (AI, 5) | `--accent-yellow` (= `--accent`) | `--accent-2(-hover)`, `--indigo-secondary` | `--accent-2*` ×6, `--accent-3*` ×6, `--celebrate*` ×5 | `--brand-2` |
| **Brand constants** | — | — | `--brand-green, --ink-black, --gray, --white` + aliases `--primary, --ink, --paper, --muted, --surface-deep` | `--logo-*` ×4 | `--brand-logo-*` ×3 | `--brand`, `--primary` |
| **On-status / status text** | — | `--status-*-text` ×4 | `--status-error-fg` (**means text**) | `--status-*-bg` ×4, `--status-error-bold` | `--status-*-bg` ×4, `--status-*-fg` ×4 (**means on-fill**) | `--success-ink` |
| **Focus** | — | `--focus-ring` (colour) | `--focus-ring` (colour) | `--focus-ring` (**box-shadow**), `--focus-ring-offset` (**colour**) | same as studyfi | `--ring` (colour) |
| **Overlay / scrim** | — (literal `oklch(0 0 0/.6)` in `components-dialogs.css`) | — | `--scrim-green`, `--scrim-ink` | — | — (`color-mix(var(--bg) 62%, transparent)` in specimens) | — |
| **Illustration / categorical** | — | `--object-*` ×7 (yellow, green, lilac, coral, sky, grey, **ink**) | — (monochrome brand) | `--pastel-*` ×4, `--tile-*` ×5, `--stat-*` ×4, `--action-*` ×4 | — | `--pastel-*` ×4, `--tile-*` ×5 |
| **Display ramp** | — | — | `--display-1..5`, `-lh`, `-tracking`, `-headline`, `-story`, `-fluid-hero`, `-3d-*` | `--type-4xl/5xl` | `--type-4xl..6xl` | `--type-4xl..7xl` |
| **Weight** | — | `--w-regular/medium/semibold` | — (hard-coded 900 italic in kit) | `--weight-light..bold` ×5 | same ×5 | — |
| **Tracking** | `-tight/-wide` | `-tight/-wide` | `--display-tracking` | `-tight/-normal/-wide` | `+ -snug` | — |
| **Line-height (semantic)** | — | — | `--display-lh` | `--lh-tight/snug/normal/relaxed` | same | — |
| **Motion extras** | — | `--dur-spring`, `--ease-spring` | `--dur-complex` | `--dur-instant..slow`, `--dur-ambient-1..3`, `--motion-*` ×8, `--ease-linear/out-soft` | + `--dur-celebrate/flame/xp-roll/progress/ambient-4`, `--ease-spring/celebrate` | `--dur-brand/reveal/loop`, `--ease-out-brand` |
| **Textures / patterns** | `--canvas-dot/grid/bg` | same | camo (`--camo-*`), halftone (`--halftone-*`), duo photo modes (`--duo-*` ×5), stripes, scute (`--scute-h*`), outline (`--outline-*` ×4), ghost (`--ghost-opacity*`) | — | `--pattern-dot/halftone/grain-alpha/mask/*-size` | — |
| **Elevation / material** | — | `--island-*` ×5 | — | `--shadow-xl/-accent`, `--panel-border-*` | `--shadow-xl/-accent*`, `--highlight-inset` | `--shadow-glow`, `--shadow-soft-*` |
| **Layout / platform** | — | `--control-off` | — | `--touch-target`, `--space-10/12/16` | `--touch-target`, `--space-10..24`, `--radius-2xl/3xl/full` | `--layout-reading`, `--space-10..20`, `--radius-2xl/3xl` |
| **Mascot** | — | — | — | — | `--mascot-aura-*` ×9 | — |

### 1.4 Which extras are really shared roles, and which are private

**Functional roles (should join Tier 1).** Most systems already have each of these under some name, and canvases use them heavily:

| Proposed v1 name | Existing equivalents | Canvas uses today (by native name) |
|---|---|---|
| `--accent-soft` | maude/v2 `--accent-muted`; studyfi/v3 `--accent-soft`; web `--brand-soft` | 106 (v3) + 41 (studyfi) + 56 (maude) + 69 (v2) = **272** |
| `--accent-on-soft` | v3 `--accent-on-soft`; web `--accent-foreground` | **206** (v3 132+62, web 12) |
| `--accent-text` | v2 `--accent-text`; alligators README "green text on paper" rule | 109 |
| `--focus-ring` (*colour*) + `--focus-ring-width` + `--focus-ring-offset` (*lengths*) | v2/alligators colour; studyfi/v3 box-shadow (**type collision**) | 12–20 |
| `--selection` | maude/v2 `--accent-tint` | 126 |
| `--scrim` | alligators `--scrim-ink/-green`; maude literal; v3 `color-mix` | literals in 4 of 5 dialog specimens |
| `--status-{success,warn,error,info}-fg` (on fill) | v3 `-fg` | — |
| `--status-*-soft` (tint bg) | studyfi/v3 `-bg` | ~60 |
| `--status-*-text` (status colour as text on surfaces) | v2 `-text`; **alligators `--status-error-fg`** | 56+ |
| `--weight-regular/medium/semibold/bold` | v2 `--w-*`; studyfi/v3 `--weight-*` | **1,061** (v2 595 `--w-semibold` alone) |
| `--tracking-tight/normal/wide` | maude, v2, studyfi, v3 | 360+ |

**Expressive kinds (Tier 2 slots, optional, any count):** display ramp (alligators, studyfi family); brand colours (alligators, studyfi-web, the logo colours); illustration palette (v2 objects, studyfi tiles/pastels/stats); chart (studyfi stats); textures (camo, halftone, vzor dot/grain, canvas dot-grid); graphic devices (scute, sash, ghost-A, outline/3D display, mascot auras); signature motion (v2 spring, v3 celebrate/flame/xp-roll, alligators complex, ambient loops).

**Truly private (Tier 3 `--x-*`):**
- Pantone constants (`--ink-black`, `--gray`, `--white`)
- `--island-*` (Maude chrome material)
- `--spark*` (Maude's AI role)
- `--canvas-*` (Maude app canvas)
- `--mascot-aura-*`
- `--duo-*` photo modes
- `--action-like/comment/repost/share`
- `--panel-border-ai`
- `--font-emoji`
- `--ease-linear`
- Tailwind-step spacing `--space-10..24`
- `--highlight-inset`
- `--control-off`

### 1.5 Name collisions (same name, different meaning)

These are worse than missing tokens: the switch "succeeds" and renders the wrong thing.

| Name | Meaning A | Meaning B | Effect on switch |
|---|---|---|---|
| `--accent` | primary action fill (6 systems) | **studyfi-web: pale violet hover bg `#ede9fe`** (shadcn) | primary buttons turn pale lilac with white text |
| `--primary` | alligators: brand green `#13322b` | studyfi-web: action violet `#6d28d9` | — (not contract; both get renamed) |
| `--muted` | alligators: Cool Gray colour | shadcn: muted *background* | — |
| `--status-error-fg` | alligators: error **text** on green surfaces | studyfi-v3: text **on the error fill** | text drawn on the wrong background |
| `--focus-ring` | colour (v2, alligators, web `--ring`) | **box-shadow** (studyfi, v3) | `outline-color: var(--focus-ring)` becomes invalid, so the ring disappears |
| `--focus-ring-offset` | (proposed) length | studyfi/v3: a **colour** | — |
| `--bg-4` | "hover / pressed" (template) | v3: `--bg-elevated` (not monotonic); studyfi: duplicate of `bg-3`; web: `--secondary` | hover states become invisible |
| `--space-N` | ordinal step N of 0..8 | studyfi family: N×4px (Tailwind) | `--space-8` = 32 vs 48–96; layouts collapse |
| `--ease-out` | a decelerate curve | v3: an overshoot spring (`0.34, 1.42, …`) | intended character, not a collision; listed only because a switch *will* make every panel bounce |

---

## 2. Component census

### 2.1 Specimens (preview pages)

The **shared specimen set** in maude, maude-v2, alligators and studyfi-v3 (17):
- **Foundations:** colors-{accent,status,surfaces,text,themes-side-by-side}, type-scale, spacing-scale, radii, elevation, borders, opacity, focus, grid, selection, iconography, motion
- **Brand:** logo
- **Components:** components-{buttons, callout, cards, dialogs, inputs, status, tables, toggles, tooltips}, empty-state, skeletons
- **UI kit:** ui_kits-desktop-index, plus a desktop showcase

| System | Extra specimens |
|---|---|
| maude, maude-v2 | command-palette, keyboard, list, resize-panels, shortcuts-overlay, toast-menu, colors-presence; maude also has inspector-controls and type-mono; v2 adds textures |
| alligators | banner, empty-state-generous, feature-grid, marketing-card, testimonial, marketing-{display,edges,surfaces}, graphics, mascot, signs-font, voice |
| studyfi-v3 | banner, bottom-sheet, pull-to-refresh, segmented-control, tab-bar, resize-panels, marketing-card, testimonial, feature-grid, empty-state-generous, gamification, mascot-moods, vzor, mobile_showcase/desktop_showcase |
| studyfi-web | components-web, homepage-showcase, motion |
| project | motion only |

### 2.2 `_components.css` (shell-injected into every canvas of that system)

| System | Lines | Class roots (count of rules) | Variants | State mechanism |
|---|---|---|---|---|
| maude | 240 | btn(14) switch(5) presence-dot(5) callout(5) seg(4) tree-row(3) input(3) tab(2) field(2) toolbar* panel* kbd insp-* chip tag tabbar textarea + 8 `.motion-*` | `btn--primary/ghost/danger/sm/icon`, `callout--info/success/warn/error`, `tag--accent` | `:hover :active :focus-visible :checked :disabled`, `[aria-selected]`, `[aria-pressed]` |
| maude-v2 | 235 | btn(16) sticky(6) switch(5) row-item(5) icon-btn(5) ask(5) seg(4) input(4) dock(4) chip(3) island(2) collapsible(2) field-label/hint kbd textarea | `btn--primary/ghost/spark/sm/lg`, `chip--accent/spark` | `:hover :focus-visible`, `[aria-pressed] [aria-checked] [aria-current] [data-collapsed]` |
| alligators | 255 | btn(10) switch(6) badge(6) table(5) input(4) callout(3) sash(2) card(2) camo-panel(2) tail-cut skeleton num | `btn--primary/secondary/ghost`, `badge--win/loss/warn/info/accent`, `callout--warn/error`, `card--deep` | `:hover :focus-visible`, `[aria-checked]`, **`.switch.is-on`** |
| studyfi-v3 | 356 | btn(20) switch(6) tile(5) textarea(5) input(5) seg(4) chip(4) card(4) field(3) select(2) streak pill badge | `btn--primary/ghost/soft/danger/energy/progress/icon/sm/lg`, `chip--accent/energy/progress`, `tile--accent/energy/progress`, `card--raised/interactive`, `input--error` | `:hover :disabled :active :focus-visible`; canvases also use `.is-active` (7×) |
| studyfi-web, project | 129 | only the 8 `.motion-*` role classes (template default) | — | — |

**Class names shared by maude, maude-v2, alligators and studyfi-v3:** only `btn`, `btn--primary`, `btn--ghost`, `input`, `switch` (5 names). Pairwise overlap is 5–13 names. Everyone already uses **BEM double-dash modifiers**, so the convention is free to standardise.

### 2.3 React kits (TSX exports a canvas can import)

| System | File | Exports |
|---|---|---|
| alligators | `preview/_kit.tsx` (219 L) | **colour constants as hex** (`G, G2, G_DEEP, INK, GRAY, Y, W, PAPER, BROWN, INK_1, INK_2, PANEL_1, PANEL_2, SCRIM_GREEN`, a CSS-filter `FY` that tints signs yellow), type helpers `disp/outline/filled/body/mono`, `KitDefs, Halftone, ScuteDivider, Cta, GhostA, GhostWordmark, SponsorBar, Duo, GameWeek, Versus`; `_signtext.tsx` → `SignText` |
| studyfi-v3 | `_shell.tsx` (418 L) | `Logo, AssistantBadge, SpecimenHeader, Rail, ContextualFab, DesktopShell, TopBar, FloatingNav, MobileShell, GlyphByName` |
| | `_parts.tsx` (1,304 L) | 38 product parts (`Avatar, SearchBar, SegTabs, FilterPills, ProgressRing, Flashcard, PostCard, Feed, ChatThread, …`) |
| | `_icons.tsx` | 60 `Icon*` + `Icon` + `IconName` |
| | `_mascot.tsx`, `_face-kit.tsx` | — |
| maude / maude-v2 | `_specimen-controls.tsx` | specimen chrome only (`ThemeToggle, ReducedMotionToggle, Mark, Spark, SpecimenHeader`) |
| maude repo (not in system) | `ui/v2/_kit.tsx` (1,577 L) | `Icon, Avatar, Kbd, Toolbar, Inspector, Dialog, Sheet, Toast, Tooltip, Callout, Menu, …` — an app kit that lives outside `system/` |

### 2.4 Common set and gaps

- **Present in every studied product system** (as specimen and/or classes): Button, Input/Textarea, Switch, Card, Callout, Dialog, Tooltip, Table, Badge/Status, Skeleton, EmptyState, Logo, Icon set.
- **Present in 3 of 4:** Segmented, Chip/Tag, Field (label + hint), ListRow (`tree-row` / `row-item`), Kbd, Menu/Toast, Tabs/TabBar, Avatar.
- **Missing everywhere as a named primitive:** Checkbox/Radio (only inside toggles specimens), Select (v3 only), Tabs as a class (maude only), Scrim (literals), and text-role classes (every canvas sets font metrics by hand).

---

## 3. Canvas consumption

### 3.1 `var()` uses (208 canvases, 36,411 uses)

Column definitions:
- **Core-68:** DDR-043 + accent states.
- **v1 new role:** the name is already a v1 Tier-1/2 name and exists in that system.
- **Optional:** a Tier-2 name.
- **Alias:** a native name with a known 1:1 v1 equivalent, e.g. `--text`→`--fg-0` or `--w-semibold`→`--weight-semibold`.
- **Private:** a system-only name.
- **Local:** declared inside the canvas.
- **Undefined:** not defined by the canvas's system.

| System (canvases) | Core-68 | v1 new role | Optional | **Alias** | **Private** | Local | **Undefined** |
|---|---|---|---|---|---|---|---|
| maude (41) | 7,133 | 176 | 59 | 414 | 83 | 67 | 38 |
| maude-v2 (16) | 8,443 | 247 | 31 | 1,560 | 323 | 659 | 62 |
| alligators (59) | 347 | 1 | 0 | 14 | 2 | 0 | 22 |
| studyfi (15, undeclared system) | 899 | 263 | 94 | 771 | 147 | 291 | 0 |
| studyfi-v3 (71) | 5,389 | 1,007 | 788 | 2,583 | 414 | 591 | 281 |
| studyfi-web (1) | 439 | 15 | 18 | 226 | 54 | 0 | 0 |
| "studyadmin" (4, **no such system**) | 551 | 0 | 0 | 313 | 0 | 0 | 528 |
| "studyfi + studyfi-v3" (1, invalid value) | 473 | 0 | 0 | 283 | 0 | 101 | 211 |
| **Total** | **23,674 (65.0%)** | 1,709 (4.7%) | 990 (2.7%) | **6,164 (16.9%)** | **1,023 (2.8%)** | 1,709 (4.7%) | **1,142 (3.1%)** |

**Reading it:**
- **72.4%** of `var()` uses already target v1 names (core 65.0 + new 4.7 + optional 2.7).
- Another **16.9%** can be rewritten mechanically (aliases), which brings the total to **89.4%**.
- Only **10.6% (3,874 uses)** need judgement: private + local + undefined.
- **Undefined uses already fail silently today, before any switch.** Examples:
  - studyfi-v3 canvases use `--space-7` (14×), `--border-default` (17×) and `--radius-pill` (12×), which studyfi-v3 doesn't define.
  - maude canvases use `--radius-xs` 298× and `--type-md` 100×; switching them to studyfi-v3 would silently drop **398 declarations**.

### 3.2 Values that bypass tokens

| System | Colour literals | SVG fill/stroke literals | `fontSize` literal : token | Box metric literal : token | Canvases importing a system kit directly |
|---|---|---|---|---|---|
| maude | 681 | 87 | 273 : 775 | 885 : 1,915 | 0 |
| maude-v2 | 279 | 0 | 103 : 1,217 | 941 : 2,762 | 0 |
| alligators | **574** (vs only 347 core `var`) | 7 | 90 : 50 | **1,090 : 103** | 6 |
| studyfi | 430 | 38 | 298 : 153 | 916 : 415 | 1 |
| studyfi-v3 | **1,790** | 54 | **1,010 : 776** | 2,780 : 2,527 | **17** |
| studyfi-web | 15 | 0 | 0 : 67 | 76 : 208 | 0 |
| **Total** | **3,856** | 189 | **1,875 : 3,077 (38% literal)** | **6,886 : 8,561 (45% literal)** | **24** |

- **The worst literal offenders** are AI-StudyMate/ux mobile canvases (335 and 181 literals in single files), `armory/ux/vzhledy.tsx` (185) and the moodboards (`v2/maude-v2-moodboard.tsx` 156 with 0 `var`). Moodboards are fine: they compare directions, so they are pinned by nature.
- **Where literals come from:**
  - Alligators' marketing canvases import hex constants from `_kit.tsx`. The kit's own header says these exist "because marketing canvases work with brand constants, not var()".
  - Every specimen set except maude-v2 carries literals: v3 previews 487, alligators 93, maude 49, v2 4.
- **"Opt-out" scope is common.** It accounts for 75 `palette` + 18 `aesthetic` + 25 `full` of the 152 canvases that have a `.meta.json` (78%), and it *licenses* a canvas-local palette. Without an explicit way to declare that local palette, it looks the same as a literal.

### 3.3 What breaks switching, ranked by blast radius

| # | Pattern | Count | Breaks how | Fix class |
|---|---|---|---|---|
| B1 | **Native alias names** (`--text`, `--surface-2`, `--w-semibold`, `--radius-full`, `--status-warning`, shadcn `--muted-foreground`, …) | 6,164 uses / 5 systems | undefined in the target system, so the text inherits and backgrounds go transparent | mechanical rename |
| B2 | **Colour literals** (style, CSS, SVG attrs, kit constants) | 3,856 + 189 | don't follow the switch: brand A's colours on brand B's surfaces | AI restyle (nearest-role suggestion via ΔE-OKLCH, then judged) |
| B3 | **Literal type and box metrics** | 1,875 font sizes; 6,886 box values | type ramp and density don't follow, so character is lost (alligators 16px base / 96px space-8 vs maude 14 / 48) | mechanical when the value equals a ladder step; AI otherwise |
| B4 | **Hard-coded root-class wrapper** `<div className="sfv3 orb-host" data-theme>` (61×), `"app …"` (40+×), `"maude …"` (35+×) | **78 canvases** | the target system's tokens are scoped to a different class, so every `var()` is undefined and the canvas renders white (the DDR-093 failure, re-entered through the wrapper) | mechanical: a shared `.ds` scope |
| B5 | **Private tokens** (`--island-*`, `--object-*`, `--accent-3-on-soft`, `--celebrate`, `--pattern-*`, `--mascot-aura-*`, …) | 1,023 uses | undefined in the target system | Tier-2 slot (paired) or Tier-3 `--x-*` (AI) |
| B6 | **Direct imports of a system kit** (`../system/studyfi-v3/preview/_mascot`, `_shell`, `_parts`, `_icons`, `_fonts.css`; alligators `_kit`) | 24 canvases, 41 import lines | hard path to another system's files; after a switch the canvas still renders system A's mascot, shell and icons | `@maude/ds` standard exports; `ext.*` stays pinned |
| B7 | **Undeclared / invalid `designSystem`** (`studyfi` ×15, `studyadmin` ×4, `maude` ×2 in studyfi-design, `"studyfi + studyfi-v3"` ×1) + **no meta at all** (56 canvases) | 22 + 56 | the switch scope can't count them; the render falls back to the default | require `meta.designSystem` ∈ config |
| B8 | **Name collisions** (§1.5) | 7 names | silent wrong rendering | AI judgement during Bring-up |
| B9 | **Component classes that aren't shared** (`.tile--energy`, `.btn--spark`, `.island`, `.is-on`, `.is-active`) | DS classes are 5–15% of className tokens (v2 1,332/8,904; maude 436/4,282; v3 393/7,676; alligators 0/392) | unstyled after a switch | standard class contract + `ext` |
| B10 | **Fonts loaded by the canvas** (`_fonts.css`, `brand.css` via `_brand-css.ts`, `@font-face` inside the web tokens CSS) | 1–7 canvases + 3 systems | the target system's fonts never load | fonts declared in the manifest, loaded by the shell |

---

## 4. Schema v1 proposal

### 4.1 Shape: three tiers (as decided in kg) plus one rule about names

```
Tier 1  CORE ROLES        required · fixed names · Light+Dark · swap mechanically
Tier 2  EXPRESSIVE SLOTS  optional · <kind>-N · any count · paired by kind+index · AI fills gaps
Tier 3  OWN               --x-* tokens / ext.* components · unlimited · declared · AI restyles on switch
```

**Rule about names:** a name means the same thing in every system. A system may keep native names (`--text`, `--primary`) as **aliases that point at the v1 role** (`--text: var(--fg-0)`). That inverts today's direction, where v1 aliases point at the native names. Aliases exist for production-code parity. Canvases never use them; the checker rewrites them.

**What the schema checks:**
- **Checks** structure only: names, presence, theme coverage, value *type* (a colour is a `<color>`, a width is a `<length>`) and naming collisions.
- **Never checks** values or aesthetics (DDR-043 + the kg decision).
- **Contrast** is a separate a11y report (a11y-critic / "Check the system"), never a conformance gate.
- **Spacing/type "bands"** are not checked at all.

### 4.2 Tier 1 — Core roles (95 names; 92 unconditional)

**A. DDR-043 names, unchanged (65 template names + 3 de-facto = 68):**

| Family | Names | Theme |
|---|---|---|
| Surfaces | `--bg-0` page · `--bg-1` card/panel · `--bg-2` popover · `--bg-3` input/row-hover · `--bg-4` pressed/selected-without-accent | L+D |
| Text | `--fg-0` primary · `--fg-1` secondary · `--fg-2` tertiary · `--fg-3` disabled/non-text | L+D |
| Borders | `--border-subtle` · `--border-default` · `--border-strong` | L+D |
| Accent | `--accent` (primary action fill) · `--accent-hover` · `--accent-active` · `--accent-fg` (text/icon on accent fill) | L+D |
| Status | `--status-success` · `--status-warn` · `--status-error` · `--status-info` (fills/icons) | L+D |
| Presence (only if `presence ∈ activeFamilies`) | `--presence-online` · `--presence-away` · `--presence-offline` | L+D |
| Elevation | `--shadow-sm` · `--shadow-md` · `--shadow-lg` | L+D |
| Radius | `--radius-xs` · `-sm` · `-md` · `-lg` · `-xl` · `-pill` | invariant |
| Space | `--space-0` … `--space-8`: **an ordinal ladder of 9 steps, strictly increasing** | invariant |
| Fonts | `--font-display` · `--font-body` · `--font-mono` | invariant |
| Type ramp | `--type-xs` `-sm` `-base` `-md` `-lg` `-xl` `-2xl` `-3xl`, each paired with `--lh-<step>` (unitless or px) | invariant |
| Motion | `--dur-flip` · `--dur-soft` · `--dur-panel` · `--dur-route` · `--ease-out` · `--ease-in-out` (all `--dur-*` collapse to 1ms under reduced motion) | invariant |
| Layout | `--layout-max-w` (`none` allowed) · `--layout-gutter` | invariant |

**B. Functional roles, new in v1 (27).** These are role pairs a canvas needs to stay legible after a switch. None of them is decorative.

| Group | Names | Type | Default derivation (fallback layer, §4.6) |
|---|---|---|---|
| Accent pairing | `--accent-soft` (tinted bg: selected row, chip) · `--accent-on-soft` (text on it) · `--accent-text` (accent used as text/link on `--bg-0..2`) | color, L+D | `color-mix(in oklch, var(--accent) 14%, var(--bg-1))` · `var(--accent-text)` · `var(--accent)` |
| Focus | `--focus-ring` **(colour)** · `--focus-ring-width` (length) · `--focus-ring-offset` (length) | color L+D / length | `var(--accent)` · `2px` · `2px` |
| Selection | `--selection` (text and object selection fill) | color L+D | `color-mix(in oklch, var(--accent) 24%, transparent)` |
| Overlay | `--scrim` (modal/sheet backdrop) | color with alpha, L+D | `color-mix(in oklch, var(--fg-0) 45%, transparent)` |
| Status pairing | `--status-{success,warn,error,info}-fg` (on the fill) · `-soft` (tint bg) · `-text` (status as text on surfaces) | color, L+D | `var(--bg-0)`/`var(--fg-0)` by fill lightness · 14% mix into `--bg-1` · `var(--status-X)` |
| Weight | `--weight-regular` · `--weight-medium` · `--weight-semibold` · `--weight-bold` (= the system's strongest; may equal semibold, e.g. maude-v2 caps at 600) | number | 400/500/600/700 |
| Tracking | `--tracking-tight` · `--tracking-normal` · `--tracking-wide` | length (em) | -0.01em / 0 / 0.04em |

**Why Tier 1 grows from ~60 to 95, against the decision's "~60" estimate:**
- Each of the 27 has an equivalent in 2–5 of the studied systems, and together they already carry **~2,300 canvas uses** under native names (§1.4).
- Without them, the most common canvas patterns can't survive a switch: a selected chip, a focused input, a status badge with readable text, a dialog backdrop.
- They are pairings and states, not expressive content, so DDR-043's bias-free rule holds: templates get placeholders, not values.

**Light + Dark.**
- Every colour-typed Tier-1 role has a value in **both** a `light` and a `dark` block. "Inherits from the other block via cascade" doesn't count; that is the V18c invisible-text bug.
- A system may declare `themes: ["light"]` only. It then conforms at **Missing roles** at best (flag `single-theme`), and dark previews of its canvases use the fallback layer's computed inversion, with a warning.
- **Locked brand values are allowed.** alligators' accent stays `#ffcd00` in both themes. The *roles* `--accent-text` / `--focus-ring` carry the per-theme difference (green on paper, yellow on green), which is exactly what the alligators README already does by hand.

**Value types checked:**
- `color`: any CSS colour, incl. `var()` / `color-mix()` resolving to a colour.
- `length`, `duration`, `easing`, `number`, `font-family`, `shadow`.
- A `--focus-ring: 0 0 0 2px …` box-shadow fails the type check. That is the studyfi/v3 collision.

### 4.3 Tier 2 — Expressive slots

Optional, any count, and named `<kind>-<N>` so they pair positionally across systems. Each slot carries a `role` hint in the manifest to make pairing smarter than index alone.

| Kind | Names | Shared companions | Pairing on switch | Examples today |
|---|---|---|---|---|
| **Display ramp** | `--display-1..N` (ascending size) | `--display-lh`, `--display-tracking`, `--display-weight` | by relative rank (A's 1..5 onto B's 1..3: nearest normalised position); if B has none, fall back to `--type-3xl` | alligators `--display-1..5` (names kept); studyfi `--type-4xl..7xl` → `--display-1..4` |
| **Brand colours** | `--brand`, `--brand-2..N` + `--brand-fg`, `--brand-N-fg` | — | by index; if missing, AI picks from B's accent family | alligators green, studyfi-web `--brand`, logo facets (`--brand-2..4`) |
| **Illustration palette** | `--palette-1..N` + `--palette-ink` (text on any swatch) + optional `--palette-N-fg` | — | by index modulo N; AI may reorder by hue role | v2 `--object-*` (6 + ink), studyfi `--tile-*` (5), `--pastel-*` |
| **Chart** | `--chart-1..N` + optional `--chart-grid`, `--chart-axis` | — | by index; if absent, `var(--palette-N)` | studyfi `--stat-*` |
| **Texture** | `--texture-N-opacity`, `--texture-N-size` + class `.texture-N` (+ `role: backdrop\|surface\|overlay`) | — | by role, then index; if missing, AI decides (usually drop) | alligators camo/halftone, v3 vzor dot/halftone/grain, Maude canvas dot-grid |
| **Graphic device** | class `.device-N` / React `ext` component with `role: divider\|frame\|ornament\|mascot\|badge` | — | by role; if B lacks it, AI restyles or removes | alligators scute/tail-cut, sash, ghost-A, outline/3D display; v3 mascot |
| **Signature motion** | `--dur-signature-N`, `--ease-signature-N` (+ `role: celebrate\|ambient\|playful\|emphasis`) | — | by role, then index; if missing, use `--dur-route` + `--ease-out` | v2 `--dur-spring/--ease-spring`; v3 celebrate/flame/xp-roll/ambient; alligators `--dur-complex` |
| **Extra accents** (existing `accentStrategy`) | `--accent-2..N` with the same 7 sub-roles as `--accent` (`-hover -active -fg -soft -on-soft -text`) | — | by index; if missing, use `--accent` | v3 citron/cyan; studyfi purple |
| **Optional scale extensions** | `--shadow-xl`, `--radius-2xl`, `--font-serif`, `--font-rounded`, `--touch-target`, `--layout-reading` | — | by name; if missing, use the nearest Tier-1 step | various |

### 4.4 Tier 3 — Own tokens and components (the extension namespace)

- **Tokens:** `--x-<name>`, for example `--x-camo-opacity`, `--x-island-bg`, `--x-spark`, `--x-mascot-aura-fire`, `--x-ink-black`. They are declared in `tokens.json` under group `x`, with `$extensions["sh.maude"].own = true` and an optional `"pairsWith"` hint for AI.
- **Components:** `ext.<Name>` in `@maude/ds` and `.x-<name>` CSS classes, for example `ext.ScuteDivider`, `ext.Mascot`, `ext.Island`, `.x-sash`, `.x-camo-panel`.
- **What canvases may and may not do:**
  - **Canvases never reference a private token by its raw/native name.** They do it only through `--x-*` (declared, flagged).
  - Brand constants frozen as hex are never referenced by a canvas at all. Constants like alligators' Pantone values live as `--x-*` *inside* the system and feed `--brand`, `--accent`, etc.
  - A canvas that uses `--x-*` / `ext.*` is **Switchable with review**. The checker writes the list to `meta.dsPins` so the switch dialog can say "12 hand-picked colours and its camo texture" (canvas 13 #22).

This reconciles two framings:
- the task brief's "canvases must not reference private tokens directly";
- the kg decision's "own tokens usable by canvases, flagged so a switch hands them to AI".

The indirection is the declared namespace.

### 4.5 Components v1

**Core component set (14, required for Conformant)**

Each component ships two things:
- a **CSS class contract** in `preview/_components.css`;
- a **React export** in `@maude/ds`. The default implementation lives in canvas-lib and renders the class contract, so a system that only writes CSS gets React components for free.

States always use pseudo-classes or ARIA attributes, never `.is-*`.

| Standard name | Class contract | Variants | Sizes | Required states |
|---|---|---|---|---|
| `Button` | `.btn` `.btn--primary` `--secondary` `--ghost` `--danger` | + `data-tone="accent-2…N\|brand"` | `--sm` `--lg` | `:hover :active :focus-visible :disabled [aria-pressed=true] [aria-busy=true]` |
| `IconButton` | `.btn.btn--icon` | same as Button | same | same |
| `Input` | `.input` `.textarea` `.select` | — | `--sm` | `:focus-visible :disabled [aria-invalid=true]` |
| `Field` | `.field` `.field__label` `.field__hint` `.field__error` | — | — | `[aria-invalid=true]` |
| `Switch` | `.switch[role=switch]` | — | — | `[aria-checked=true] :disabled :focus-visible` |
| `Checkbox` | `.checkbox` (+ `.radio`) | — | — | `:checked :indeterminate :disabled :focus-visible` |
| `Segmented` | `.seg` `.seg__item` | — | `--sm` | `[aria-pressed=true]` or `[aria-selected=true]` |
| `Tabs` | `.tabs` `.tab` | — | — | `[aria-selected=true]` |
| `Chip` (UI copy "Tag") | `.chip` `.chip--accent` `.chip--soft` | + `data-tone` | — | `[aria-pressed=true] :focus-visible` |
| `Badge` | `.badge` `.badge--success` `--warn` `--error` `--info` `--accent` | — | — | — |
| `Card` | `.card` `.card--raised` `--interactive` `--flat` | — | — | `:hover` (interactive), `:focus-visible` |
| `Callout` | `.callout` `.callout--info` `--success` `--warn` `--error` | — | — | — |
| `Dialog` | `.dialog` `.dialog__title` `__body` `__actions` + `.scrim` | — | — | `[open]` |
| `Tooltip` | `.tooltip` | — | — | `[data-side]` |

**Required brand pieces (also Core):**
- `Logo` (`variant: mark|wordmark|lockup`, `tone: auto|mono`), resolved from `assets/logos/` per DDR-141.
- `Icon` (`name` from a **standard vocabulary of 40 names**: home, search, add, close, check, chevron-up/down/left/right, arrow-up/down/left/right, more, settings, user, users, bell, share, link, trash, edit, copy, download, upload, lock, info, warning, error, success, star, heart, calendar, clock, image, file, folder, play, pause, external).
  - Each system maps the names onto its own icon family: v3 `_icons.tsx` already has 60, the v2 kit has `GLYPH_NAMES`.
  - Extra icons are `ext`.
- `Text` / type-role classes: `.t-display-1..N`, `.t-title`, `.t-heading`, `.t-subheading`, `.t-body`, `.t-body-sm`, `.t-caption`, `.t-label`, `.t-eyebrow`, `.t-code`, `.t-num` (tabular).
  - **This is where type character lives.** alligators' display = condensed 900 italic uppercase; v2's title = SF Rounded semibold; v3's = General Sans.
  - A canvas says *which role*, and the system says *how it looks*. This is the fix for B3 (38% literal font sizes).

**Extended set (recommended):** `Menu`/`MenuItem`, `Toast`, `Table`, `ListRow` (`.list-row[aria-selected]`), `Avatar`, `Kbd`, `Skeleton`, `EmptyState`, `Banner`, `Panel`, `Sheet`, `TabBar`, `CommandPalette`. Audience/platform packs: `Marketing` (FeatureGrid, Testimonial, MarketingCard), `Mobile` (BottomSheet, PullToRefresh).

**Mapping existing components onto the standard set** (recorded in `components.json`; old class kept as a second selector during migration):

| System-native | → v1 |
|---|---|
| alligators `Cta` (kit) | `Button[variant=primary]` (brand override; the scute arrow is part of the system's Button styling) |
| alligators `.badge--win/--loss` | `Badge--success/--error` |
| alligators `.switch.is-on` | `.switch[aria-checked=true]` |
| alligators `.num` | `.t-num` |
| alligators `.card--deep` | `Card--flat` + `data-surface="deep"`, or `ext` |
| alligators `.sash`, `.tail-cut`, `.camo-panel`, `ScuteDivider`, `GhostA`, `Halftone`, `Duo` | Tier-2 devices/textures (`.device-N`/`.texture-N`) or `ext.*` |
| maude-v2 `.icon-btn` | `IconButton` |
| maude-v2 `.row-item`, maude `.tree-row` | `ListRow` |
| maude-v2 `.island` | `Panel` (variant `floating`) |
| maude-v2 `.dock`, `.ask`, `.sticky`, `.btn--spark` | `ext.Dock`, `ext.Ask`, `ext.Sticky`, `Button[data-tone=x-spark]`→ext |
| studyfi-v3 `.btn--energy/--progress` | `Button[data-tone=accent-2/accent-3]` |
| studyfi-v3 `.btn--soft` | `Button--secondary` |
| studyfi-v3 `.tile--*` | `Card[data-tone]` |
| studyfi-v3 `.pill` | `Chip` |
| studyfi-v3 `.streak` | `ext` |
| studyfi-v3 `SegTabs`, `FilterPills` | `Segmented`, `Chip` group |
| studyfi-v3 `Mascot`, `DesktopShell`, `MobileShell`, the 38 `_parts` | `ext.*` (shells: see the DDR-127 Tier-0 showcase) |

### 4.6 Files and manifests

```
system/<ds>/
  colors_and_type.css     # runtime tokens (stays authoritative in v1; DDR-172 writes here)
  tokens.json             # DTCG — DERIVED by `ds-check --emit`, committed, freshness-checked
  components.json         # component manifest — hand/AI-authored, checked
  preview/_components.css # class contract (+ ext/x- classes)
  preview/_ds.tsx         # optional React overrides for @maude/ds standard names + ext.*
  README.md               # "## Token usage guide" auto-generated from registry + own notes
```

**Which file is the source of truth:**
- **v1:** CSS is the source and `tokens.json` is generated. Every agent reads CSS today, and DDR-172's patch-scoped writer targets CSS.
- **Later:** when the v2 Design-system canvas edits tokens in place (CONTRACT §7, "files under Advanced are generated from it"), flip `tokens.json` to be the source and generate the CSS. Two hand-edited sources would be drift.

**Selector rule.** Every theme block lists **both** `.ds[data-theme="<t>"]` and `.<rootClass>[data-theme="<t>"]` (plus `:root` for the default). `.ds` is the schema-wide scope class, which fixes B4 without touching canvases. It keeps V18b's per-artboard theming (a non-root class).

**Fallback layer.** The registry ships `ds-schema-v1.fallbacks.css`, which the shell injects *before* the system's tokens:

```css
@layer maude.fallback {
  :where(.ds, [data-theme]) {
    --accent-soft: color-mix(in oklch, var(--accent) 14%, var(--bg-1));
    --scrim: color-mix(in oklch, var(--fg-0) 45%, transparent);
    /* … one line per Tier-1 role */
  }
}
```

- It is declared on the same element as the system's theme wrapper, so `var(--accent)` resolves to *that* system's value.
- Unlayered system tokens always win.
- This is what makes **Missing roles** systems render instead of break.
- The checker reports every role served by the fallback, so it is never silent.

**`tokens.json` (DTCG format; verify the exact spec version at implementation time):**

```json
{
  "$schema": "https://maude.sh/schema/ds-tokens-v1.json",
  "$extensions": { "sh.maude": {
    "schemaVersion": 1, "system": "alligators", "themes": ["dark", "light"], "defaultTheme": "dark",
    "rootClass": "app", "colorSpace": "oklch",
    "fonts": [{ "family": "Avenir Next Condensed", "src": "assets/fonts/AvenirNextCondensed-HeavyItalic.ttf", "weight": 900, "style": "italic" }]
  }},
  "color": {
    "bg": { "0": { "$type": "color", "$value": "#13322b",
                   "$extensions": { "sh.maude": { "tier": 1, "role": "bg-0", "css": "--bg-0",
                                                   "modes": { "light": "#ffffff" } } } } },
    "accent": { "soft": { "$type": "color", "$value": "{color.x.gray}",
                          "$extensions": { "sh.maude": { "tier": 1, "css": "--accent-soft",
                                                          "source": "fallback|own|alias", "modes": { "light": "#f4f3ef" } } } } }
  },
  "display": { "1": { "$type": "dimension", "$value": "64px",
                      "$extensions": { "sh.maude": { "tier": 2, "kind": "display", "index": 1, "css": "--display-1" } } } },
  "x": { "camo-opacity": { "$type": "number", "$value": 0.07,
                           "$extensions": { "sh.maude": { "tier": 3, "css": "--x-camo-opacity",
                                                           "pairsWith": "texture:backdrop", "modes": { "light": 0.05 } } } } },
  "alias": { "primary": { "$value": "{color.brand.1}",
                          "$extensions": { "sh.maude": { "alias": true, "css": "--primary", "canvasUse": "forbidden" } } } }
}
```

**`components.json`:**

```json
{
  "$schema": "https://maude.sh/schema/ds-components-v1.json",
  "schemaVersion": 1, "system": "studyfi-v3",
  "components": {
    "Button": {
      "class": "btn", "export": "Button", "specimen": "preview/components-buttons.tsx",
      "variants": { "primary": "btn--primary", "secondary": "btn--soft", "ghost": "btn--ghost", "danger": "btn--danger" },
      "sizes": { "sm": "btn--sm", "md": null, "lg": "btn--lg" },
      "tones": { "accent-2": "btn--energy", "accent-3": "btn--progress" },
      "states": ["hover", "active", "focus-visible", "disabled", "pressed", "busy"],
      "legacyClasses": ["btn--soft", "btn--energy", "btn--progress"]
    },
    "Badge": { "class": "badge", "variants": { "success": "badge--success", "warn": null }, "fallback": { "warn": "info" } }
  },
  "typeRoles": { "display-1": ".t-display-1", "title": ".t-title", "body": ".t-body", "num": ".t-num" },
  "icons": { "family": "studyfi-v3", "export": "Icon", "map": { "home": "IconHome", "add": "IconAdd", "close": "IconClose" } },
  "slots": {
    "texture": [{ "index": 1, "class": "texture-1", "role": "backdrop", "native": "vzor-dot" }],
    "device":  [{ "index": 1, "export": "ext.Mascot", "role": "mascot" }]
  },
  "ext": { "Mascot": { "export": "ext.Mascot" }, "DesktopShell": { "export": "ext.DesktopShell", "role": "shell" } }
}
```

**`config.json`.** `designSystems[]` entries gain `"schema": 1` (written by the checker on success). Canvas `.meta.json` gains `"dsPins": [...]` (written by the checker).

### 4.7 Conformance levels

**Systems** (exit codes as in `bootstrap-check`):

| Level | Exit | Meaning | Switch behaviour |
|---|---|---|---|
| **Conformant** | 0 | All 95 Tier-1 roles (presence if active), each colour role in Light **and** Dark. Value types valid. No collisions. Own tokens are `--x-*`. 14 core components + Logo/Icon/Text present in CSS **and** `components.json`. Manifests fresh. | one review, nothing to map (canvas 13 #22) |
| **Missing roles** | 10 | All 68 DDR-043 names present with schema meaning, **but** some functional roles, components or a second theme are missing (served by the fallback layer). | switch works; the dialog lists "N roles are guessed"; offers Bring-up |
| **Private-only** | 11 | Any DDR-043 name missing, **or** any collision (§1.5), **or** core roles exist only under native names. | switching to/from it is refused, except via "Bring it up to the schema" (canvas 13 #23) |

**Canvases:**

| Level | Rule |
|---|---|
| **Switchable** | passes S1–S9 below |
| **Switchable with review** | only `dsPins` (Tier-3 use, declared `--c-*` local palette, `ext.*`) |
| **Pinned** | `opt_out_scope: full`, moodboards/comparisons, or `meta.dsPinned: true`; shown as "Left out — keeps <system>" |

**Where the 7 systems stand today:**

| System | Level | DDR-043 gaps | Functional gaps | Collisions | Own tokens to prefix | Notes |
|---|---|---|---|---|---|---|
| maude-v2 | **Missing roles** | 0 | 14 (`accent-on-soft`, focus width/offset, `scrim`, status fg×4, soft×4, `tracking-normal`, `weight-bold`) | 0 | 13 (island, spark, canvas) | closest to Conformant; `--w-*`→`--weight-*`, `--object-*`→`--palette-*`, `--accent-muted/-tint`→`-soft`/`--selection` |
| maude | **Missing roles** | 0 | 23 | 0 | 3 (`--canvas-*`) | v1 app system; scrim is a literal in specimens |
| alligators | **Missing roles** | 0 (presence family off) | 24 | **3** (`--primary`, `--muted`, `--status-error-fg`) | 34 | the strongest brand: needs AI judgement for palette (a monochrome brand gets tonal greens + yellow + gray) |
| project | **Missing roles** (single-theme) | 0 | 27 | 0 | 0 | the `--no-discovery` neutral skeleton (all radii 0); consider retiring it |
| studyfi-v3 | **Private-only** | 14 (`lh-*`×8, `border-default`, `radius-pill`, `radius-xs`, `space-7`, `type-md`, `status-warn`) | 8 (`accent-text`, `focus-ring-width`, `scrim`, `selection`, status `-text`×4) | **3** (`--focus-ring` box-shadow, `--focus-ring-offset` colour, `--bg-4` not monotonic) | 52 | heavy alias use in canvases (2,583) |
| studyfi-web | **Private-only** | 19 (dur×4, ease×2, lh×8, `layout-max-w`, `space-0`, `space-7`, `type-md`, `radius-xs`) | 26 | **2** (`--accent`, `--primary`) | 22 | code-derived reference of production; native names stay as aliases |
| studyfi | **Private-only** | 18 (+3 presence) | — | 2 (focus) | 44 | not in config, no README/SKILL/preview; 15 canvases use it |

**Checker bug to fix with this work.** Completeness-critic **C7** strips only `-fg|hover|active|glow|edge|muted`, so it counts the following as extra accent *families*:
- `--accent-tint`, `--accent-text`, `--accent-soft`, `--accent-on-soft`, `--accent-softer`
- `--accent-yellow`

Running its grep today gives: maude **2**, maude-v2 **3**, alligators **2** (all declared `single`), studyfi-web **2** (`--accent-foreground`), and studyfi-v3 ~**9** (declared `chromatic-3`). **Every system except the neutral `project` skeleton false-fails C7.** The v1 sub-role suffix list (`hover active fg soft on-soft text glow`) must be shared between the registry and C7.

### 4.8 Rules canvases must follow to stay switchable (S-rules)

| # | Rule | Check | Severity (default / `dsFidelity: strict`) |
|---|---|---|---|
| S1 | **No colour literals for colour the system drives.** No hex/rgb/hsl/oklch/named colours in `style`, canvas CSS or SVG `fill`/`stroke`. Allowed: photos/images; third-party logos; `<DrawProof>`/moodboard canvases (Pinned); and a **declared local palette** — under `opt_out_scope: palette`, colours live once as `--c-<name>` on the canvas root, ideally derived from roles (`color-mix(in oklch, var(--accent) 60%, var(--palette-2))`). | regex + AST | warning / blocker |
| S2 | **Only registry names in `var()`.** Tier 1/2 names, `--x-*` (Tier 3, auto-pinned), `--c-*` (local palette), canvas layout locals (`--i`, `--dly`). Never alias names (autofix), never another system's names, never undefined names. | registry lookup | alias = autofix; undefined = blocker |
| S3 | **Type through roles.** `.t-*` classes or `<Text role>`, or `--type-*`/`--display-*`/`--lh-*`/`--weight-*`/`--tracking-*`/`--font-*`. No numeric `fontSize`/`fontWeight`/`letterSpacing`/`fontFamily` literals. | regex | warning |
| S4 | **Box metrics through the ladder.** `padding/margin/gap/border-radius` use `--space-*`/`--radius-*`. Artboard geometry (width/height/absolute x/y) is layout, not system, and is exempt. | regex | warning |
| S5 | **No imports from `system/<ds>/…`.** Components, icons, logo and fonts come from `@maude/ds`. `ext.*` imports are allowed and auto-pinned. | import scan | blocker for new canvases |
| S6 | **Theme wrapper is `<DSRoot>` (canvas-lib) or `className="ds" data-theme`.** Never a system's rootClass literal. | regex | warning (autofix) |
| S7 | **Icons by standard name, the mark via `<Logo>`** (DDR-141). | keeper A.8 | per DDR-141 |
| S8 | **Fonts are never loaded by a canvas.** | regex on `@font-face`/`_fonts.css` | warning |
| S9 | **`meta.designSystem` is required** and must name a `config.designSystems[]` entry. | meta check | blocker |

**What a switch does, for canvases already at Switchable:**
1. Rewrite `meta.designSystem`.
2. Re-render. The switch touches **no canvas source.**
3. Tier-2 slots pair by kind and index.

For **Switchable with review**: the AI restyle pass (on by default, one undo step) maps `--c-*`, `--x-*` and `ext.*` to the target's roles/slots. "Version history keeps the old look."

---

## 5. Migration

### 5.1 Per system

"Mechanical" means a deterministic codemod in `ds-check --fix=mechanical`. "AI" means it needs the brand's taste or a semantic call.

| System | Mechanical | Needs AI judgement | Canvas impact |
|---|---|---|---|
| **maude-v2** | add `.ds` to theme selectors; `--w-*`→`--weight-*` (alias kept); `--accent-muted`→`--accent-soft`, `--accent-tint`→`--selection`; `--object-*`→`--palette-1..6` + `--palette-ink`; `--dur-spring/--ease-spring`→`--dur-/--ease-signature-1`; `--island-*`, `--spark*`, `--canvas-*`→`--x-*`; `--focus-ring-width: 2px`, `--tracking-normal: 0`; emit manifests | `--weight-bold` (= 600: bold is banned); status `-fg/-soft` ×8 from its own OKLCH hues; `--scrim` tone; `--accent-on-soft`; component map (`island`→Panel, `row-item`→ListRow, dock/ask/sticky→ext) | 16 canvases: 1,560 alias + 323 private uses rewritten; 6 wrappers; 279 literals for AI |
| **maude** | same renames; `--canvas-*`→`--x-*`; scrim literal in `components-dialogs.css`→`var(--scrim)` | 23 functional roles from its palette | 41 canvases: 414 alias, 83 private, 681 literals; 17 wrappers |
| **alligators** | `.ds` selectors; `--scrim-ink`→`--scrim` (`--scrim-green` = `--x-scrim-green`); `--display-1..5` already v1 names; Pantone constants → `--x-*`; `--brand: var(--x-brand-green)`; `.switch.is-on`→`[aria-checked]`; `.num`→`.t-num`; `.badge--win/loss`→`--success/--error` (old classes kept as second selectors); fonts into the manifest | **collisions:** `--status-error-fg` → `--status-error-text` (+ a real on-fill `-fg`); `--primary`/`--muted`/`--ink`/`--paper` become aliases or `--x-*`. A palette for a monochrome brand (tonal greens + yellow + gray: a brand call). `accent-soft/-on-soft/-text` (yellow on green vs green on paper). Status `-soft/-text` against the "no ink on green" hard-stop. `Cta`→Button. Kit hex constants `G, INK, Y…` → `var()` reads (`--x-*`). | 59 canvases: **574 colour literals + 1,090 box literals** (the most literal-heavy project per `var`); 36 canvases have no `.meta.json`; 6 kit importers |
| **studyfi-v3** | add DDR-043 names: `--lh-xs..3xl` from the semantic lh by size (xs–base→normal, md–xl→snug, 2xl–3xl→tight); `--type-md` = round(√(base·lg)); `--space-7` = midpoint(6, 8); `--radius-xs` = ½ sm; `--radius-pill: var(--radius-full)`; `--border-default: var(--border)`; `--status-warn` ↔ `--status-warning`; invert aliases (native names → `var(--v1)`); `--type-4xl..6xl`→`--display-1..3`; `--accent-2/3*` already Tier-2 names; `--celebrate*`, `--mascot-aura-*`, `--pattern-*`→`--x-*`/texture slots; `.ds` selector next to `sfv3` | **collisions:** `--focus-ring` box-shadow → colour + width + offset (and rewrite `box-shadow: var(--focus-ring)` call sites); `--bg-4` meaning (elevated vs pressed; ordering in dark). `--accent-text` value; `--scrim`; palette from tiles/pastels; component map (`tile`, energy/progress tones); 38 `_parts` + shells → `ext` | 71 canvases: **2,583 alias**, 414 private, **1,790 literals**, 1,010 literal font sizes, **17 kit importers**, 41 `sfv3` wrappers |
| **studyfi-web** | add dur/ease/lh/space/type DDR-043 names from its own scale (`--dur-flip: var(--dur-fast)`, …); native shadcn names become aliases | **`--accent` collision:** `--accent` := action violet (`--brand`/`#6d28d9` per contrast), the shadcn `--accent` → `--accent-soft`, `--accent-foreground` → `--accent-on-soft`; `--primary` → alias of `--accent-active`/`--brand` | 1 canvas |
| **studyfi** | — | decide first: **retire into studyfi-v3 or studyfi-web**, or bring up (it has no README/SKILL/preview, is undeclared, and is a "1:1 imprint" of the production app). Recommend: declare it in config as a Private-only reference, then migrate its 15 canvases to studyfi-web/v3 via switch-with-review. | 15 canvases (+4 "studyadmin", +1 invalid value → fix S9 first) |
| **project** | everything except the 27 functional roles | none, if deleted: it is the neutral `--no-discovery` skeleton. Otherwise re-bootstrap. | 0 canvases declare it |

**Effort:**
- **~80% of system-file edits** and **~89% of canvas `var()` edits** are mechanical.
- **AI is needed for:** ~30–40 role values per system, 2–3 collisions, the component map, and the **4,045 colour literals** (B2), where a ΔE-OKLCH nearest-role suggestion is proposed and an agent accepts, pins or restyles.

### 5.2 In-app "Bring <system> up to the schema" (canvas 13 #23)

**Engine:** `/design:setup-ds <ds> --upgrade-schema` (agent side) plus the `ds-check` verb (deterministic side). The UI dialog calls the same engine.

1. **Analyse (deterministic, ~1s).** `maude design ds-check <ds> --canvases --json` → level, Tier-1 gaps, collisions, aliases, own-token candidates, the component map, plus every canvas declaring the system with its S-rule findings.
2. **Plan (one AI agent, `design:ds-migrator`, read-only)** writes `_history/_system/<ds>-schema-v1-plan.json`. Rules:
   - Derive every new value **from the system's own tokens**, citing the source token, e.g. `--accent-soft = color-mix(in oklch, var(--accent) 14%, var(--bg-1))  ← from --accent`.
   - Never introduce a hue the system lacks, unless a whole kind is missing (e.g. palette). Then propose 3 options and mark the item `needs-pick`.
   - Resolve collisions explicitly: old meaning → new name.
   - Map components; prefix own tokens; never change an existing contract value.
3. **Stage.** Apply the plan to a staging copy:
   - **Tokens CSS:** DDR-172 Decision 7 theme-block-scoped patching (never a whole-file regex).
   - **`_components.css`:** old classes stay as second selectors (`.btn--energy, .btn[data-tone="accent-2"] {…}`), so nothing stops rendering.
   - **Manifests:** `tokens.json` + `components.json` emitted.
   - **Canvas codemods:** aliases→v1, private→`--x-*`, wrapper→`ds`, `system/<ds>/preview/_*` imports→`@maude/ds`/`ext`, `meta.designSystem`/`dsPins`.
4. **Prove "nothing changes how it looks."**
   - Screenshot every affected canvas before and after, in both themes (`maude design screenshot --all-screens`, each artboard).
   - Pixel diff threshold: e.g. ≤0.5% of pixels with ΔE>2 per artboard.
   - New roles are invisible to existing canvases because nobody used them yet, so a diff above the threshold means a codemod bug and blocks that file.
5. **Review (one dialog), with exactly the four lines of canvas 13 SCHEMA_FIX:**
   - **Adds N roles** (expand: swatches Light | Dark, source token, contrast as information only)
   - **Renames N components** (variants kept)
   - **Keeps N of its own tokens** (named `--x-*` "so a switch knows to restyle them")
   - **Updates N canvases** ("nothing looks different")

   `needs-pick` items render inline as 3-way picks. "Advanced › Map by hand…" opens the raw plan.
6. **Commit as one undo step.** Every touched file is written under one `batchId` in `_history` (system files + N canvases), with one Version-history entry, "Brought <ds> up to schema v1". Undo restores the batch atomically. Then set `designSystems[].schema = 1`, re-run `ds-check`, and run the completeness critic.
7. **Fail-safe.** If any step fails, nothing is written (staging is discarded). Cancel = no change.

**Switch A→B** (canvas 13 #22) reuses steps 1, 4, 5 and 6 with a different plan:
- Swap `meta.designSystem` for the scoped canvases.
- Pair Tier-2 slots.
- The AI restyle pass covers `dsPins` only.
- Canvases that are Pinned are listed as "Left out".

---

## 6. Changes to the design plugin (enforcement points)

| # | Where | Change |
|---|---|---|
| E1 | **New registry** `apps/studio/schema/ds-schema-v1.json` (ships via npm `files`, read by CLI + helpers) | Single source for: tier/role list, types, theme requirements, sub-role suffixes, alias table (§3 native→v1, ~70 entries incl. shadcn), collision list, component class contract, 40-name icon vocabulary, type roles, slot kinds. Plus generated `ds-schema-v1.fallbacks.css`. Everything below reads it; nothing restates it. |
| E2 | **New verb** `maude design ds-check [<ds>\|--all] [--canvas <file>…\|--canvases] [--json] [--emit] [--fix=mechanical] [--plan <file> --apply]` (`apps/studio/bin/ds-check.sh` + `_ds-check.mjs`; DDR-062 whitelist; DDR-177 helper-deps + `check-bundle-completeness --smoke`) | Exit 0/10/11 = Conformant / Missing roles / Private-only. `--emit` writes `tokens.json`. `--fix=mechanical` runs the codemods. `--apply` executes a migration plan with the visual-diff gate. Reuses DDR-172's parser/grammar and `palette.ts` (`rgbToOklch`, ΔE for nearest-role). |
| E3 | **Templates** (`core/colors_and_type.css.tpl`, `_components.css.tpl`, `SKILL.md.tpl`, `README.philosophy.md.tpl`, `config.json.tpl`) | Add the 27 functional placeholders (values from discovery; DDR-043 holds). Theme selectors gain `.ds[data-theme]`. `_components.css.tpl` gains the 14-component **structural** class contract (selectors + ARIA states, declarations token-only, no visual values) + `.t-*` role skeleton. README tpl gets an auto-generated "## Token usage guide" (fixes keeper Pass B degraded in 5/6 systems). New `components.json.tpl`. `config.json.tpl` gets `designSystems[].schema: 1`. |
| E4 | **`/design:setup-ds` (`_bootstrap.md`)** | LOCK writes Tier-1 + chosen Tier-2 slots. Batch A emits manifests. Post-scaffold gate runs `ds-check`: **must exit 0** (Missing roles only with `--allow-partial`). New sub-mode `--upgrade-schema` = the §5.2 engine, preferred over `--force` re-bootstrap for existing systems. Stage-4 refinement adds "expressive slots" asks (display ramp? palette? texture? signature motion?), answered from research and never defaulted. |
| E5 | **completeness-critic** | C6 → "all Tier-1 roles" via `ds-check --json`. **Fix C7** (shared sub-role suffix list). New **C10** value-type check (`--focus-ring` must be a colour…). **C11** collisions. **C12** core component contract + `components.json` present. **C13** manifests fresh. Existing V18c parity extended to all Tier-1 colour roles. V24 contrast-claim stays a warning; contrast numbers come from the a11y report, never the conformance gate. Legacy systems: C10–C13 warn until `schema: 1` is set, then they block. |
| E6 | **design-system-keeper** | New **Pass C — switchability**: S1–S9 per canvas, writes `meta.dsPins`. Pass B reads the registry's role table when the README guide is missing (no more "degraded"). Severity per §4.8; `dsFidelity: strict` promotes S1/S5 to blockers. A.9 extended: `system/<ds>/preview/_*` imports → S5. |
| E7 | **`/design:new`** (stages 5 envelope, 7 validate, 8 write) | Envelope carries a ≤60-line **role cheat-sheet** from the registry + the system's `components.json` names (not a file list) + "use `@maude/ds`, `.t-*`, `<DSRoot>`". Stage 7 runs `ds-check --canvas <file>` beside the existing `var(` lint: S2-undefined / S5 / S9 block the write, the rest warn. Stage 8 always writes `meta.designSystem` (+ `dsPins`). Palette opt-out generates a `--c-*` block instead of inline literals. |
| E8 | **`/design:edit`** | Same lint on the diff (changed lines only, so legacy debt doesn't block an unrelated edit). Mechanical alias fixes are offered and reported, never silent. `--ds=<name>` on an existing canvas = a switch (§5.2 variant). |
| E9 | **design-critic / typography-critic / brand-critic** | Token-compliance findings cite S-rule IDs. Typography-critic flags S3 literal sizes (it already flags off-ladder px). Brand-critic owns Tier-2 device/texture pairing quality after a switch. |
| E10 | **canvas-lib** | `<DSRoot theme>`; `@maude/ds` virtual specifier (resolved like `@maude/canvas-lib` to the canvas's system `preview/_ds.tsx`, falling back to canvas-lib default implementations of the 14 + Logo/Icon/Text); `ext` namespace. The shell injects `fallbacks.css` → system tokens → `_components.css`. |
| E11 | **Hook** (`plugins/design/hooks/hooks.json`) | `PostToolUse` on `Write\|Edit` matching `<designRoot>/**/*.{tsx,css}` → `maude design ds-check --canvas "$FILE" --quiet --hook`, returning findings as additional context (non-blocking, ≤8s). Also on `system/<ds>/colors_and_type.css` → `ds-check <ds>` to catch hand edits that drop a role or add a collision. Opt-out via `config.schemaLint: off`. |
| E12 | **Studio** (v2 S10) | "Check the system" = `ds-check` + the critic panel headless. The Canvases-panel system row shows the level. The switch dialog consumes `ds-check --json`. The off-system colour question (inventory E, `ds-edge-suggest`) = S1 at edit time. |
| E13 | **DDR + docs** | Record the decision as a DDR that extends DDR-043, references the kg decision and supersedes nothing. Add a public doc page `site/content/docs/design-system-schema.mdx`. Adding new runtime paths (`schema/`) means updating `package.json` `files`. |

**Order of work:** E1 → E2 (with `--json`) → E5/C7 fix → E3 → E10 → E6/E7/E8 → E11 → E4 `--upgrade-schema` → E12. Migrate maude-v2 first: it is the closest to Conformant and dogfoods v2.

---

## 7. Open questions for Michal

1. **Tier-1 size.** Is 95 roles (~60 + 27 functional + accent states) acceptable, or should status `-text`/`-soft` (8) move to "recommended + fallback"? The data says canvases need them.
2. **Source of truth flip.** CSS stays authoritative in v1 and `tokens.json` is derived. Is it agreed that the flip waits for the Design-system canvas editor?
3. **studyfi.** Retire it into studyfi-web/v3, or bring it up as its own system?
4. **studyfi-family spacing.** `--space-N` = N×4px collides with the ordinal ladder. Option A: re-index (moves ~480 canvas uses of space-5..8). Option B: keep the values (a switch into/out of studyfi changes density by up to 3×, accepted as character). The schema itself is silent on values.
5. **Moodboards / comparison canvases.** Auto-mark them Pinned by `kind` or name, or require an explicit `meta.dsPinned`?
