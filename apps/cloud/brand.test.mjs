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

import { lockup, PAGE_CSS, TOKENS } from './brand.mjs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '../..');
const DS_TOKENS = join(REPO, '.design/system/maude/colors_and_type.css');
const DS_LOGO_CSS = join(REPO, '.design/system/maude/preview/logo.css');
const DS_LOGO_TSX = join(REPO, '.design/system/maude/preview/logo.tsx');

/** `--name: value;` pairs from a CSS blob, first occurrence wins (dark = default). */
function declarations(css) {
  const out = new Map();
  for (const [, name, value] of css.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/gi)) {
    const key = name.trim();
    if (!out.has(key)) out.set(key, value.trim().replace(/\s+/g, ' '));
  }
  return out;
}

/**
 * The DS (schema v1, V2-2.15) names some tokens by alias — `--accent-muted:
 * var(--accent-soft)`, `--canvas-dot: var(--x-canvas-dot)`. The pages inline the
 * RESOLVED value, so compare against the DS value with every bare `var(--x)`
 * followed to its own declaration. An alias is indirection, not drift: the
 * resolved value must still equal the page's exactly.
 */
function resolveAlias(ds, value, depth = 0) {
  const m = /^var\((--[a-z0-9-]+)\)$/i.exec(value);
  if (!m || depth > 8 || !ds.has(m[1])) return value;
  return resolveAlias(ds, ds.get(m[1]), depth + 1);
}

describe('the tokens are the design system’s, not lookalikes', () => {
  it('every token the pages use matches the DS value exactly', () => {
    // "Close enough" is how a product ends up with two indigos.
    const ds = declarations(readFileSync(DS_TOKENS, 'utf8'));
    const mine = declarations(TOKENS);
    assert.ok(mine.size >= 40, `expected a real subset, got ${mine.size} tokens`);

    const drift = [];
    for (const [name, value] of mine) {
      if (!ds.has(name)) {
        drift.push(`${name} is not in the design system at all`);
      } else if (resolveAlias(ds, ds.get(name)) !== value) {
        drift.push(`${name}: page has "${value}", DS has "${resolveAlias(ds, ds.get(name))}"`);
      }
    }
    assert.deepEqual(drift, [], `token drift:\n  ${drift.join('\n  ')}`);
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
  it('uses the DS path verbatim, not a redrawn star', () => {
    // DDR-141: a brand mark in a surface IS the stored specimen's mark. A
    // redrawn mark is a second mark, and nobody ever notices until both are
    // in the wild.
    const dsPath = readFileSync(DS_LOGO_TSX, 'utf8').match(/d="(M16 5l[^"]+)"/)?.[1];
    assert.ok(dsPath, 'could not find the spark path in the DS specimen');
    assert.ok(lockup().includes(dsPath), 'the mark path must be lifted, not re-authored');
  });

  it('keeps the squared bottom-right corner — that IS the mark', () => {
    // A star in a fully-rounded box is somebody else's logo.
    const dsRadius = readFileSync(DS_LOGO_CSS, 'utf8').match(/border-radius:\s*(24%[^;]*);/)?.[1];
    assert.equal(dsRadius?.trim(), '24% 24% 0 24%');
    assert.match(PAGE_CSS, /border-radius: 24% 24% 0 24%/);
  });

  it('the tile takes accent-fg, so the star holds contrast at every size', () => {
    // The DS is explicit: white on the indigo would be 3.0:1. The dark navy is
    // 6.3:1. Getting this backwards is the classic way to ship an unreadable
    // favicon.
    assert.match(PAGE_CSS, /\.mark \{[^}]*background: var\(--accent\)/s);
    assert.match(PAGE_CSS, /\.mark \{[^}]*color: var\(--accent-fg\)/s);
  });
});

describe('the signature surface is present', () => {
  it('the pages sit on the dotted canvas, not on flat grey', () => {
    // It is the one visual idea this product has, and the front door was the
    // single surface not using it.
    assert.match(PAGE_CSS, /radial-gradient\(var\(--canvas-dot\) 1px/);
    assert.match(PAGE_CSS, /background-size: var\(--canvas-grid\)/);
  });
});
