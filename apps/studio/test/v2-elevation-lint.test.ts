// S11.18 (S11-slices Q15) — `00/rule/lower-elevation`: islands float on a soft shadow, and the shadow comes from the
// elevation tokens (CONTRACT §6, "Elevation tokens lowered"). A rule on `.island` may set `box-shadow` to a token,
// to `none`, or add a flat ring (no offset, no blur: a hairline or a focus ring). A raw drop shadow is a hit.

import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lastCompounds, readDecls } from './_v2-css-scan.ts';

const CLIENT = join(dirname(fileURLToPath(import.meta.url)), '..', 'client');

/** Split on top-level commas (a comma inside var(...) or oklch(...) does not split). */
function layers(value: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of value) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      out.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

const TOKEN =
  /^var\(--(?:island-shadow|x-island-shadow|shadow-(?:sm|md|lg|focus))(?:\s*,[\s\S]*)?\)$/;
const RING = /^(?:inset\s+)?0\s+0\s+0\s+[\d.]+px\s+\S[\s\S]*$/;

/** The layers of a `box-shadow` value that are neither a token, nor `none`, nor a flat ring. */
export function rawShadowLayers(value: string): string[] {
  return layers(value).filter((l) => l !== 'none' && !TOKEN.test(l) && !RING.test(l));
}

/** Every `.island` rule whose box-shadow has a raw layer. */
export function elevationHits(css: string): { line: number; selector: string; layer: string }[] {
  const out: { line: number; selector: string; layer: string }[] = [];
  for (const d of readDecls(css)) {
    if (d.prop !== 'box-shadow') continue;
    if (!lastCompounds(d.selector).some((c) => /\.island(?![-\w])/.test(c))) continue;
    for (const layer of rawShadowLayers(d.value))
      out.push({ line: d.line, selector: d.selector, layer });
  }
  return out;
}

function cssFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) cssFiles(p, out);
    else if (name.endsWith('.css')) out.push(p);
  }
  return out;
}

describe('the lint reads shadows', () => {
  test('a raw drop shadow on .island is a hit; tokens, none and flat rings are not', () => {
    expect(elevationHits('.island { box-shadow: 0 8px 24px rgba(0,0,0,.4); }')).toHaveLength(1);
    expect(
      elevationHits('.a .island { box-shadow: var(--island-shadow), 0 12px 30px #000; }')
    ).toHaveLength(1);
    expect(elevationHits('.x.island { box-shadow: var(--shadow-md); }')).toEqual([]);
    expect(elevationHits('.island { box-shadow: none; }')).toEqual([]);
    expect(
      elevationHits(
        '.island { box-shadow: var(--island-shadow, 0 4px 14px #000), inset 0 0 0 0.5px var(--island-edge); }'
      )
    ).toEqual([]);
    expect(
      elevationHits('.island:focus-within { box-shadow: 0 0 0 3px var(--accent-tint); }')
    ).toEqual([]);
  });

  test('only a rule on .island itself counts (not .island-title, not another element)', () => {
    expect(elevationHits('.island-title { box-shadow: 0 8px 24px #000; }')).toEqual([]);
    expect(elevationHits('.card { box-shadow: 0 8px 24px #000; }')).toEqual([]);
  });

  test('a comma inside a colour function does not split a layer', () => {
    expect(
      rawShadowLayers('0 2px 10px oklch(0.24 0.03 250 / 0.07), 0 0.5px 1.5px rgba(0, 0, 0, 0.1)')
    ).toHaveLength(2);
  });
});

describe('the shell’s CSS', () => {
  test('no island sets a raw drop shadow', () => {
    const bad: string[] = [];
    for (const f of cssFiles(CLIENT)) {
      for (const h of elevationHits(readFileSync(f, 'utf8')))
        bad.push(`${relative(CLIENT, f)}:${h.line} ${h.selector} => ${h.layer}`);
    }
    expect(bad).toEqual([]);
  });

  test('the elevation tokens exist for both themes', () => {
    const css = readFileSync(join(CLIENT, 'styles', '1-tokens-maude-v2.css'), 'utf8');
    const n = (css.match(/--island-shadow:/g) ?? []).length;
    expect(n).toBeGreaterThanOrEqual(2);
    expect((css.match(/--shadow-lg:/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });
});
