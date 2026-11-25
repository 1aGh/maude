// The cloud pages wear the Maude design system — and keep wearing it.
//
// `brand.mjs` inlines a SUBSET of the DS tokens, because these are small
// server-rendered pages and shipping 187 lines of variables to use fifteen of
// them is waste. A subset is only defensible while it is provably identical to
// the source, which is what this file is for.
//
// Same pattern as the hub's plain-JS twins: copy, then prove the copy.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { appShell, lockup, PAGE_CSS, TOKENS } from './brand.mjs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '../..');
const DS_TOKENS = join(REPO, '.design/system/maude-v2/colors_and_type.css');
const DS_MARK = join(REPO, '.design/system/maude-v2/preview/_specimen-controls.tsx');

/** `--name: value;` pairs from a CSS blob, first occurrence wins. */
function declarations(css) {
  const out = new Map();
  for (const [, name, value] of css.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/gi)) {
    const key = name.trim();
    if (!out.has(key)) out.set(key, value.trim().replace(/\s+/g, ' '));
  }
  return out;
}

/**
 * The DS names some tokens by alias — `--accent-muted: var(--accent-soft)`.
 * The pages inline the RESOLVED value, so compare against the DS value with
 * every bare `var(--x)` followed to its own declaration in the same theme.
 */
function resolveAlias(ds, value, depth = 0) {
  const m = /^var\((--[a-z0-9-]+)\)$/i.exec(value);
  if (!m || depth > 8 || !ds.has(m[1])) return value;
  return resolveAlias(ds, ds.get(m[1]), depth + 1);
}

/**
 * The DS file in its two themes. Light is `:root` (the default) plus the
 * theme-independent block; dark is the `[data-theme="dark"]` block over the
 * same theme-independent block.
 */
function dsThemes() {
  const css = readFileSync(DS_TOKENS, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const blocks = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, sel, body]) => ({ sel, body }));
  const light = blocks.find(
    (b) => /:root/.test(b.sel) && /data-theme="light"/.test(b.sel) && !/dark/.test(b.sel)
  );
  const dark = blocks.find((b) => /data-theme="dark"/.test(b.sel) && !/light/.test(b.sel));
  const common = blocks.find(
    (b) => /data-theme="light"/.test(b.sel) && /data-theme="dark"/.test(b.sel)
  );
  const both = (theme) =>
    new Map([...declarations(common?.body ?? ''), ...declarations(theme?.body ?? '')]);
  return { light: both(light), dark: both(dark) };
}

function driftOf(mine, ds) {
  const drift = [];
  for (const [name, value] of mine) {
    if (!ds.has(name)) drift.push(`${name} is not in the design system at all`);
    else if (resolveAlias(ds, ds.get(name)) !== value) {
      drift.push(`${name}: page has "${value}", DS has "${resolveAlias(ds, ds.get(name))}"`);
    }
  }
  return drift;
}

describe('the tokens are the design system’s, not lookalikes', () => {
  it('every token the pages use matches the DS value exactly — light, the default', () => {
    // "Close enough" is how a product ends up with two azures.
    const { light } = dsThemes();
    const mine = declarations(TOKENS.slice(0, TOKENS.indexOf('@media')));
    assert.ok(mine.size >= 40, `expected a real subset, got ${mine.size} tokens`);
    const drift = driftOf(mine, light);
    assert.deepEqual(drift, [], `token drift:\n  ${drift.join('\n  ')}`);
  });

  it('is light only, as canvas 16 draws it — no dark block follows the system', () => {
    // Owner decision 2026-11-25: the admin pages are always light.
    assert.doesNotMatch(TOKENS, /prefers-color-scheme/);
    assert.match(TOKENS, /color-scheme: light/);
  });

  it('carries the reduced-motion invariant with them', () => {
    // Not optional and not a page-level nicety — it travels with the tokens
    // (DDR-043), so a surface that copies the tokens copies this too.
    assert.match(TOKENS, /prefers-reduced-motion: reduce/);
    assert.match(TOKENS, /--dur-soft: 1ms/);
  });

  it('hardcodes no colour of its own', () => {
    // Every colour must come from a token. A literal hex or oklch outside the
    // token block is a second palette starting.
    const chrome = PAGE_CSS.slice(PAGE_CSS.indexOf('* { box-sizing'));
    const literals = [
      ...chrome.matchAll(/#[0-9a-f]{3,8}\b/gi),
      ...chrome.matchAll(/\boklch\(/gi),
      ...chrome.matchAll(/\brgba?\(/gi),
    ].map((m) => m[0]);
    assert.deepEqual(literals, [], `colour literals outside the tokens: ${literals.join(', ')}`);
  });
});

describe('the mark is the stored specimen’s mark', () => {
  it('uses the DS paths verbatim — the tile with its squared corner, and the star', () => {
    // DDR-141: a brand mark in a surface IS the stored specimen's mark. A
    // redrawn mark is a second mark. The tile's squared bottom-right corner is
    // what makes it the Maude mark rather than a star in a rounded box.
    const src = readFileSync(DS_MARK, 'utf8');
    const tile = src.match(/d="(M7 0H25[^"]+)"/)?.[1];
    const star = src.match(/d="(M16 5l[^"]+)"/)?.[1];
    assert.ok(tile && star, 'could not find the mark paths in the DS specimen');
    assert.ok(lockup().includes(tile), 'the tile path must be lifted, not re-authored');
    assert.ok(lockup().includes(star), 'the star path must be lifted, not re-authored');
  });

  it('the tile takes accent and the star accent-fg', () => {
    assert.match(lockup(), /d="M7 0H25[^"]+" fill="var\(--accent\)"/);
    assert.match(lockup(), /d="M16 5l[^"]+" fill="var\(--accent-fg\)"/);
  });
});

describe('the page is the design’s (canvas 16)', () => {
  it('a light page on --bg-0 with one floating nav island, and no sidebar', () => {
    assert.match(PAGE_CSS, /body \{[^}]*background: var\(--bg-0\)/s);
    const html = appShell({ account: { email: 'a@example.com' }, title: 'Overview', body: '' });
    assert.match(html, /<nav class="island ma-nav"/);
    assert.doesNotMatch(html, /class="shell"|class="nav-item"|nav-hd/);
  });
});
