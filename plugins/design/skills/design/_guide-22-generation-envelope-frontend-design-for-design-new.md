## Generation envelope (frontend-design — for `/design:new`)

The envelope adapts to per-repo config. Read `.design/config.json` (or call `/_config` endpoint) and inject the right values. **Critical: the envelope is a creative brief, NOT a wireframe spec.** See "Envelope discipline" below before authoring one.

```
You are generating a NEW canvas project for the {CFG.name} repo.

Read the project's design system before generating:
  {designRoot}/{tokensCssRel}        # tokens (colors, type, radii, shadows, motion)
  {designRoot}/system/{ds}/README.md # design system rationale, if present (per-DS — there is no top-level system/README.md)
  {designRoot}/ui/                   # existing canvases as reference

DO NOT pick fonts, colors, radii, or shadows. Use the CSS variables defined in the tokens file. Use only fonts the tokens CSS already imports.

DS-PIN (overrides any invent-first instinct — DDR-141): this project HAS a design system, and the DS **is** the aesthetic direction. Fonts, colors, icons, the brand mark, and the product shell are PINNED to the DS specimens referenced below — do not "commit to a bold new direction", do not vary identity between generations. Creativity lives in composition, content, and the signature moment, NOT in re-deriving identity. Invent a component / mark / glyph ONLY where the DS ships no specimen for it, and leave a one-line JSX comment naming the gap. (The envelope's opt-out interpretation section, when present, relaxes exactly what the canvas's opt_out_scope permits — nothing more.)

Reference — WRAPPER pattern (read at least one — the canvas-lib frame: `DesignCanvas` / `DCSection` / `DCArtboard`):
{matched existing canvas paths, picked by similarity}

Reference — PRODUCT SHELL (the established chrome layout — where nav / sidebar / toolbar / main / status go):
{designRoot}/system/{ds}/preview/ui_kits-{platform}-showcase.tsx
For any full-screen surface, ADOPT this showcase's spatial skeleton + chrome material instead of inventing a new shell — it is the DS's canonical "DS in use" composition. Reinvent the shell only with a one-line JSX comment justifying it. (If no `ui_kits-{platform}-showcase` exists for this platform, fall back to any showcase the DS ships as a chrome reference, or compose the shell from the DS readme. This is reference, not a wireframe — adopt the skeleton, keep ownership of element-level decisions and the signature moment.)

Reference — BRAND ASSETS (canonical identity — REUSE, do not invent) (DDR-141):
{designRoot}/system/{ds}/preview/logo.*          # THE brand mark — its markup is inlined in the envelope's Brand-assets subsection
{designRoot}/system/{ds}/preview/iconography.*   # the icon family: grid, stroke, corners, shipped glyphs
{designRoot}/system/{ds}/assets/                 # approved variants + illustration refs, if present
Any brand mark you render IS the inlined canonical mark — lift its markup, adapt only size/placement via tokens/classes. Icons come from the iconography family; a glyph it doesn't ship is drawn to match its grid/stroke/corner rules, with a one-line JSX comment naming the gap. (If the DS ships no brand specimens, a new mark is legitimate — the orchestrator routes it through the draw pipeline.)

Output: a single self-contained TSX file at <target_path>. The file MUST:
1. Default-exported React component (`export default function <Name>() { … }`).
2. `import { DesignCanvas, DCSection, DCArtboard } from "@maude/canvas-lib"` — virtual specifier the dev-server resolves to its bundled canvas-lib at `apps/studio/canvas-lib.tsx` (per DDR-025; no project-side copy). Optional helpers (`DCPostIt`, `SpecimenHeader`, `TokenChip`, `useTheme`, …) live in the same module.
3. Use a multi-artboard canvas wrapper (`<DesignCanvas><DCSection><DCArtboard …/></DCSection></DesignCanvas>`) — minimum 1 DCArtboard, but expect to grow. Each artboard has `id`, `label`, `width`, `height`, and an optional `kind` (`digital` default | `print` | `web` | `video`) — see the `ui-kit` skill's "Artboard kinds" section for which kind to generate and the switch-≠-conversion rule. Leave `kind` off entirely for the common `digital` case.
4. `data-theme="{CFG.themeDefault}"` on the **DS rootClass wrapper** inside artboards — the class the DS scopes its `[data-theme]` token blocks to (read it from the DS tokens CSS `.<class>[data-theme]` selector; e.g. `.maude` for the maude DS, `.{CFG.rootClass}` otherwise — NOT `:root`, and NOT the literal `.mdcc` unless that IS the DS's wrapper). Two rules keep per-artboard light/dark switching working: (a) the wrapper MUST be this non-root class so the runtime can re-theme one artboard, and (b) leave `data-theme` at the DS default — do NOT hardcode a fixed `light`/`dark` unless the canvas is intentionally single-theme, or the reviewer's right-click `Theme ▸ Light / Dark / Follow chrome` flip has nothing to switch. Tokens link auto-loads via the dev-server's canvas-shell harness; no `<link>` in the TSX.
5. NO inline color/font/radius values — use CSS vars from the tokens file via `style={{ background: 'var(--accent)' }}` or DS classes.
6. NO external fonts beyond what the tokens CSS already imports.
7. NO inline images / icons that aren't sourced from the project's assets folder or the DS iconography family (see BRAND ASSETS reference — never introduce a parallel icon style).
8. Optional per-canvas sibling `<Name>.css` (`import "./<Name>.css"`) for bespoke styles — canvas-build inlines it as a `<style>` tag at module init. Class names should still favor `_components.css` shared classes (`.btn`, `.tile`, `.sku`, …) when possible.

## Aspiration directives (always include — these drive the signature-moment-critic axes)

9. **One signature compositional moment per artboard.** A memorable visual: oversized hero shape, geometric overlap (e.g. card + circle crossing the edge), bold negative space, photographic anchor, or typographic statement at 40px+. Form-letter "icon + headline + body + button" stacks fail this axis.
10. **Brand mark featured at human scale on at least one screen.** Not a 16px corner mark — a wordmark or lockup ≥ 32px in a hero/anchor position. The mark = the canonical DS logo from the BRAND ASSETS reference (inlined in the envelope) whenever the DS ships one — this directive is an order to *place* the stored mark prominently, never to *draw* a new one (DDR-141).
11. **Realistic mock fidelity, not placeholder rectangles.** Real iOS keyboards have predictive bars and key labels. Real maps have street geometry. Real charts have axis labels. Gray boxes labeled "img" fail this axis.
12. **Restrained color discipline.** Per artboard: 1 primary fill, accent ≤ 3 instances, ≤ 3 type weights, no more than 2 chromatic surfaces. Loud beats subtle once; subtle beats loud everywhere.
13. **Generous negative space.** Hero elements get ≥ 32 px breathing room from artboard edge. Content density target ≤ 60 % per screen; ≤ 40 % for editorial / hero screens.
14. **Specific content, not placeholders.** Real-feeling names (Maya Chen, Pavel Novák), real phone formats (+420 777 123 456), real prices ("$4 / day"), real station names. NEVER use "Lorem", "John Doe", "555-0199", "$XX", or ALL-CAPS placeholder labels.
15. **Element tagging for stable handles — ALWAYS, not optional polish.** Every named **region** AND every **interactive primitive** gets `data-dc-element="<kebab-id>"`: regions (hero, nav, card, list-row, form-field, section, panel) + interactives (every button / CTA, link, input / select / textarea, nav item, tab, toggle). The id is role-prefixed and brief-specific — e.g. `cta-get-started`, `card-hero`, `list-row-roster`, `field-email`, `nav-item-profile`, `btn-submit`. Artboards already get `data-dc-screen="<id>"` from the `DCArtboard` runtime; you only tag inner elements. This is the **stable-handle contract** three systems depend on: (a) the in-canvas **Layers tree** (Phase 12) renders these as human labels — "Cta Get Started", "Card Hero" — instead of `div.flex`, so an untagged tree reads as anonymous boxes; (b) scoped screenshots (`screenshot.sh --element <id>`); (c) critic verdicts + user comments stay stable across iterations (no fragile `:nth-child`). An untagged interactive or named region is a **regression** — when in doubt, tag it.

User brief:
{the brief}

Plan the artboards based on the brief — typically 1–6 DCArtboards in 1 DCSection, but follow what the brief asks for. The brief tells you WHAT to build; the aspiration directives above tell you HOW WELL.
```
