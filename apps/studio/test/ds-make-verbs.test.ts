// S10.16a — `maude design ds make|draft|use|mix|done`: the words, the `--json` shapes (frozen here),
// the parity rule (the route's answer IS the in-process verb's answer), the roles, and the whole
// making loop driven only through the verbs — what an AI in the studio is allowed to do.
import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { resolveAccess } from '../access/scope.ts';
import { DsUsageError, execDsPlan, planDsVerb } from '../ds/ds-verb.ts';
import { createDsRoutes } from '../routes/ds.ts';
import type { RouteSpec } from '../routes/table.ts';
import { cleanup, makeProject, type Project } from './_ds-engine-fixture.ts';
import { conformantFiles, fixtureConfig } from './_ds-fixture.ts';

afterAll(cleanup);

const NEW = 'forge';
const FILES: Record<string, string> = {
  'a.json': JSON.stringify({ label: 'Warm', tokens: { '--accent': 'red' }, componentsCss: '.x{}' }),
  'bare.json': JSON.stringify({ '--accent': { light: 'red', dark: 'blue' } }),
};
const plan = (s: string) => planDsVerb(s.split(' ').filter(Boolean), (f) => FILES[f] ?? '{}');

describe('maude design ds — the making words', () => {
  test('each sub-verb is one `make` operation (the route takes an action)', () => {
    expect(plan('make forge --label Forge')).toMatchObject({
      op: 'make',
      input: { ds: 'forge', action: 'make', label: 'Forge' },
      read: false,
    });
    expect(plan('make forge').input).toEqual({ ds: 'forge', action: 'make' });
    expect(plan('draft forge --direction b --tokens a.json').input).toEqual({
      ds: 'forge',
      action: 'draft',
      direction: 'b',
      tokens: { '--accent': 'red' },
      label: 'Warm',
      componentsCss: '.x{}',
    });
    // the bare map form
    expect(plan('draft forge --direction c --tokens bare.json').input.tokens).toEqual({
      '--accent': { light: 'red', dark: 'blue' },
    });
    expect(plan('use forge b').input).toEqual({ ds: 'forge', action: 'use', direction: 'b' });
    expect(plan('mix forge b --take colour=c --take type=a').input).toEqual({
      ds: 'forge',
      action: 'mix',
      base: 'b',
      take: { colour: 'c', type: 'a' },
    });
    expect(plan('done forge').input).toEqual({ ds: 'forge', action: 'done' });
    expect(plan('done forge --no-default').input).toEqual({
      ds: 'forge',
      action: 'done',
      setDefault: false,
    });
  });

  test('a missing piece or a foreign flag is a usage error', () => {
    for (const bad of [
      'draft forge --direction b',
      'draft forge --tokens a.json',
      'mix forge b',
      'mix forge b --take colour',
      'mix forge b --take colour=C',
      'use forge',
      'done forge --label x',
      'make forge --take colour=c',
      'make',
    ])
      expect(() => plan(bad)).toThrow(DsUsageError);
  });
});

/** A fetch that answers from the route table — what a running studio does. */
function studioOf(p: Project, who: 'owner' | 'view' = 'owner') {
  const specs: RouteSpec[] = createDsRoutes({
    engine: () => p.engine,
    access: () =>
      resolveAccess(who === 'owner' ? { v: 1, role: 'owner' } : { v: 1, role: 'observer' }),
    person: async () => ({ name: 'Michal' }),
  });
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    const u = new URL(url);
    const spec = specs.find((s) => s.method === (init?.method ?? 'GET') && s.path === u.pathname);
    if (!spec) return new Response('no route', { status: 404 });
    return spec.handle(new Request(url, init as RequestInit), {});
  }) as unknown as typeof fetch;
  return { studio: { base: 'http://127.0.0.1:1' }, fetchImpl };
}

const tokens = (k: number) => ({
  '--accent': { light: `oklch(0.5 0.1 ${k * 40})`, dark: `oklch(0.6 0.1 ${k * 40})` },
  '--fg-0': { light: '#111111', dark: '#eeeeee' },
});

describe('maude design ds make… — parity and shapes', () => {
  test('the route and the in-process verb answer the same bytes; the shapes are frozen', async () => {
    const a = await makeProject();
    const b = await makeProject();
    const viaRoute = studioOf(a);
    const steps = [
      'make forge --label Forge',
      'draft forge --direction a --tokens a.json',
      'use forge a',
    ];
    FILES['a.json'] = JSON.stringify({ label: 'Warm', tokens: tokens(1) });
    const out: unknown[][] = [[], []];
    for (const s of steps) {
      const r1 = await execDsPlan(plan(s), { root: a.root, ...viaRoute });
      const r2 = await execDsPlan(plan(s), { root: b.root, studio: null });
      out[0].push(r1);
      out[1].push(r2);
    }
    // the working files differ per project only by the revision's `at`; the answers do not
    const norm = (v: unknown) =>
      JSON.parse(JSON.stringify(v).replace(/"[0-9a-f]{64}"/g, '"<rev>"'));
    expect(norm(out[0])).toEqual(norm(out[1]));
    expect(norm(out[0])).toEqual([
      {
        status: 200,
        body: {
          format: 'maude.ds-result',
          v: 1,
          action: 'make',
          rev: null,
          actionId: null,
          system: 'forge',
          path: 'system/forge',
        },
      },
      {
        status: 200,
        body: {
          format: 'maude.ds-result',
          v: 1,
          action: 'draft',
          rev: '<rev>',
          actionId: null,
          direction: 'a',
        },
      },
      {
        status: 200,
        body: {
          format: 'maude.ds-result',
          v: 1,
          action: 'use',
          rev: '<rev>',
          actionId: null,
          direction: 'a',
        },
      },
    ]);
    // status sees the making system: converted, head null, one draft
    const st = await execDsPlan(plan('status forge'), { root: a.root, ...viaRoute });
    const row = (st.body as { systems: Record<string, unknown>[] }).systems[0];
    expect(row).toMatchObject({
      name: 'forge',
      converted: true,
      head: null,
      base: null,
      label: 'Forge',
    });
    expect(row.drafts).toHaveLength(1);
    // a refusal carries its code on both paths
    const bad = await execDsPlan(plan('use forge z'), { root: b.root, studio: null });
    expect(bad).toMatchObject({ status: 404, body: { code: 'ds-unknown-direction' } });
    const pub = await execDsPlan(plan('update forge --dry-run'), { root: a.root, ...viaRoute });
    expect(pub).toMatchObject({ status: 409, body: { code: 'ds-making' } });
  });

  test('the section states are a read for anyone who can see the system; the writes are Can edit', async () => {
    const p = await makeProject();
    const owner = studioOf(p);
    await execDsPlan(plan('make forge'), { root: p.root, ...owner });
    const specs = createDsRoutes({
      engine: () => p.engine,
      access: () => resolveAccess({ v: 1, role: 'observer' }),
      person: async () => ({ name: 'M' }),
    });
    const get = specs.find((s) => s.method === 'GET' && s.path === '/_api/ds/make-state');
    const res = await (get as RouteSpec).handle(
      new Request('http://localhost/_api/ds/make-state?ds=forge'),
      {}
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      format: 'maude.ds-make',
      v: 1,
      system: 'forge',
      making: true,
      sections: { brand: 'waiting', colour: 'waiting', patterns: 'waiting' },
    });
    const post = specs.find((s) => s.method === 'POST' && s.path === '/_api/ds/make') as RouteSpec;
    for (const body of [
      { action: 'make', ds: 'other' },
      { action: 'draft', ds: 'forge', direction: 'a', tokens: tokens(1) },
      { action: 'use', ds: 'forge', direction: 'a' },
      { action: 'mix', ds: 'forge', base: 'a', take: { colour: 'b' } },
      { action: 'done', ds: 'forge' },
    ]) {
      const r = await post.handle(
        new Request('http://localhost/_api/ds/make', {
          method: 'POST',
          body: JSON.stringify(body),
          headers: { 'content-type': 'application/json' },
        }),
        {}
      );
      expect({ action: body.action, status: r.status }).toEqual({
        action: body.action,
        status: 403,
      });
    }
    expect(p.read('config.json')).not.toContain('"other"');
  });
});

describe('the whole loop through the verbs', () => {
  test('three directions, B + C’s colour, fill, done → a level-0 system and a make log entry', async () => {
    const p = await makeProject();
    const root = p.root;
    const run = (s: string) =>
      execDsPlan(planDsVerb(s.split(' ').filter(Boolean)), { root, studio: null });
    const cfg = fixtureConfig({ name: NEW, path: `system/${NEW}`, rootClass: NEW });
    const seed = conformantFiles({ ...cfg, tokensCssRel: `system/${NEW}/colors_and_type.css` });
    // the model of the conformant seed, as a direction file (every value a plain per-theme pair)
    const { parseSystem } = await import('../ds/generate.ts');
    const model = parseSystem({
      config: { name: NEW, rootClass: NEW, themes: ['light', 'dark'], defaultTheme: 'light' },
      tokensCss: seed[`system/${NEW}/colors_and_type.css`],
    });
    const dirTokens = Object.fromEntries(
      Object.entries(model.tokens).map(([n, t]) => [
        n,
        { light: t.values.light, dark: t.values.dark ?? t.values.light },
      ])
    );
    const tmp = path.join(root, 'dir.json');
    writeFileSync(tmp, JSON.stringify({ label: 'Base', tokens: dirTokens }));

    expect((await run(`make ${NEW} --label Forge`)).status).toBe(200);
    for (const d of ['a', 'b', 'c'])
      expect((await run(`draft ${NEW} --direction ${d} --tokens ${tmp}`)).status).toBe(200);
    // identical directions give identical revisions: one revision, three draft entries
    const st0 = await run(`status ${NEW}`);
    const drafts = (st0.body as { systems: { drafts: { direction: string }[] }[] }).systems[0]
      .drafts;
    expect(drafts.map((d) => d.direction)).toEqual(['a', 'b', 'c']);
    expect((await run(`use ${NEW} a`)).status).toBe(200);
    expect((await run(`mix ${NEW} b --take colour=c --take type=a`)).status).toBe(200);
    for (const k of [
      'components.json',
      'preview/_components.css',
      'preview/logo.tsx',
      'assets/logos/mark.svg',
    ]) {
      const abs = path.join(p.designRoot, `system/${NEW}`, k);
      mkdirSync(path.dirname(abs), { recursive: true });
      writeFileSync(abs, seed[`system/${NEW}/${k}`] as string);
    }
    const done = await run(`done ${NEW}`);
    expect(done).toMatchObject({
      status: 200,
      body: { format: 'maude.ds-result', action: 'make', level: 0, reasons: [], defaultSet: true },
    });
    const after = await run(`status ${NEW}`);
    const row = (after.body as { systems: Record<string, unknown>[] }).systems[0];
    expect(row).toMatchObject({ converted: true, level: 0, outside: null });
    expect(row.head).toBe((done.body as { rev: string }).rev);
    // a second `done` and a late `use` are refused in words the code names
    expect(await run(`done ${NEW}`)).toMatchObject({
      status: 409,
      body: { code: 'ds-not-making' },
    });
    expect(await run(`use ${NEW} a`)).toMatchObject({
      status: 409,
      body: { code: 'ds-not-making' },
    });
  });
});
