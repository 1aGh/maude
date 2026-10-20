// S10.8 (13 · ds-edit-instance) — a canvas that was left out of an update: what it is missing, in words; the
// instance's "Update available" block (Update gives THIS instance the current look, Detach is S2's); the quiet
// word on the Canvases row; and the edit-op that writes `data-ds-rev="head"` on one instance.
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { DS_ROW_SLOT, dsRowSlots } from '../client/v2/ds/row-dots.js';
import {
  agoWords,
  diffRevisions,
  leftOutMap,
  leftOutOf,
  missedUpdate,
  whatWords,
} from '../client/v2/ds/update-model.js';
import { type DispatchDeps, dispatchEditOp } from '../edit-ops/dispatch.ts';
import { createWriteLog } from '../edit-ops/revert.ts';
import type { EditOpResult } from '../edit-ops/types.ts';

const HEAD = 'a'.repeat(64);
const OLD = 'b'.repeat(64);
const CFG = {
  designRel: '.design',
  designSystems: [{ name: 'studio', path: 'system/studio' }],
  dsConverted: { studio: true },
  systemHeads: { studio: HEAD },
  canvasDsRevs: { 'ui/2026/combine.tsx': OLD, 'ui/Home.tsx': HEAD },
};

const body = (radius: string, accent: string) => ({
  files: {
    'colors_and_type.css': { text: `:root { --accent: ${accent}; --space-1: 4px; }` },
    'preview/_components.css': { text: `.btn { border-radius: ${radius}; padding: 8px; }` },
    'components.json': {
      text: JSON.stringify({ components: { Button: { class: 'btn', label: 'Tlačítko' } } }),
    },
  },
});

describe('is this canvas left out?', () => {
  test('its revision differs from the system head — and only then', () => {
    expect(leftOutOf('ui/2026/combine.tsx', CFG)).toEqual({
      ds: 'studio',
      dsRev: OLD,
      head: HEAD,
      folder: 'ui/2026',
    });
    expect(leftOutOf('.design/ui/2026/combine.tsx', CFG)?.dsRev).toBe(OLD);
    expect(leftOutOf('ui/Home.tsx', CFG)).toBeNull(); // follows head
    expect(leftOutOf('ui/Other.tsx', CFG)).toBeNull(); // no revision recorded = follows
    expect(leftOutOf('ui/2026/combine.tsx', { ...CFG, dsConverted: {} })).toBeNull(); // not converted
    expect(leftOutOf('ui/2026/combine.png', CFG)).toBeNull();
  });
  test('the Canvases row gets the quiet word "update", titled "Update available"', () => {
    expect(Object.keys(leftOutMap(CFG))).toEqual(['ui/2026/combine.tsx']);
    const slots = dsRowSlots(CFG);
    expect(slots.get('ui/2026/combine.tsx')).toBe(DS_ROW_SLOT);
    expect(DS_ROW_SLOT.meta).toEqual({ word: 'update', tone: 'quiet', title: 'Update available' });
    expect(slots.has('ui/Home.tsx')).toBe(false);
  });
});

describe('what it is missing', () => {
  test('the diff reads tokens and masters; the line is canvas 13 · ds-edit-instance verbatim', () => {
    const diff = diffRevisions(
      body('2px', 'oklch(0.5 0.1 255)'),
      body('6px', 'oklch(0.5 0.1 255)')
    );
    expect(diff.tokens).toEqual([]);
    expect(diff.components).toEqual([
      expect.objectContaining({
        component: 'Button',
        prop: 'border-radius',
        before: '2px',
        after: '6px',
      }),
    ]);
    const now = Date.parse('2026-10-20T12:10:00Z');
    const text = whatWords({
      diff,
      row: { by: { kind: 'person' }, at: '2026-10-20T12:00:00Z' },
      folder: '2026/combine',
      now,
    });
    expect(text).toBe(
      'Corners 2 → 6, by You, 10 min ago. 2026/combine was left out of that update.'
    );
  });
  test('a token change reads "<Label> changed"; later updates are counted', () => {
    const diff = diffRevisions(
      body('2px', 'oklch(0.5 0.1 255)'),
      body('2px', 'oklch(0.6 0.1 255)')
    );
    expect(diff.tokens.map((t: { css: string }) => t.css)).toEqual(['--accent']);
    expect(whatWords({ diff, folder: 'ui', more: 2 })).toBe(
      'Accent changed. ui was left out of that update. 2 later updates came after.'
    );
  });
  test('the missed update is the row just above the canvas’s own revision', () => {
    const rows = [{ id: 'c' }, { id: 'd' }, { id: OLD }];
    expect(missedUpdate(rows, OLD)).toEqual({ row: { id: 'd' }, more: 1 });
    expect(missedUpdate(rows, 'c')).toBeNull();
    expect(missedUpdate(undefined, OLD)).toBeNull();
  });
  test('times are CONTRACT §4: relative first', () => {
    const now = Date.parse('2026-10-20T12:00:00Z');
    expect(agoWords('2026-10-20T11:59:30Z', now)).toBe('just now');
    expect(agoWords('2026-10-20T09:00:00Z', now)).toBe('3 h ago');
    expect(agoWords('2026-10-19T09:00:00Z', now)).toBe('yesterday');
  });
});

describe('ds.instance-update — one instance takes the current look', () => {
  const FILE = 'ui/2026/combine.tsx';
  const SRC = `import { DCArtboard, DesignCanvas } from '@maude/canvas-lib';
import { Button } from '@maude/ds';
export default function Home() {
  return (
    <DesignCanvas>
      <DCArtboard id="desktop" label="Desktop" width={800} height={500}>
        <Button data-cd-id="cta" variant="primary">Go</Button>
        <Button data-cd-id="old" data-ds-rev="${OLD}">Old</Button>
        <Button data-cd-id="cur" data-ds-rev="head">Cur</Button>
      </DCArtboard>
    </DesignCanvas>
  );
}
`;
  function harness(dsRev: string | null) {
    const files = new Map<string, string>([[FILE, SRC]]);
    let writes = 0;
    const deps: DispatchDeps = {
      resolve: (f) => (f === FILE ? f : null),
      read: (rel) => files.get(rel) ?? null,
      write: async (rel, _b, after) => {
        writes += 1;
        files.set(rel, after);
      },
      heldByAi: () => null,
      log: createWriteLog(),
      ctx: () => ({ dsRev, variantsOf: () => null }),
    };
    const run = (element: string): Promise<EditOpResult> =>
      dispatchEditOp(
        {
          file: FILE,
          op: 'ds.instance-update',
          targets: [{ artboard: 'desktop', element }],
          params: {},
        },
        deps
      );
    return { run, src: () => files.get(FILE) as string, writes: () => writes };
  }

  test('an instance with no pin gets data-ds-rev="head" right after its id; nothing else moves', async () => {
    const h = harness(OLD);
    const r = await h.run('cta');
    expect(r.ok).toBe(true);
    expect(h.src()).toContain(
      '<Button data-cd-id="cta" data-ds-rev="head" variant="primary">Go</Button>'
    );
    expect(h.src().replace(' data-ds-rev="head"', '')).toBe(SRC);
    expect(h.writes()).toBe(1);
  });
  test('an instance pinned to an old revision is re-pinned to head', async () => {
    const h = harness(OLD);
    expect((await h.run('old')).ok).toBe(true);
    expect(h.src()).toContain('data-cd-id="old" data-ds-rev="head"');
    expect(h.src()).not.toContain(`data-ds-rev="${OLD}"`);
  });
  test('already current is the same bytes — no second write', async () => {
    const h = harness(OLD);
    const r = await h.run('cur');
    expect(r.ok).toBe(true);
    expect(h.src()).toBe(SRC);
    expect(h.writes()).toBe(0);
  });
  test('a canvas that follows head has nothing to update: refused, the file untouched', async () => {
    const h = harness(null);
    const r = await h.run('cta');
    expect(r.ok).toBe(false);
    expect(h.src()).toBe(SRC);
  });
});

describe('the Update available block', () => {
  const roots: Root[] = [];
  let mod: typeof import('../client/v2/ds/update-available.jsx');
  const realFetch = globalThis.fetch;
  beforeAll(async () => {
    GlobalRegistrator.register();
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
      true;
    mod = await import('../client/v2/ds/update-available.jsx');
  });
  afterAll(() => {
    globalThis.fetch = realFetch;
    GlobalRegistrator.unregister();
  });
  afterEach(async () => {
    for (const r of roots.splice(0)) await act(async () => r.unmount());
    document.body.innerHTML = '';
    mod.forgetRevisions();
  });
  const q = (id: string) => document.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
  const settle = () => act(async () => new Promise((r) => setTimeout(r, 30)));

  function stubServer() {
    const seen: string[] = [];
    globalThis.fetch = (async (url: string) => {
      seen.push(url);
      const ok = (b: unknown) => ({ ok: true, status: 200, json: async () => b }) as Response;
      if (url.startsWith('/_api/ds/revisions?'))
        return ok({
          revisions: [
            { id: HEAD, by: { kind: 'person' }, at: new Date(Date.now() - 600_000).toISOString() },
            { id: OLD },
          ],
        });
      if (url.includes(`rev=${OLD}`)) return ok(body('2px', 'oklch(0.5 0.1 255)'));
      return ok(body('6px', 'oklch(0.5 0.1 255)'));
    }) as never;
    return seen;
  }
  async function mount(props: Record<string, unknown>) {
    const el = document.createElement('div');
    document.body.append(el);
    const root = createRoot(el);
    roots.push(root);
    await act(async () =>
      root.render(<mod.DsUpdateAvailable {...({ cfg: CFG, ...props } as never)} />)
    );
    await settle();
  }

  test('on a left-out canvas it says what is missing, with Update and Detach', async () => {
    stubServer();
    let updated = 0;
    let detached = 0;
    await mount({
      canvas: 'ui/2026/combine.tsx',
      el: { instanceInfo: { dsPin: null } },
      onUpdate: () => updated++,
      onDetach: () => detached++,
    });
    expect(q('ds-update-available')).not.toBeNull();
    expect(q('ds-update-what')?.textContent).toMatch(
      /^Corners 2 → 6, by You, 10 min ago\. ui\/2026 was left out of that update\.$/
    );
    await act(async () => q('ds-update-do')?.click());
    await act(async () => q('ds-update-detach')?.click());
    expect([updated, detached]).toEqual([1, 1]);
  });
  test('quiet on a canvas that follows the system, and on an instance already current', async () => {
    stubServer();
    await mount({ canvas: 'ui/Home.tsx' });
    expect(q('ds-update-available')).toBeNull();
    await mount({ canvas: 'ui/2026/combine.tsx', el: { instanceInfo: { dsPin: 'head' } } });
    expect(q('ds-update-available')).toBeNull();
  });
  test('Update posts the edit-op for ONE instance and says a refusal in words', async () => {
    const posted: Array<Record<string, unknown>> = [];
    const f = async (_u: string, init: { body: string }) => {
      posted.push(JSON.parse(init.body));
      return { ok: true, json: async () => ({ ok: false, code: 'held-by-ai' }) } as Response;
    };
    const r = await mod.writeInstanceUpdate(
      { canvas: 'ui/2026/combine.tsx', ref: { artboard: 'desktop', element: 'cta' } },
      f as never
    );
    expect(posted).toEqual([
      {
        file: 'ui/2026/combine.tsx',
        op: 'ds.instance-update',
        targets: [{ artboard: 'desktop', element: 'cta' }],
      },
    ]);
    expect(r).toEqual({
      ok: false,
      message: 'Not updated. This belongs to AI until it’s done; Stop is in the AI chat.',
    });
  });
});
