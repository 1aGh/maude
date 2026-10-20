// S10.12 — "Convert system folders" (13 · 25 ds-multi-migrate, 29 ds-edge-migrate): the words from the server's dry
// run, the dialog and its host (the banner / `ds.convert` → dry run → Convert = one POST naming exactly the folders
// shown), the banner on today's folder view, and the registry rows' handlers.
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { AGENT_PATHS } from '../actions/agents.ts';
import { ACTIONS_BY_ID } from '../actions/index.ts';
import {
  CONVERT_WORDS,
  dialogModel,
  mapRows,
  requestDsConvert,
  useWords,
} from '../client/v2/ds/convert-model.js';
import { createMenuHandlers } from '../client/v2/shell/menu-runner.js';

const none = {
  brand: [],
  colour: [],
  type: [],
  space: [],
  motion: [],
  components: [],
  patterns: [],
};
const row = (o: Record<string, unknown>) => ({
  sections: none,
  own: [],
  specimens: 0,
  refused: null,
  folder: null,
  default: false,
  ...o,
});
// 25: three old folders — two canvases and a draft
const PLAN_25 = {
  format: 'maude.ds-convert',
  v: 1,
  systems: [
    row({
      name: 'gator',
      label: 'Alligators brand system',
      path: 'system/alligators',
      canvases: 87,
      default: true,
      to: 'design-system',
    }),
    row({
      name: 'combine',
      label: 'Combine 2026',
      path: 'system/combine-2026',
      canvases: 6,
      folder: '2026/combine',
      to: 'design-system',
    }),
    row({
      name: 'gator-2023',
      label: 'Alligators 2023',
      path: 'system/alligators-2023',
      canvases: 0,
      to: 'draft',
    }),
  ],
};
// 29: one folder up close
const PLAN_29 = {
  format: 'maude.ds-convert',
  v: 1,
  systems: [
    row({
      name: 'gator',
      label: 'Alligators brand system',
      path: 'system/alligators',
      canvases: 87,
      default: true,
      to: 'design-system',
      specimens: 9,
      sections: {
        ...none,
        brand: ['logo', 'iconography'],
        colour: ['colors-accent', 'colors-status', 'opacity'],
        type: ['type-scale'],
        components: ['components-buttons'],
      },
      own: [
        {
          slug: 'ui_kits-desktop-showcase',
          id: 'ds-own-ui-kits-desktop-showcase',
          label: 'Desktop showcase',
          src: 'preview/ui_kits-desktop-showcase.tsx',
        },
        {
          slug: 'ui_kits-desktop-index',
          id: 'ds-own-ui-kits-desktop-index',
          label: 'Desktop index',
          src: 'preview/ui_kits-desktop-index.tsx',
        },
      ],
    }),
  ],
};

describe('convert words (CONTRACT §3, 25 / 29)', () => {
  test('25: every folder in use becomes a canvas, the unused one a draft, the default stays', () => {
    const m = dialogModel(PLAN_25);
    expect(m.kind).toBe('many');
    expect(m.title).toBe('Convert 3 system folders?');
    expect(m.lead).toBe(
      '2 become Design system canvases. Alligators 2023 becomes a draft — listed with the systems, used by no canvas. The files stay exactly where they are.'
    );
    expect(m.list.map((r: { use: string; to: string }) => [r.use, r.to])).toEqual([
      ['87 canvases · default', 'Design system canvas'],
      ['6 canvases in 2026/combine', 'Design system canvas'],
      ['no canvas uses it', 'Draft'],
    ]);
    expect(m.fine).toBe(
      'Alligators brand system stays the default for new canvases. A converted system made before the schema shows an amber dot — Bring it up lines it up. Version history keeps the folder view; Restore undoes the conversion.'
    );
    expect(m.canConvert).toBe(true);
    expect(useWords({ canvases: 1 })).toBe('1 canvas');
  });

  test('29: pages fold into sections; showcases stay their own artboards', () => {
    const m = dialogModel(PLAN_29);
    expect(m.kind).toBe('one');
    expect(m.title).toBe('Convert system/alligators into its Design system canvas?');
    expect(m.lead).toBe(
      '9 specimen pages fold into 7 sections. The files stay exactly where they are.'
    );
    expect(mapRows(PLAN_29.systems[0]).map((r) => [r.label, r.from, r.count])).toEqual([
      ['Brand', 'logo · iconography', 2],
      ['Colour', 'accent · status · opacity', 3],
      ['Type', 'type scale', 1],
      ['Components', 'buttons', 1],
      ['Own artboards', 'desktop showcase · desktop index — kept as they are', 2],
    ]);
    expect(m.fine).toBe('Version history keeps the folder view — Restore undoes the conversion.');
  });

  test('a refused folder says why, and Convert is off (one run converts all of them or none)', () => {
    const plan = structuredClone(PLAN_25);
    (plan.systems[1] as { refused: unknown }).refused = {
      code: 'ds-convert-exists',
      message: 'system/combine-2026/design-system.tsx already exists — move it first',
    };
    const m = dialogModel(plan);
    expect(m.canConvert).toBe(false);
    expect(m.refused).toEqual([
      {
        name: 'combine',
        label: 'Combine 2026',
        why: 'system/combine-2026/design-system.tsx already exists — move it first',
      },
    ]);
  });
});

describe('the registry rows', () => {
  test('ds.convert / ds.convert-restore: Can edit, the verb, the route; the shell handles both', async () => {
    for (const id of ['ds.convert', 'ds.convert-restore']) {
      expect(ACTIONS_BY_ID.get(id)?.visible).toEqual({ minRole: 'edit' });
      expect(AGENT_PATHS[id]?.server).toEqual({ route: '/_api/ds/convert', method: 'POST' });
    }
    expect(AGENT_PATHS['ds.convert']?.agent).toMatchObject({
      path: 'cli',
      verb: 'maude design ds convert [<ds>…] [--dry-run]',
    });
    const toasts: string[] = [];
    const h = createMenuHandlers({ toast: (m: string) => toasts.push(m) } as never);
    expect(typeof h['ds.convert']).toBe('function');
    expect(typeof h['ds.convert-restore']).toBe('function');
  });
});

describe('the dialog and its host', () => {
  const roots: Root[] = [];
  let Host: (p: Record<string, unknown>) => JSX.Element | null;
  let SystemView: (p: Record<string, unknown>) => JSX.Element;
  beforeAll(async () => {
    GlobalRegistrator.register();
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
      true;
    Host = (await import('../client/v2/ds/convert-host.jsx')).DsConvertHost as never;
    SystemView = (await import('../client/system/system-view.jsx')).SystemView as never;
  });
  afterAll(() => GlobalRegistrator.unregister());
  afterEach(async () => {
    for (const r of roots.splice(0)) await act(async () => r.unmount());
    document.body.innerHTML = '';
  });
  const q = (id: string) => document.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
  const settle = () => act(async () => new Promise((r) => setTimeout(r, 30)));
  async function render(node: JSX.Element) {
    const el = document.createElement('div');
    document.body.append(el);
    const root = createRoot(el);
    roots.push(root);
    await act(async () => root.render(node));
  }
  function fakeFetch(answer: (body: Record<string, unknown>) => { status: number; body: unknown }) {
    const calls: Record<string, unknown>[] = [];
    const impl = (async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}'));
      calls.push(body);
      const a = answer(body);
      return new Response(JSON.stringify(a.body), { status: a.status });
    }) as unknown as typeof fetch;
    return { impl, calls };
  }

  test('the banner opens the dry run; Convert sends one POST naming exactly the folders shown', async () => {
    const f = fakeFetch((b) =>
      b.dryRun
        ? { status: 200, body: { ...PLAN_25, result: null } }
        : {
            status: 200,
            body: {
              ...PLAN_25,
              result: {
                snapshot: '_history/_ds-convert/x',
                systems: PLAN_25.systems.map((s) => ({ name: s.name })),
              },
            },
          }
    );
    const toasts: string[] = [];
    await render(
      <>
        <Host toast={(m: string) => toasts.push(m)} fetchImpl={f.impl} />
        <SystemView
          data={{
            ds: { name: 'gator' },
            availableDesignSystems: [{ name: 'gator' }],
            previewGallery: [],
            uiKitsGallery: [],
            systemDir: 'system/alligators',
            tokens: [],
            tokenGroups: {},
          }}
          cfg={{ dsConverted: { gator: false } }}
          onOpen={() => {}}
        />
      </>
    );
    expect(q('ds-convert-banner')?.textContent).toContain(CONVERT_WORDS.banner);
    await act(async () => q('ds-convert-open')?.click());
    await settle();
    expect(f.calls[0]).toEqual({ dryRun: true });
    expect(q('ds-convert-title')?.textContent).toBe('Convert 3 system folders?');
    expect(
      [...document.querySelectorAll('[data-testid="ds-convert-row"]')].map((e) =>
        e.getAttribute('data-ds')
      )
    ).toEqual(['gator', 'combine', 'gator-2023']);
    await act(async () => q('ds-convert-go')?.click());
    await settle();
    expect(f.calls[1]).toEqual({ systems: ['gator', 'combine', 'gator-2023'] });
    expect(q('ds-convert')).toBeNull();
    expect(toasts).toEqual(['3 Design system canvases now.']);
  });

  test('a refusal stays in the dialog in words; Cancel writes nothing', async () => {
    const f = fakeFetch((b) =>
      b.dryRun
        ? { status: 200, body: { ...PLAN_29, result: null } }
        : {
            status: 409,
            body: {
              code: 'ds-convert-refused',
              error:
                'Alligators brand system: it is already a Design system canvas — nothing was converted',
            },
          }
    );
    await render(<Host toast={() => {}} fetchImpl={f.impl} />);
    await act(async () => void requestDsConvert({ ds: 'gator' }));
    await settle();
    expect(q('ds-convert')?.getAttribute('data-kind')).toBe('one');
    expect(q('ds-convert-map')?.querySelectorAll('.dsc-map-r').length).toBe(5);
    await act(async () => q('ds-convert-go')?.click());
    await settle();
    expect(q('ds-convert-error')?.textContent).toBe(
      'Alligators brand system: it is already a Design system canvas — nothing was converted'
    );
    await act(async () => q('ds-convert-cancel')?.click());
    expect(q('ds-convert')).toBeNull();
    expect(f.calls).toHaveLength(2);
  });

  test('no banner on a converted system, nor for someone who can only look', async () => {
    const data = {
      ds: { name: 'gator' },
      availableDesignSystems: [{ name: 'gator' }],
      previewGallery: [],
      uiKitsGallery: [],
      systemDir: 'system/alligators',
      tokens: [],
      tokenGroups: {},
    };
    await render(
      <SystemView data={data} cfg={{ dsConverted: { gator: true } }} onOpen={() => {}} />
    );
    expect(q('ds-convert-banner')).toBeNull();
    await render(
      <SystemView data={data} cfg={{ dsConverted: {}, readOnly: true }} onOpen={() => {}} />
    );
    expect(q('ds-convert-banner')).toBeNull();
  });
});
