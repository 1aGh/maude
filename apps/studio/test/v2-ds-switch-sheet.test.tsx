// S10.14 (13 · ds-multi-switch, ds-many-switch) — "Switch canvases to …?" and the "Preview in …" bar.
// The model is pure (rows, words, request body); the sheet and the bar are real markup. Pinned here: the title asks
// with the verb the button repeats, a pinned or blocked canvas is unticked WITH a reason and cannot be ticked, the
// AI row appears only when there is something of its own to restyle and an AI to ask, and a refused (level 11)
// switch cannot be sent; the bar steps with ↑↓, opens the review with ↵ and stops with esc.
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { AGENT_PATHS } from '../actions/agents.ts';
import { DS_ACTIONS } from '../actions/defs/ds.ts';
import { beginDsPreview, getDsPreview, resetDsPreview } from '../client/v2/ds/preview-mode.js';
import {
  finishedMaking,
  onDsSwitchRequest,
  requestDsSwitch,
  resetDsSwitchBus,
} from '../client/v2/ds/switch-bus.js';
import {
  defaultScope,
  primaryWords,
  refusalWords,
  restyleBrief,
  restyleSummary,
  restyleWords,
  rowNote,
  schemaLine,
  scopeFields,
  scopeOptions,
  switchBody,
  switchedWords,
  switchRows,
  switchTitle,
  withTicks,
} from '../client/v2/ds/switch-model.js';
import { systemMenuItems } from '../client/v2/ds/system-menu.jsx';

// the six canvases of 13 · ds-multi-switch: five switch, one is pinned (Combine-video-AI keeps Combine 2026)
const row = (name: string, over: Record<string, unknown> = {}) => ({
  path: `2026/combine/${name}.tsx`,
  folder: '2026/combine',
  from: 'combine',
  state: 'switchable',
  ticked: true,
  pins: {},
  ...over,
});
const REVIEW = {
  format: 'maude.ds-switch-review',
  v: 1,
  to: 'gator',
  scope: { kind: 'folder', path: '2026/combine' },
  canvases: [
    row('Combine-kampan', { pins: { 'own-token:--x-camo': 2, 'literal-colour': 12 } }),
    row('Combine-kampan — varianta'),
    row('Combine-letak-registrace'),
    row('Combine-invite', { state: 'review', pins: { 'own-token:--x-scute-height': 1 } }),
    row('Combine-cisla'),
    row('Combine-video-AI', { state: 'pinned', ticked: false, reason: 'pinned' }),
  ],
  pairing: { kinds: ['display', 'palette'], canvases: {} },
  levels: { gator: 0, combine: 0 },
  refused: null,
  result: null,
};

describe('the switch model', () => {
  test('rows: pinned and blocked are locked with their reason; the rest take the server’s tick', () => {
    const rows = switchRows(REVIEW);
    expect(rows.filter((r) => r.ticked)).toHaveLength(5);
    const pinned = rows.find((r) => r.name === 'Combine-video-AI');
    expect(pinned).toMatchObject({ locked: true, ticked: false, reason: 'pinned' });
    expect(rowNote(pinned as never)).toBe('Pinned — keeps its look');
    // a tick can't land on a locked row
    expect(withTicks(rows, { [pinned?.path as string]: true }).find((r) => r.locked)?.ticked).toBe(
      false
    );
    const blocked = switchRows({
      canvases: [row('X', { state: 'blocked', ticked: false, reason: 'S2:foreign' })],
    });
    expect(rowNote(blocked[0])).toBe('Uses another system’s names — keeps its look');
    expect(
      rowNote(
        switchRows({
          canvases: [row('Y', { ticked: false, state: 'blocked', reason: 'ds-level-11' })],
        })[0]
      )
    ).toBe('Made before the schema — keeps its look');
  });

  test('from a system’s own menu only that system’s canvases start ticked', () => {
    const mixed = {
      canvases: [row('A'), row('B', { from: 'studio' }), row('C', { from: null })],
    };
    const rows = switchRows(mixed, { fromOnly: 'combine' });
    expect(rows.map((r) => r.ticked)).toEqual([true, false, false]);
  });

  test('words: the title asks with the verb the button repeats', () => {
    expect(switchTitle('Alligators brand')).toBe('Switch canvases to Alligators brand?');
    expect(primaryWords(5)).toBe('Switch 5 canvases');
    expect(primaryWords(1)).toBe('Switch 1 canvas');
    expect(primaryWords(0)).toBe('Switch no canvases');
    expect(switchedWords(5, 0, 'Alligators brand')).toBe(
      'Switched 5 canvases to Alligators brand.'
    );
    expect(switchedWords(4, 1, 'Alligators brand')).toBe(
      'Switched 4 canvases to Alligators brand. 1 left out keeps the old look.'
    );
  });

  test('scope: This canvas · Folder · Whole project; one field names it', () => {
    expect(scopeOptions({ canvas: 'a/b.tsx', folder: 'a' }).map((s) => s.label)).toEqual([
      'This canvas',
      'Folder · a',
      'Whole project',
    ]);
    expect(scopeOptions({}).map((s) => s.id)).toEqual(['all']);
    expect(defaultScope({ folder: 'a' })).toBe('folder');
    expect(defaultScope({ folder: '' })).toBe('all');
    expect(scopeFields('folder', { canvas: 'a/b.tsx', folder: 'a' })).toEqual({ folder: 'a' });
    expect(scopeFields('canvas', { canvas: 'a/b.tsx', folder: 'a' })).toEqual({
      canvas: 'a/b.tsx',
    });
    expect(scopeFields('all', { canvas: 'a/b.tsx' })).toEqual({ all: true });
  });

  test('the request body carries the system, the scope and every row that can tick', () => {
    const rows = withTicks(switchRows(REVIEW), { '2026/combine/Combine-cisla.tsx': false });
    const body = switchBody({ to: 'gator', scope: { folder: '2026/combine' }, rows });
    expect(body).toMatchObject({ to: 'gator', folder: '2026/combine' });
    expect(body.canvases).toHaveLength(5); // the pinned one is not sent
    expect(
      body.canvases.find((c: { path: string }) => c.path.endsWith('Combine-cisla.tsx'))
    ).toEqual({
      path: '2026/combine/Combine-cisla.tsx',
      ticked: false,
    });
  });

  test('the line over the AI row: both follow the schema, pairs by kind', () => {
    expect(schemaLine(REVIEW)).toEqual({
      tone: 'ok',
      text: 'Both follow the schema — core roles and components swap; the display ramp and illustration palette pair by kind.',
    });
    expect(schemaLine({ ...REVIEW, levels: { gator: 0, combine: 10 } }).tone).toBe('warn');
    expect(schemaLine({ ...REVIEW, pairing: { kinds: [] } }).text).toMatch(/swap\.$/);
  });

  test('AI restyle: what the ticked canvases own, from the server’s pins', () => {
    const s = restyleSummary(switchRows(REVIEW));
    expect(s).toMatchObject({ tokens: ['--x-camo', '--x-scute-height'], colours: 12, any: true });
    const w = restyleWords(s, { fromLabel: 'Combine 2026' });
    expect(w.title).toBe('AI restyles Combine 2026’s 2 own tokens');
    expect(w.sub).toBe(
      'camo, scute height · plus 12 colours picked by hand outside the system · your Claude account · one undo step'
    );
    // nothing of its own → no row
    expect(restyleSummary(switchRows({ canvases: [row('Plain')] })).any).toBe(false);
    // an unticked canvas's own tokens are not counted
    const rows = withTicks(switchRows(REVIEW), { '2026/combine/Combine-kampan.tsx': false });
    expect(restyleSummary(rows).colours).toBe(0);
    const brief = restyleBrief({ toLabel: 'Alligators brand', rows: switchRows(REVIEW) });
    expect(brief).toContain('Own tokens: --x-camo, --x-scute-height');
    expect(brief).toContain('- 2026/combine/Combine-kampan.tsx');
    expect(brief).not.toContain('Combine-video-AI'); // the pinned one stays
  });

  test('refusals are the person’s words', () => {
    expect(refusalWords('ds-level-11')).toBe(
      'Made before the schema. Bring it up to the schema first, then switch.'
    );
    expect(refusalWords('ds-kernel-unavailable')).toMatch(/back online/);
    expect(refusalWords('forbidden')).toMatch(/ask to edit/);
    expect(refusalWords('weird')).toBe('Not switched. Nothing changed; try again.');
  });
});

describe('the registry rows', () => {
  test('ds.switch is Can edit + cli; ds.preview is the one human row, open to anyone who can open the project', () => {
    const def = (id: string) => DS_ACTIONS.find((a) => a.id === id);
    expect(def('ds.switch')?.visible).toMatchObject({ minRole: 'edit' });
    expect(def('ds.preview')?.visible).toMatchObject({ minRole: 'view' });
    expect(AGENT_PATHS['ds.switch']).toMatchObject({
      effect: 'project',
      minRole: 'edit',
      server: { route: '/_api/ds/switch', method: 'POST' },
      agent: { path: 'cli' },
    });
    expect(AGENT_PATHS['ds.preview']).toMatchObject({
      effect: 'none',
      agent: { path: 'human', because: 'view-pref' },
    });
  });

  test('S10.13’s system menu picks both up once they are registered, and not before', () => {
    const rows = [
      { dsName: 'studio', systemLabel: 'Studio site', isDefault: true },
      { dsName: 'gator', systemLabel: 'Alligators brand' },
    ];
    const ids = (has: (id: string) => boolean) =>
      systemMenuItems({ row: rows[0], rows, canEdit: true, has }).map((i) => i.id);
    expect(ids(() => false)).not.toContain('switch');
    const registered = new Set(DS_ACTIONS.map((a) => a.id));
    expect(ids((id) => registered.has(id))).toEqual(
      expect.arrayContaining(['open', 'switch', 'preview'])
    );
    const items = systemMenuItems({
      row: rows[0],
      rows,
      canEdit: true,
      has: (id) => registered.has(id),
    });
    expect(items.find((i) => i.id === 'switch')?.action).toEqual({
      id: 'ds.switch',
      params: { from: 'studio' },
    });
    // a Can view session sees Preview (it writes nothing) but not Switch
    const view = systemMenuItems({
      row: rows[0],
      rows,
      canEdit: false,
      has: (id) => registered.has(id),
    });
    expect(view.map((i) => i.id)).toContain('preview');
    expect(view.map((i) => i.id)).not.toContain('switch');
  });
});

describe('the bus', () => {
  afterEach(resetDsSwitchBus);

  test('a request made before the host mounted waits and is handed over', () => {
    expect(requestDsSwitch({ from: 'studio' })).toBe(false);
    const seen: unknown[] = [];
    const off = onDsSwitchRequest((r: unknown) => seen.push(r));
    expect(seen).toEqual([{ kind: 'switch', from: 'studio' }]);
    expect(requestDsSwitch({ to: 'gator' })).toBe(true);
    off();
  });

  test('S10.16a’s done offers the existing canvases one quiet review of the whole project', () => {
    const seen: Record<string, unknown>[] = [];
    const off = onDsSwitchRequest((r: Record<string, unknown>) => seen.push(r));
    expect(finishedMaking({ system: 'forge', defaultSet: false })).toBe(false);
    expect(finishedMaking({ action: 'make' })).toBe(false);
    expect(finishedMaking({ system: 'forge', defaultSet: true })).toBe(true);
    expect(seen).toEqual([{ kind: 'switch', to: 'forge', scope: 'all', quiet: true }]);
    off();
  });
});

// ── the sheet and the bar ─────────────────────────────────────────────────────────────────────

let Sheet: typeof import('../client/v2/ds/switch-sheet.jsx').DsSwitchSheet;
let Bar: typeof import('../client/v2/ds/preview-bar.jsx').DsPreviewBar;
const roots: Root[] = [];
beforeAll(async () => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  Sheet = (await import('../client/v2/ds/switch-sheet.jsx')).DsSwitchSheet;
  Bar = (await import('../client/v2/ds/preview-bar.jsx')).DsPreviewBar;
});
afterAll(() => GlobalRegistrator.unregister());
afterEach(async () => {
  for (const r of roots.splice(0)) await act(async () => r.unmount());
  document.body.innerHTML = '';
  resetDsPreview();
});

const LABELS: Record<string, string> = {
  combine: 'Combine 2026',
  gator: 'Alligators brand',
  studio: 'Studio site',
};
type Calls = {
  switched: { rows: { path: string; ticked: boolean }[]; restyle: boolean }[];
  scopes: string[];
  closed: number;
};
async function mount(over: Record<string, unknown> = {}) {
  const calls: Calls = { switched: [], scopes: [], closed: 0 };
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () =>
    root.render(
      <Sheet
        review={REVIEW}
        to="gator"
        toLabel="Alligators brand"
        targets={Object.entries(LABELS).map(([name, label]) => ({ name, label }))}
        scope="folder"
        scopes={scopeOptions({ canvas: '2026/combine/Combine-kampan.tsx', folder: '2026/combine' })}
        labelOf={(n: string) => LABELS[n] ?? n}
        canAskAI={true}
        onScope={(id: string) => calls.scopes.push(id)}
        onTo={() => undefined}
        onSwitch={async (rows: never[], o: { restyle: boolean }) => {
          calls.switched.push({ rows, restyle: o.restyle });
          return { ok: true };
        }}
        onClose={() => {
          calls.closed++;
        }}
        {...over}
      />
    )
  );
  return { host, calls };
}
const q = (host: HTMLElement, id: string) =>
  host.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const all = (host: HTMLElement, id: string) => [
  ...host.querySelectorAll<HTMLElement>(`[data-testid="${id}"]`),
];
const click = async (el: Element | null) => {
  if (!el) throw new Error('missing element');
  await act(async () => {
    el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  });
};

describe('the sheet', () => {
  test('p8 c7: a row wears its canvas’s own picture when the host knows one, else the empty tile', async () => {
    const { host } = await mount({
      coverOf: (p: string) => (p.endsWith('Combine-kampan.tsx') ? '/_api/thumb/k1' : null),
    });
    const imgs = [...host.querySelectorAll<HTMLImageElement>('.dsr-row .dsr-thumb img')];
    expect(imgs.map((i) => i.getAttribute('src'))).toEqual(['/_api/thumb/k1']);
    expect(host.querySelectorAll('.dsr-row .dsr-thumb').length).toBe(6);
  });

  test('canvas 23: title, scope, head count, six rows, the schema line, the AI row, version history', async () => {
    const { host } = await mount();
    expect(q(host, 'ds-switch-title')?.textContent).toBe('Switch canvases to Alligators brand?');
    expect(all(host, 'ds-switch-scope-folder')[0].getAttribute('aria-pressed')).toBe('true');
    expect(q(host, 'ds-switch-scope-folder')?.textContent).toBe('Folder · 2026/combine');
    expect(q(host, 'ds-switch-head')?.textContent).toBe('5 of 5 canvases in 2026/combine');
    expect(all(host, 'ds-switch-row')).toHaveLength(6);
    expect(q(host, 'ds-switch-line')?.textContent).toContain('Both follow the schema');
    expect(q(host, 'ds-switch-ai-row')?.textContent).toContain(
      'AI restyles Combine 2026’s 2 own tokens'
    );
    expect(q(host, 'ds-switch-fine')?.textContent).toBe('Version history keeps the old look.');
    expect(q(host, 'ds-switch-go')?.textContent).toBe('Switch 5 canvases');
    expect(q(host, 'ds-switch-cancel')?.textContent).toBe('Cancel');
  });

  test('the pinned canvas says why and cannot be ticked', async () => {
    const { host } = await mount();
    const tick = host.querySelector<HTMLButtonElement>(
      '[data-testid="ds-switch-tick"][data-path="2026/combine/Combine-video-AI.tsx"]'
    ) as HTMLButtonElement;
    expect(tick.disabled).toBe(true);
    expect(tick.getAttribute('aria-checked')).toBe('false');
    const r = host.querySelector(
      '[data-path="2026/combine/Combine-video-AI.tsx"][data-testid="ds-switch-row"]'
    );
    expect(r?.querySelector('[data-testid="ds-switch-note"]')?.textContent).toBe(
      'Pinned — keeps its look'
    );
  });

  test('unticking a canvas updates the count, and Switch sends the ticks with the AI choice', async () => {
    const { host, calls } = await mount();
    await click(
      host.querySelector(
        '[data-testid="ds-switch-tick"][data-path="2026/combine/Combine-cisla.tsx"]'
      )
    );
    expect(q(host, 'ds-switch-go')?.textContent).toBe('Switch 4 canvases');
    await click(q(host, 'ds-switch-go'));
    expect(calls.switched).toHaveLength(1);
    expect(calls.switched[0].restyle).toBe(true);
    const sent = Object.fromEntries(
      calls.switched[0].rows.map((r) => [r.path.split('/').pop(), r.ticked])
    );
    expect(sent['Combine-cisla.tsx']).toBe(false);
    expect(sent['Combine-kampan.tsx']).toBe(true);
  });

  test('the AI row is a switch: off, the canvases keep their own look and Switch asks no AI', async () => {
    const { host, calls } = await mount();
    const sw = q(host, 'ds-switch-ai') as HTMLElement;
    expect(sw.getAttribute('aria-checked')).toBe('true');
    await click(sw);
    expect(sw.getAttribute('aria-checked')).toBe('false');
    expect(q(host, 'ds-switch-ai-row')?.textContent).toContain(
      'Own tokens keep their look, marked off-system.'
    );
    await click(q(host, 'ds-switch-go'));
    expect(calls.switched[0].restyle).toBe(false);
  });

  test('no AI available, or nothing of its own to restyle → no AI row', async () => {
    const { host: a } = await mount({ canAskAI: false });
    expect(q(a, 'ds-switch-ai-row')).toBeNull();
    const plain = { ...REVIEW, canvases: [row('Plain')] };
    const { host: b } = await mount({ review: plain });
    expect(q(b, 'ds-switch-ai-row')).toBeNull();
  });

  test('scope segments ask the host for another review', async () => {
    const { host, calls } = await mount();
    await click(q(host, 'ds-switch-scope-all'));
    await click(q(host, 'ds-switch-scope-canvas'));
    await click(q(host, 'ds-switch-scope-folder')); // already there: nothing to ask
    expect(calls.scopes).toEqual(['all', 'canvas']);
  });

  test('a refused switch (level 11) says why and cannot be sent', async () => {
    const refused = { ...REVIEW, refused: { code: 'ds-level-11', system: 'combine' } };
    const { host } = await mount({ review: refused });
    expect(q(host, 'ds-switch-refused')?.textContent).toBe(
      'Made before the schema. Bring it up to the schema first, then switch.'
    );
    expect((q(host, 'ds-switch-go') as HTMLButtonElement).disabled).toBe(true);
    expect(q(host, 'ds-switch-ai-row')).toBeNull();
  });

  test('a refusal from the server is printed under the list, in words', async () => {
    const { host } = await mount({
      onSwitch: async () => ({
        ok: false,
        message: 'Not switched. You can look here; ask to edit.',
      }),
    });
    await click(q(host, 'ds-switch-go'));
    expect(q(host, 'ds-switch-error')?.textContent).toBe(
      'Not switched. You can look here; ask to edit.'
    );
  });

  test('many canvases group by folder with a tick on the folder', async () => {
    const many = {
      ...REVIEW,
      canvases: Array.from({ length: 14 }, (_, i) => row(`c${i}`, { folder: i < 8 ? 'a' : 'b' })),
    };
    const { host } = await mount({ review: many });
    expect(all(host, 'ds-switch-folder')).toHaveLength(2);
    await click(all(host, 'ds-switch-folder-tick')[0]);
    expect(q(host, 'ds-switch-go')?.textContent).toBe('Switch 6 canvases');
  });
});

describe('the preview bar', () => {
  async function mountBar(onSwitch: (t: string) => void) {
    const session = beginDsPreview({ from: 'studio', systems: ['studio', 'combine', 'gator'] });
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    const render = async () =>
      act(async () =>
        root.render(
          <Bar
            session={getDsPreview() ?? (session as never)}
            labelOf={(n: string) => LABELS[n] ?? n}
            shown={5}
            onSwitch={onSwitch}
          />
        )
      );
    await render();
    return { host, render };
  }
  const key = async (el: Element | null, k: string) =>
    act(async () => {
      el?.dispatchEvent(
        new window.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true })
      );
    });

  test('canvas 18: the menu lists the systems, the banner says what is previewed and how to stop', async () => {
    const { host } = await mountBar(() => undefined);
    expect(all(host, 'ds-preview-option').map((o) => o.getAttribute('data-ds'))).toEqual([
      'studio',
      'combine',
      'gator',
    ]);
    expect(q(host, 'ds-preview-banner')?.textContent).toContain(
      'Previewing Studio site in Combine 2026.'
    );
    expect(q(host, 'ds-preview-banner')?.textContent).toContain(
      '5 canvases shown in it · esc to stop'
    );
    expect(q(host, 'ds-preview-switch')?.textContent).toBe('Switch…');
    const menu = q(host, 'ds-preview-menu') as HTMLElement;
    expect(menu.getAttribute('role')).toBe('listbox');
    expect(document.activeElement).toBe(menu);
  });

  test('↑↓ step (and re-render the banner), ↵ opens the review for the highlighted system, esc stops', async () => {
    const switched: string[] = [];
    const { host, render } = await mountBar((t) => switched.push(t));
    const menu = q(host, 'ds-preview-menu');
    await key(menu, 'ArrowDown');
    expect(getDsPreview()?.target).toBe('gator');
    await render();
    expect(q(host, 'ds-preview-banner')?.textContent).toContain('in Alligators brand.');
    await key(menu, 'ArrowUp');
    await key(menu, 'ArrowUp');
    expect(getDsPreview()?.target).toBe('studio');
    await key(menu, 'ArrowDown');
    await render(); // the host re-renders the bar from the store
    await key(menu, 'Enter');
    expect(switched).toEqual(['combine']);
    await key(menu, 'Escape');
    expect(getDsPreview()).toBeNull();
  });

  test('esc stops it from anywhere, but not while a sheet is open', async () => {
    const session = beginDsPreview({ from: 'studio', systems: ['studio', 'gator'] });
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    const draw = (blocked: boolean) =>
      act(async () =>
        root.render(
          <Bar
            session={session as never}
            labelOf={(n: string) => n}
            shown={0}
            blocked={blocked}
            onSwitch={() => undefined}
          />
        )
      );
    await draw(true);
    await act(async () => {
      window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(getDsPreview()).not.toBeNull();
    await draw(false);
    await act(async () => {
      window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(getDsPreview()).toBeNull();
  });

  test('a click on a system also works; the banner carries ONE action (CONTRACT §4) — esc is the way out', async () => {
    const { host } = await mountBar(() => undefined);
    await click(all(host, 'ds-preview-option')[2]);
    expect(getDsPreview()?.target).toBe('gator');
    expect(q(host, 'ds-preview-stop')).toBeNull();
    expect(q(host, 'ds-preview-banner')?.querySelectorAll('button').length).toBe(1);
    // the menu's foot: the way out to the Design system, to making one and to linking a team library
    expect(all(host, 'ds-preview-door').map((d) => d.getAttribute('data-door'))).toEqual([
      'open',
      'make',
      'link',
    ]);
    await act(async () => {
      window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(getDsPreview()).toBeNull();
  });
});
