// canvas-ds-icons — P8 C5: the in-canvas chrome draws the maude-v2 family, path for path. The iframe keeps its
// own copy (another bundle than the shell), so this pins every path to the board kit (`.design/ui/v2/_kit.tsx`,
// FAMILY = the DS iconography GLYPHS + KIT_GLYPHS): a glyph that drifts from the DS is a red test.

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { DS_GLYPHS, DsIcon } from '../canvas-ds-icons.tsx';

const KIT = readFileSync(join(import.meta.dir, '../../../.design/ui/v2/_kit.tsx'), 'utf8');

describe('canvas-ds-icons', () => {
  test('every glyph is the kit glyph of the same name, path for path', () => {
    for (const name of Object.keys(DS_GLYPHS)) {
      const html = renderToStaticMarkup(<DsIcon name={name} />);
      const ds = [...html.matchAll(/ d="([^"]+)"/g)].map((m) => m[1] as string);
      const at = KIT.search(new RegExp(`\\n\\s*"?${name}"?: `));
      expect({ name, found: at >= 0 }).toEqual({ name, found: true });
      const line = KIT.slice(at, KIT.indexOf('\n', at + 1));
      for (const d of ds)
        expect({ name, d, inKit: line.includes(`d="${d}"`) }).toEqual({ name, d, inKit: true });
    }
  });

  test('16 grid, 1.5 round stroke, currentColor, hidden from AT; an unknown name draws nothing', () => {
    const html = renderToStaticMarkup(<DsIcon name="web" />);
    expect(html).toContain('viewBox="0 0 16 16"');
    expect(html).toContain('stroke-width="1.5"');
    expect(html).toContain('stroke="currentColor"');
    expect(html).toContain('aria-hidden="true"');
    expect(renderToStaticMarkup(<DsIcon name="nope" />)).toBe('');
  });
});
