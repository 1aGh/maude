// S10.17 (13 · ds-edge-contrast, ds-edge-trash, ds-edge-suggest) — the client half. The words and the small decisions
// are pure (edge-model.js); the writers send exactly one request each; the three surfaces are real markup: the
// contrast warning inside the token inspector ("Lighten to 4.5:1", "Falls short in 3 canvases · Show"), the trash
// sheet ("40 canvases use it … switch to …"), and the quiet off-system question ("Use Accent" / "Add it to the
// system"). Only fetch and the panel's writers are faked; the server half is ds-edges.test.ts / ds-use-nearest.test.ts.
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { AGENT_PATHS } from '../actions/agents.ts';
import { DS_ACTIONS } from '../actions/defs/ds.ts';
import {
  EDGE_WORDS,
  edgeWords,
  findingKey,
  fixOffer,
  nextFinding,
  offSystemWords,
  shortWords,
  trashWords,
} from '../client/v2/ds/edge-model.js';
import {
  addColourNow,
  applyNearestNow,
  fetchOffSystem,
  fetchTrashQuestion,
  fixContrastNow,
  trashTokenNow,
} from '../client/v2/ds/edge-write.js';

const tok = (css: string, label: string, light: string, dark: string, extra = {}) => ({
  css,
  section: 'colour',
  group: 'accent',
  kind: 'color',
  label,
  valueNames: {},
  locked: false,
  darkFollows: null,
  values: { light, dark },
  used: null,
  pending: null,
  ...extra,
});
// a pale Accent under white text: 'Text on accent' falls short in Light
const MODEL = () => ({
  format: 'maude.ds-board',
  v: 1,
  system: 'studio',
  label: 'Studio',
  rootClass: 'studio',
  themes: { all: ['light', 'dark'], default: 'light', light: 'light', dark: 'dark' },
  converted: true,
  tokens: [
    tok('--bg-0', 'Page', '#ffffff', '#111111'),
    tok('--accent', 'Accent', 'oklch(0.80 0.1 255)', 'oklch(0.60 0.175 255)', { used: 3 }),
    tok('--accent-fg', 'Text on accent', '#ffffff', '#0a0a0a'),
  ],
  typeRoles: [],
  components: [],
  logos: [],
  pendingCount: 0,
  canvases: 5,
});

describe('the edge model', () => {
  test('canvas 26: the fix names the bar and the direction; nothing to offer when lightness cannot do it', () => {
    const m = MODEL();
    const fails = [{ theme: 'light', other: '--accent-fg', ratio: 2.1, need: 4.5 }];
    const offer = fixOffer(m, '--accent', fails);
    expect(offer?.label).toBe('Darken to 4.5:1'); // a pale surface under white text moves away from it
    expect(offer?.themes).toEqual(['light']);
    expect(fixOffer(m, '--accent', [])).toBeNull();
    // text that must be read on both a dark and a light surface cannot be fixed by lightness alone
    const stuck = {
      ...m,
      tokens: [
        tok('--bg-0', 'A', '#000000', '#000000'),
        tok('--bg-4', 'B', '#ffffff', '#ffffff'),
        tok('--fg-0', 'Ink', '#808080', '#808080'),
      ],
    };
    expect(
      fixOffer(stuck, '--fg-0', [{ theme: 'light', other: '--bg-0', ratio: 3, need: 4.5 }])
    ).toBeNull();
  });

  test('"Falls short in 3 canvases" counts the canvases that use it; nothing when none does', () => {
    expect(shortWords(3)).toBe('Falls short in 3 canvases');
    expect(shortWords(1)).toBe('Falls short in 1 canvas');
    expect(shortWords(0)).toBeNull();
    expect(shortWords(null)).toBeNull();
  });

  test('canvas 27: the trash sentence says how many canvases follow what, and that Restore puts it back', () => {
    const w = trashWords({
      css: '--x-line-fine',
      label: 'Linka — jemná',
      trashable: true,
      used: 40,
      replacement: { css: '--x-line-mid', label: 'Linka — střední', value: '#bbb' },
    });
    expect(w.title).toBe('Move “Linka — jemná” to the trash?');
    expect(w.lines[0]).toBe(
      '40 canvases use it. They switch to Linka — střední, the closest colour, so nothing breaks.'
    );
    expect(w.back).toBe('Restore from the Trash puts it back in all 40.');
    expect(w.canGo).toBe(true);
    const one = trashWords({ label: 'A', trashable: true, used: 1, replacement: { label: 'B' } });
    expect(one.lines[0]).toBe(
      '1 canvas uses it. It switches to B, the closest colour, so nothing breaks.'
    );
    const none = trashWords({ label: 'A', trashable: true, used: 0, replacement: { label: 'B' } });
    expect(none.lines[0]).toMatch(/^No canvas uses it\./);
  });

  test('a main colour, a locked colour and a colour with nothing to stand in for it cannot go', () => {
    expect(trashWords({ label: 'A', trashable: false, reason: 'tier-1' }).blocked).toBe(
      EDGE_WORDS.tier1
    );
    expect(trashWords({ label: 'A', trashable: false, reason: 'locked' }).blocked).toBe(
      EDGE_WORDS.locked
    );
    const alone = trashWords({ label: 'A', trashable: true, used: 2, replacement: null });
    expect(alone.blocked).toBe(EDGE_WORDS.alone);
    expect(alone.canGo).toBe(false);
    expect(trashWords(null).canGo).toBe(false);
  });

  test('canvas 28: one quiet question, naming the closest system colour', () => {
    const f = {
      literal: '#3b6fe0',
      nearest: { css: '--accent', label: 'Accent', exact: false },
    };
    expect(offSystemWords(f, 'Studio site')).toMatchObject({
      text: 'A colour picked by hand isn’t in Studio site. The closest is Accent.',
      use: 'Use Accent',
      canUse: true,
    });
    expect(offSystemWords({ literal: '#fff', nearest: null }, 'X').canUse).toBe(false);
    expect(offSystemWords({ ...f, nearest: { ...f.nearest, exact: true } }, 'X').text).toMatch(
      /is Accent in X, but it is written by hand/
    );
  });

  test('a question put away stays away; the next finding comes up', () => {
    const a = { file: 'ui/P.tsx', line: 6, col: 3, literal: '#3b6fe0' };
    const b = { file: 'ui/P.tsx', line: 9, col: 3, literal: '#ff00aa' };
    expect(nextFinding([a, b], new Set())).toBe(a);
    expect(nextFinding([a, b], new Set([findingKey(a)]))).toBe(b);
    expect(nextFinding([a, b], new Set([findingKey(a), findingKey(b)]))).toBeNull();
    expect(nextFinding(undefined, new Set())).toBeNull();
  });

  test('refusal codes become words', () => {
    expect(edgeWords('forbidden')).toBe(EDGE_WORDS.forbidden);
    expect(edgeWords('ds-nothing-to-fix')).toBe(EDGE_WORDS.nothing);
    expect(edgeWords('ds-trash-tier1')).toBe(EDGE_WORDS.tier1);
    expect(edgeWords('whatever')).toBe(EDGE_WORDS.failed);
  });
});

describe('the writers send one request each', () => {
  type Sent = { url: string; method: string; body: unknown };
  const fake = (status = 200, json: unknown = {}) => {
    const sent: Sent[] = [];
    const impl = (async (url: string, init?: RequestInit) => {
      sent.push({
        url,
        method: init?.method ?? 'GET',
        body: init?.body ? JSON.parse(String(init.body)) : null,
      });
      return new Response(JSON.stringify(json), { status });
    }) as unknown as typeof fetch;
    return { impl, sent };
  };

  test('fix-contrast, add-colour, trash, use-nearest are the routes the registry names', async () => {
    const f = fake(200, { fixes: [{ theme: 'dark' }], css: '--x-badge-blue', label: 'Badge blue' });
    expect(await fixContrastNow({ ds: 'studio', css: '--accent' }, f.impl)).toMatchObject({
      ok: true,
    });
    expect(
      await addColourNow({ ds: 'studio', value: '#3b6fe0', label: 'Badge blue' }, f.impl)
    ).toMatchObject({
      ok: true,
      css: '--x-badge-blue',
    });
    expect(await trashTokenNow({ ds: 'studio', css: '--a', replacement: '--b' }, f.impl)).toEqual({
      ok: true,
    });
    const finding = {
      literal: '#3b6fe0',
      line: 6,
      col: 3,
      target: { artboard: 'a', element: 'badge' },
    };
    expect(await applyNearestNow({ canvas: 'ui/P.tsx', finding, css: '--accent' }, f.impl)).toEqual(
      { ok: true }
    );
    expect(f.sent.map((s) => `${s.method} ${s.url}`)).toEqual([
      'POST /_api/ds/fix-contrast',
      'POST /_api/ds/add-colour',
      'POST /_api/ds/trash',
      'POST /_api/edit-op',
    ]);
    expect(f.sent[3].body).toEqual({
      file: 'ui/P.tsx',
      op: 'ds.use-nearest',
      targets: [{ artboard: 'a', element: 'badge' }],
      params: { literal: '#3b6fe0', css: '--accent', line: 6, col: 3 },
    });
    // the registry names the same routes
    for (const [id, route] of [
      ['ds.fix-contrast', '/_api/ds/fix-contrast'],
      ['ds.add-colour', '/_api/ds/add-colour'],
      ['ds.use-nearest', '/_api/edit-op'],
      ['ds.trash-token', '/_api/ds/trash'],
    ] as const)
      expect(AGENT_PATHS[id]?.server?.route).toBe(route);
    for (const id of ['ds.fix-contrast', 'ds.add-colour', 'ds.use-nearest'])
      expect(DS_ACTIONS.some((a) => a.id === id)).toBe(true);
  });

  test('a refusal is words, never a stack; a missing target sends nothing', async () => {
    const forbidden = fake(403, { code: 'forbidden' });
    expect(await fixContrastNow({ ds: 'studio', css: '--accent' }, forbidden.impl)).toEqual({
      ok: false,
      code: 'forbidden',
      message: EDGE_WORDS.forbidden,
    });
    const gone = fake(422, { code: 'ds-nothing-to-fix' });
    expect((await fixContrastNow({ ds: 's', css: '--a' }, gone.impl)).message).toBe(
      EDGE_WORDS.nothing
    );
    const none = fake();
    expect(
      await applyNearestNow(
        {
          canvas: 'ui/P.tsx',
          finding: { literal: '#fff', line: 1, col: 1, target: null },
          css: '--a',
        },
        none.impl
      )
    ).toMatchObject({ ok: false });
    expect(none.sent).toHaveLength(0);
    const down = (async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;
    expect((await trashTokenNow({ ds: 's', css: '--a', replacement: '--b' }, down)).message).toBe(
      EDGE_WORDS.unreachable
    );
  });

  test('the questions are reads', async () => {
    const f = fake(200, { edge: 'trash', css: '--a' });
    expect(await fetchTrashQuestion({ ds: 'studio', css: '--x-line-fine' }, f.impl)).toMatchObject({
      ok: true,
    });
    const g = fake(200, { edge: 'off-system', findings: [] });
    expect(await fetchOffSystem({ canvas: 'ui/Pricing.tsx' }, g.impl)).toMatchObject({ ok: true });
    expect(f.sent[0]).toMatchObject({
      method: 'GET',
      url: '/_api/ds/nearest?ds=studio&css=--x-line-fine',
    });
    expect(g.sent[0]).toMatchObject({
      method: 'GET',
      url: '/_api/ds/off-system?canvas=ui%2FPricing.tsx',
    });
  });
});

const CFG = {
  designRel: '.design',
  designSystems: [{ name: 'studio', path: 'system/studio' }],
  dsConverted: { studio: true },
};
const roots: Root[] = [];
beforeAll(() => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(() => GlobalRegistrator.unregister());
afterEach(async () => {
  for (const r of roots.splice(0)) await act(async () => r.unmount());
  document.body.innerHTML = '';
});

async function mount(node: unknown) {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => root.render(node as never));
  return host;
}
const q = (id: string, within: ParentNode = document) =>
  within.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const click = async (el: Element | null) => {
  if (!el) throw new Error('missing element');
  await act(async () => {
    el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  });
};

async function panel(over: Record<string, unknown> = {}) {
  const { TokenPanel } = await import('../client/v2/ds/kinds/token.jsx');
  const calls = {
    fix: [] as unknown[],
    ask: [] as unknown[],
    trash: [] as unknown[],
    show: 0,
    refreshed: 0,
  };
  const host = await mount(
    <TokenPanel
      {...({
        css: '--accent',
        ds: 'studio',
        model: MODEL(),
        onWrite: async () => ({ ok: true }),
        onRefresh: async () => {
          calls.refreshed++;
        },
        onAdopt: () => undefined,
        onShow: () => {
          calls.show++;
        },
        onFix: async (a: unknown) => {
          calls.fix.push(a);
          return { ok: true };
        },
        onAskTrash: async (a: unknown) => {
          calls.ask.push(a);
          return {
            ok: true,
            question: {
              css: '--accent',
              label: 'Accent',
              trashable: true,
              used: 40,
              replacement: { css: '--accent-fg', label: 'Text on accent', value: '#ffffff' },
            },
          };
        },
        onTrash: async (a: unknown) => {
          calls.trash.push(a);
          return { ok: true };
        },
        ...over,
      } as never)}
    />
  );
  return { host, calls };
}

describe('canvas 26 — the contrast warning in the token inspector', () => {
  test('a quiet warning with the fix as the action; Show walks the canvases', async () => {
    const { host, calls } = await panel();
    const line = q('ds-token-contrast', host);
    expect(line?.getAttribute('data-tone')).toBe('warn');
    expect(line?.textContent).toMatch(/on Text on accent in Light/);
    expect(q('ds-contrast-fix', host)?.textContent).toBe('Darken to 4.5:1');
    expect(q('ds-contrast-short', host)?.textContent).toContain('Falls short in 3 canvases');
    await click(q('ds-contrast-show', host));
    expect(calls.show).toBe(1);
    await click(q('ds-contrast-fix', host));
    expect(calls.fix).toEqual([{ ds: 'studio', css: '--accent' }]);
    expect(calls.refreshed).toBe(1);
  });

  test('a passing token has no fix button, and a refused fix says why', async () => {
    const m = MODEL();
    m.tokens[1].values.light = 'oklch(0.45 0.19 255)';
    const ok = await panel({ model: m });
    expect(q('ds-token-contrast', ok.host)?.getAttribute('data-tone')).toBe('ok');
    expect(q('ds-contrast-fix', ok.host)).toBeNull();
    const refused = await panel({
      onFix: async () => ({ ok: false, message: EDGE_WORDS.forbidden }),
    });
    await click(q('ds-contrast-fix', refused.host));
    expect(q('ds-contrast-note', refused.host)?.textContent).toBe(EDGE_WORDS.forbidden);
  });
});

describe('canvas 27 — a colour to the trash', () => {
  test('Move to trash… asks the server, the sheet says what canvases follow, the primary trashes', async () => {
    const { host, calls } = await panel();
    await click(q('ds-token-trash', host));
    expect(calls.ask).toEqual([{ ds: 'studio', css: '--accent' }]);
    expect(q('ds-trash-title')?.textContent).toBe('Move “Accent” to the trash?');
    expect(q('ds-trash-line')?.textContent).toBe(
      '40 canvases use it. They switch to Text on accent, the closest colour, so nothing breaks.'
    );
    expect(q('ds-trash-back')?.textContent).toBe('Restore from the Trash puts it back in all 40.');
    expect(q('ds-trash')?.getAttribute('role')).toBe('dialog');
    await click(q('ds-trash-go'));
    expect(calls.trash).toEqual([{ ds: 'studio', css: '--accent', replacement: '--accent-fg' }]);
    expect(q('ds-trash')).toBeNull();
    expect(calls.refreshed).toBe(1);
  });

  test('Cancel changes nothing; a colour that cannot go has no primary', async () => {
    const { host, calls } = await panel();
    await click(q('ds-token-trash', host));
    await click(q('ds-trash-cancel'));
    expect(q('ds-trash')).toBeNull();
    expect(calls.trash).toHaveLength(0);
    const blocked = await panel({
      onAskTrash: async () => ({
        ok: true,
        question: { css: '--accent', label: 'Accent', trashable: false, reason: 'tier-1' },
      }),
    });
    await click(q('ds-token-trash', blocked.host));
    expect(q('ds-trash-blocked')?.textContent).toBe(EDGE_WORDS.tier1);
    expect(q('ds-trash-go')).toBeNull();
    expect(q('ds-trash-cancel')?.textContent).toBe('Close');
  });

  test('a refusal stays in the sheet, in words', async () => {
    const { host } = await panel({
      onTrash: async () => ({ ok: false, message: EDGE_WORDS.forbidden }),
    });
    await click(q('ds-token-trash', host));
    await click(q('ds-trash-go'));
    expect(q('ds-trash-error')?.textContent).toBe(EDGE_WORDS.forbidden);
    expect(q('ds-trash')).not.toBeNull();
  });
});

describe('canvas 28 — the off-system question', () => {
  const finding = {
    literal: '#3b6fe0',
    file: 'ui/Pricing.tsx',
    line: 6,
    col: 3,
    nearest: { css: '--accent', label: 'Accent', exact: false, value: '#2a5bd7', deltaE: 0.04 },
    target: { artboard: 'a', element: 'badge' },
  };

  test('one quiet question with the swatch, the closest colour, and the two answers', async () => {
    const { OffSystemQuestion } = await import('../client/v2/ds/off-system.jsx');
    const calls = { use: 0, add: 0, dismiss: 0 };
    const host = await mount(
      <OffSystemQuestion
        finding={finding}
        systemLabel="Studio site"
        onUse={async () => {
          calls.use++;
          return { ok: true };
        }}
        onAdd={async () => {
          calls.add++;
          return { ok: true };
        }}
        onDismiss={() => {
          calls.dismiss++;
        }}
      />
    );
    expect(q('ds-off-system', host)?.getAttribute('role')).toBe('status');
    expect(q('ds-off-system-text', host)?.textContent).toBe(
      'A colour picked by hand isn’t in Studio site. The closest is Accent.'
    );
    expect(q('ds-off-system-use', host)?.textContent).toBe('Use Accent');
    expect(q('ds-off-system-add', host)?.textContent).toBe('Add it to the system');
    await click(q('ds-off-system-use', host));
    await click(q('ds-off-system-add', host));
    await click(q('ds-off-system-dismiss', host));
    expect(calls).toEqual({ use: 1, add: 1, dismiss: 1 });
  });

  test('without an addressable element there is no "Use": the colour can still be added', async () => {
    const { OffSystemQuestion } = await import('../client/v2/ds/off-system.jsx');
    const host = await mount(
      <OffSystemQuestion
        finding={{ ...finding, target: null }}
        systemLabel="S"
        onUse={async () => ({ ok: true })}
        onAdd={async () => ({ ok: true })}
        onDismiss={() => undefined}
      />
    );
    expect(q('ds-off-system-use', host)).toBeNull();
    expect(q('ds-off-system-add', host)).not.toBeNull();
  });

  test('the host asks about the open canvas, shows the first question, writes with the server’s own words', async () => {
    const { DsOffSystemHost } = await import('../client/v2/ds/off-system-host.jsx');
    const sent: Array<{ url: string; method: string; body: unknown }> = [];
    const toasts: string[] = [];
    const impl = (async (url: string, init?: RequestInit) => {
      sent.push({
        url,
        method: init?.method ?? 'GET',
        body: init?.body ? JSON.parse(String(init.body)) : null,
      });
      if (String(url).startsWith('/_api/ds/off-system'))
        return new Response(
          JSON.stringify({
            edge: 'off-system',
            system: 'studio',
            canvas: 'ui/Pricing.tsx',
            findings: [finding],
          }),
          { status: 200 }
        );
      return new Response(JSON.stringify({ css: '--x-new', label: 'New' }), { status: 200 });
    }) as unknown as typeof fetch;
    const host = await mount(
      <DsOffSystemHost
        cfg={CFG}
        activePath=".design/ui/Pricing.tsx"
        toast={(m: string) => toasts.push(m)}
        fetchImpl={impl}
        pollMs={60_000}
        firstMs={0}
      />
    );
    await act(async () => {
      await new Promise((r) => setTimeout(r, 5));
    });
    expect(sent[0]).toMatchObject({
      method: 'GET',
      url: '/_api/ds/off-system?canvas=ui%2FPricing.tsx',
    });
    expect(q('ds-off-system', host)?.getAttribute('data-literal')).toBe('#3b6fe0');
    await click(q('ds-off-system-add', host));
    expect(sent.at(-1)).toMatchObject({
      method: 'POST',
      url: '/_api/ds/add-colour',
      body: { ds: 'studio', value: '#3b6fe0' },
    });
    expect(toasts).toEqual([EDGE_WORDS.added]);
    // answered: it does not ask again about the same place
    expect(q('ds-off-system', host)).toBeNull();
  });

  test('a system canvas, no canvas, or a system that is not converted: nothing is asked', async () => {
    const { DsOffSystemHost } = await import('../client/v2/ds/off-system-host.jsx');
    const sent: string[] = [];
    const impl = (async (url: string) => {
      sent.push(String(url));
      return new Response('{}', { status: 404 });
    }) as unknown as typeof fetch;
    const props = { fetchImpl: impl, pollMs: 60_000, firstMs: 0 };
    const a = await mount(
      <DsOffSystemHost cfg={CFG} activePath=".design/system/acme/design-system.tsx" {...props} />
    );
    const b = await mount(<DsOffSystemHost cfg={CFG} activePath="" {...props} />);
    const c = await mount(
      <DsOffSystemHost
        cfg={{ ...CFG, dsConverted: {} }}
        activePath=".design/ui/Pricing.tsx"
        {...props}
      />
    );
    await act(async () => {
      await new Promise((r) => setTimeout(r, 5));
    });
    expect(sent).toEqual([]);
    for (const h of [a, b, c]) expect(h.innerHTML).toBe('');
  });
});
