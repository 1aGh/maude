// S10.12 — `maude design ds convert [<ds>…] [--dry-run]` (alias `migrate`) and `convert <ds> --restore`
// over `POST /_api/ds/convert`: the words, the `maude.ds-convert/1` shape (frozen here), the parity rule
// (the route's answer IS the in-process verb's answer) and the roles (S10 Q15: Can edit on the whole
// project — a viewer and a canvas-scoped editor are refused on the server).
import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { type AccessClaim, resolveAccess } from '../access/scope.ts';
import { DsUsageError, execDsPlan, planDsVerb } from '../ds/ds-verb.ts';
import { createDsEngine } from '../ds/engine.ts';
import { readHead } from '../ds/head.ts';
import { createDsRoutes } from '../routes/ds.ts';
import type { RouteSpec } from '../routes/table.ts';

const DS = 'acme';
const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function project(): { root: string; designRoot: string } {
  const root = mkdtempSync(path.join(tmpdir(), 'maude-ds-convert-verb-'));
  dirs.push(root);
  const designRoot = path.join(root, '.design');
  const w = (rel: string, t: string) => {
    mkdirSync(path.dirname(path.join(designRoot, rel)), { recursive: true });
    writeFileSync(path.join(designRoot, rel), t);
  };
  w(
    'config.json',
    `${JSON.stringify({ designSystems: [{ name: DS, label: 'Acme', path: `system/${DS}`, rootClass: DS, themes: ['light', 'dark'], themeDefault: 'light' }], defaultDesignSystem: DS, canvasGroups: [{ path: 'ui' }, { path: 'system' }] }, null, 2)}\n`
  );
  w(
    `system/${DS}/colors_and_type.css`,
    `:root,\n.${DS}[data-theme="light"] {\n  --accent: red;\n}\n\n.${DS}[data-theme="dark"] {\n  --accent: blue;\n}\n`
  );
  w(`system/${DS}/preview/_components.css`, '.btn {\n  border-radius: 4px;\n}\n');
  w(`system/${DS}/preview/colors-accent.tsx`, 'export default () => null;\n');
  w(`system/${DS}/preview/ui_kits-desktop-showcase.tsx`, 'export default () => null;\n');
  w('ui/Home.tsx', 'export default () => <h1>Home</h1>;\n');
  return { root, designRoot };
}

const claims: Record<string, AccessClaim> = {
  view: { v: 1, role: 'observer' },
  edit: { v: 1, role: 'member' },
  canvasEditor: {
    v: 1,
    role: null,
    grants: [{ c: `system/${DS}/design-system.tsx`, r: 'member' }],
  },
};

function studioOf(p: { designRoot: string }, who: keyof typeof claims = 'edit') {
  const engine = createDsEngine({
    designRoot: p.designRoot,
    kernel: null,
    log: { warn() {}, error() {} },
  });
  const specs: RouteSpec[] = createDsRoutes({
    engine: () => engine,
    access: () => resolveAccess(claims[who]),
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

const BY = { kind: 'person', name: 'Michal' } as const;
const norm = (v: unknown) =>
  JSON.parse(
    JSON.stringify(v)
      .replace(/"[0-9a-f]{64}"/g, '"<rev>"')
      .replace(/_history\/_ds-convert\/[0-9TZ-]+/g, '<snapshot>')
      .replace(/_trash\/ds-convert\/[a-z0-9-]+-[0-9TZ-]+/g, '<trash>')
  );

describe('maude design ds convert — the words', () => {
  test('convert / migrate / --dry-run / --restore are one `convert` operation', () => {
    expect(planDsVerb(['convert'])).toMatchObject({ op: 'convert', input: {}, read: false });
    expect(planDsVerb(['migrate', 'a', 'b', '--dry-run'])).toMatchObject({
      op: 'convert',
      input: { systems: ['a', 'b'], dryRun: true },
      read: true,
    });
    expect(planDsVerb(['convert', DS, '--restore']).input).toEqual({ restore: DS });
    for (const bad of [
      'convert --restore',
      `convert ${DS} b --restore`,
      `convert ${DS} --restore --dry-run`,
      `convert ${DS} --label x`,
    ])
      expect(() => planDsVerb(bad.split(' '))).toThrow(DsUsageError);
  });
});

describe('maude design ds convert — parity, shape, roles', () => {
  test('the route and the in-process verb answer the same; maude.ds-convert/1 is frozen', async () => {
    const a = project();
    const b = project();
    const out: unknown[][] = [[], []];
    for (const words of [
      ['convert', '--dry-run'],
      ['convert', DS],
      ['convert', DS, '--restore'],
    ]) {
      out[0].push(await execDsPlan(planDsVerb(words), { root: a.root, ...studioOf(a), by: BY }));
      out[1].push(await execDsPlan(planDsVerb(words), { root: b.root, studio: null, by: BY }));
    }
    expect(norm(out[0])).toEqual(norm(out[1]));
    const row = {
      name: DS,
      path: `system/${DS}`,
      label: 'Acme',
      canvases: 1,
      folder: 'ui',
      default: true,
      to: 'design-system',
      sections: {
        brand: [],
        colour: ['colors-accent'],
        type: [],
        space: [],
        motion: [],
        components: [],
        patterns: [],
      },
      own: [
        {
          slug: 'ui_kits-desktop-showcase',
          id: 'ds-own-ui-kits-desktop-showcase',
          label: 'Desktop showcase',
          src: 'preview/ui_kits-desktop-showcase.tsx',
        },
      ],
      specimens: 2,
      refused: null,
    };
    expect(norm(out[0])).toEqual([
      { status: 200, body: { format: 'maude.ds-convert', v: 1, systems: [row], result: null } },
      {
        status: 200,
        body: {
          format: 'maude.ds-convert',
          v: 1,
          systems: [row],
          result: {
            snapshot: '<snapshot>',
            systems: [{ name: DS, rev: '<rev>', canvas: `system/${DS}/design-system.tsx` }],
          },
        },
      },
      {
        status: 200,
        body: {
          format: 'maude.ds-result',
          v: 1,
          action: 'restore',
          rev: null,
          actionId: null,
          system: DS,
          trash: '<trash>',
          moved: ['revisions/head.json', 'design-system.tsx', 'design-system.meta.json'],
        },
      },
    ]);
  });

  test('Can view and a canvas-scoped editor are refused on the server; nothing is written', async () => {
    for (const who of ['view', 'canvasEditor'] as const) {
      const p = project();
      for (const words of [['convert'], ['convert', '--dry-run'], ['convert', DS, '--restore']]) {
        const r = await execDsPlan(planDsVerb(words), {
          root: p.root,
          ...studioOf(p, who),
          by: BY,
        });
        expect(r.status).toBe(403);
        expect((r.body as { code: string }).code).toBe('forbidden');
      }
      expect(readHead(path.join(p.designRoot, 'system', DS)).state).toBe('absent');
    }
  });

  test('a refusal answers its code: converting twice, an unknown system, a bad body', async () => {
    const p = project();
    const s = studioOf(p);
    await execDsPlan(planDsVerb(['convert']), { root: p.root, ...s, by: BY });
    const twice = await execDsPlan(planDsVerb(['convert', DS]), { root: p.root, ...s, by: BY });
    expect(twice.status).toBe(409);
    expect(twice.body).toMatchObject({
      code: 'ds-convert-refused',
      detail: { systems: [{ name: DS, code: 'ds-converted' }] },
    });
    const none = await execDsPlan(planDsVerb(['convert']), { root: p.root, ...s, by: BY });
    expect(none).toMatchObject({ status: 409, body: { code: 'ds-convert-nothing' } });
    const unknown = await execDsPlan(planDsVerb(['convert', 'nope']), {
      root: p.root,
      ...s,
      by: BY,
    });
    expect(unknown).toMatchObject({ status: 404, body: { code: 'ds-unknown-system' } });
    const bad = await execDsPlan(
      { op: 'convert', input: { systems: 'acme' }, json: true, root: null, read: false },
      { root: p.root, ...s, by: BY }
    );
    expect(bad).toMatchObject({ status: 400, body: { code: 'ds-convert-usage' } });
  });
});
