// r1 (Michal rc.1, img 8) — "home pill nema zadny padding": on Home the project pill was only as tall as its
// mark. `.sh-pill.island { height: var(--pill-h) }` had no fallback, and `--pill-h` is defined on `.sh-body`
// — the project shell. Home has no `.sh-body`, so the height was invalid at computed time (auto) and the pill
// hugged its 22 px mark with no room above or below. Every `var(--pill-h…)` in the client CSS now carries the
// 40 px fallback the shell's other islands already used, so the pill keeps its height wherever it is drawn.

import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const CLIENT = join(import.meta.dir, '../client');

function cssFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) cssFiles(p, out);
    else if (name.endsWith('.css')) out.push(p);
  }
  return out;
}

describe('the project pill keeps its height outside the project shell (Home)', () => {
  test('.sh-pill.island takes its height with the 40 px fallback', () => {
    const css = readFileSync(join(CLIENT, 'v2/shell/project-pill.css'), 'utf8');
    const at = css.indexOf('.sh-pill.island {');
    const rule = css.slice(at, css.indexOf('}', at));
    expect(rule).toMatch(/height:\s*var\(--pill-h,\s*40px\)/);
  });

  test('no client stylesheet reads --pill-h without a fallback', () => {
    const bare: string[] = [];
    for (const f of cssFiles(CLIENT)) {
      const src = readFileSync(f, 'utf8');
      for (const m of src.matchAll(/var\(--pill-h\s*\)/g))
        bare.push(`${f.slice(CLIENT.length)}@${m.index}`);
    }
    expect(bare).toEqual([]);
  });
});
