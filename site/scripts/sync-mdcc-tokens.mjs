#!/usr/bin/env node
// Sync the design tokens from .design/system/<ds>/colors_and_type.css into
// site/app/mdcc-tokens.css. The source-of-truth lives in .design; this script
// transforms its theme scoping to the site's `.mdcc` / `html.dark` convention
// and keeps the published copy under site/app/ in lock-step.
//
// DS retarget (DDR-09X): the site now consumes the **maude** DS ("Unified Pro
// Studio" — dark-first cool-neutral, one indigo accent) instead of the legacy
// **project** DS. maude scopes tokens under `.maude[data-theme="dark|light"]`
// with dark as `:root`; the site scopes light at `:root`/`.mdcc` (fumadocs
// default) and rides dark on the fumadocs `.dark` className (DDR-011 bridge).
// We rewrite the selectors during sync and append a reconciliation block for
// the handful of token NAMES the site's `.mdcc-*` classes consume that maude
// doesn't define.
//
// Usage:
//   node scripts/sync-mdcc-tokens.mjs           # transform SRC → DST (overwrites)
//   node scripts/sync-mdcc-tokens.mjs --check   # exit non-zero on drift, no write
//   node scripts/sync-mdcc-tokens.mjs --ds=foo  # target a different DS folder

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');

const dsArg = process.argv.find((a) => a.startsWith('--ds='));
// V2-2.6 (T13 minimum): the site follows the v2 design system. `--ds=maude` still works.
const DS = dsArg ? dsArg.slice('--ds='.length) : 'maude-v2';

const SRC = resolve(REPO_ROOT, `.design/system/${DS}/colors_and_type.css`);
const DST = resolve(REPO_ROOT, 'site/app/mdcc-tokens.css');

const check = process.argv.includes('--check');

// ── Selector transform ──────────────────────────────────────────────────────
// maude → site theme scoping. In maude the dark/default block at `:root` carries
// the FULL token set (colours + structure: fonts, spacing, radii, type scale,
// motion); the light block only overrides COLOURS and inherits structure from
// `:root`. On the site, light is the fumadocs default (no class) and dark rides
// the `.dark` className (DDR-011 bridge). So the base block must STAY anchored at
// `:root, .mdcc` (theme-independent structure + dark colours as the default) and
// ALSO match the dark scopes; the light block then overrides only colours at
// `:root, .mdcc` with later (equal-specificity) declarations, while dark wins via
// the higher-specificity `html.dark` scopes. Dropping `:root` from the base block
// — as the first cut did — severed every structural token to dark-only and
// collapsed light mode (no fonts/spacing/radii). See DDR-099 follow-up.
const SELECTOR_MAPS = {
  maude: [
    // Base/default block opener — keep `:root, .mdcc` (structure + dark default)
    // and add the dark scopes so dark colours win on the `.dark` toggle.
    [':root,\n.maude[data-theme="dark"] {', ':root,\n.mdcc,\nhtml.dark.mdcc,\nhtml.dark .mdcc {'],
    // Light block opener.
    ['.maude[data-theme="light"] {', ':root,\n.mdcc,\n.mdcc[data-theme="light"] {'],
    // Reduced-motion guard — collapse durations for every site scope.
    [
      '  :root,\n  .maude[data-theme="dark"],\n  .maude[data-theme="light"] {',
      '  :root,\n  .mdcc,\n  html.dark.mdcc,\n  html.dark .mdcc {',
    ],
  ],
  // maude-v2 is LIGHT-first (`:root` = light) and keeps its structure (radii, spacing, type,
  // motion) in one theme-independent block — which is exactly the site's shape: light at
  // `:root, .mdcc`, dark on the fumadocs `html.dark` className at higher specificity.
  // Order matters: the 3-line lists first, so the bare dark opener matches only the dark block.
  'maude-v2': [
    [
      ':root,\n.maude-v2[data-theme="light"],\n.maude-v2[data-theme="dark"] {',
      ':root,\n.mdcc,\nhtml.dark.mdcc,\nhtml.dark .mdcc {',
    ],
    [
      '  :root,\n  .maude-v2[data-theme="light"],\n  .maude-v2[data-theme="dark"] {',
      '  :root,\n  .mdcc,\n  html.dark.mdcc,\n  html.dark .mdcc {',
    ],
    [':root,\n.maude-v2[data-theme="light"] {', ':root,\n.mdcc,\n.mdcc[data-theme="light"] {'],
    ['\n.maude-v2[data-theme="dark"] {', '\nhtml.dark.mdcc,\nhtml.dark .mdcc {'],
  ],
};
const SELECTOR_MAP = SELECTOR_MAPS[DS];
if (!SELECTOR_MAP) {
  console.error(`[sync-mdcc-tokens] no selector map for DS "${DS}" — add one to SELECTOR_MAPS`);
  process.exit(2);
}

// ── Reconciliation aliases ──────────────────────────────────────────────────
// Token NAMES the site's `.mdcc-*` classes (global.css + components) consume
// that the maude DS doesn't define. var()-based aliases resolve against the
// themed base tokens above, so one block serves both themes. The selector list
// includes the dark scopes at matching specificity so `--layout-max-w` wins
// over maude's `none` (full-bleed app surface) in dark mode too — the docs site
// wants a centered max-width.
const RECONCILIATION = `
/* ── site reconciliation (generated) ─────────────────────────────────────────
 * Names the site's .mdcc-* classes consume that the source DS doesn't define.
 * Edit the alias table in scripts/sync-mdcc-tokens.mjs, never this file. */
:root,
.mdcc,
html.dark.mdcc,
html.dark .mdcc {
  --layout-max-w: 1240px;       /* maude = none (full-bleed app); docs site centers */
  --layout-prose: 72ch;
  --mono-cell-bg: var(--bg-2);
  --mono-cell-fg: var(--fg-1);
  --mono-rule: var(--border-subtle);
  --rule-thin: 1px solid var(--border-default);
  --rule-strong: 1px solid var(--border-strong);
  --space-9: 64px;
  --tracking-normal: 0;
  --tracking-sku: 0.12em;
  --tracking-eyebrow: 0.18em;
  --shadow-focus: 0 0 0 2px var(--accent);
}
`;

const BANNER = `/* GENERATED by site/scripts/sync-mdcc-tokens.mjs from
   .design/system/${DS}/colors_and_type.css — DO NOT EDIT BY HAND.
   Selectors are transformed to the site's .mdcc / html.dark scoping and a
   reconciliation block is appended. Run: pnpm --filter @maude/site sync:tokens */
`;

/** Pure transform: maude tokens CSS → site mdcc-tokens.css. */
function transform(src) {
  let out = src;
  for (const [from, to] of SELECTOR_MAP) {
    if (!out.includes(from)) {
      throw new Error(
        `[sync-mdcc-tokens] expected selector not found in ${SRC}:\n${from}\n` +
          'The source DS scoping changed — update SELECTOR_MAP.'
      );
    }
    out = out.replace(from, to);
  }
  return `${BANNER}${out}${RECONCILIATION}`;
}

if (!existsSync(SRC)) {
  console.error(`[sync-mdcc-tokens] source missing: ${SRC}`);
  process.exit(2);
}

const src = readFileSync(SRC, 'utf8');
const next = transform(src);
const dst = existsSync(DST) ? readFileSync(DST, 'utf8') : null;

if (check) {
  if (next !== dst) {
    console.error(
      `[sync-mdcc-tokens] DRIFT: ${DST} is stale vs transformed ${SRC}.\n` +
        'Run: pnpm --filter @maude/site sync:tokens'
    );
    process.exit(1);
  }
  console.log('[sync-mdcc-tokens] in sync');
  process.exit(0);
}

writeFileSync(DST, next);
console.log(`[sync-mdcc-tokens] wrote ${DST} (${next.length} bytes, DS=${DS})`);
