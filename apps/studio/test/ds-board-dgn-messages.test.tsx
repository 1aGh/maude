// S10.16c — the Design system canvas's three shell messages are typed dgn messages (bridge/dgn-protocol.ts),
// not raw `{ type: 'maude:ds-…' }` posts: `ds-theme-preview`, `ds-marks`, `ds-make-states`. Each is an s2c row gated
// 'parent' with a parser and caps; the board listens through `acceptFromShell` and keeps the parent-only check.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

import { s2cSpec } from '../bridge/dgn-protocol.ts';

let registeredHere = false;
beforeAll(async () => {
  if (typeof document === 'undefined') {
    if (GlobalRegistrator.isRegistered) await GlobalRegistrator.unregister();
    GlobalRegistrator.register();
    registeredHere = true;
  }
});
afterAll(async () => {
  if (registeredHere && GlobalRegistrator.isRegistered) await GlobalRegistrator.unregister();
});

const parse = (m: Record<string, unknown>) => s2cSpec(String(m.dgn))?.parse(m) ?? null;
const STUDIO = join(import.meta.dir, '..');

describe('the three rows', () => {
  test.each([
    'ds-theme-preview',
    'ds-marks',
    'ds-make-states',
  ])('%s is a parent-gated live s2c row', (t) => {
    const s = s2cSpec(t);
    expect(s?.gate).toBe('parent');
    expect(s?.status).toBe('live');
  });

  test('ds-theme-preview: light | dark only', () => {
    expect(parse({ dgn: 'ds-theme-preview', mode: 'dark' })).toEqual({ mode: 'dark' });
    expect(parse({ dgn: 'ds-theme-preview', mode: 'light' })).toEqual({ mode: 'light' });
    expect(parse({ dgn: 'ds-theme-preview', mode: 'sepia' })).toBeNull();
    expect(parse({ dgn: 'ds-theme-preview' })).toBeNull();
  });

  test('ds-marks: registry-shaped names, at most 200 each', () => {
    expect(parse({ dgn: 'ds-marks', outside: ['--fg-3'], conflicts: ['--accent'] })).toEqual({
      outside: ['--fg-3'],
      conflicts: ['--accent'],
    });
    expect(parse({ dgn: 'ds-marks', outside: [], conflicts: [] })).toEqual({
      outside: [],
      conflicts: [],
    });
    expect(parse({ dgn: 'ds-marks', outside: ['red;}body{x:y'], conflicts: [] })).toBeNull();
    expect(parse({ dgn: 'ds-marks', outside: ['fg-3'], conflicts: [] })).toBeNull();
    const many = Array.from({ length: 201 }, (_, i) => `--t${i}`);
    expect(parse({ dgn: 'ds-marks', outside: many, conflicts: [] })).toBeNull();
    expect(parse({ dgn: 'ds-marks', outside: many.slice(0, 200), conflicts: [] })).not.toBeNull();
    expect(parse({ dgn: 'ds-marks', outside: 'x', conflicts: [] })).toBeNull();
  });

  test('ds-make-states: the seven sections and the three words, nothing else', () => {
    const ok = { brand: 'done', colour: 'drawing', type: 'waiting' };
    expect(parse({ dgn: 'ds-make-states', sections: ok })).toEqual({ sections: ok });
    expect(parse({ dgn: 'ds-make-states', sections: {} })).toEqual({ sections: {} });
    expect(parse({ dgn: 'ds-make-states', sections: { brand: 'finished' } })).toBeNull();
    expect(parse({ dgn: 'ds-make-states', sections: { __proto__x: 'done' } })).toBeNull();
    expect(parse({ dgn: 'ds-make-states', sections: { sidebar: 'done' } })).toBeNull();
    expect(parse({ dgn: 'ds-make-states', sections: 'done' })).toBeNull();
  });
});

describe('the table’s section list is the board’s', () => {
  test('DS_SECTION_KINDS = ds/board/types.ts SECTIONS, in order', async () => {
    const { DS_SECTION_KINDS } = await import('../bridge/dgn-protocol.ts');
    const { SECTIONS } = await import('../ds/board/types.ts');
    expect([...DS_SECTION_KINDS]).toEqual(SECTIONS.map((s) => s.kind));
  });
});

describe('the board listens through the table, and only to its parent', () => {
  const fromParent = (data: unknown) =>
    window.dispatchEvent(new MessageEvent('message', { source: window.parent, data }));
  const fromSibling = (data: unknown) =>
    window.dispatchEvent(
      new MessageEvent('message', { source: { name: 'sibling' } as unknown as Window, data })
    );

  test('theme preview and marks', async () => {
    const st = await import('../ds/board/state.ts?s10-16c');
    st.__resetBoardState();
    st.listenForThemePreview();
    fromParent({ dgn: 'ds-theme-preview', mode: 'dark' });
    expect(st.getBoardMode()).toBe('dark');
    fromSibling({ dgn: 'ds-theme-preview', mode: 'light' });
    expect(st.getBoardMode()).toBe('dark');
    // the retired raw shape does nothing
    fromParent({ type: 'maude:ds-theme-preview', mode: 'light' });
    expect(st.getBoardMode()).toBe('dark');
    fromParent({ dgn: 'ds-marks', outside: ['--fg-3'], conflicts: ['--accent'] });
    expect(st.getBoardMarks()).toEqual({ outside: ['--fg-3'], conflicts: ['--accent'] });
    fromSibling({ dgn: 'ds-marks', outside: [], conflicts: [] });
    expect(st.getBoardMarks().outside).toEqual(['--fg-3']);
    fromParent({ type: 'maude:ds-marks', outside: [], conflicts: [] });
    expect(st.getBoardMarks().outside).toEqual(['--fg-3']);
    // junk the parser refuses never reaches the board
    fromParent({ dgn: 'ds-marks', outside: ['red;}body{x:y'], conflicts: [] });
    expect(st.getBoardMarks().outside).toEqual(['--fg-3']);
    st.__resetBoardState();
  });

  test('outline states', async () => {
    const ol = await import('../ds/board/outline.tsx?s10-16c');
    ol.__resetOutlineStates();
    ol.listenForOutlineStates();
    fromParent({ dgn: 'ds-make-states', sections: { brand: 'done', colour: 'drawing' } });
    expect(ol.getOutlineStates()).toEqual({ brand: 'done', colour: 'drawing' });
    fromSibling({ dgn: 'ds-make-states', sections: { type: 'done' } });
    expect(ol.getOutlineStates()).toEqual({ brand: 'done', colour: 'drawing' });
    fromParent({ type: 'maude:ds-make-states', sections: { type: 'done' } });
    expect(ol.getOutlineStates()).toEqual({ brand: 'done', colour: 'drawing' });
    ol.__resetOutlineStates();
  });
});

describe('nothing raw is left', () => {
  const walk = (dir: string, out: string[] = []): string[] => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p, out);
      else if (/\.(jsx?|tsx?)$/.test(e.name)) out.push(p);
    }
    return out;
  };
  test('no `type: "maude:ds-…"` message is sent or read in the shell or the board', () => {
    const files = [...walk(join(STUDIO, 'client/v2/ds')), ...walk(join(STUDIO, 'ds/board'))];
    const raw = files.filter((f) =>
      /type\s*(?::|===)\s*['"]maude:ds-/.test(readFileSync(f, 'utf8'))
    );
    expect(raw.map((f) => f.replace(STUDIO, ''))).toEqual([]);
  });
});
