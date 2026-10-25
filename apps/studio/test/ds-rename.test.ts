// P8 round 7 (13 · ds-multi-menu): "Rename…" in a system's own menu. A system's name on screen is its
// `config.json` `designSystems[].label`; its `name` is the id every canvas pin, the folder and head.json
// carry, so a rename touches ONE file and nothing that points at the system moves. The writer
// (ds/rename.ts), the route's roles (owner / Can edit; a viewer gets 403 and nothing is written) and the
// verb that is its agent path (`maude design ds rename <ds> <name>`).
import { afterAll, describe, expect, test } from 'bun:test';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { type AccessClaim, resolveAccess } from '../access/scope.ts';
import { planDsVerb } from '../ds/ds-verb.ts';
import { renameSystem } from '../ds/rename.ts';
import { createDsRoutes } from '../routes/ds.ts';
import { cleanup, DS, makeProject } from './_ds-engine-fixture.ts';

afterAll(cleanup);

const cfgOf = (root: string) => JSON.parse(readFileSync(path.join(root, 'config.json'), 'utf8'));

function addSystem(root: string, entry: Record<string, unknown>) {
  const file = path.join(root, 'config.json');
  const cfg = JSON.parse(readFileSync(file, 'utf8'));
  cfg.designSystems.push(entry);
  writeFileSync(file, `${JSON.stringify(cfg, null, 2)}\n`);
}

describe('renameSystem — the label, nothing else', () => {
  test('writes designSystems[].label; the name, every other key and the file shape stay', async () => {
    const p = await makeProject();
    const before = cfgOf(p.designRoot);
    const r = renameSystem(p.designRoot, DS, '  Studio   site  ');
    expect(r).toEqual({ changed: true, previous: null, label: 'Studio site' });
    const after = cfgOf(p.designRoot);
    const entry = after.designSystems.find((d: { name: string }) => d.name === DS);
    expect(entry.label).toBe('Studio site');
    expect(entry.name).toBe(DS);
    // nothing else in the config moved
    delete entry.label;
    expect(after).toEqual(before);
    expect(readFileSync(path.join(p.designRoot, 'config.json'), 'utf8').endsWith('\n')).toBe(true);
  });

  test('the same name again changes nothing; null puts the label back to the name', async () => {
    const p = await makeProject();
    renameSystem(p.designRoot, DS, 'Studio site');
    expect(renameSystem(p.designRoot, DS, 'Studio site')).toEqual({
      changed: false,
      previous: 'Studio site',
      label: 'Studio site',
    });
    expect(renameSystem(p.designRoot, DS, null)).toEqual({
      changed: true,
      previous: 'Studio site',
      label: null,
    });
    const entry = cfgOf(p.designRoot).designSystems.find((d: { name: string }) => d.name === DS);
    expect('label' in entry).toBe(false);
  });

  // V2-8.9 defender L4: a label that reverses or hides the text around it spoofs the system's name
  // in every list — the bidi overrides / isolates and the tag characters go (exporters' set).
  test('strips bidi overrides, isolates and tag characters from the label', async () => {
    const p = await makeProject();
    const r = renameSystem(p.designRoot, DS, 'Brand‮⁧kit⁩\u{e0041}\u{e007f} 2026');
    expect(r.label).toBe('Brandkit 2026');
    const sys = cfgOf(p.designRoot).designSystems.find((s: { name: string }) => s.name === DS);
    expect(sys.label).toBe('Brandkit 2026');
  });

  test('refuses an empty, too long or control-character name, and one another system shows', async () => {
    const p = await makeProject();
    addSystem(p.designRoot, { name: 'combine', path: 'system/combine', label: 'Combine 2026' });
    const was = readFileSync(path.join(p.designRoot, 'config.json'), 'utf8');
    for (const bad of ['', '   ', 'x'.repeat(65), 'a\u0000b', 'line\nbreak']) {
      expect(() => renameSystem(p.designRoot, DS, bad)).toThrow(
        expect.objectContaining({ code: 'ds-bad-name', status: 400 })
      );
    }
    // V2-8.9 defender L4: a name of nothing but bidi controls / tag characters is empty once they go
    for (const bad of ['‮⁦', '\u{e0041}\u{e0042}']) {
      expect(() => renameSystem(p.designRoot, DS, bad)).toThrow(
        expect.objectContaining({ code: 'ds-bad-name', status: 400 })
      );
    }
    // another system's label or its bare name is taken, case aside
    for (const taken of ['combine 2026', 'COMBINE']) {
      expect(() => renameSystem(p.designRoot, DS, taken)).toThrow(
        expect.objectContaining({ code: 'ds-name-taken', status: 409 })
      );
    }
    expect(() => renameSystem(p.designRoot, 'nope', 'Fine')).toThrow(
      expect.objectContaining({ code: 'ds-unknown-system', status: 404 })
    );
    expect(readFileSync(path.join(p.designRoot, 'config.json'), 'utf8')).toBe(was);
  });
});

const claims: Record<string, AccessClaim> = {
  owner: { v: 1, role: 'owner' },
  edit: { v: 1, role: 'member' },
  comment: { v: 1, role: 'viewer' },
  view: { v: 1, role: 'observer' },
  homeOnly: { v: 1, role: null, grants: [{ c: 'ui/Home.tsx', r: 'member' }] },
};

async function post(
  p: Awaited<ReturnType<typeof makeProject>>,
  who: keyof typeof claims,
  body: unknown
) {
  const seen: unknown[] = [];
  const spec = createDsRoutes({
    engine: () => p.engine,
    access: () => resolveAccess(claims[who]),
    person: async () => ({ name: 'Michal' }),
    emit: (e, payload) => seen.push([e, payload]),
  }).find((s) => s.method === 'POST' && s.path === '/_api/ds/rename');
  if (!spec) throw new Error('no POST /_api/ds/rename');
  expect(spec.origin).toBe('main');
  expect(spec.readOnly).toBe('refused');
  const res = await spec.handle(
    new Request('http://localhost/_api/ds/rename', {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json' },
    }),
    {}
  );
  return { status: res.status, json: (await res.json()) as Record<string, unknown>, seen };
}

describe('POST /_api/ds/rename — roles', () => {
  test('Can view and Can comment get 403, a canvas-scoped grant never sees the system; nothing is written', async () => {
    const p = await makeProject();
    const cfgPath = path.join(p.designRoot, 'config.json');
    const was = readFileSync(cfgPath, 'utf8');
    const hidden = await post(p, 'homeOnly', { ds: DS, label: 'X' });
    expect({ status: hidden.status, code: hidden.json.code }).toEqual({
      status: 404,
      code: 'ds-unknown-system',
    });
    for (const who of ['view', 'comment'] as const) {
      const r = await post(p, who, { ds: DS, label: 'X' });
      expect({ who, status: r.status, code: r.json.code }).toEqual({
        who,
        status: 403,
        code: 'forbidden',
      });
    }
    expect(readFileSync(cfgPath, 'utf8')).toBe(was);
  });

  test('the owner and Can edit rename it; the answer carries the previous name (the Undo) and the studio hears it', async () => {
    const p = await makeProject();
    const a = await post(p, 'edit', { ds: DS, label: 'Studio site' });
    expect(a.status).toBe(200);
    expect(a.json).toMatchObject({
      format: 'maude.ds-result',
      action: 'rename',
      label: 'Studio site',
      previous: null,
    });
    expect(a.seen).toEqual([['ds:changed', { system: DS }]]);
    const b = await post(p, 'owner', { ds: DS, label: 'Studio' });
    expect(b.json).toMatchObject({ label: 'Studio', previous: 'Studio site' });
    // the Undo: the previous name back (null = the system's own name)
    const c = await post(p, 'edit', { ds: DS, label: null });
    expect(c.json).toMatchObject({ label: null, previous: 'Studio' });
    const bad = await post(p, 'edit', { ds: DS, label: 42 });
    expect(bad.status).toBe(400);
  });
});

describe('maude design ds rename — the agent path', () => {
  test('plans one POST with the system and the new name', () => {
    const plan = planDsVerb(['rename', 'club', 'Club', 'brand', '--json']);
    expect(plan.op).toBe('rename');
    expect(plan.input).toEqual({ ds: 'club', label: 'Club brand' });
    expect(plan.read).toBe(false);
  });
  test('--reset puts the label back to the name; a missing name is a usage error', () => {
    expect(planDsVerb(['rename', 'club', '--reset']).input).toEqual({ ds: 'club', label: null });
    expect(() => planDsVerb(['rename', 'club'])).toThrow();
    expect(() => planDsVerb(['rename'])).toThrow();
  });
});
