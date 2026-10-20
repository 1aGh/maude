// S10.13: "Default for new canvases" — the rule (a new canvas follows its folder's one system, else the
// default), the writer behind `ds.set-default` (`config.json` `defaultDesignSystem`), the route's roles
// (Can edit on the whole project, rule 12) and the verb that is its agent path.
import { afterAll, describe, expect, test } from 'bun:test';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { type AccessClaim, resolveAccess } from '../access/scope.ts';
import {
  defaultSystemName,
  folderOfCanvas,
  newCanvasDesignSystem,
} from '../client/v2/ds/new-canvas-default.js';
import { setDefaultSystem } from '../ds/default.ts';
import { planDsVerb } from '../ds/ds-verb.ts';
import { createDsRoutes } from '../routes/ds.ts';
import { cleanup, DS, makeProject } from './_ds-engine-fixture.ts';

afterAll(cleanup);

const SYSTEMS = [
  { name: 'club', path: 'system/club' },
  { name: 'combine-2026', path: 'system/combine-2026' },
];
const MAP: Record<string, string> = {
  '.design/ui/Home.tsx': 'club',
  '.design/ui/2026/combine/Poster.tsx': 'combine-2026',
  '.design/ui/2026/combine/Post.tsx': 'combine-2026',
  '.design/ui/2026/combine/video/Cut.tsx': 'combine-2026',
  '.design/ui/2026/Mixed.tsx': 'club',
  '.design/ui/2026/combine/Left-out.tsx': 'club',
  '.design/system/club/design-system.tsx': 'club',
};
const ask = (folder: string | null, over: Record<string, unknown> = {}) =>
  newCanvasDesignSystem({
    folder,
    canvasDesignSystems: MAP,
    designSystems: SYSTEMS,
    defaultDs: 'club',
    designRel: '.design',
    ...over,
  });

describe('which system a new canvas starts on (13 · ds-multi-menu)', () => {
  test('a folder whose canvases all use one system passes it on', () => {
    // 2026/combine/video holds only Cut.tsx on combine-2026, and so does its parent chain below
    expect(ask('.design/ui/2026/combine/video')).toBe('combine-2026');
    expect(ask('ui/2026/combine/video')).toBe('combine-2026');
  });

  test('a mixed folder falls back to the default', () => {
    // 2026/combine has five canvases on combine-2026 and one left out on club
    expect(ask('ui/2026/combine')).toBe('club');
    expect(ask('ui/2026')).toBe('club');
  });

  test('the root, an empty folder and a project without a map use the default', () => {
    expect(ask(null)).toBe('club');
    expect(ask('')).toBe('club');
    expect(ask('ui/empty')).toBe('club');
    expect(ask('ui/2026/combine/video', { canvasDesignSystems: {} })).toBe('club');
  });

  test('the default is the configured one when it exists, else the first system', () => {
    expect(defaultSystemName(SYSTEMS, 'combine-2026')).toBe('combine-2026');
    expect(defaultSystemName(SYSTEMS, 'gone')).toBe('club');
    expect(defaultSystemName(SYSTEMS, null)).toBe('club');
    expect(defaultSystemName([], 'club')).toBeNull();
  });

  test('a system the project no longer holds never leaks out of the rule', () => {
    const map = { '.design/ui/x/A.tsx': 'deleted-system' };
    expect(ask('ui/x', { canvasDesignSystems: map })).toBe('club');
  });

  test("a system's own folder is not a canvas the folder uses", () => {
    const map = {
      '.design/ui/f/Design.tsx': 'club',
      '.design/system/club/a/B.tsx': 'combine-2026',
    };
    expect(ask('ui/f', { canvasDesignSystems: map })).toBe('club');
    expect(ask('system/club', { canvasDesignSystems: map })).toBe('club');
  });

  test('folderOfCanvas names the folder a canvas path sits in', () => {
    expect(folderOfCanvas('.design/ui/2026/combine/Poster.tsx')).toBe('ui/2026/combine');
    expect(folderOfCanvas('ui/Home.tsx')).toBe('ui');
    expect(folderOfCanvas('Home.tsx')).toBe('');
  });
});

describe('setDefaultSystem — the writer behind ds.set-default', () => {
  test('writes defaultDesignSystem, keeps every other key and the file’s shape', async () => {
    const p = await makeProject();
    const cfgPath = path.join(p.designRoot, 'config.json');
    const before = JSON.parse(readFileSync(cfgPath, 'utf8'));
    // a second system to move to
    before.designSystems.push({ name: 'other', path: 'system/other' });
    writeFileSync(cfgPath, `${JSON.stringify(before, null, 2)}\n`);
    const r = setDefaultSystem(p.designRoot, 'other');
    expect(r).toEqual({ changed: true, previous: DS, default: 'other' });
    const text = readFileSync(cfgPath, 'utf8');
    expect(text.endsWith('\n')).toBe(true);
    const after = JSON.parse(text);
    expect(after.defaultDesignSystem).toBe('other');
    expect({ ...after, defaultDesignSystem: before.defaultDesignSystem }).toEqual(before);
    // the same again is no write
    expect(setDefaultSystem(p.designRoot, 'other').changed).toBe(false);
  });

  test('a system the project does not hold is refused and nothing is written', async () => {
    const p = await makeProject();
    const cfgPath = path.join(p.designRoot, 'config.json');
    const was = readFileSync(cfgPath, 'utf8');
    expect(() => setDefaultSystem(p.designRoot, 'nope')).toThrow(/no design system named nope/);
    expect(readFileSync(cfgPath, 'utf8')).toBe(was);
  });
});

const claims: Record<string, AccessClaim> = {
  view: { v: 1, role: 'observer' },
  comment: { v: 1, role: 'viewer' },
  edit: { v: 1, role: 'member' },
  homeOnly: { v: 1, role: null, grants: [{ c: 'ui/Home.tsx', r: 'member' }] },
};
async function post(
  p: Awaited<ReturnType<typeof makeProject>>,
  who: keyof typeof claims,
  ds: unknown
) {
  const spec = createDsRoutes({
    engine: () => p.engine,
    access: () => resolveAccess(claims[who]),
    person: async () => ({ name: 'Michal' }),
  }).find((s) => s.method === 'POST' && s.path === '/_api/ds/default');
  if (!spec) throw new Error('no POST /_api/ds/default');
  const res = await spec.handle(
    new Request('http://localhost/_api/ds/default', {
      method: 'POST',
      body: JSON.stringify({ ds }),
      headers: { 'content-type': 'application/json' },
    }),
    {}
  );
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

describe('POST /_api/ds/default — roles (Q15)', () => {
  test('Can view and Can comment get 403 and nothing is written; a canvas-scoped grant never sees the system', async () => {
    const p = await makeProject();
    const cfgPath = path.join(p.designRoot, 'config.json');
    const was = readFileSync(cfgPath, 'utf8');
    // answered like a system that does not exist (no existence oracle) — and nothing moves
    const hidden = await post(p, 'homeOnly', DS);
    expect({ status: hidden.status, code: hidden.json.code }).toEqual({
      status: 404,
      code: 'ds-unknown-system',
    });
    for (const who of ['view', 'comment'] as const) {
      const r = await post(p, who, DS);
      expect({ who, status: r.status, code: r.json.code }).toEqual({
        who,
        status: 403,
        code: 'forbidden',
      });
    }
    expect(readFileSync(cfgPath, 'utf8')).toBe(was);
  });

  test('Can edit sets it; an unknown system is the engine’s own refusal', async () => {
    const p = await makeProject();
    const cfgPath = path.join(p.designRoot, 'config.json');
    const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
    cfg.designSystems.push({ name: 'other', path: 'system/other' });
    writeFileSync(cfgPath, `${JSON.stringify(cfg, null, 2)}\n`);
    const ok = await post(p, 'edit', 'other');
    expect(ok.status).toBe(200);
    expect(ok.json).toMatchObject({
      format: 'maude.ds-result',
      action: 'default',
      default: 'other',
    });
    expect(JSON.parse(readFileSync(cfgPath, 'utf8')).defaultDesignSystem).toBe('other');
    const no = await post(p, 'edit', 'nope');
    expect(no.status).toBe(404);
    expect(no.json.code).toBe('ds-unknown-system');
  });
});

describe('maude design ds default — the agent path', () => {
  test('plans one POST with the system named', () => {
    const plan = planDsVerb(['default', 'club', '--json']);
    expect(plan.op).toBe('default');
    expect(plan.input).toEqual({ ds: 'club' });
    expect(plan.json).toBe(true);
    expect(plan.read).toBe(false);
  });
  test('takes exactly one <ds>', () => {
    expect(() => planDsVerb(['default'])).toThrow();
    expect(() => planDsVerb(['default', 'a', 'b'])).toThrow();
  });
});
