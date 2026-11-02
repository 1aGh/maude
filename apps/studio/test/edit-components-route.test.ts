// S2.16 — the server half of ⇧I: `GET /_api/ds/components` (minRole edit, main origin, in neither
// canvas allowlist) lists Brand / Components / Patterns from the canvas's own system, and
// `POST /_api/edit-op` {component.insert} puts `data-ds-rev="head"` only on a canvas whose meta says
// it is left out. The role is judged by the server — a Can comment session is refused, not just
// shown no panel (standing rule 12).

import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { resolveAccess } from '../access/scope.ts';
import { CANVAS_SAFE_API } from '../http.ts';
import { createEditRoutes } from '../routes/edit.ts';
import { allSpecs } from '../routes/index.ts';
import { mountRoutes } from '../routes/table.ts';
import { stubDeps } from './_route-stubs.ts';

const SRC = `import { DCArtboard, DesignCanvas } from '@maude/canvas-lib';
export default function Home() {
  return (
    <DesignCanvas>
      <DCArtboard id="desktop" label="Desktop" width={800} height={500}>
        <footer data-cd-id="footer">Footer</footer>
      </DCArtboard>
    </DesignCanvas>
  );
}
`;
const COMPONENTS = {
  schemaVersion: 1,
  system: 'alligators',
  components: {
    Button: {
      class: 'btn',
      label: 'Tlačítko',
      variants: { primary: 'btn--primary', outline: 'btn--outline', danger: null },
    },
    Badge: { class: 'badge', label: 'Štítek', variants: {} },
    Chip: { class: 'chip' },
    Tabs: { class: 'tabs', label: 'Tabs (this system switches views with its segmented control)' },
    Wizard: { class: 'x-wizard' }, // not placeable from here: never listed
  },
  icons: { map: { home: 'h', star: 's', gap: null } },
};

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});
function sandbox(meta?: Record<string, unknown>) {
  const root = mkdtempSync(join(tmpdir(), 'maude-picker-'));
  dirs.push(root);
  const designRoot = join(root, '.design');
  mkdirSync(join(designRoot, 'ui'), { recursive: true });
  mkdirSync(join(designRoot, 'system', 'alligators'), { recursive: true });
  writeFileSync(
    join(designRoot, 'config.json'),
    JSON.stringify({
      defaultDesignSystem: 'alligators',
      designSystems: [{ name: 'alligators', path: 'system/alligators' }],
    })
  );
  writeFileSync(
    join(designRoot, 'system', 'alligators', 'components.json'),
    JSON.stringify(COMPONENTS)
  );
  writeFileSync(join(designRoot, 'ui', 'Home.tsx'), SRC);
  if (meta) writeFileSync(join(designRoot, 'ui', 'Home.meta.json'), JSON.stringify(meta));
  return { root, designRoot };
}
const claim = (role: string) => resolveAccess({ v: 1, role } as never);
const routes = (designRoot: string, root: string, role: string | null) =>
  createEditRoutes({
    designRoot,
    designRel: '.design',
    repoRoot: root,
    emit: () => {},
    ...(role ? { access: () => claim(role) } : {}),
  });
const get = (url = '/_api/ds/components') => new Request(`http://localhost${url}`);
const post = (body: unknown) =>
  new Request('http://localhost/_api/edit-op', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
const listSpec = (r: ReturnType<typeof routes>) =>
  r.find((s) => s.method === 'GET' && s.path === '/_api/ds/components') as (typeof r)[number];
const opSpec = (r: ReturnType<typeof routes>) =>
  r.find((s) => s.method === 'POST' && s.path === '/_api/edit-op') as (typeof r)[number];

describe('GET /_api/ds/components in the one table', () => {
  test('main origin only, in neither canvas allowlist, declared once', () => {
    const specs = allSpecs(stubDeps()).filter((s) => s.path === '/_api/ds/components');
    expect(specs.map((s) => [s.method, s.origin])).toEqual([['GET', 'main']]);
    expect(mountRoutes(allSpecs(stubDeps())).canvasPaths).not.toContain('/_api/ds/components');
    expect(CANVAS_SAFE_API.has('/_api/ds/components')).toBe(false);
  });
});

describe('the list', () => {
  test('Brand = Logo + Icon, Components = the manifest (labels, real variants), Patterns empty', async () => {
    const { root, designRoot } = sandbox();
    const r = await listSpec(routes(designRoot, root, 'member')).handle(
      get('/_api/ds/components?file=.design/ui/Home.tsx'),
      {}
    );
    expect(r.status).toBe(200);
    const body = (await r.json()) as {
      system: { name: string };
      brand: Array<{ name: string; glyph?: string; glyphs?: number }>;
      components: Array<{
        name: string;
        label: string;
        variants: Array<{ key: string; label: string }>;
      }>;
      patterns: unknown[];
    };
    expect(body.system.name).toBe('alligators');
    expect(body.brand.map((b) => b.name)).toEqual(['Logo', 'Icon']);
    expect(body.brand[1]).toMatchObject({ glyph: 'star', glyphs: 2 });
    expect(body.components.map((c) => c.name)).toEqual(['Button', 'Badge', 'Chip', 'Tabs']);
    expect(body.components[0]).toMatchObject({
      label: 'Tlačítko',
      variants: [
        { key: 'primary', label: 'Primary' },
        { key: 'outline', label: 'Outline' },
      ],
    });
    expect(body.components[1]?.variants).toEqual([]);
    // a component the manifest does not label falls back to its name; its default variants are offered
    expect(body.components[2]).toMatchObject({ label: 'Chip' });
    // a description the system wrote after its name ("Tabs (this system …)") is not part of the row's name
    expect(body.components[3]).toMatchObject({ label: 'Tabs' });
    expect(body.patterns).toEqual([]);
  });

  test('no manifest: the 14 defaults are offered', async () => {
    const { root, designRoot } = sandbox();
    rmSync(join(designRoot, 'system', 'alligators', 'components.json'));
    const r = await listSpec(routes(designRoot, root, 'owner')).handle(get(), {});
    const body = (await r.json()) as { components: Array<{ name: string }> };
    expect(body.components.map((c) => c.name)).toContain('Button');
    expect(body.components.length).toBe(14);
  });
});

describe('who may ask (rule 12)', () => {
  test.each([
    'viewer',
    'observer',
  ])('%s (Can comment / Can view) is refused with 403', async (role) => {
    const { root, designRoot } = sandbox();
    const r = await listSpec(routes(designRoot, root, role)).handle(get(), {});
    expect(r.status).toBe(403);
    expect(((await r.json()) as { code: string }).code).toBe('forbidden');
  });

  test('no access wired: refused, never open', async () => {
    const { root, designRoot } = sandbox();
    expect((await listSpec(routes(designRoot, root, null)).handle(get(), {})).status).toBe(403);
  });

  test.each(['member', 'owner'])('%s is answered', async (role) => {
    const { root, designRoot } = sandbox();
    expect((await listSpec(routes(designRoot, root, role)).handle(get(), {})).status).toBe(200);
  });

  test('the placement itself is the read-only gate’s: POST /_api/edit-op is `refused` for a viewer', () => {
    const specs = allSpecs(stubDeps()).filter((s) => s.path === '/_api/edit-op');
    expect(specs.map((s) => s.readOnly)).toEqual(['refused']);
    expect(mountRoutes(allSpecs(stubDeps())).readOnlyAllowed.exact).not.toContain('/_api/edit-op');
  });
});

describe('data-ds-rev comes from the canvas’s meta, only', () => {
  const place = (extra: Record<string, unknown> = {}) => ({
    file: '.design/ui/Home.tsx',
    op: 'component.insert',
    targets: [],
    params: { component: 'Button', variant: 'primary', artboard: 'desktop', ...extra },
  });

  test('a left-out canvas (meta.dsRev) gets it; the file on disk shows it', async () => {
    const { root, designRoot } = sandbox({ dsRev: 'a'.repeat(64) });
    const r = await opSpec(routes(designRoot, root, 'member')).handle(post(place()), {});
    expect(r.status).toBe(200);
    const src = readFileSync(join(designRoot, 'ui', 'Home.tsx'), 'utf8');
    expect(src).toContain('<Button data-cd-id="button" data-ds-rev="head" variant="primary">');
    expect(src).toContain("import { Button } from '@maude/ds';");
  });

  test('a canvas that follows the system does not, and the request cannot ask for it', async () => {
    const { root, designRoot } = sandbox({});
    const r = await opSpec(routes(designRoot, root, 'member')).handle(
      post(place({ dsRev: 'head', 'data-ds-rev': 'head' })),
      {}
    );
    expect(r.status).toBe(200);
    expect(readFileSync(join(designRoot, 'ui', 'Home.tsx'), 'utf8')).not.toContain('data-ds-rev');
  });
});
