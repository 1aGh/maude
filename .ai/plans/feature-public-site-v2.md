# Feature: Public site v2 (maude.sh redesign) + live Cloud payments + new intro film with voice-over

Validate docs and codebase patterns before implementing. Pay attention to existing naming, utils, and imports.

## Description

Ship the Maude 2 public site designed on `.design/ui/Public Site v2.tsx` into `site/` (Next.js 16 + fumadocs). Switch Maude Cloud's payments from Stripe sandbox to live, so "Get Maude Cloud" really sells. Make a new ~60 s intro film with voice-over that tells the same story.

The site today still reads as the v1 "catalog" (SKU stamps `MDCC-DSN/01`, plugin-first copy, six top links incl. the coffee). The canvas replaces it with:
- one message ("You like Figma. You like Claude. Meet Maude.");
- three links (Product · Docs · Pricing);
- a visible Cloud buy path;
- an interactive hero;
- a "Good ol' HTML" file story;
- a feature bento;
- Docs split into two doors (Using Maude / Advanced), with every Advanced page kept.

## User Story

As a designer or team lead who has never heard of Maude, I want to understand in ten seconds what it is, see it work and know what it costs, so that I download it or buy a Cloud project without reading a manual.

As an existing Claude Code / plugin user, I want every Advanced doc page and install line one click away, so that the redesign doesn't take my tools from me.

## Problem

- The landing page pitches plugins and a CLI to people who want a design app. The desktop app and Maude Cloud are secondary.
- There are six top nav items plus a coffee link, no Pricing page, and no way to buy.
- Cloud payments run in Stripe test mode, so nobody can pay.
- The intro-film slot (`site/components/mdcc/intro-video.tsx`) is a disabled "coming soon" player, and the showreel (`site/public/demo.mp4`, V5) shows v1 chrome.
- Nothing tells a non-technical reader why plain web files matter.

## Decisions taken (2026-11-04)

These come from the planning debate (builder · shipper · breaker, reduce tier) and Michal's answers.

1. **One-time port.** The canvas is frozen as the historical spec the day Phase A starts, and `site/` is the source of truth after that. There is no "keep in step" kit fork and no sync script. Port only the kit pieces the site renders.
2. **Three phases, separate PRs.**
   - A = the site, B = live Stripe payments, C = the intro film.
   - A ships first and does not wait for C; the disabled intro player stays until C lands.
   - B runs alongside A and is mostly Michal's hands.
3. **Get Maude Cloud sells for real.**
   - Once B is done, the CTA leads to the Cloud checkout (`https://cloud.maude.sh/projects/new`).
   - If A merges before B, the CTA points at `/cloud`, and the pilot line stays until B is done.
4. **Download offers Mac and Windows.** The CTA label follows the visitor's platform, reusing the detection in `site/app/(home)/desktop/download-button.tsx`.
5. **The VO uses an ElevenLabs stock voice.**
   - The agent prepares 2–3 candidates as samples and Michal picks one.
   - The default path is the manual ElevenLabs production pack, as for V5 (`_audio-prompts.md`), not `maude design generate`.
6. **The hero shot is the live CSS-clock component**, not a video loop. It weighs nothing, stays sharp at any DPR and shows the final frame with JS off.
7. **The v2 pages use one font: the maude-v2 token stack.**
   - The stack is `--font-display: system-ui …` in `site/app/mdcc-tokens.css`. It resolves to SF Pro on macOS and Segoe UI Variable on Windows 11, both variable fonts.
   - The v2 shell must not inherit `global.css:73`'s Inter Tight override. Inter Tight comes from `next/font/google` (`layout.tsx:25`, weights 500/600/700 only) and cannot drive the 600→900 weight bubble.
   - Docs keep their current fonts.
8. **The film shows no price.** Prices change and the film doesn't. The site's prices are generated from `apps/cloud/pricing.json`, never typed by hand.

## Solution

1. **Port the canvas, don't re-derive it.**
   - Lift its markup and its `ps-*` / `fp-*` CSS into `site/` as server components plus a few small client islands.
   - The token audit was done during planning. Every `var(--*)` the canvas CSS uses already exists in `site/app/mdcc-tokens.css` (synced from maude-v2 by `site/scripts/sync-mdcc-tokens.mjs`). The only extras are the canvas's own local properties `--d`, `--t0`, `--fx`, `--fy` and `--pos`.
2. **Routes:**

   | Route | Change |
   |---|---|
   | `/` | new Home |
   | `/cloud` | new Pricing page |
   | `/docs` | two-door index; fumadocs is kept |
   | `/desktop` | keeps its content under the new shell |

   Old addresses keep working.
3. **One shared shell.**
   - The floating `SiteNav` island and `SiteFoot` cover every `(home)` route through `(home)/layout.tsx`.
   - Docs keep fumadocs' layout, with the same links set in `site/lib/layout.shared.tsx`.
4. **Interactivity lives only in islands:**
   - the hero rewrite chips, ⌘Z, the weight bubble and the draggable stickies;
   - Replay on the product shot;
   - the design↔file wipe;
   - the Monthly/Yearly toggle;
   - the nav buy button that turns primary after the hero.

   Everything else is static HTML, and every page renders its final state with JS off.
5. **Live payments (Phase B).** Switch Cloud's Stripe from sandbox to live behind the guard that already exists in `apps/cloud/pricing.mjs`, which throws when a live price id is missing. Michal does every step that needs keys, the dashboard or a card. The agent writes the catalog script, the price-id change, the copy change and the read-only checks.
6. **The intro film (Phase C)** is a new Remotion composition, `Intro2`, in `scripts/video/final/`.
   - **Length and beats:** about 60 s, with beats that mirror the site.
   - **Footage:** real Maude 2 captures for the product beats; site components scrubbed frame by frame for the typographic beats.
   - **Sound:** ElevenLabs VO, whisper captions and a music bed, mixed by a parameterised `build-audio.sh`.
   - **Hosting:** the MP4 goes out as a GitHub release asset and plays in the enabled `IntroVideo` player.

## Metadata

- **Type**: Enhancement (site) + New Capability (payments live, intro film)
- **Complexity**: High
- **App/Package**: `site/` (@maude/site), `apps/cloud/` (Phase B), `scripts/video/final/` (Remotion)
- **Affected Systems**: public site, docs navigation, Maude Cloud checkout (production), README video embed
- **Dependencies**:
  - Site: nothing new (React 19 and Next 16 are already there).
  - Film: the existing Remotion 4.0.463 deps.
  - Michal's accounts: ElevenLabs, plus a live Stripe account and keys.
- **Risk**: payments, production (Phase B)

---

## Context References

### Must-Read Files

> `/flow:execute` reads every file listed here in parallel in a single assistant message — they are independent context loads.

**The canvas (the spec)**
- `.design/ui/Public Site v2.tsx` — Why: the spec. Components:
  - shell: `SiteNav`, `SiteFoot`;
  - hero: `HeroHeadline`, `useWeightBubble`, `BubbleLine`, `DragFloat`, `HeroShot`, `RunCard`;
  - sections: `Features`, `Feat`, `PlainHtml`;
  - pages: `HomePage`, `CloudPage`, `DocsPage`, `AdvancedPage`, `HomeMobile`;
  - the intro clock `T` and the rewrite versions `HEADS`.
- `.design/ui/Public Site v2.css` — Why: every `ps-*` / `fp-*` class, plus the motion block (keyframes, view-timeline, reduced motion, `.ps-still`).
- `.design/ui/Public Site v2.meta.json` — Why: per-artboard notes on what each section must do.
- `.design/ui/v2/_kit.tsx` + `_kit.css` — Why: the product-shot pieces and the DS glyph family `FAMILY`.

**The current site**
- `site/app/(home)/page.tsx`, `site/app/(home)/layout.tsx`, `site/lib/layout.shared.tsx` — Why: the current Home and nav being replaced.
- `site/app/layout.tsx` — Why: fonts at lines 4–30, and the existing skip link `mdcc-skip-link` → `#main-content` at line 109.
- `site/app/global.css` (2105 lines; line 73 overrides `--font-display`) — Why: the existing `.mdcc-*` classes, and which ones docs still need.
- `site/app/mdcc-tokens.css`, `site/scripts/sync-mdcc-tokens.mjs` — Why: the token source and its reconciliation block.
- `site/content/docs/meta.json`, `site/content/docs/index.mdx` — Why: the sidebar groups already read "Using Maude" / "Advanced / …"; the index becomes the two doors.
- `site/content/docs/cloud/pricing.mdx` — Why: prices, VAT, the 14-day trial, storage and the pilot callout.
- `site/components/mdcc/intro-video.tsx`, `demo-video.tsx` — Why: the player chrome to enable, and the showreel to retire from Home.
- `site/next.config.mjs` — Why: `redirects()`.
- `site/app/(home)/desktop/download-button.tsx` — Why: platform detection for the Download label.
- `scripts/test/docs-no-old-chrome.test.mjs` — Why: today it walks only `site/content/docs/**/*.mdx`; Task A6 widens it.

**Cloud and payments (Phase B)**
- `apps/cloud/pricing.mjs`, `pricing-core.mjs`, `pricing.json` — Why: the live/sandbox guard and the single source of prices.
- `apps/cloud/checkout-routes.mjs` (`/projects/new`, `/checkout/return`, the webhook) — Why: what the live CTA lands on.
- `apps/cloud/wrangler.toml` — Why: the secrets `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`, and the route `cloud.maude.sh`.
- `.ai/archive/decisions/DDR-196-cloud-arc-buildable-half-and-the-vendor-boundary.md`, plus the kg decision `stripe-merchant-of-record-prices-are-net` — Why: the deploy blockers, and the rule that prices are net with Stripe as merchant of record.
- `.ai/release-guide.md` — Why: deploying the control plane and verifying it.

**The film (Phase C)**
- `scripts/video/storyboard.md`, `scripts/video/final/src/compositions/V5.tsx`, `scripts/video/final/build-audio.sh`, `scripts/video/final/sub.mjs`, the V5 `_audio-prompts.md` — Why: the beat structure, VO timing, audio mix and captions to mirror.

**Copy rules**
- `.claude/skills/maude-positioning/SKILL.md` — Why: every claim must be a shipped feature; never "replaces Figma"; no em-dash as a clause joiner.

### Files to Create

**Phase A (site)**
- `site/components/v2/` — the section components:
  - shell: `site-nav.tsx`, `nav-buy.client.tsx`, `mobile-menu.client.tsx`, `site-foot.tsx`;
  - hero: `hero.tsx`, `hero-headline.client.tsx`, `use-weight-bubble.ts`, `drag-float.client.tsx`, `hero-shot.tsx`, `replay.client.tsx`;
  - Home sections: `why.tsx`, `how.tsx`, `features.tsx`, `yours.tsx`, `plain-html.tsx`, `wipe.client.tsx`, `cloud-band.tsx`, `advanced-door.tsx`, `whats-new-teaser.tsx`;
  - Pricing and Docs: `pricing-plans.tsx`, `billing-toggle.client.tsx`, `docs-doors.tsx`;
  - `kit/`: the ported, static kit pieces.
- `site/app/site-v2.css` — the ported CSS, scoped under `.v2-site`.
- `site/app/(home)/cloud/page.tsx` — the Pricing page.
- `site/scripts/build-pricing.mjs` + `site/lib/pricing.json` (committed generated file) — prices.

**Phase B (payments)**
- `apps/cloud/scripts/stripe-live-catalog.mjs` + test — creates the live catalog.

**Phase C (film)**
- `scripts/video/intro2-script.md` — beat sheet, VO, voice id and settings.
- `scripts/video/final/src/compositions/Intro2.tsx` + `src/scenes/intro2/*` — the film.
- `scripts/video/final/public/intro2/` — captures, VO, music, captions.

### Files to Update (not create)

- `scripts/video/final/build-audio.sh` — parameterise it (input video, VO list with offsets, bed, output) instead of copying it.

### Design canvases

| Canvas | Status | Tags | Notes |
| ------ | ------ | ---- | ----- |
| `.design/ui/Public Site v2.tsx` | draft → **frozen when Phase A starts** | public-site, maude-v2 | Critics passed on 2026-11-03. The hero rewrite, weight bubble, bento and HTML story were added on 2026-11-04 without a new critic round, so Task A0 runs one. Seven artboards: Direction, Home, Cloud, Docs, Advanced page, Home mobile, Motion. Ground every section here. |
| `.design/ui/v1/Studio Intro Video.tsx` | historical | intro-video | The player chrome that the current `IntroVideo` ports. |

---

## Design Decisions

### Components (lift from the canvas)

| Component | Source | Notes |
| --------- | ------ | ----- |
| `SiteNav` | canvas `SiteNav` | 3 links, GitHub, Download (ghost), Get Maude Cloud. On Home the buy button stays quiet until the hero scrolls out. Mobile: island + a menu sheet. |
| `SiteFoot` | canvas `SiteFoot` | Product / Docs / Project / Legal. Changelog, Roadmap, About and the coffee move here. |
| Hero | canvas hero + `HeroHeadline` | A selected-layer headline; Ask Maude chips; ⌘Z; the weight bubble; draggable stickies; the "scripted demo" line. |
| Product shot | canvas `HeroShot` + kit | Static markup on a CSS clock; Replay remounts the run. |
| Feature bento | canvas `Features` | 10 cards, each a shipped feature checked against `apps/studio/whats-new.json`. |
| Good ol' HTML | canvas `PlainHtml` | A 4-beat story and a range-input wipe. |
| Pricing | canvas `CloudPage` | Prices from the generated `site/lib/pricing.json`, plus the 14-day trial line the canvas lacks. |
| Docs doors | canvas `DocsPage` | A component at the top of `docs/index.mdx`; the fumadocs sidebar stays unchanged. |

### Tokens

Every value comes from `mdcc-tokens.css`: colours, radii, spacing, type, durations and easings. No hex anywhere. The maude-v2 rules hold:
- azure for actions only;
- the spark only where the AI acts;
- no glass on content;
- mono only in Advanced and code.

The `fp-*` illustrations use `--object-*` and `--bg-*` only.

### Icons

Port only the glyphs the site uses from the kit's inline DS family (`FAMILY` in `_kit.tsx`). No Lucide and no emoji: the ✓ in "Ship it ✓" becomes the check glyph.

### Custom components needed

| Component | Reason | Extends |
| --------- | ------ | ------- |
| `useWeightBubble` | proximity font-weight on the hero headline | none (rAF + refs, no re-render) |
| `Wipe` | the design↔file before/after slider | a native `<input type="range">` |

---

## Tasks

**Phases and lanes**
- Three phases, three PRs.
- Phases A and C run in parallel lanes. Phase B runs alongside A.
- Inside Phase A, after A1–A2: lane 1 = A3 → A4 → A5 → A6; lane 2 = A7 + A8.

**Rules for every site task**
- No hex values; maude-v2 tokens only.
- Copy is verbatim from the frozen canvas.
- `pnpm --filter @maude/site build` stays green.

## Phase A — the site (one PR)

### Task A0: RUN one critic round on the 2026-11-04 additions, then freeze the canvas

- **Do**:
  - Run `/design:critic` (design, a11y, motion) on the Home artboard only, scoped to the hero rewrite, the weight bubble, the bento and Good ol' HTML.
  - Fix blockers on the canvas.
  - Then set `"status": "frozen"` and `"frozen": "<date>"` in `Public Site v2.meta.json`, and add a line to its brief saying site/ is the source of truth from here on.
- **Files**: `.design/ui/Public Site v2.*`
- **Validate**: the critic verdicts show 0 blockers

### Task A1: CREATE the v2 CSS

- **Do**:
  - Copy `.design/ui/Public Site v2.css` into `site/app/site-v2.css`, scoped under a `.v2-site` root class.
  - Copy the subset of `.design/ui/v2/_kit.css` and `.design/system/maude-v2/preview/_components.css` that the ported parts use: `.island`, `.btn*`, `.chip*`, `.seg`, `.kbd`, sticky, cursor and window chrome.
  - Inside `.v2-site`, set `font-family: var(--font-display)` / `var(--font-body)` from the token stack, so `global.css:73`'s Inter Tight doesn't leak in (Decision 7).
  - Import the file once, in `(home)/layout.tsx`.
- **Files**: `site/app/site-v2.css`, `site/app/(home)/layout.tsx`
- **Pattern**: `sync-mdcc-tokens.mjs` reconciliation block (only if a token turns out to be missing; never inline a value)
- **Gotcha**: fumadocs drives dark mode with `.dark`, and maude-v2 dark tokens ride it (the DDR-011 bridge). Check light and dark.
- **Validate**: `pnpm --filter @maude/site sync:tokens:check && pnpm --filter @maude/site build`

### Task A2: CREATE the static kit (only what is rendered)

- **Do**:
  - Port into `site/components/v2/kit/`, as server components, only the pieces that `/`, `/cloud` and `/docs` render. Grep `HomePage`, `HeroShot`, `CloudPage`, `DocsPage`, `Features` and `PlainHtml` to find them.
  - The likely set is `Mark`, `Spark`, `Icon` (the used glyphs), `Sticky`, `Cursor`, `Avatar`, `Kbd`, `Thumb`, `Window`, `Canvas`, `Artboard`, `AIPanel`, `HeroMock`, `PhoneMock`, `ProjectPill`, `ShareCluster`, `ZoomUndo` and `Toolbar`. Drop any the pages don't reach.
  - Header comment on each file: `Ported once from .design/ui/v2/_kit.tsx on <date>; site/ is the source now`.
- **Files**: `site/components/v2/kit/*.tsx`
- **Gotcha**: no `@maude/canvas-lib` or studio import may appear in `site/`, because Vercel uploads only `site/`.
- **Validate**: `pnpm --filter @maude/site types:check`

### Task A3: CREATE SiteNav + SiteFoot and wire the (home) layout

- **Do**:
  - **Port both components.**
  - **Nav links:**
    - Product `/`, Docs `/docs`, Pricing `/cloud`;
    - GitHub;
    - Download `/desktop`, labelled by platform (Decision 4);
    - Get Maude Cloud `/cloud` (Task B2 repoints it to the checkout).
  - **Quiet buy button.** On Home, `nav-buy.client.tsx` (an IntersectionObserver) turns the buy button primary once the hero leaves the viewport.
  - **Skip link.** Reuse the root layout's `mdcc-skip-link` → `#main-content`. Give each page's `<main>` `id="main-content"` and add no second skip link.
  - **Mobile (< 720 px).** The island plus a menu button that opens a sheet with the same links.
  - **Docs header.** Set the same links in `site/lib/layout.shared.tsx`, so it matches.
- **Files**: `site/components/v2/site-nav.tsx`, `nav-buy.client.tsx`, `mobile-menu.client.tsx`, `site-foot.tsx`, `site/app/(home)/layout.tsx`, `site/lib/layout.shared.tsx`
- **Validate**: build, plus an agent-browser screenshot of `/` at 1440 and 390

### Task A4: CREATE the hero (server) + islands

- **Do**: Port the hero:
  - **Announce chip.** Links to `/whats-new`; its text is the newest entry in `site/lib/whats-new.json`.
  - **`HeroHeadline`** (client): `HEADS` rewrite chips, ⌘Z, aria-live, and the weight bubble via `useWeightBubble` + `BubbleLine`.
  - **`DragFloat`** (client) for the stickies.
  - **Static parts:** the cursors, lede, CTAs, fine print and the "A scripted demo…" line.

  The first headline state must be real server-rendered `<h1>` text (for SEO and no-JS), and the island hydrates over it.
- **Files**: `site/components/v2/hero.tsx`, `hero-headline.client.tsx`, `use-weight-bubble.ts`, `drag-float.client.tsx`
- **Gotcha**:
  - The weight bubble needs a variable font. The token `system-ui` stack provides one on macOS and Windows 11; other systems get stepped weights, which is acceptable.
  - The bubble works with a pointer only; touch gets no effect.
- **Validate**:
  - Build.
  - agent-browser: click each chip and assert the `h1` text changes; ⌘Z restores it.
  - axe: 0 serious issues.

### Task A5: CREATE HeroShot + Replay

- **Do**:
  - Port `HeroShot` with its CSS intro clock (`--d`, `--t0`), the `ps-show` Replay, and the reduced-motion final frame.
  - Replace the canvas's `navigator.webdriver` → `.ps-still` hook with `prefers-reduced-motion`, plus a `?still=1` query for captures.
- **Files**: `site/components/v2/hero-shot.tsx`, `replay.client.tsx`
- **Validate**: build; a screenshot with `?still=1` shows the finished frame

### Task A6: CREATE the Home sections

- **Do**:
  - Port, in canvas order:
    1. **Proof strip.** The release count comes from the generated stats or the tag count at build time, never a hard-coded "145".
    2. Why Maude trio.
    3. How it feels.
    4. Features bento.
    5. It's yours.
    6. Good ol' HTML, with the `Wipe` client island.
    7. Cloud band.
    8. **Advanced door** (`id="advanced"`). Its install lines come from `stats.json` and the existing `CATALOG` data.
    9. **What's new teaser.** The 3 newest entries from `site/lib/whats-new.json`.
  - Remove the old catalog, `AppPreview` and `QuickStart` from Home. `QuickStart` moves into the Advanced door or the docs.
  - Retire `DemoVideo` from Home, but keep `demo.mp4` for old links.
- **Files**: `site/app/(home)/page.tsx`, the section files under `site/components/v2/`, `scripts/test/docs-no-old-chrome.test.mjs`
- **Gotcha**: the old-chrome test only walks `site/content/docs/**/*.mdx`, so it never reads the new components.
  - Widen it here to `site/app/(home)/**` and `site/components/v2/**` (JSX text), and extend its self-test to match.
  - Add a rule that fails on SKU stamps (`MDCC-[A-Z]{3}/`) under `(home)`.
- **Validate**: `pnpm --filter @maude/site build && node --test scripts/test/docs-no-old-chrome.test.mjs`

### Task A7: CREATE /cloud (Pricing)

- **Do**:
  - **Port `CloudPage`:**
    - three plans: Self-host free · Cloud Project €19 or €190 a year · Dedicated €99;
    - a Monthly/Yearly toggle (client, `aria-pressed`);
    - the VAT note;
    - the 14-day trial line (from `pricing.mdx`; the canvas lacks it);
    - the pilot callout, which Task B2 removes;
    - the per-project vs per-seat bars;
    - the Self-host vs Cloud table;
    - the trust row;
    - FAQs as `<details>`;
    - the closing CTA.
  - **Generate the prices.** A small `site/scripts/build-pricing.mjs` copies `apps/cloud/pricing.json` `amounts` into `site/lib/pricing.json` at build time. It is committed like `stats.json`, because Vercel only sees `site/`.
    - Add `gen:pricing` to `site/package.json` and to prebuild.
    - Add `--check` to the `quality.site-content` gate.
    - Never type a price by hand.
- **Files**: `site/app/(home)/cloud/page.tsx`, `site/components/v2/pricing-plans.tsx`, `billing-toggle.client.tsx`, `site/scripts/build-pricing.mjs`, `site/lib/pricing.json`, `site/package.json`, `.ai/workflows.config.json`
- **Validate**: build; `node site/scripts/build-pricing.mjs --check`; the scenario toggles Monthly/Yearly

### Task A8: UPDATE docs: two doors

- **Do**:
  - Render `DocsDoors` (Using Maude / Advanced, starting points, release strip) at the top of `site/content/docs/index.mdx`, and register it in `site/components/mdx.tsx`.
  - Keep the `meta.json` order and every page.
  - Advanced pages use mono type for code only.
- **Files**: `site/content/docs/index.mdx`, `site/components/v2/docs-doors.tsx`, `site/components/mdx.tsx`
- **Validate**: `pnpm --filter @maude/site build`

### Task A9: CHECK the other (home) routes

- **Do**:
  - The new nav and footer reach every `(home)` route through `(home)/layout.tsx` (Task A3).
  - Open `/desktop`, `/about`, `/changelog`, `/roadmap` and `/whats-new`, and fix only what breaks under the new shell, such as double headers or old SKU chrome.
  - No content rewrite.
- **Files**: `site/app/(home)/*/page.tsx` (only where broken)
- **Validate**: build + the widened old-chrome test

### Task A10: ADD redirects + URL check

- **Do**:
  - Add `/pricing` → `/cloud` to `redirects()`.
  - `/#advanced` cannot be redirected, because the browser never sends the hash. The Advanced door keeps `id="advanced"` instead.
  - Before merging, list the URLs in the production `sitemap.xml` and curl each one once against the preview deploy. Record the result in the PR.
- **Files**: `site/next.config.mjs`
- **Validate**: every URL returns 200 or 308
- **Result (2026-11-04, `next start` of the built site on localhost, Phase A tree)**:
  - `sitemap.xml` lists 89 URLs; all 89 return 200 (`/cloud` was added to `STATIC_ROUTES`).
  - `/pricing` returns 308 to `/cloud`; `/whats-new` returns 308 to `/changelog`; `/terms`, `/privacy`, `/dpa` return 307 to the docs legal pages (existing, non-permanent).
  - The check found `/docs/recipes`, `/docs/commands-design` and `/docs/commands-flow` are folders with no index page, so they 404. They are not in the sitemap; the footer's Recipes link and the docs doors now point at real pages (`/docs/recipes/nextjs`, `/docs/commands-design/help`, `/docs/commands-flow/plan`).
  - Still to do before merge, per the task: repeat the curl against the preview deploy.

### Task A11: UPDATE metadata

- **Do**:
  - Take the title and description from the canvas lede ("A design canvas built around AI, not bent to fit one.").
  - Update the `llms.txt` intro paragraph.
  - A new OG image is deferred.
- **Files**: `site/app/layout.tsx`, `site/app/llms.txt/route.ts`
- **Validate**: build

### Task A12: REGEN generated content + run the site gates

- **Do**:
  - Run `pnpm --filter @maude/site gen:stats gen:roadmap gen:whatsnew gen:pricing` and commit the regen. Site docs edits re-date `stats.json`; see memory `maude-site-docs-edit-needs-stats-regen`.
  - Run biome format and lint on the final tree before any gate run.
- **Validate**: `quality.lint`, `quality.format`, `quality.tokens`, `quality.site-content` and `quality.build` from `.ai/workflows.config.json`

## Phase B — live payments (one PR + Michal's steps)

**Risk**: payments, production.
- Every step marked **Michal** needs his Stripe dashboard, his keys or his card. The agent never does those steps, and never sees or types a live key.
- The Cloud control plane and cells are production, so nothing in this phase deploys without Michal's explicit go for that step.

### Task B0: CHECK the Cloud is actually live (read-only)

- **Do**:
  - Confirm on the real account that the DDR-196 blockers are cleared:
    - Workers Paid;
    - R2;
    - the `cloud.maude.sh` zone and route;
    - the control-plane Worker deployed;
    - the D1 schema current;
    - the GitHub App;
    - the e-mail sender.
  - Use read-only checks only: `curl https://cloud.maude.sh/_health`, `wrangler deployments list` under Michal's account, and the release guide's verification steps.
  - Write the result into this plan.
  - If anything is still blocked, Phase B stops here and the site keeps the pilot copy.
- **Validate**: a table with each prerequisite, its state, and how it was checked

**B0 result (2026-11-04, read-only: `curl` on public URLs, `gh run list`, repo files; no account access, no key).** The real health path is `/health` (`apps/cloud/worker.mjs:569`), not `/_health`. The `/_health` 404 is just the wrong path; `/_health` is the render service's path.

| Prerequisite | State | How it was checked |
| --- | --- | --- |
| `cloud.maude.sh` zone + route | Verified live | `GET /login` = 200, `GET /projects/new` = 303 to `/login` (not signed in, which is correct); the route is a Worker custom domain in `apps/cloud/wrangler.toml` |
| Control-plane Worker answers | Verified live | `GET https://cloud.maude.sh/health` = `{"ok":true,"version":"phase-13","d1":"ok","r2Creds":"per-tenant"}` |
| D1 reachable, schema usable | Verified live | `"d1":"ok"` (a `SELECT` on `schema_migrations`). "Schema current" is **not** proven by this: the hourly sweep applies pending migrations, so check the migration version in the operator view. **Michal to confirm** |
| R2 enabled | Verified live (indirectly) | `"r2Creds":"per-tenant"` means the R2 minting secrets are configured and the minting path is on; the cells' `GET /health` is 200, `releaseVersion` 2.0.2 |
| Workers Paid / Containers | Verified live (indirectly) | A tenant cell (`alligators.cloud.maude.sh/health` = 200, v2.0.2) and `render.cloud.maude.sh/_health` = 200 (`v2.0.2`) are running Containers, which need Workers Paid. The plan itself is **Michal to confirm** in the dashboard |
| Data plane (cells) + render deployed at the current release | Verified live | Both report 2.0.2, the latest release tag |
| **Control plane is on the current source** | **Not proven, probably behind** | `/health` `version` is the constant `phase-13`, which does not move. The "Cloud control plane" workflow (`cloud-deploy.yml`, push to `main` touching `apps/cloud/**`) has **no run since 2026-10-01** (v1.6.0), yet `apps/cloud` changed on 2026-11-02 (v2.0, 53 files: trial, accounts, checkout routes). Either that deploy never fired or the Worker was deployed from a laptop. **Michal to confirm**: `cd apps/cloud && npx wrangler deployments list` |
| `STRIPE_SECRET_KEY` on the Worker | Present, **test** | Documented in `.ai/plans/cloud-live-payments-rollout.md` (the key in use is `rk_test_`). **Michal to confirm** with `npx wrangler secret list` (names only, never values) |
| `STRIPE_WEBHOOK_SECRET` on the Worker | **Missing as of 2026-10-02** | Same rollout plan, L6: every Stripe webhook gets a bare 400 until it is set, and the hourly sweep hides it. **Michal to confirm** it is still unset |
| Stripe Worker `/health` reports its mode | **No** | `/health` has no `stripeMode` field, so the Acceptance line "the deployed Worker reports `stripeMode` = `live`" cannot be checked as written. Use the `cs_live_` prefix of the checkout session (B3) or the patch request below |
| GitHub App | **Michal to confirm** | Cannot be seen without the account. `apps/cloud/github-app.mjs` needs its secrets; `wrangler secret list` shows whether they exist |
| E-mail sender (Resend, `cloud@maude.sh`) | **Michal to confirm** | `/login` renders, but sending cannot be proven without sending. Needs `RESEND_API_KEY`; the sign-in e-mail you receive is the proof |
| Stripe account activated for live payments, Stripe Tax and Managed Payments on in **live** mode | **Michal to confirm** | Dashboard only. Sandbox behaviour is wired (`automatic_tax[enabled]=true`, Managed Payments); a sandbox-only tax setup gives a legally wrong first invoice |
| Legal gates (rollout plan L1 accountant, L2 counsel review) | **Michal to confirm** | `terms.mdx`/`privacy.mdx`/`dpa.mdx` promise both before the first live charge. Open as far as the repo knows |
| Fleet ceiling | Known: `max_instances = 5` | `apps/cells/wrangler.toml:84`. Customer #6 gets no container, and the sale is voided (rollout plan L7b). Decide before announcing |

**Verdict: the control plane is deployed, routed and healthy, so Phase B does not stop at B0.** Three things stay open before the key switch: (1) whether the deployed control plane is the current source, (2) the webhook secret, (3) the dashboard and legal items. The site keeps the pilot copy until B3 passes.

### Task B1: CREATE the live catalog script (agent writes, Michal runs)

- **Do (agent)**: write `apps/cloud/scripts/stripe-live-catalog.mjs`, which reads `STRIPE_SECRET_KEY` from Michal's shell environment and:
  - creates the live products and prices from `pricing.json` `amounts`: Cloud Project €19 monthly and €190 yearly, Dedicated €99, and the €5 storage block per 50 GB;
  - sets `tax_behavior: exclusive` (prices are net; Stripe adds VAT as merchant of record);
  - prints the new ids;
  - refuses to run with a test key;
  - writes nothing secret to disk;
  - has a dry-run mode that prints the plan without calling Stripe.
- **Michal**:
  - Run the script with your live key.
  - In the dashboard, confirm Stripe Tax and the merchant-of-record setting.
  - Create the live webhook endpoint on `cloud.maude.sh`, at the path `checkout-routes.mjs` handles, with the same events as the sandbox endpoint.
- **Files**: `apps/cloud/scripts/stripe-live-catalog.mjs`, `apps/cloud/scripts/stripe-live-catalog.test.mjs`
- **Validate**: `node --test apps/cloud/scripts/stripe-live-catalog.test.mjs`; Michal reviews the dry-run output before the real run
- **Status (agent, 2026-11-04): written and tested with a stubbed `fetch`; never run against Stripe.** It is idempotent: products have fixed ids (`maude_cloud_project`, `maude_cloud_dedicated`, `maude_cloud_storage`), prices are found by `lookup_key` (`maude_cloud_<plan>_<interval>_eur_v1`) before they are created, and a price that exists with a different amount, currency, interval or tax behaviour stops the run (Stripe prices are immutable). After creating, it reads every price back and compares with `pricing.json`; the blob is printed only if they agree.

### Task B2: FILL the live price ids, switch the secrets, drop the pilot copy

- **Do (agent)**:
  - Put the live ids into `apps/cloud/pricing.json`. `pricing.mjs` throws on any unfilled live id, which is the guard.
  - Add a test that every live id is filled and that `amounts` match.
  - Remove the "private pilot / test mode" lines from `site/content/docs/cloud/pricing.mdx`, the `/cloud` page callout and the Cloud band fine print.
  - Repoint Get Maude Cloud to `https://cloud.maude.sh/projects/new`.
- **Michal**:
  - Run `wrangler secret put STRIPE_SECRET_KEY` and `wrangler secret put STRIPE_WEBHOOK_SECRET`, both live, on the control-plane Worker.
  - Deploy per `.ai/release-guide.md`.
- **Files**: `apps/cloud/pricing.json`, `apps/cloud/pricing.test.mjs`, `site/content/docs/cloud/pricing.mdx`, the Phase A pricing components, `site/lib/pricing.json` (regen)
- **Validate**:
  - `node --test apps/cloud/pricing.test.mjs apps/cloud/checkout-routes.test.mjs`
  - The deployed Worker reports `stripeMode` = `live` (read-only).

### Task B3: PROVE one real purchase end to end (Michal; agent watches read-only)

- **Do**: Michal buys one Cloud Project with his own card. Check that:
  - the checkout shows the net price plus Czech VAT (€22.99);
  - the 14-day trial authorises without charging;
  - the project provisions and the webhook lands;
  - the account page shows the plan.

  Michal then cancels, and the authorisation is released. The agent watches the operator pages and logs read-only and records the evidence here.
- **Validate**: an evidence table (checkout total, webhook event ids, provision state, cancellation), and no charge left on the card

### Runbook for Michal: B1 to B3, in order

Everything here runs in the worktree `.claude/worktrees/public-site-v2-pay` (or after the branch is merged, from `main`). **Never paste a key into a chat, a file or a command argument.** Keys live only in your shell environment for the minutes a step needs.

**0. Before any key (dashboard, no commands).** Do not start step 3 until all of these are true:

- [ ] Stripe account is activated for live payments (business details, bank account).
- [ ] **Stripe Tax is on in live mode**, with your registrations; **Managed Payments** is enabled in live mode (the checkout is built on it: `checkout.mjs` sets `automatic_tax[enabled]=true`). Note the account's **default product tax code** (Tax settings); if it is not SaaS, pass `--tax-code txcd_10103001` in step 3.
- [ ] **Billing, Customer portal: save a configuration in live mode.** The portal is configured per mode; without a saved live configuration `POST /v1/billing_portal/sessions` fails and the "Manage billing" button breaks (`checkout-routes.mjs:465`).
- [ ] Rollout plan gates `.ai/plans/cloud-live-payments-rollout.md`: L1 (accountant, "identifikovaná osoba") and L2 (counsel review of terms/privacy/dpa) are done or consciously waived; L7b (`max_instances = 5`) decided.
- [ ] B0's open rows are confirmed: `npx wrangler deployments list` (is the Worker on the current source?), `npx wrangler secret list` (names only).

**1. Dry run (no key needed, nothing is sent).** Read the output; it is exactly what step 3 will create:

```sh
node apps/cloud/scripts/stripe-live-catalog.mjs --dry-run
```

Expected: 3 products and 4 prices: Cloud Project 19.00 EUR/month and 190.00 EUR/year, Dedicated 99.00 EUR/month, Storage add-on 5.00 EUR/month, all `tax_behavior=exclusive`.

**2. Make a temporary live key.** Dashboard, Developers, API keys, *Create restricted key* (live mode), named `catalog-temp`. Permissions: **Products write, Prices write** (write includes read; the script only reads products and prices it then creates). Nothing else. Do not reuse the Worker's key for this.

**3. Live run.** The key goes in the environment of this shell only, typed at a silent prompt so it is in no command line and no history:

```sh
read -s STRIPE_SECRET_KEY && export STRIPE_SECRET_KEY      # paste the temp key, Enter
node apps/cloud/scripts/stripe-live-catalog.mjs --confirm-live > /tmp/live-ids.json
unset STRIPE_SECRET_KEY
```

The script refuses a `sk_test_`/`rk_test_` key and a run without `--confirm-live`. Progress goes to the terminal, the id blob to `/tmp/live-ids.json`. It ends with "Read-back OK" and exit 0; any other ending prints no blob. Safe to re-run: finished objects are reused. Then **revoke `catalog-temp`** in the dashboard.

**4. Fill the ids into `pricing.json`.**

```sh
node apps/cloud/scripts/fill-live-price-ids.mjs --in /tmp/live-ids.json --dry-run   # shows the change
node apps/cloud/scripts/fill-live-price-ids.mjs --in /tmp/live-ids.json
git diff apps/cloud/pricing.json          # exactly 3 changed lines, the three "live" blocks
node --test apps/cloud/pricing.test.mjs apps/cloud/checkout-routes.test.mjs apps/cloud/scripts/*.test.mjs
rm /tmp/live-ids.json
```

It refuses sandbox ids, a missing or extra interval, and replacing an id already filled. The pricing tests flip by themselves from "live throws" to "every plan resolves live and the amounts hold". The site's prices do not change (`publicPricing` carries no ids). Commit `apps/cloud/pricing.json` on the Phase B branch.

**5. Webhook endpoint (dashboard, live mode).** Developers, Webhooks, *Add endpoint*:

- URL: `https://cloud.maude.sh/webhooks/stripe` (`worker.mjs:594`, signature-verified in `stripe-webhook.mjs`).
- Events: at least the ones the Worker acts on (`projectRefFromEvent`): `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `customer.subscription.trial_will_end`, `invoice.paid`, `invoice.payment_failed`, `invoice.payment_action_required`. The handler takes any `customer.subscription.*` or `invoice.*`, so "same events as the sandbox endpoint" is also correct: open the sandbox endpoint and copy its list.
- Copy the endpoint's **signing secret** (`whsec_…`) for step 7. Do not send a test event yet: the Worker still holds no live secret.

**6. Deploy the Worker with the live ids.** The ids ship inside the bundled Worker. Merge the Phase B PR (or run the workflow by hand); `cloud-deploy.yml` tests, dry-runs and deploys, then polls `/health`. It has **not fired since 2026-10-01**, so do not assume a merge deployed anything:

```sh
gh workflow run "Cloud control plane" --repo 1aGh/maude -f dry_run=true     # dry run first
gh workflow run "Cloud control plane" --repo 1aGh/maude -f dry_run=false    # the deploy
gh run list --repo 1aGh/maude --workflow cloud-deploy.yml --limit 2         # wait for success
curl -s https://cloud.maude.sh/health                                        # ok:true, d1:ok
```

This is a control-plane deploy only: the cell/render fleet rolls on a release tag (`.ai/release-guide.md`), not here. With the sandbox key still in place the Worker stays in sandbox mode, so this step is safe.

**7. The switch (two secrets, in this order).** Webhook secret first so no live event ever arrives unverified; the key last because **setting the live `STRIPE_SECRET_KEY` is the moment real cards can be charged**:

```sh
cd apps/cloud
npx wrangler secret put STRIPE_WEBHOOK_SECRET   # paste the live whsec_… from step 5
npx wrangler secret put STRIPE_SECRET_KEY       # paste the live restricted key (below)
```

The Worker's key is a separate restricted live key, mirroring the permission set of the sandbox `rk_test_` one (Checkout Sessions, Customers, Subscriptions, Billing portal sessions, Invoices read, Tax IDs; confirm against the sandbox key's page). `stripeMode()` flips to `live` on the `rk_live_`/`sk_live_` prefix, and `priceIdFor` then uses the ids from step 4.

**8. Prove the wiring before a purchase.** Dashboard, the live webhook endpoint, *Send test webhook* (`invoice.paid`): it must return **200** (a 400 means the signing secret is wrong; the Worker logs `[webhook] rejected: <reason>`, visible under Workers, Logs). Then B3.

**Rollback.** `npx wrangler secret put STRIPE_SECRET_KEY` with the old `rk_test_` key returns the Worker to sandbox mode in seconds. Prices already created in live mode are harmless and are reused.

**B3 purchase checklist (Michal, own card; the agent watches read-only).**

1. Sign in at `https://cloud.maude.sh/login` with a fresh e-mail, open `/projects/new`, create a project (name like `live-proof`), pick Cloud Project monthly.
2. At Stripe Checkout: the URL contains `cs_live_` (proves live mode); it shows **14-day trial, nothing due today**, then **€19.00 + Czech VAT = €22.99** after the trial; billing address and VAT-id fields are present.
3. Pay with your own card. The card is validated, not charged: confirm there is no €19 or €22.99 charge, only the authorisation or none.
4. On return, the project provisions; open `https://live-proof.cloud.maude.sh/health` (200).
5. Dashboard, Webhooks (live): `checkout.session.completed` delivered with **200**. Note the event ids.
6. `/projects/<id>/billing` shows the plan, the trial end date and the invoice list; "Manage billing" opens the Stripe portal (live portal configuration).
7. Cancel from the billing page (or the portal). Check the subscription is `canceled` in the dashboard, the project follows the retention ladder, and **no charge or pending authorisation is left on the card**. If anything else was charged, refund it.
8. Optional, the path v2 uses for trial projects: create a second project as a trial (no card), then use *Choose a plan* on its billing page. It goes through the same live price ids and proves the `convert` checkout.
9. Record in the evidence table below: checkout total, `cs_live_` id, webhook event ids, provision state, cancellation, card statement check.

| Item | Value |
| --- | --- |
| Checkout total after trial (net / VAT / gross) | _pending B3_ |
| Session id prefix | _pending B3_ |
| Webhook event ids (all 200) | _pending B3_ |
| Provision state + cell `/health` | _pending B3_ |
| Cancellation + retention state | _pending B3_ |
| Card shows no charge | _pending B3_ |

**Then (agent, after B3 passes, not before):** remove the pilot copy in **the same change that makes it false** (rollout plan L8). That is four files, not one: `site/content/docs/cloud/pricing.mdx`, `site/content/docs/legal/terms.mdx`, `privacy.mdx`, `dpa.mdx`, plus the `/cloud` page callout and the Cloud band fine print from Phase A. Repoint Get Maude Cloud to `https://cloud.maude.sh/projects/new`. Also delete the `$comment` line "PROPOSAL, NOT SIGNED OFF" in `pricing.json` and its test once you have signed the numbers off.

## Phase C — the intro film (own PR, own lane)

### Task C1: WRITE the intro film script (beat sheet + VO)

- **Do**:
  - Write `scripts/video/intro2-script.md`: about 60 s, 30 fps, 1920×1080. A 1080×1920 cut is out of scope.
  - Final words go through `maude-positioning` and `michal-voice` (EN-dev). The draft beats:

    | # | s | Screen | VO (draft) |
    |---|---|---|---|
    | 1 | 0–5 | the three headline lines appear, "Maude." gets selected | "You like Figma. You like Claude. Meet Maude." |
    | 2 | 5–14 | real capture: select an artboard, ⌘/, ask, AI draws pricing cards | "Draw it yourself, or just ask. The AI draws right on the canvas while you watch." |
    | 3 | 14–22 | one ⌘Z takes back the whole run; version history | "Don't like it? One undo takes the whole thing back." |
    | 4 | 22–32 | the Good ol' HTML wipe: the design slides into its file | "And here's the part that matters. Your design isn't locked in a secret format. It's plain web code, the language AI grew up on. So the AI is fluent in it, and a developer can ship it as it is." |
    | 5 | 32–44 | montage: video timeline, print PDF, Present, moodboard → design system, live cursors | "Screens, reels, slides and print. A design system from a moodboard. Your whole team, live, on one canvas." |
    | 6 | 44–52 | Cloud: a share link, people join | "Maude Cloud puts your project online for everyone. You pay for the project, never per seat." |
    | 7 | 52–60 | end card: Mark, maude.sh, Download | "Maude. Built around AI, not bent to fit one. Free, at maude.sh." |

    The film shows no price (Decision 8).
  - **ElevenLabs:** 2–3 stock-voice candidates as samples for Michal to pick from. Commit the chosen voice id and settings in this file so anyone can re-render.
  - **Delivery:** "Maude" pronounced /mɔːd/, about 150 WPM, files named `vo-1.mp3 … vo-7.mp3`.
- **Files**: `scripts/video/intro2-script.md`
- **Validate**: Michal approves the script and the voice before Task C2. This is his decision, never a gate the agent passes itself.

### Task C2: CAPTURE the product beats

- **Do**:
  - Record beats 2, 3, 5 and 6 from the real Maude 2 desktop app on a throwaway demo project, at 60 fps and 2x.
  - Keep the capture clean: no real account data, `XDG_CONFIG_HOME` isolated, and `claude` stubbed on PATH (memory `maude-fake-home-real-claude-keychain`).
  - Where an AI run is not deterministic, record one real run and keep that take.
  - Store raw clips under `scripts/video/final/public/intro2/captures/`, and the capture script under `scripts/video/final/scripts/`.
- **Files**: the captures and the capture script
- **Gotcha**: WebKit freezes on a locked screen, a slept display or a covered window (memory `maude-webkit-locked-screen-invalid`). Keep the display awake.
- **Validate**: every clip plays, is 1920×1080 or larger, and shows no personal data

### Task C3: BUILD the Intro2 composition

- **Do**:
  - Write `Intro2.tsx` + `src/scenes/intro2/`, using the `video-new-scene` skill for each scene, and register it in `Root.tsx`.
  - Typographic and UI beats can render the ported site components from `site/components/v2/` directly, with their CSS clock paused and scrubbed from `useCurrentFrame()`, so they match the site pixel for pixel.
  - Product beats stay real captures.
  - Transitions come from `@remotion/transitions`, and type from `load-font.ts` using the same font stack as the site.
- **Files**: `scripts/video/final/src/compositions/Intro2.tsx`, `src/scenes/intro2/*`, `src/Root.tsx`
- **Validate**: `cd scripts/video/final && bun run lint:motion && bun run qa Intro2 12 --render`

### Task C4: VO, captions, music; mix

- **Do**:
  - **VO:** recorded per beat through the manual ElevenLabs production pack (as for V5). Michal pastes the lines with the chosen voice and settings, and drops the files in.
  - **Captions:** made with `sub.mjs` (whisper), shipped as a `.vtt` sidecar, with burned-in as an option.
  - **Music bed:** documented in the script file, with its source and licence.
  - **Mix:** parameterise `build-audio.sh` (input video, VO list with offsets, bed and output, via env or args) instead of copying it.
  - **Output:** `out/intro2/Intro2-audio.mp4` at ≤ 16 MB (CRF about 23), plus a poster JPG of the end-card frame.
- **Files**: `scripts/video/final/public/intro2/audio/*`, `scripts/video/final/build-audio.sh`, `public/intro2/captions.vtt`
- **Gotcha**: the ElevenLabs key stays in Michal's account. It never goes into the repo or a log.
- **Validate**:
  - ffprobe shows a duration of about 60 s and an audio stream.
  - Loudness is about -16 LUFS (`ffmpeg -af loudnorm=print_format=summary`).

### Task C5: SHIP the film on the site + README

- **Do**:
  - Host the MP4 as a GitHub release asset, not in `site/public`, which would add up to 16 MB to the repo on every cut. Keep only `intro-poster.jpg` and `intro.vtt` in `site/public`.
  - Turn `IntroVideo` into a real `<video controls preload="metadata" poster>` with `<track kind="captions">`, enable its controls, and remove "coming soon".
  - Place it on Home under the hero; a "Watch the 1-minute intro" link in the hero fine print scrolls to it.
  - Point the README embed at the new asset.
- **Files**: `site/components/mdcc/intro-video.tsx` (or move it to `components/v2/`), `site/public/intro-poster.jpg`, `site/public/intro.vtt`, `site/app/(home)/page.tsx`, `README.md`
- **Validate**: build; the video plays in Chromium and WebKit; captions toggle

---

## Validation

1. **Static checks.** Run all of these:
   - `pnpm lint`
   - `pnpm --filter @maude/site types:check`
   - `pnpm --filter @maude/site build`
   - the `tokens` and `site-content` gates
   - `node --test apps/cloud/*.test.mjs` (Phase B)
2. **Scenario.** web-desktop 1440 and web-mobile 390, via agent-browser. Native platforms are skipped because this is a website.
   - Flow:
     1. Home loads.
     2. A hero chip rewrites the headline; ⌘Z restores it.
     3. Drag a sticky.
     4. Scroll to the bento and move the wipe slider.
     5. Open Pricing, switch to Yearly, and follow the Get Maude Cloud target.
     6. Open Docs, take the Advanced door, and open one Advanced page.
   - Plus one run with JS disabled: every section is visible and the h1 is present.
3. **Design System Guard.** Compare the scenario screenshots with the canvas exports (`maude design export png --scope selection`).
4. **A11y.** Run `a11y-auditor` on `/`, `/cloud` and `/docs`. It checks:
   - keyboard reach of the chips, undo, wipe and toggle;
   - the aria-live announcement;
   - reduced motion;
   - 44 px targets on mobile;
   - contrast in light and dark.
5. **Performance.** Measured and reported, but not a blocker: Lighthouse mobile on `/`, the LCP element, and island JS size.
6. **Payments.** The B3 evidence table.
7. **Manual.** Michal:
   - watches the film with sound;
   - checks the VO pronunciation;
   - reviews the hero rewrite copy;
   - signs off B3.

---

## Scenario Coverage

| Scenario | Covers | Status |
| -------- | ------ | ------ |
| `public-site-v2-home` | hero interactions, bento, wipe, Cloud band, footer | 🆕 new |
| `public-site-v2-pricing` | toggle, CTA target, FAQ | 🆕 new |
| `public-site-v2-docs` | two doors, Advanced page, old URLs | 🆕 new |

---

## Open questions (for Michal)

1. **Is Maude Cloud actually deployed on the real account?** Task B0 checks it read-only. If it isn't, which of the DDR-196 blockers is left?
2. **Where does the film's music bed come from?** A licensed track you already have, or generated (ElevenLabs music)?

## Acceptance Criteria

- [ ] All tasks completed
- [ ] Home, /cloud and /docs match the frozen canvas at 1440 and 390 (design-system-guard: 0 blockers)
- [ ] Every old URL resolves, and every Advanced doc page is kept
- [ ] Pages render complete with JS off, and motion respects reduced motion
- [ ] a11y-auditor: 0 blockers
- [ ] Every claim on the site and in the VO maps to a shipped feature (maude-positioning), and no price is typed by hand
- [ ] Live payments: one real purchase and cancellation proven (B3), with no pilot copy left
- [ ] Intro film: about 60 s, with VO, captions and music; ≤ 16 MB; hosted as a release asset; plays on Home and in the README
- [ ] Generated site content regenerated and committed; site gates green

## Progress (2026-11-04, local final — nothing pushed or deployed)

Branch `feat/public-site-v2` (worktree `.claude/worktrees/public-site-v2`), with `feat/public-site-v2-pay` and `feat/public-site-v2-film` merged in.

- **Phase A done:** A0 critic round (design + a11y; fixes applied in site/, canvas frozen), A1–A12. Gates green: lint, format, tokens, site-content, build, types:check. All 89 sitemap URLs return 200 on a local `next start`. Still to do before merge: curl the sitemap against the Vercel preview.
- **Phase B, agent half done:** catalog + fill scripts with tests, `/health` reports `stripe`, scripts/ tests in CI, Michal's runbook (above). Still open, all Michal's: run the runbook, then B3. After B3: flip `PILOT_ON` and `CLOUD_START` in `site/components/v2/pilot.tsx`, and remove the pilot copy from pricing/terms/privacy/dpa.
- **Phase C done locally:** the film is `scripts/video/final/out/intro2/Intro2-audio.mp4` (60.0 s, 9.2 MB, -16 LUFS, voice Sarah `EXAVITQu4vr4xnSDxMaL` on eleven_v3, generated music bed). Poster and captions are in site/public, the player is on Home, the README embed points at release `intro-v2`. Still open: Michal listens to the film and approves the voice, checks the music licence for commercial use, and uploads the release asset (command in README).

Acceptance status:
- met locally: tasks, canvas match, URLs, no-JS, claims, generated content;
- open: design-system-guard + a11y-auditor on the real site, B3 live purchase, release-asset upload.
