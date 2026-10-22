// S8.10 — the Handoff to production sheet (09 Export · ex-handoff, ex-handoff-ready, ex-handoff-edges),
// mounted through the Export sheet's `mode: 'handoff'` door with a scripted fetch (no server, no AI).
// Proves: the targets from settings with Lottie off and its reason; the title verb is the button;
// the last review's blockers as a warn line; not connected → the one connect sheet and nothing is sent;
// queued → the drawn words; ready → one thing to copy and the Advanced lines; Design system › Hand off
// tokens asks for the system, not a canvas.

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

beforeAll(() => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(() => {
  GlobalRegistrator.unregister();
});

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { blockersLine, CONNECT_FINE, handoffTitle } from '../client/v2/handoff/targets.js';

const TARGETS = [
  {
    id: 'web',
    kind: 'web',
    title: 'Studio web',
    sub: 'Web components — a shadcn registry item',
    outRel: '.design/ui/Pricing.registry.json',
    off: null,
  },
  {
    id: 'app',
    kind: 'rn',
    title: 'Studio app',
    sub: 'A React Native component',
    outRel: 'src/components/Pricing.tsx',
    off: null,
  },
  {
    id: 'lottie',
    kind: 'lottie',
    title: 'Lottie animation',
    sub: 'For motion',
    outRel: '.design/assets/pricing.json',
    off: 'For motion — needs an animated frame; Pricing has none',
  },
];
const READY_WEB = {
  copyLabel: 'Copy command',
  copy: 'bunx shadcn add file:///r/.design/ui/Pricing.registry.json',
  writes: null,
  snippet: null,
  lines: [
    { note: 'This Mac only', text: 'bunx shadcn add file:///r/.design/ui/Pricing.registry.json' },
    { note: 'Claude Code', text: '/design:handoff ui/Pricing.tsx' },
    { note: 'Terminal', text: 'maude design handoff .design/ui/Pricing.tsx .design' },
  ],
};

type Script = {
  connected?: boolean;
  blockers?: Array<{ what: string }>;
  start?: Record<string, unknown>;
  exists?: boolean;
};
let host: HTMLDivElement | null = null;
let root: Root | null = null;
let calls: Array<{ url: string; body?: unknown }> = [];
const realFetch = globalThis.fetch;

function stub(s: Script = {}) {
  calls = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const ok = (b: unknown) => new Response(JSON.stringify(b), { status: 200 });
    if (url.startsWith('/_api/handoff/targets')) {
      const tokens = url.includes('ds=');
      return ok({
        subject: tokens
          ? { name: 'studio', canvas: null, ds: 'studio' }
          : { name: 'Pricing', canvas: 'ui/Pricing.tsx', ds: 'Studio' },
        targets: tokens
          ? [
              {
                id: 'tokens',
                kind: 'tokens',
                title: 'Design tokens',
                sub: 'x',
                outRel: 'src/styles/studio-tokens.css',
                off: null,
              },
            ]
          : TARGETS,
        review: { reviewed: true, at: 1, blockers: s.blockers ?? [] },
        connected: s.connected ?? true,
        canEdit: true,
      });
    }
    if (url === '/_api/handoff')
      return new Response(
        JSON.stringify(
          s.start ?? {
            ok: true,
            status: 'running',
            runId: 'r_00000001',
            chatId: 'handoff-x',
            ready: READY_WEB,
          }
        ),
        { status: 202 }
      );
    if (url.startsWith('/_api/handoff/result'))
      return ok({
        exists: s.exists ?? false,
        content: s.exists ? '{"name":"pricing"}' : null,
        ready: READY_WEB,
      });
    return ok({});
  }) as typeof fetch;
}

const $ = (sel: string) => document.querySelector(sel);
const text = (sel: string) => ($(sel)?.textContent ?? '').trim();
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
async function settle() {
  for (let i = 0; i < 4; i++) await act(async () => await tick(5));
}
async function click(sel: string) {
  await act(async () => {
    ($(sel) as HTMLElement | null)?.click();
    await tick(5);
  });
  await settle();
}

async function mount(script: Script = {}, request: Record<string, unknown> = { mode: 'handoff' }) {
  stub(script);
  const { ExportSheet } = await import('../client/v2/export/export-sheet.jsx');
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root?.render(
      <ExportSheet
        mode="handoff"
        request={request}
        activePath=".design/ui/Pricing.tsx"
        designRel=".design"
        exportLane="local"
        access={{ canEdit: true, role: 'member' }}
        aiRuns={{ seq: 1, mine: [], others: [], needsYou: 0, live: 0 }}
        onClose={() => {}}
      />
    );
  });
  await settle();
}

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  host = null;
  root = null;
  globalThis.fetch = realFetch;
  localStorage.clear();
});

describe('S8.10 ⇧⌘H — pick where the code goes', () => {
  test('the targets come from settings; Lottie is off with its reason; the title verb is the button', async () => {
    await mount();
    expect(text('[data-testid="export-title"]')).toBe(handoffTitle('Pricing'));
    expect(text('[data-testid="export-submit-label"]')).toBe('Hand off');
    expect($('[data-testid="handoff-target-web"]')?.getAttribute('aria-checked')).toBe('true');
    const lottie = $('[data-testid="handoff-target-lottie"]');
    expect(lottie?.getAttribute('aria-disabled')).toBe('true');
    expect(lottie?.textContent).toContain('needs an animated frame; Pricing has none');
    expect(text('[data-testid="handoff-use-ds"]')).toContain('Use the design system');
    expect(text('[data-testid="handoff-review"]')).toContain('Last review: no blockers.');
  });

  test('picking App and Hand off posts the target and Use the design system', async () => {
    await mount();
    await click('[data-testid="handoff-target-app"]');
    await click('[data-testid="export-submit"]');
    const post = calls.find((c) => c.url === '/_api/handoff');
    expect(post?.body).toEqual({ canvas: 'ui/Pricing.tsx', target: 'app', useDs: true });
    expect($('[data-testid="handoff-drafting"]')).not.toBeNull();
  });

  // P8-C4 (09 ex-handoff, a11y) — radio cards with a dot and the target's glyph; arrows reach every target
  test('the targets are radio cards: a dot, a glyph, and ← ↑ → ↓ move and pick (Lottie, off, is skipped)', async () => {
    await mount();
    const web = $('[data-testid="handoff-target-web"]') as HTMLElement;
    expect(web.querySelector('.ho-radio')).not.toBeNull();
    expect(web.querySelector('.ho-target-ic svg')).not.toBeNull();
    await act(async () => {
      web.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
      await tick(10);
    });
    expect($('[data-testid="handoff-target-app"]')?.getAttribute('aria-checked')).toBe('true');
    await act(async () => {
      $('[data-testid="handoff-target-app"]')?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })
      );
      await tick(10);
    });
    // Lottie is off: the next live target wraps round to web
    expect($('[data-testid="handoff-target-web"]')?.getAttribute('aria-checked')).toBe('true');
  });

  test('blockers inform: the warn line names them, and Hand off stays on', async () => {
    const blockers = [
      { what: 'Tablet price text is 3.9 : 1 (needs 4.5 : 1)' },
      { what: "Mobile's Start button is 38 px tall" },
    ];
    await mount({ blockers });
    expect($('[data-testid="handoff-review"]')?.getAttribute('data-tone')).toBe('warn');
    expect(text('[data-testid="handoff-review"]')).toContain(blockersLine(blockers));
    expect(($('[data-testid="export-submit"]') as HTMLButtonElement).disabled).toBe(false);
  });
});

describe('S8.10 ⇧⌘H — focus goes into the sheet (gate-b-keys, the v1-keys golden)', () => {
  test('the sheet opens with focus inside it although the targets have not arrived (its Hand off is off until they do)', async () => {
    // The mount-time focus lands on the primary button, which is `disabled` until a target is
    // picked: a disabled button takes no focus, so focus stayed behind the sheet and Esc / ↵ went
    // to the shell instead of the dialog.
    await mount();
    const sheet = $('[data-testid="export-sheet"]') as HTMLElement;
    expect(sheet).not.toBeNull();
    expect(sheet.contains(document.activeElement)).toBe(true);
  });

  test('Esc closes the sheet from where focus landed', async () => {
    let closed = 0;
    stub();
    const { ExportSheet } = await import('../client/v2/export/export-sheet.jsx');
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    await act(async () => {
      root?.render(
        <ExportSheet
          mode="handoff"
          request={{ mode: 'handoff' }}
          activePath=".design/ui/Pricing.tsx"
          designRel=".design"
          exportLane="local"
          access={{ canEdit: true, role: 'member' }}
          aiRuns={{ seq: 1, mine: [], others: [], needsYou: 0, live: 0 }}
          onClose={() => {
            closed++;
          }}
        />
      );
    });
    await settle();
    await act(async () => {
      (document.activeElement ?? document.body).dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
      );
      await tick(5);
    });
    expect(closed).toBe(1);
  });
});

describe('S8.10 edges — not connected, queued', () => {
  test('not connected: the one connect sheet, and nothing is sent until Connect', async () => {
    await mount({ connected: false });
    await click('[data-testid="export-submit"]');
    expect($('[data-testid="handoff-connect"]')).not.toBeNull();
    expect(text('[data-testid="ai-connect-sheet"]')).toContain(
      'Connect your Claude account to let AI draft this.'
    );
    expect(text('[data-testid="ai-connect-sheet"]')).toContain(CONNECT_FINE);
    expect(calls.some((c) => c.url === '/_api/handoff')).toBe(false);
  });

  test('queued: the drawn words, and it starts by itself', async () => {
    await mount({
      start: {
        ok: true,
        status: 'queued',
        intentId: 'i_x',
        gates: ['online'],
        words: 'Queued — starts when this Mac is online',
        ready: READY_WEB,
      },
    });
    await click('[data-testid="export-submit"]');
    expect(text('[data-testid="handoff-queued"]')).toContain(
      'Queued — starts when this Mac is online'
    );
  });
});

describe('S8.10 ready — one thing to copy; Advanced shows the rest', () => {
  test('once the file is written: Copy command, and Advanced holds This Mac only, Claude Code and Terminal', async () => {
    await mount({ exists: true });
    await click('[data-testid="export-submit"]');
    expect(text('[data-testid="handoff-ready"]')).toContain('Pricing is ready for developers');
    expect(text('[data-testid="handoff-ready-copy"]')).toBe('Copy command');
    await click('[data-testid="handoff-ready-advanced"]');
    expect(text('[data-testid="handoff-ready-line-1"]')).toContain(
      '/design:handoff ui/Pricing.tsx'
    );
    expect(text('[data-testid="handoff-ready-line-2"]')).toContain('maude design handoff');
  });
});

describe('S8.10 Design system › Hand off tokens (S10.19)', () => {
  test('asks for the system, not the open canvas, and offers the tokens target', async () => {
    await mount({}, { mode: 'handoff', target: 'tokens', ds: 'studio' });
    expect(calls[0]?.url).toBe('/_api/handoff/targets?ds=studio');
    expect($('[data-testid="handoff-target-tokens"]')?.getAttribute('aria-checked')).toBe('true');
  });
});

describe('S8.10 the permission card is honest about a handoff run’s scope', () => {
  test('a write outside the run’s one file never claims to be outside the project', async () => {
    const { describeOutOfProject } = await import('../client/panels/PermissionPrompt.jsx');
    const d = describeOutOfProject({
      outOfProjectWrite: true,
      reason: 'outside-run-scope',
      resolvedPaths: ['/r/.design/ui/Pricing.tsx'],
      scopeRoot: '/r',
    });
    expect(d?.lead).toBe(
      'This handoff may write its one file only. Nothing else changes unless you allow it now.'
    );
  });
});
