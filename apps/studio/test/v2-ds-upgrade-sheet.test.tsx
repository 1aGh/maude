// S10.15b (13 · ds-multi-schema) — "Bring <system> up to the schema?". The model is pure (the four lines, the faces,
// the words, the brief); the sheet and the host are real markup against a fake server that says what the real one
// says (the real server answers are pinned in ds-upgrade-sheet-flow.test.ts). Pinned here: the pre-schema system
// opens the dialog with the canvas's words; "✦ Bring it up" hands the AI a brief with origin `ds-upgrade` and the
// sheet waits for the stage; the check shows its progress and Cancel stops it; a proved stage shows the review and
// its primary applies it; a converted system is said in words; the switch sheet's level-11 refusal and the amber dot
// both lead here.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { AGENT_PATHS } from '../actions/agents.ts';
import { DS_ACTIONS } from '../actions/defs/ds.ts';
import { systemMenuItems } from '../client/v2/ds/system-menu.jsx';
import {
  onDsUpgradeRequest,
  requestDsUpgrade,
  resetDsUpgradeBus,
} from '../client/v2/ds/upgrade-bus.js';
import {
  appliedWords,
  pickStage,
  previewLines,
  progressFraction,
  refusalWords,
  refusedLine,
  reviewLines,
  roleLabel,
  UPGRADE_WORDS,
  upgradeBrief,
  upgradeTitle,
  viewOf,
} from '../client/v2/ds/upgrade-model.js';
import { bindPaletteEnv } from '../client/v2/search/search-env.js';

const PLAN = {
  format: 'maude.ds-upgrade-plan',
  v: 1,
  system: 'combine',
  registry: 1,
  items: [
    {
      id: 'alias:--w-semibold',
      kind: 'invert-alias',
      status: 'mechanical',
      v1: '--weight-semibold',
    },
    {
      id: 'own:--camo',
      kind: 'prefix-own',
      status: 'mechanical',
      native: '--camo',
      as: '--x-camo',
    },
    {
      id: 'own:--scute',
      kind: 'prefix-own',
      status: 'mechanical',
      native: '--scute',
      as: '--x-scute',
    },
    { id: 'role:--on-accent', kind: 'add-role', status: 'needs-judgement' },
    { id: 'role:--scrim', kind: 'add-role', status: 'needs-judgement' },
    { id: 'manifests', kind: 'emit-manifests', status: 'mechanical' },
  ],
};
const REVIEW = {
  format: 'maude.ds-upgrade-review',
  v: 1,
  system: 'combine',
  stamp: '111',
  provedAt: 1,
  systemFailed: false,
  addsRoles: [
    { name: '--on-accent', label: null, sources: ['--accent'], contrast: null },
    { name: '--scrim', label: null, sources: ['--fg-0'], contrast: null },
  ],
  renamesComponents: [
    { from: 'Tlačítko kampaň', to: 'Button', variantsKept: ['Plné'] },
    { from: 'Štítek kampaň', to: 'Tag', variantsKept: [] },
  ],
  keepsOwn: [
    { native: '--camo', as: '--x-camo' },
    { native: '--scute', as: '--x-scute' },
  ],
  updatesCanvases: [
    ...[1, 2, 3, 4, 5].map((n) => ({ path: `2026/combine/C${n}.tsx`, edits: 3, diff: 'pass' })),
    { path: '2026/combine/Combine-invite.tsx', edits: 2, diff: 'fail' },
  ],
  refused: [{ path: '2026/combine/Combine-invite.tsx', reason: 'visual' }],
  needsPick: [],
};
const stage = (over: Record<string, unknown> = {}) => ({
  stamp: '111',
  createdAt: 1,
  phase: 'proved',
  canvases: 6,
  conformantAfter: true,
  progress: null,
  review: REVIEW,
  stale: false,
  ...over,
});

describe('the model', () => {
  test('role names read as words', () => {
    expect(roleLabel('--on-accent')).toBe('On accent');
    expect(roleLabel('--scrim')).toBe('Scrim');
    expect(roleLabel('')).toBe('');
  });

  test('before the run: the canvas’s lines from the mechanical plan', () => {
    const lines = previewLines(PLAN, { label: 'Combine 2026', canvases: 6 });
    expect(lines.map((l) => l.kind)).toEqual(['roles', 'components', 'own', 'canvases']);
    expect(lines[0]).toMatchObject({
      title: 'Adds 2 roles',
      detail: 'On accent, Scrim — from Combine 2026’s own colours and type',
    });
    expect(lines[2].title).toBe('Keeps 2 own tokens');
    expect(lines[2].detail).toBe('Camo, Scute — named as its own, so a switch hands them to AI');
    expect(lines[3]).toMatchObject({
      title: 'Updates 6 canvases',
      detail: 'They point at the new names; nothing looks different',
    });
    // a system that lacks no role and owns nothing: only what happens is drawn
    const bare = previewLines({ items: [] }, { label: 'X', canvases: 1 });
    expect(bare.map((l) => l.kind)).toEqual(['components', 'canvases']);
    expect(bare[1].title).toBe('Updates 1 canvas');
  });

  test('after the proof: the same four lines, from review.json', () => {
    const lines = reviewLines(REVIEW, { label: 'Combine 2026' });
    expect(lines.map((l) => l.title)).toEqual([
      'Adds 2 roles',
      'Renames 2 components',
      'Keeps 2 own tokens',
      'Updates 5 canvases',
    ]);
    expect(lines[1].detail).toBe(
      'Tlačítko kampaň → Button · Štítek kampaň → Tag, variants and names kept'
    );
  });

  test('"N canvases can’t be updated yet" counts distinct canvases; nothing refused → no line', () => {
    expect(refusedLine(REVIEW)).toMatchObject({
      count: 1,
      text: '1 canvas can’t be updated yet',
      paths: ['2026/combine/Combine-invite.tsx'],
    });
    const two = {
      refused: [
        { path: 'a.tsx', reason: 'visual' },
        { path: 'a.tsx', reason: 'V6' },
        { path: 'b.tsx', reason: 'render' },
      ],
    };
    expect(refusedLine(two)?.text).toBe('2 canvases can’t be updated yet');
    expect(refusedLine({ refused: [] })).toBeNull();
  });

  test('the face follows the stage: proving > proved > staged; converted wins over all', () => {
    const base = { label: 'Combine 2026', canvases: 6, plan: PLAN, canAskAI: true };
    expect(viewOf({ ...base, status: { stages: [] } })).toMatchObject({
      kind: 'ask',
      canAsk: true,
    });
    expect(viewOf({ ...base, status: { stages: [] }, canAskAI: false })).toMatchObject({
      kind: 'ask',
      canAsk: false,
    });
    expect(viewOf({ ...base, status: { stages: [] }, asked: true })).toEqual({
      kind: 'working',
      step: 'waiting',
    });
    expect(
      viewOf({ ...base, status: { stages: [stage({ phase: 'staged', review: null })] } })
    ).toEqual({
      kind: 'working',
      step: 'staged',
      stamp: '111',
    });
    const proving = stage({
      stamp: '222',
      phase: 'proving',
      review: null,
      progress: { phase: 'rendering', current: 2, total: 6 },
    });
    expect(viewOf({ ...base, status: { stages: [stage(), proving] } })).toEqual({
      kind: 'proving',
      stamp: '222',
      current: 2,
      total: 6,
    });
    const review = viewOf({ ...base, status: { stages: [stage()] } });
    expect(review).toMatchObject({ kind: 'review', stamp: '111', blocker: null, updated: 5 });
    expect(viewOf({ ...base, status: { converted: true, stages: [stage()] } })).toEqual({
      kind: 'converted',
    });
    expect(pickStage([])).toBeNull();
  });

  test('a proved stage that cannot be applied says why', () => {
    const base = { label: 'X', canvases: 1, plan: PLAN };
    const blocker = (over: Record<string, unknown>, rev: Record<string, unknown> = {}) =>
      (
        viewOf({
          ...base,
          status: { stages: [stage({ ...over, review: { ...REVIEW, ...rev } })] },
        }) as { blocker: string | null }
      ).blocker;
    expect(blocker({}, { systemFailed: true })).toBe(UPGRADE_WORDS.systemFailed);
    expect(blocker({ stale: true })).toBe(UPGRADE_WORDS.stale);
    expect(blocker({}, { needsPick: ['palette'] })).toBe(UPGRADE_WORDS.needsPick);
  });

  test('the brief names the slash command, the verbs, and stops before --apply', () => {
    const b = upgradeBrief({ ds: 'combine', label: 'Combine 2026' });
    expect(b).toContain('/design:setup-ds combine --upgrade-schema');
    expect(b).toContain('maude design ds-upgrade analyse combine');
    expect(b).toContain('--stage');
    expect(b).toContain('--prove');
    expect(b).toMatch(/Do not run --apply/);
  });

  test('words: title asks with the verb the button repeats; refusals; the toast', () => {
    expect(upgradeTitle('Combine 2026')).toBe('Bring Combine 2026 up to the schema?');
    expect(UPGRADE_WORDS.go).toBe('Bring it up');
    expect(refusalWords('ds-upgrade-converted', 'Combine 2026')).toMatch(/Design system canvas/);
    expect(refusalWords('ds-upgrade-stale')).toBe(UPGRADE_WORDS.stale);
    expect(refusalWords('ds-kernel-unavailable')).toMatch(/back online/);
    expect(refusalWords('forbidden')).toMatch(/ask to edit/);
    expect(refusalWords('weird')).toBe('Nothing changed; try again.');
    expect(appliedWords({ updated: 5, refused: 1 }, 'Combine 2026')).toBe(
      'Brought Combine 2026 up to the schema. 5 canvases updated; 1 can’t be updated yet.'
    );
    expect(appliedWords({ updated: 1, refused: 0 }, 'X')).toBe(
      'Brought X up to the schema. 1 canvas updated.'
    );
    expect(progressFraction(2, 6)).toBeCloseTo(1 / 3);
    expect(progressFraction(0, 0)).toBe(0);
    expect(progressFraction(9, 6)).toBe(1);
  });
});

describe('the registry, the menu and the bus', () => {
  test('ds.upgrade is Can edit with the route and the verb as its agent path', () => {
    expect(DS_ACTIONS.find((a) => a.id === 'ds.upgrade')?.visible).toMatchObject({
      minRole: 'edit',
    });
    expect(AGENT_PATHS['ds.upgrade']).toMatchObject({
      minRole: 'edit',
      server: { route: '/_api/ds/upgrade', method: 'POST' },
      agent: { path: 'cli' },
    });
  });

  test('a system with the amber dot offers "Bring it up to the schema…" in its menu; a clean one does not', () => {
    const has = (id: string) => DS_ACTIONS.some((a) => a.id === id);
    const old = {
      dsName: 'combine',
      systemLabel: 'Combine 2026',
      amber: { title: 'Made before the schema' },
    };
    const fine = { dsName: 'gator', systemLabel: 'Alligators brand' };
    const items = systemMenuItems({ row: old, rows: [old, fine], canEdit: true, has });
    expect(items.find((i) => i.id === 'upgrade')).toMatchObject({
      label: 'Bring it up to the schema…',
      action: { id: 'ds.upgrade', params: { ds: 'combine' } },
    });
    expect(
      systemMenuItems({ row: fine, rows: [old, fine], canEdit: true, has }).map((i) => i.id)
    ).not.toContain('upgrade');
    // Can view never sees it (the server refuses every step anyway)
    expect(
      systemMenuItems({ row: old, rows: [old, fine], canEdit: false, has }).map((i) => i.id)
    ).not.toContain('upgrade');
  });

  test('the bus hands a request made before the host mounted over, and ignores a nameless one', () => {
    resetDsUpgradeBus();
    expect(requestDsUpgrade({ ds: '' })).toBe(false);
    expect(requestDsUpgrade({ ds: 'combine' })).toBe(false);
    const seen: unknown[] = [];
    const off = onDsUpgradeRequest((r: unknown) => seen.push(r));
    expect(seen).toEqual([{ ds: 'combine' }]);
    expect(requestDsUpgrade({ ds: 'gator' })).toBe(true);
    off();
    resetDsUpgradeBus();
  });
});

// ── the sheet, the host and the doors ─────────────────────────────────────────────────────────

let Host: typeof import('../client/v2/ds/upgrade-host.jsx').DsUpgradeHost;
let Pinned: typeof import('../client/v2/left-panel/canvases-pinned.jsx').DsPinnedRows;
let SwitchSheet: typeof import('../client/v2/ds/switch-sheet.jsx').DsSwitchSheet;
const roots: Root[] = [];
beforeAll(async () => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  Host = (await import('../client/v2/ds/upgrade-host.jsx')).DsUpgradeHost;
  Pinned = (await import('../client/v2/left-panel/canvases-pinned.jsx')).DsPinnedRows;
  SwitchSheet = (await import('../client/v2/ds/switch-sheet.jsx')).DsSwitchSheet;
});
afterAll(() => GlobalRegistrator.unregister());

let unbind: () => void = () => {};
const asked: { text: string; opts: unknown }[] = [];
beforeEach(async () => {
  asked.length = 0;
  resetDsUpgradeBus();
  (await import('../client/v2/ds/upgrade-host.jsx')).resetUpgradeAsked();
  unbind = bindPaletteEnv({
    canAskAI: () => true,
    askAI: (text: string, opts: unknown) => asked.push({ text, opts }),
  });
});
afterEach(async () => {
  unbind();
  for (const r of roots.splice(0)) await act(async () => r.unmount());
  document.body.innerHTML = '';
  resetDsUpgradeBus();
});

const CFG = {
  designSystems: [
    { name: 'combine', label: 'Combine 2026' },
    { name: 'gator', label: 'Alligators brand' },
  ],
  canvasDesignSystems: Object.fromEntries(
    [1, 2, 3, 4, 5, 6].map((n) => [`2026/combine/C${n}.tsx`, 'combine'])
  ),
};

/** A fake of `POST /_api/ds/upgrade`: it answers like the real steps and records every body. */
function backend(init: Record<string, unknown> = {}) {
  const s = {
    converted: false,
    stages: [] as Record<string, unknown>[],
    calls: [] as Record<string, unknown>[],
    fail: null as { status: number; code: string } | null,
    apply: { status: 200, body: { updated: 5, refused: 1, schema: 1 } as Record<string, unknown> },
    ...init,
  };
  const fetchImpl = (async (_url: string, req: RequestInit) => {
    const body = JSON.parse(String(req.body));
    s.calls.push(body);
    if (s.fail) return Response.json({ code: s.fail.code }, { status: s.fail.status });
    switch (body.step) {
      case 'status':
        return Response.json({
          ds: body.ds,
          converted: s.converted,
          schema: null,
          stages: s.stages,
        });
      case 'analyse':
        return Response.json(PLAN);
      case 'apply':
        return Response.json(s.apply.body, { status: s.apply.status });
      case 'cancel':
        return Response.json({ cancelled: body.stage, stopped: true });
      case 'discard':
        s.stages = [];
        return Response.json({ discarded: body.stage });
      default:
        return Response.json({ code: 'usage' }, { status: 400 });
    }
  }) as unknown as typeof fetch;
  return { s, fetchImpl };
}

const q = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const qa = (id: string) => [...document.querySelectorAll<HTMLElement>(`[data-testid="${id}"]`)];
const click = async (el: Element | null) => {
  if (!el) throw new Error('missing element');
  await act(async () => {
    el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  });
};
const waitFor = async (ok: () => boolean, ms = 2000) => {
  const t = Date.now();
  while (!ok() && Date.now() - t < ms)
    await act(async () => {
      await new Promise((r) => setTimeout(r, 15));
    });
  expect(ok()).toBe(true);
};
async function mountHost(fetchImpl: typeof fetch, toasts: string[] = [], pollMs = 20) {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () =>
    root.render(
      <Host cfg={CFG} toast={(m: string) => toasts.push(m)} fetchImpl={fetchImpl} pollMs={pollMs} />
    )
  );
}
const open = async (ds = 'combine') => {
  await act(async () => {
    requestDsUpgrade({ ds });
  });
};

describe('the dialog (canvas 22)', () => {
  test('a pre-schema system opens it: the title, the lead, the four lines, the fine print, "✦ Bring it up"', async () => {
    const { fetchImpl } = backend();
    await mountHost(fetchImpl);
    await open();
    await waitFor(() => q('ds-upgrade') !== null);
    expect(q('ds-upgrade')?.getAttribute('data-view')).toBe('ask');
    expect(q('ds-upgrade-title')?.textContent).toBe('Bring Combine 2026 up to the schema?');
    expect(q('ds-upgrade-lead')?.textContent).toBe(
      'Combine 2026 was made before the schema. Until it does, canvases can’t switch to or from it cleanly.'
    );
    expect(qa('ds-upgrade-line').map((l) => l.querySelector('b')?.textContent)).toEqual([
      'Adds 2 roles',
      'Renames its components',
      'Keeps 2 own tokens',
      'Updates 6 canvases',
    ]);
    expect(q('ds-upgrade-fine')?.textContent).toBe(
      'Nothing on the 6 canvases changes how it looks. Uses your Claude account.'
    );
    expect(q('ds-upgrade-go')?.textContent).toBe('✦ Bring it up');
    expect(q('ds-upgrade-cancel')?.textContent).toBe('Cancel');
  });

  test('"✦ Bring it up" hands the AI the brief with origin ds-upgrade, then waits for the stage', async () => {
    const b = backend();
    await mountHost(b.fetchImpl);
    await open();
    await waitFor(() => q('ds-upgrade') !== null);
    await click(q('ds-upgrade-go'));
    expect(asked).toHaveLength(1);
    expect(asked[0].opts).toEqual({ send: true, origin: 'ds-upgrade' });
    expect(asked[0].text).toContain('/design:setup-ds combine --upgrade-schema');
    await waitFor(() => q('ds-upgrade')?.getAttribute('data-view') === 'working');
    expect(q('ds-upgrade-working')?.textContent).toContain('AI is bringing it up');
    // the AI stages, then proves: the dialog follows without being asked again
    b.s.stages = [stage({ phase: 'staged', review: null })];
    await waitFor(() => q('ds-upgrade-working')?.textContent?.includes('Plan made') === true);
    b.s.stages = [
      stage({
        phase: 'proving',
        review: null,
        progress: { phase: 'rendering', current: 2, total: 6 },
      }),
    ];
    await waitFor(() => q('ds-upgrade')?.getAttribute('data-view') === 'proving');
    expect(q('ds-upgrade-progress')?.getAttribute('data-current')).toBe('2');
    expect(q('ds-upgrade-progress')?.getAttribute('data-total')).toBe('6');
    expect(q('ds-upgrade-progress-words')?.textContent).toBe(
      '2 of 6 canvases checked, in every theme'
    );
    b.s.stages = [stage()];
    await waitFor(() => q('ds-upgrade')?.getAttribute('data-view') === 'review');
    expect(qa('ds-upgrade-line').map((l) => l.querySelector('b')?.textContent)).toEqual([
      'Adds 2 roles',
      'Renames 2 components',
      'Keeps 2 own tokens',
      'Updates 5 canvases',
    ]);
    expect(q('ds-upgrade-refused')?.textContent).toBe('1 canvas can’t be updated yet');
    expect(q('ds-upgrade-go')?.textContent).toBe('Bring it up');
    expect((q('ds-upgrade-go') as HTMLButtonElement).disabled).toBe(false);
  });

  test('closing and reopening while the AI works does not ask twice (it finds the job again)', async () => {
    const b = backend();
    await mountHost(b.fetchImpl);
    await open();
    await waitFor(() => q('ds-upgrade') !== null);
    await click(q('ds-upgrade-go'));
    await act(async () => {
      document
        .querySelector('[data-testid="ds-upgrade"]')
        ?.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    await waitFor(() => q('ds-upgrade') === null);
    await open();
    await waitFor(() => q('ds-upgrade') !== null);
    expect(q('ds-upgrade')?.getAttribute('data-view')).toBe('working');
    expect(asked).toHaveLength(1);
    // nothing was put back: closing is not cancelling
    expect(b.s.calls.some((c) => c.step === 'discard' || c.step === 'cancel')).toBe(false);
  });

  test('Cancel during the check stops it, puts the stage back and closes', async () => {
    const b = backend({
      stages: [
        stage({
          phase: 'proving',
          review: null,
          progress: { phase: 'rendering', current: 1, total: 6 },
        }),
      ],
    });
    const toasts: string[] = [];
    await mountHost(b.fetchImpl, toasts);
    await open();
    await waitFor(() => q('ds-upgrade')?.getAttribute('data-view') === 'proving');
    await click(q('ds-upgrade-cancel'));
    await waitFor(() => q('ds-upgrade') === null);
    expect(b.s.calls.filter((c) => c.step === 'cancel' || c.step === 'discard')).toEqual([
      { ds: 'combine', step: 'cancel', stage: '111' },
      { ds: 'combine', step: 'discard', stage: '111' },
    ]);
    expect(toasts).toEqual([UPGRADE_WORDS.discarded]);
  });

  test('the primary button applies the proved stage once and says what landed', async () => {
    const b = backend({ stages: [stage()] });
    const toasts: string[] = [];
    await mountHost(b.fetchImpl, toasts);
    await open();
    await waitFor(() => q('ds-upgrade')?.getAttribute('data-view') === 'review');
    await click(q('ds-upgrade-go'));
    await waitFor(() => q('ds-upgrade') === null);
    expect(b.s.calls.filter((c) => c.step === 'apply')).toEqual([
      { ds: 'combine', step: 'apply', stage: '111' },
    ]);
    expect(toasts).toEqual([
      'Brought Combine 2026 up to the schema. 5 canvases updated; 1 can’t be updated yet.',
    ]);
  });

  test('a refusal stays in the dialog in words; a stale or failed stage cannot be applied at all', async () => {
    const b = backend({ stages: [stage()] });
    b.s.apply = { status: 409, body: { code: 'ds-upgrade-stale' } };
    await mountHost(b.fetchImpl);
    await open();
    await waitFor(() => q('ds-upgrade')?.getAttribute('data-view') === 'review');
    await click(q('ds-upgrade-go'));
    await waitFor(() => q('ds-upgrade-error') !== null);
    expect(q('ds-upgrade-error')?.textContent).toBe(UPGRADE_WORDS.stale);
    expect(q('ds-upgrade')).not.toBeNull();
  });

  test('a stage the project has moved past cannot be applied', async () => {
    const b = backend({ stages: [stage({ stale: true })] });
    await mountHost(b.fetchImpl);
    await open();
    await waitFor(() => q('ds-upgrade-blocker') !== null);
    expect(q('ds-upgrade-blocker')?.textContent).toBe(UPGRADE_WORDS.stale);
    expect((q('ds-upgrade-go') as HTMLButtonElement).disabled).toBe(true);
  });

  test('a proved stage with a system-file change showing has no way to apply', async () => {
    const b = backend({ stages: [stage({ review: { ...REVIEW, systemFailed: true } })] });
    await mountHost(b.fetchImpl);
    await open();
    await waitFor(() => q('ds-upgrade-blocker') !== null);
    expect(q('ds-upgrade-blocker')?.textContent).toBe(UPGRADE_WORDS.systemFailed);
    expect((q('ds-upgrade-go') as HTMLButtonElement).disabled).toBe(true);
  });

  test('a converted system is said in words: nothing to press but Close', async () => {
    const b = backend({ converted: true });
    await mountHost(b.fetchImpl);
    await open();
    await waitFor(() => q('ds-upgrade') !== null);
    expect(q('ds-upgrade')?.getAttribute('data-view')).toBe('converted');
    expect(q('ds-upgrade-converted')?.textContent).toBe(
      'Combine 2026 is on a Design system canvas, and Bring it up can’t update those yet. It keeps working as it is — nothing here changes.'
    );
    expect(q('ds-upgrade-go')).toBeNull();
    expect(q('ds-upgrade-cancel')?.textContent).toBe('Close');
    // the plan was not even asked for
    expect(b.s.calls.map((c) => c.step)).toEqual(['status']);
    await click(q('ds-upgrade-cancel'));
    expect(q('ds-upgrade')).toBeNull();
  });

  test('no AI to ask (a browser tab): the button is off and the Claude Code command is named', async () => {
    unbind();
    unbind = bindPaletteEnv({ canAskAI: () => false, askAI: () => undefined });
    const b = backend();
    await mountHost(b.fetchImpl);
    await open();
    await waitFor(() => q('ds-upgrade') !== null);
    expect((q('ds-upgrade-go') as HTMLButtonElement).disabled).toBe(true);
    expect(q('ds-upgrade-no-ai')?.textContent).toContain(
      '/design:setup-ds <system> --upgrade-schema'
    );
  });

  test('Can view: the server says 403 and the person gets a word, not a dialog', async () => {
    const b = backend({ fail: { status: 403, code: 'forbidden' } });
    const toasts: string[] = [];
    await mountHost(b.fetchImpl, toasts);
    await open();
    await waitFor(() => toasts.length > 0);
    expect(toasts).toEqual([UPGRADE_WORDS.forbidden]);
    expect(q('ds-upgrade')).toBeNull();
  });

  test('a name no system has opens nothing and asks nothing', async () => {
    const b = backend();
    await mountHost(b.fetchImpl);
    await open('nope');
    await act(async () => new Promise((r) => setTimeout(r, 30)));
    expect(q('ds-upgrade')).toBeNull();
    expect(b.s.calls).toEqual([]);
  });
});

describe('the doors', () => {
  test('the amber dot opens it; the rest of the row still opens the system', async () => {
    const opened: string[] = [];
    const brought: string[] = [];
    const rows = [
      {
        dsName: 'combine',
        label: 'Combine 2026',
        sub: '6 canvases',
        amber: { title: 'Made before the schema' },
      },
      { dsName: 'gator', label: 'Alligators brand', sub: '87 canvases · default' },
    ];
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () =>
      root.render(
        <Pinned
          rows={rows}
          onOpen={(ds: string) => opened.push(ds)}
          onBringUp={(ds: string) => brought.push(ds)}
        />
      )
    );
    const dot = q('canvases-ds-row-warn');
    expect(dot?.getAttribute('data-act')).toBe('bring-up');
    await click(dot);
    expect(brought).toEqual(['combine']);
    expect(opened).toEqual([]);
    await click(qa('canvases-ds-row')[0]);
    expect(opened).toEqual(['combine']);
    await click(qa('canvases-ds-row')[1]);
    expect(opened).toEqual(['combine', 'gator']);
    expect(brought).toEqual(['combine']);
  });

  test('without onBringUp (Can view) the dot is only a mark and a click opens the system', async () => {
    const opened: string[] = [];
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () =>
      root.render(
        <Pinned
          rows={[
            {
              dsName: 'combine',
              label: 'Combine 2026',
              amber: { title: 'Made before the schema' },
            },
          ]}
          onOpen={(ds: string) => opened.push(ds)}
        />
      )
    );
    expect(q('canvases-ds-row-warn')?.getAttribute('data-act')).toBeNull();
    await click(q('canvases-ds-row-warn'));
    expect(opened).toEqual(['combine']);
  });

  test('the switch sheet’s level-11 refusal carries a "Bring it up" button for the system that is old', async () => {
    const brought: string[] = [];
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    const review = {
      canvases: [],
      pairing: { kinds: [] },
      levels: { gator: 0, combine: 11 },
      refused: { code: 'ds-level-11', system: 'combine' },
    };
    await act(async () =>
      root.render(
        <SwitchSheet
          review={review}
          to="gator"
          toLabel="Alligators brand"
          targets={[]}
          scope="all"
          scopes={[{ id: 'all', label: 'Whole project' }]}
          labelOf={(n: string) => n}
          onScope={() => undefined}
          onTo={() => undefined}
          onSwitch={async () => ({ ok: true })}
          onClose={() => undefined}
          onBringUp={(ds: string) => brought.push(ds)}
        />
      )
    );
    expect(q('ds-switch-refused')?.textContent).toContain('Bring it up to the schema first');
    const btn = q('ds-switch-bring-up');
    expect(btn?.textContent).toBe('Bring it up');
    expect(btn?.getAttribute('data-ds')).toBe('combine');
    await click(btn);
    expect(brought).toEqual(['combine']);
    // the switch itself stays impossible
    expect((q('ds-switch-go') as HTMLButtonElement).disabled).toBe(true);
  });
});
