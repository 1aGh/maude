// S10.10 (lead decision v2-S10.8-review-update-server-mapper): "Update <Heading> / <Button> for every canvas…"
// sends `POST /_api/ds/pending {ds, from: {canvas, elementId, target}}` and the SERVER turns the element's own
// overrides into waiting edits: a master → `components[name][.<components.json class>][prop]`, a type role →
// the role's class rule. The client never computes the CSS; whatever the page sends is re-checked here.
import { afterAll, describe, expect, test } from 'bun:test';

import { resolveAccess } from '../access/scope.ts';
import { DsEngineError } from '../ds/engine.ts';
import { planDsVerb } from '../ds/ds-verb.ts';
import { mapOverrides } from '../ds/override-map.ts';
import { createDsRoutes } from '../routes/ds.ts';
import { cleanup, DS, DS_PATH, makeProject, type Project } from './_ds-engine-fixture.ts';

afterAll(cleanup);

const COMPONENTS_JSON = {
  schemaVersion: 1,
  system: 'acme',
  components: {
    Button: {
      class: 'btn',
      export: 'Button',
      variants: { primary: 'btn--primary', ghost: 'btn--ghost', plain: null },
      sizes: { sm: 'btn--sm' },
      label: 'Tlačítko',
    },
  },
  typeRoles: { heading: 't-heading', body: 't-body' },
};

const IMPORT = "import { Button } from '@maude/ds';\n";
const canvas = (body: string) => `${IMPORT}export default () => <main>${body}</main>;\n`;

const BUTTON = canvas(
  `<Button data-cd-id="b1" variant="primary" style={{ borderRadius: 6, background: 'tomato', color: '#fff', height: 40, margin: 8, position: 'absolute' }}>Go</Button>`
);
const HEADING = canvas(
  `<h1 data-cd-id="h1" className="t-heading" style={{ fontSize: 40, fontWeight: 700, lineHeight: 1.1, textTransform: 'uppercase', color: 'red', width: 300 }}>Hi</h1>`
);

const map = (source: string, elementId: string, target: unknown) =>
  mapOverrides({
    source,
    file: 'ui/Home.tsx',
    elementId,
    target: target as never,
    componentsJson: COMPONENTS_JSON,
  });

const refusal = (fn: () => unknown) => {
  try {
    fn();
    return null;
  } catch (err) {
    return err instanceof DsEngineError ? err.code : String(err);
  }
};

describe('mapOverrides (pure)', () => {
  test('a master: geometry goes to the components.json class, paint to the variant class', () => {
    const r = map(BUTTON, 'b1', { kind: 'component', name: 'Button', variant: 'primary' });
    expect(r.components).toEqual({
      Button: {
        '.btn': { 'border-radius': { value: '6px' }, height: { value: '40px' } },
        '.btn--primary': { background: { value: 'tomato' }, color: { value: '#fff' } },
      },
    });
    // placement (margin, position) is the canvas's, never the master's
    expect(r.skipped).toEqual([]);
  });

  test('a master without a variant keeps paint on the base class', () => {
    const src = canvas(`<Button data-cd-id="b1" style={{ background: 'tomato' }}>Go</Button>`);
    expect(map(src, 'b1', { kind: 'component', name: 'Button' }).components).toEqual({
      Button: { '.btn': { background: { value: 'tomato' } } },
    });
  });

  test('a type role: only the properties a style owns, in the role class rule', () => {
    const r = map(HEADING, 'h1', { kind: 'typeRole', role: 'heading' });
    expect(r.components).toEqual({
      't-heading': {
        '.t-heading': {
          'font-size': { value: '40px' },
          'font-weight': { value: '700' },
          'line-height': { value: '1.1' },
          'text-transform': { value: 'uppercase' },
        },
      },
    });
  });

  test('a value written in code is skipped and named, never guessed', () => {
    const src = canvas(
      `<Button data-cd-id="b1" style={{ borderRadius: r, background: 'tomato' }}>Go</Button>`
    );
    const r = map(src, 'b1', { kind: 'component', name: 'Button' });
    expect(r.components).toEqual({ Button: { '.btn': { background: { value: 'tomato' } } } });
    expect(r.skipped).toEqual(['border-radius']);
  });

  test('nothing overridden → ds-nothing-to-push', () => {
    const src = canvas(`<Button data-cd-id="b1" variant="primary">Go</Button>`);
    expect(refusal(() => map(src, 'b1', { kind: 'component', name: 'Button' }))).toBe(
      'ds-nothing-to-push'
    );
  });

  test('a target the page invented is refused: a name the system lacks, a role class that is not a role', () => {
    expect(refusal(() => map(BUTTON, 'b1', { kind: 'component', name: 'Nope' }))).toBe(
      'ds-pending-invalid'
    );
    expect(refusal(() => map(HEADING, 'h1', { kind: 'typeRole', role: 'x}{@import' }))).toBe(
      'ds-pending-invalid'
    );
    expect(refusal(() => map(HEADING, 'gone', { kind: 'typeRole', role: 'heading' }))).toBe(
      'ds-pending-invalid'
    );
    expect(refusal(() => map(HEADING, 'h1', { kind: 'button' }))).toBe('ds-pending-invalid');
  });

  test('a value that could leave its declaration is dropped before it is a waiting edit', () => {
    const src = canvas(
      `<Button data-cd-id="b1" style={{ background: 'red; } body { display: none', height: 40 }}>Go</Button>`
    );
    const r = map(src, 'b1', { kind: 'component', name: 'Button' });
    expect(r.components).toEqual({ Button: { '.btn': { height: { value: '40px' } } } });
    expect(r.skipped).toEqual(['background']);
  });
});

/** The real route table of this project. */
function routes(p: Project, role: 'view' | 'edit' = 'edit') {
  const claim =
    role === 'view'
      ? { v: 1 as const, role: 'observer' as const }
      : { v: 1 as const, role: 'member' as const };
  const specs = createDsRoutes({
    engine: () => p.engine,
    access: () => resolveAccess(claim),
    person: async () => ({ name: 'Michal' }),
  });
  return async (body: unknown) => {
    const spec = specs.find((s) => s.method === 'POST' && s.path === '/_api/ds/pending');
    if (!spec) throw new Error('no /_api/ds/pending');
    const res = await spec.handle(
      new Request('http://localhost/_api/ds/pending', {
        method: 'POST',
        body: JSON.stringify(body),
        headers: { 'content-type': 'application/json' },
      }),
      {}
    );
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  };
}

const waiting = (p: Project) =>
  (p.meta(`${DS_PATH}/design-system.tsx`).dsPending as { components?: Record<string, unknown> })
    ?.components;

async function project(source: string): Promise<Project> {
  const p = await makeProject();
  p.write(`${DS_PATH}/components.json`, `${JSON.stringify(COMPONENTS_JSON, null, 2)}\n`);
  p.write('ui/Home.tsx', source);
  return p;
}

describe('POST /_api/ds/pending {from}', () => {
  test('the element’s overrides wait as component patches; the answer says how many', async () => {
    const p = await project(BUTTON);
    const post = routes(p);
    const r = await post({
      ds: DS,
      from: {
        canvas: 'ui/Home.tsx',
        elementId: 'b1',
        target: { kind: 'component', name: 'Button', variant: 'primary' },
      },
    });
    expect(r.status).toBe(200);
    expect(r.body.mapped).toEqual({ entries: 4, skipped: [] });
    expect(waiting(p)).toMatchObject({
      Button: {
        '.btn': { 'border-radius': { value: '6px' } },
        '.btn--primary': { background: { value: 'tomato' } },
      },
    });
  });

  test('a type role pushes its class rule', async () => {
    const p = await project(HEADING);
    const r = await routes(p)({
      ds: DS,
      from: { canvas: 'ui/Home.tsx', elementId: 'h1', target: { kind: 'typeRole', role: 'heading' } },
    });
    expect(r.status).toBe(200);
    expect(waiting(p)).toMatchObject({
      't-heading': { '.t-heading': { 'font-size': { value: '40px' } } },
    });
  });

  test('Can view cannot push; a canvas path outside the design root is refused; nothing waits', async () => {
    const p = await project(BUTTON);
    const target = { kind: 'component', name: 'Button' };
    const view = await routes(p, 'view')({
      ds: DS,
      from: { canvas: 'ui/Home.tsx', elementId: 'b1', target },
    });
    expect(view.status).toBe(403);
    const out = await routes(p)({
      ds: DS,
      from: { canvas: '../../etc/passwd', elementId: 'b1', target },
    });
    expect(out.status).toBe(400);
    const missing = await routes(p)({
      ds: DS,
      from: { canvas: 'ui/Nope.tsx', elementId: 'b1', target },
    });
    expect(missing.status).toBe(404);
    expect(waiting(p)).toBeUndefined();
  });

  test('an element with nothing to push answers 422 ds-nothing-to-push', async () => {
    const p = await project(canvas(`<Button data-cd-id="b1">Go</Button>`));
    const r = await routes(p)({
      ds: DS,
      from: {
        canvas: 'ui/Home.tsx',
        elementId: 'b1',
        target: { kind: 'component', name: 'Button' },
      },
    });
    expect([r.status, r.body.code]).toEqual([422, 'ds-nothing-to-push']);
    expect(waiting(p)).toBeUndefined();
  });

  test('`from` and `components` together are refused: one source of edits per request', async () => {
    const p = await project(BUTTON);
    const r = await routes(p)({
      ds: DS,
      components: { Button: { '.btn': { height: { value: '1px' } } } },
      from: { canvas: 'ui/Home.tsx', elementId: 'b1', target: { kind: 'component', name: 'Button' } },
    });
    expect(r.status).toBe(400);
  });
});

describe('the verb is the same door', () => {
  test('maude design ds pending <ds> --set carries `from` to the route unchanged', () => {
    const from = {
      canvas: 'ui/Home.tsx',
      elementId: 'b1',
      target: { kind: 'component', name: 'Button' },
    };
    const plan = planDsVerb(['pending', DS, '--set', 'p.json'], () => JSON.stringify({ from }));
    expect(plan.input).toEqual({ ds: DS, from });
  });
});
