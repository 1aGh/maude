// S10.3 (S10 §2.4): `maude design ds <sub>` — the words it takes, the `--json` shapes it prints
// (format + v, frozen here), and the parity rule: the verb's answer IS the route's answer, whether
// it reached a running studio or ran the same operation in-process.
import { afterAll, describe, expect, test } from 'bun:test';

import { LOCAL_OWNER } from '../access/request.ts';
import { DsUsageError, execDsPlan, planDsVerb } from '../ds/ds-verb.ts';
import { createDsRoutes } from '../routes/ds.ts';
import {
  ACCENT,
  cleanup,
  DS,
  DS_PATH,
  makeProject,
  PERSON,
  type Project,
  TOKENS_CSS,
} from './_ds-engine-fixture.ts';

afterAll(cleanup);

const plan = (s: string) => {
  const p = planDsVerb(
    s.split(' ').filter(Boolean),
    () => '{"tokens":{"--accent":{"light":"red"}}}'
  );
  return { op: p.op, input: p.input, read: p.read };
};

/** A fetch that answers from the route table — what a running studio does. */
function studioOf(p: Project) {
  const specs = createDsRoutes({
    engine: () => p.engine,
    access: () => LOCAL_OWNER,
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

/** Timestamps and kernel action ids differ run to run; everything else must not. */
const norm = (v: unknown): unknown =>
  JSON.parse(
    JSON.stringify(v)
      .replace(/"(at|actionId)":"[^"]*"/g, '"$1":"…"')
      .replace(/"actionId":null/g, '"actionId":"…"')
  );

describe('maude design ds — words', () => {
  test('sub-verbs map to one route operation each (§2.4)', () => {
    expect(plan('status')).toEqual({ op: 'state', input: {}, read: true });
    expect(plan('status acme --json')).toEqual({ op: 'state', input: { ds: 'acme' }, read: true });
    expect(plan('publish acme --leave-out .design/ui/Home.tsx --leave-out ui/Landing.tsx')).toEqual(
      {
        op: 'publish',
        input: { ds: 'acme', leaveOut: ['ui/Home.tsx', 'ui/Landing.tsx'] },
        read: false,
      }
    );
    expect(plan('update acme --dry-run')).toEqual({
      op: 'publish',
      input: { ds: 'acme', dryRun: true },
      read: true,
    });
    expect(plan('pending acme --cancel')).toEqual({
      op: 'pending',
      input: { ds: 'acme', cancel: true },
      read: false,
    });
    expect(plan('pending acme --set p.json').input).toEqual({
      ds: 'acme',
      tokens: { '--accent': { light: 'red' } },
    });
    expect(plan('keep acme').input).toEqual({ ds: 'acme', action: 'keep' });
    expect(plan('undo acme').input).toEqual({ ds: 'acme', action: 'undo' });
    expect(plan('pick acme --accent --use file')).toBeDefined();
    expect(plan('pick acme --head abc').input).toEqual({ ds: 'acme', head: 'abc' });
    expect(plan('canvas leave .design/ui/Home.tsx').input).toEqual({
      canvas: 'ui/Home.tsx',
      action: 'leave',
    });
    expect(plan('trash acme --x --replacement --y').op).toBeDefined();
    expect(plan('restore acme --accent')).toBeDefined();
    expect(plan('usage acme --css --accent')).toBeDefined();
    expect(plan('revisions list acme')).toEqual({
      op: 'revisions',
      input: { ds: 'acme' },
      read: true,
    });
  });

  test('a read sub-verb takes no write flag, an unknown flag is a usage error', () => {
    for (const bad of [
      'status acme --set p.json',
      'status acme --dry-run',
      'usage acme --replacement x',
      'revisions list acme --cancel',
      'publish acme --use file',
      'pending acme',
      'pending acme --set p.json --cancel',
      'canvas move ui/Home.tsx',
      'frobnicate acme',
      'status --force',
    ])
      expect(() => planDsVerb(bad.split(' '))).toThrow(DsUsageError);
  });
});

describe('maude design ds — --json shapes + parity', () => {
  test('status: maude.ds-state/1, the §2.4 row keys', async () => {
    const p = await makeProject();
    const a = await execDsPlan(planDsVerb(['status', DS]), {
      root: p.root,
      studio: null,
      by: PERSON,
    });
    expect(a.status).toBe(200);
    const b = a.body as { format: string; v: number; systems: Record<string, unknown>[] };
    expect({ format: b.format, v: b.v }).toEqual({ format: 'maude.ds-state', v: 1 });
    expect(Object.keys(b.systems[0]).sort()).toEqual(
      [
        'baseMissing',
        'conflicts',
        'converted',
        'drafts',
        'head',
        'headState',
        'label',
        'leftOut',
        'level',
        'library',
        'base',
        'name',
        'outside',
        'path',
        'pending',
        'publishedInTwoPlaces',
        'reasons',
        'trashed',
        'waiting',
      ].sort()
    );
    expect(b.systems[0]).toMatchObject({
      name: DS,
      path: DS_PATH,
      converted: true,
      head: p.R0,
      base: p.R0,
    });
  });

  test('reads: in-process ≡ through the studio (status, revisions, publish --dry-run)', async () => {
    const x = await makeProject();
    const y = await makeProject();
    for (const p of [x, y])
      await p.engine.mergePending(DS, {
        tokens: ACCENT('oklch(0.5 0.19 255)', 'oklch(0.6 0.175 255)'),
        by: PERSON,
      });
    for (const words of [['status'], ['revisions', 'list', DS], ['publish', DS, '--dry-run']]) {
      const inProc = await execDsPlan(planDsVerb(words), {
        root: x.root,
        studio: null,
        by: PERSON,
      });
      const viaStudio = await execDsPlan(planDsVerb(words), {
        root: y.root,
        ...studioOf(y),
        by: PERSON,
      });
      expect({ words, status: viaStudio.status }).toEqual({ words, status: inProc.status });
      expect(norm(viaStudio.body)).toEqual(norm(inProc.body));
    }
    const review = (
      await execDsPlan(planDsVerb(['publish', DS, '--dry-run']), {
        root: x.root,
        studio: null,
        by: PERSON,
      })
    ).body as Record<string, unknown>;
    expect(review).toMatchObject({
      format: 'maude.ds-review',
      v: 1,
      system: DS,
      expectHead: x.R0,
      result: null,
    });
    expect((review.changes as { css: string }[]).map((c) => c.css)).toEqual(['--accent']);
  });

  test('keep (Plane B only): in-process ≡ studio, maude.ds-result/1', async () => {
    const x = await makeProject();
    const y = await makeProject();
    const css = TOKENS_CSS.replace(/--fg-0:[^;]+;/, '--fg-0: oklch(0.31 0.02 255);');
    for (const p of [x, y]) p.write(`${DS_PATH}/colors_and_type.css`, css);
    const a = await execDsPlan(planDsVerb(['keep', DS]), {
      root: x.root,
      studio: null,
      by: PERSON,
    });
    const b = await execDsPlan(planDsVerb(['keep', DS]), {
      root: y.root,
      ...studioOf(y),
      by: PERSON,
    });
    expect(a.status).toBe(200);
    expect(norm(b.body)).toEqual(norm(a.body));
    expect(a.body).toMatchObject({ format: 'maude.ds-result', v: 1, action: 'keep' });
    expect(x.head().base).toBe(y.head().base);
  });

  test('publish: the verb through the studio ≡ the sheet (review → publish at its head)', async () => {
    const ui = await makeProject();
    const cli = await makeProject();
    for (const p of [ui, cli])
      await p.engine.mergePending(DS, {
        tokens: ACCENT('oklch(0.5 0.19 255)', 'oklch(0.6 0.175 255)'),
        by: PERSON,
      });
    // the sheet: read the review, publish against its head with Landing unticked
    const specs = createDsRoutes({
      engine: () => ui.engine,
      access: () => LOCAL_OWNER,
      person: async () => ({ name: PERSON.name }),
    });
    const post = specs.find((s) => s.path === '/_api/ds/publish');
    const sheet = await post?.handle(
      new Request('http://localhost/_api/ds/publish', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ds: DS,
          expectHead: ui.R0,
          canvases: [{ path: 'ui/Landing.tsx', ticked: false }],
        }),
      }),
      {}
    );
    const verb = await execDsPlan(planDsVerb(['publish', DS, '--leave-out', 'ui/Landing.tsx']), {
      root: cli.root,
      ...studioOf(cli),
      by: PERSON,
    });
    expect(verb.status).toBe(200);
    const sheetBody = (await sheet?.json()) as Record<string, unknown>;
    expect(norm(verb.body)).toEqual(norm(sheetBody));
    expect((verb.body as { result: { leftOut: number } }).result.leftOut).toBeGreaterThan(0);
    expect(cli.head().head).toBe(ui.head().head);
    expect(cli.meta('ui/Landing.tsx').dsRev).toBe(cli.R0);
  });

  test('in-process, a write that needs the version log refuses instead of writing behind it', async () => {
    const p = await makeProject();
    await p.engine.mergePending(DS, {
      tokens: ACCENT('oklch(0.5 0.19 255)', 'oklch(0.6 0.175 255)'),
      by: PERSON,
    });
    const a = await execDsPlan(planDsVerb(['publish', DS]), {
      root: p.root,
      studio: null,
      by: PERSON,
    });
    expect(a.status).toBe(503);
    expect((a.body as { code: string }).code).toBe('ds-kernel-unavailable');
    expect(p.head().head).toBe(p.R0);
  });
});
