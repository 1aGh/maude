// S2.17 — the server half of the Instance blocks: `GET /_api/edit-instance` (main origin only, in neither
// canvas allowlist) tells the inspector what the selected object IS from the TSX and the canvas's own
// system, and `POST /_api/edit-op` {component.swap-variant} judges a variant against that system's
// components.json — the server's reading (`ctx.variantsOf`), not anything the request says.

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
import { Button } from '@maude/ds';
export default function Home() {
  return (
    <DesignCanvas>
      <DCArtboard id="desktop" label="Desktop" width={800} height={500}>
        <Button data-cd-id="cta" variant="primary" style={{ background: 'var(--accent)' }}>REGISTRUJ SE</Button>
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
  },
};

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});
function sandbox() {
  const root = mkdtempSync(join(tmpdir(), 'maude-instance-'));
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
const get = (id: string, file = '.design/ui/Home.tsx') =>
  new Request(`http://localhost/_api/edit-instance?file=${encodeURIComponent(file)}&id=${id}`);
const post = (body: unknown) =>
  new Request('http://localhost/_api/edit-op', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
const infoSpec = (r: ReturnType<typeof routes>) =>
  r.find((s) => s.method === 'GET' && s.path === '/_api/edit-instance') as (typeof r)[number];
const opSpec = (r: ReturnType<typeof routes>) =>
  r.find((s) => s.method === 'POST' && s.path === '/_api/edit-op') as (typeof r)[number];
const swap = (params: Record<string, unknown>, element = 'cta') => ({
  file: '.design/ui/Home.tsx',
  op: 'component.swap-variant',
  targets: [{ artboard: 'desktop', element }],
  params,
});

describe('GET /_api/edit-instance in the one table', () => {
  test('main origin only, in neither canvas allowlist, declared once', () => {
    const specs = allSpecs(stubDeps()).filter((s) => s.path === '/_api/edit-instance');
    expect(specs.map((s) => [s.method, s.origin])).toEqual([['GET', 'main']]);
    expect(mountRoutes(allSpecs(stubDeps())).canvasPaths).not.toContain('/_api/edit-instance');
    expect(CANVAS_SAFE_API.has('/_api/edit-instance')).toBe(false);
  });
});

describe('what the inspector is told', () => {
  test('an instance: the system’s label, its variants, the swaps, what it overrides', async () => {
    const { root, designRoot } = sandbox();
    const r = await infoSpec(routes(designRoot, root, 'member')).handle(get('cta'), {});
    expect(r.status).toBe(200);
    const { instance } = (await r.json()) as { instance: Record<string, any> };
    expect(instance.component).toBe('Button');
    expect(instance.label).toBe('Tlačítko');
    expect(instance.variant).toBe('primary');
    // the manifest lists primary and outline; `danger: null` is a gap, not an offer
    expect(instance.variants).toEqual([
      { key: 'primary', label: 'Primary' },
      { key: 'outline', label: 'Outline' },
    ]);
    expect(instance.swappable).toEqual([
      { name: 'Button', label: 'Tlačítko' },
      { name: 'Badge', label: 'Štítek' },
      { name: 'Chip', label: 'Chip' },
    ]);
    expect(instance.holdsText).toBe(true);
    expect(instance.text).toBe('REGISTRUJ SE');
    expect(instance.overrides).toEqual({ text: true, fill: true, props: ['background'], count: 2 });
  });

  test('a frame is not an instance; a bad id and an unknown canvas are 400', async () => {
    const { root, designRoot } = sandbox();
    const spec = infoSpec(routes(designRoot, root, 'member'));
    const frame = await spec.handle(get('footer'), {});
    expect(((await frame.json()) as { instance: unknown }).instance).toBeNull();
    expect((await spec.handle(get('a b'), {})).status).toBe(400);
    expect((await spec.handle(get('cta', '.design/ui/Nope.tsx'), {})).status).toBe(400);
  });

  test('anyone who can see the canvas may ask; no access wired is refused, never open', async () => {
    const { root, designRoot } = sandbox();
    expect(
      (await infoSpec(routes(designRoot, root, 'observer')).handle(get('cta'), {})).status
    ).toBe(200);
    expect((await infoSpec(routes(designRoot, root, null)).handle(get('cta'), {})).status).toBe(
      403
    );
  });
});

describe('the variant is judged by the system, not by the request', () => {
  test('outline is in the manifest: written', async () => {
    const { root, designRoot } = sandbox();
    const r = await opSpec(routes(designRoot, root, 'member')).handle(
      post(swap({ variant: 'outline' })),
      {}
    );
    expect(r.status).toBe(200);
    expect(readFileSync(join(designRoot, 'ui', 'Home.tsx'), 'utf8')).toContain('variant="outline"');
  });

  test('danger is a shipped default but the manifest maps it to null: refused, file untouched', async () => {
    const { root, designRoot } = sandbox();
    const r = await opSpec(routes(designRoot, root, 'member')).handle(
      // a request that CLAIMS the variant exists changes nothing
      post(swap({ variant: 'danger', variants: ['danger'], variantsOf: ['danger'] })),
      {}
    );
    expect(r.status).toBe(400);
    expect(((await r.json()) as { message: string }).message).toBe(
      'That variant is not one this component has.'
    );
    expect(readFileSync(join(designRoot, 'ui', 'Home.tsx'), 'utf8')).toBe(SRC);
  });

  test('a swap to a component whose manifest entry has no variants drops the old variant', async () => {
    const { root, designRoot } = sandbox();
    const r = await opSpec(routes(designRoot, root, 'member')).handle(
      post(swap({ component: 'Badge' })),
      {}
    );
    expect(r.status).toBe(200);
    expect(((await r.json()) as { detail: unknown }).detail).toEqual({ droppedVariant: 'primary' });
  });

  test('a Can comment session is refused by the read-only gate, not just shown no row', () => {
    const specs = allSpecs(stubDeps()).filter((s) => s.path === '/_api/edit-op');
    expect(specs.map((s) => s.readOnly)).toEqual(['refused']);
  });
});
