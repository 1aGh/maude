// S10.10 (13 · ds-edit-master) — the master editor's writer, driven through the REAL routes and a real publish:
// Corners 2 → 6 waits as one declaration patch, "Update" writes it into `preview/_components.css`, and a whole
// folder left out with one tick keeps the old corners (its canvases pinned to the old head, with the update dot's
// data behind them). The panel, the registry action and an agent are one path.
import { afterAll, describe, expect, test } from 'bun:test';

import { resolveAccess } from '../access/scope.ts';
import {
  buildMasterPatch,
  cleanMasterValue,
  currentMasterValue,
  MASTER_WORDS,
  runMasterAction,
  writeMaster,
} from '../client/v2/ds/master-write.js';
import { fetchBoard } from '../client/v2/ds/token-write.js';
import { createDsRoutes } from '../routes/ds.ts';
import {
  canvasTsx,
  cleanup,
  DS,
  DS_PATH,
  makeProject,
  PERSON,
  type Project,
} from './_ds-engine-fixture.ts';

afterAll(cleanup);

const COMPONENTS_JSON = {
  schemaVersion: 1,
  system: 'acme',
  components: { Button: { class: 'btn', label: 'Tlačítko', variants: { primary: 'btn--primary' } } },
};

function bridge(p: Project, role: 'view' | 'edit' = 'edit'): typeof fetch {
  const claim =
    role === 'view'
      ? { v: 1 as const, role: 'observer' as const }
      : { v: 1 as const, role: 'member' as const };
  const specs = createDsRoutes({
    engine: () => p.engine,
    access: () => resolveAccess(claim),
    person: async () => ({ name: 'Michal' }),
  });
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const u = new URL(String(input), 'http://localhost');
    const method = (init?.method ?? 'GET').toUpperCase();
    const spec = specs.find((s) => s.method === method && s.path === u.pathname);
    if (!spec) return new Response('{}', { status: 404 });
    return spec.handle(
      new Request(u, { method, body: init?.body as BodyInit | undefined, headers: init?.headers }),
      {}
    );
  }) as typeof fetch;
}

async function project(): Promise<Project> {
  const p = await makeProject();
  // the master list is part of the system's files: it arrives as a kept outside edit, like any other file
  await p.outside(`${DS_PATH}/components.json`, `${JSON.stringify(COMPONENTS_JSON, null, 2)}\n`);
  await p.engine.keepOutside(DS, { by: PERSON });
  // a folder of canvases that will be left out of the update
  for (const c of ['A', 'B', 'C']) {
    await p.outside(`ui/combine/${c}.tsx`, canvasTsx(c));
    await p.outside(`ui/combine/${c}.meta.json`, `${JSON.stringify({ title: c }, null, 2)}\n`);
  }
  return p;
}

describe('the pure half', () => {
  const master = {
    name: 'Button',
    label: 'Tlačítko',
    className: 'btn',
    look: { 'border-radius': '2px', height: '32px' },
    patches: [{ selector: '.btn', prop: 'border-radius', value: '6px' }],
  };

  test('values: a bare number is px for Corners and Height only; nothing that can leave its declaration', () => {
    expect(cleanMasterValue('border-radius', '6')).toBe('6px');
    expect(cleanMasterValue('border-radius', ' 0 ')).toBe('0');
    expect(cleanMasterValue('height', '40')).toBe('40px');
    expect(cleanMasterValue('background', '40')).toBe('40');
    expect(cleanMasterValue('background', 'var(--accent)')).toBe('var(--accent)');
    for (const bad of ['', '  ', 'red; x', 'a}b', 'url(x)', 'calc(1px', '\u0007', 'x'.repeat(241)])
      expect(cleanMasterValue('background', bad)).toBeNull();
  });

  test('a waiting edit shows over the file’s value; the patch is keyed by the components.json class', () => {
    expect(currentMasterValue(master, 'border-radius')).toBe('6px');
    expect(currentMasterValue(master, 'height')).toBe('32px');
    expect(currentMasterValue(master, 'color')).toBe('');
    expect(buildMasterPatch(master, { prop: 'height', value: '40' })).toMatchObject({
      components: { Button: { '.btn': { height: { value: '40px' } } } },
    });
    expect(buildMasterPatch(master, { prop: 'margin', value: '4px' }).refused).toBe(
      MASTER_WORDS.invalid
    );
    expect(buildMasterPatch({ ...master, className: null }, { prop: 'height', value: '4' }).refused)
      .toBe(MASTER_WORDS.noClass);
    expect(buildMasterPatch(null, { prop: 'height', value: '4' }).refused).toBe(MASTER_WORDS.unknown);
  });
});

describe('through the real routes', () => {
  test('Corners 2 → 6 waits as one patch; Update writes it; a folder left out keeps 2 px', async () => {
    const p = await project();
    const f = bridge(p);
    const r = await writeMaster({ ds: DS, name: 'Button', edit: { prop: 'border-radius', value: '6' } }, f);
    expect(r.ok).toBe(true);
    // the board the inspector and the canvas read now carries the waiting edit
    const board = await fetchBoard(DS, f);
    expect(board.components[0].patches).toEqual([
      { selector: '.btn', prop: 'border-radius', value: '6px' },
    ]);
    expect(board.components[0].look['border-radius']).toBe('4px'); // the file still says what it said
    expect(board.pendingCount).toBe(1);

    const review = p.engine.review(DS);
    const before = review.expectHead;
    expect(review.canvases.length).toBeGreaterThanOrEqual(6);
    const out = review.canvases.filter((c) => c.path.startsWith('ui/combine/')).map((c) => c.path);
    expect(out).toHaveLength(3);
    const res = await p.engine.publish(DS, {
      expectHead: review.expectHead,
      canvases: out.map((path) => ({ path, ticked: false })),
      by: PERSON,
    });
    expect(res).toMatchObject({ updated: 3, leftOut: 3 });
    expect(p.read(`${DS_PATH}/preview/_components.css`)).toBe('.btn {\n  border-radius: 6px;\n}\n');
    // the folder left out is pinned to the head it had; the rest follow
    for (const path of out) expect(p.meta(path).dsRev).toBe(before);
    expect(p.meta('ui/Home.tsx').dsRev).toBeUndefined();
    // nothing waits any more
    expect((await fetchBoard(DS, f)).pendingCount).toBe(0);
  });

  test('the registry action ds.set-master is the same write, with a sentence back', async () => {
    const p = await project();
    const f = bridge(p);
    const ok = await runMasterAction({ ds: DS, component: 'Button', prop: 'height', value: '44' }, f);
    expect(ok).toEqual({ ok: true, message: '1 change waiting.' });
    expect(
      (p.meta(`${DS_PATH}/design-system.tsx`).dsPending as { components: object }).components
    ).toMatchObject({ Button: { '.btn': { height: { value: '44px' } } } });
    const bad = await runMasterAction({ ds: DS, component: 'Nope', prop: 'height', value: '44' }, f);
    expect(bad).toEqual({ ok: false, message: MASTER_WORDS.unknown });
    const worse = await runMasterAction({ ds: DS, component: 'Button', prop: 'height', value: '4;}' }, f);
    expect(worse).toEqual({ ok: false, message: MASTER_WORDS.invalid });
  });

  test('Can view reads the board but cannot change a master; nothing waits', async () => {
    const p = await project();
    const f = bridge(p, 'view');
    expect((await fetchBoard(DS, f))?.components[0].name).toBe('Button');
    const r = await writeMaster({ ds: DS, name: 'Button', edit: { prop: 'height', value: '40' } }, f);
    expect(r).toEqual({ ok: false, code: 'forbidden', message: MASTER_WORDS.forbidden });
    expect(p.meta(`${DS_PATH}/design-system.tsx`).dsPending).toBeUndefined();
  });
});
