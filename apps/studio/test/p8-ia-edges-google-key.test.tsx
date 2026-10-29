// p8-ia-edges item 1 (ia-edges H, Michal 2026-10-29): Generate with no Google key shows "Connect a Google key?".
// It must not fail or go silent. Connect opens Settings › Connections (the one key flow); once the key lands the
// waiting prompt runs by itself, once, with the original words. Cancel drops it — nothing runs.
//
// No real key, no real keychain: the studio is a fake fetch; the key "lands" when the fake's `/_api/generate/keys`
// starts to list a provider (that route is presence-only, a key is never read back).

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const here = dirname(fileURLToPath(import.meta.url));
const TARGET = { canvas: 'ui/gameweek.tsx', artboardId: 'post' };

let GenerateAsk: (p: Record<string, unknown>) => unknown;
let askQuote: typeof import('../client/v2/assets/generate-ask.jsx').askQuote;
let KEY_WORDS: Record<string, string>;
const roots: Root[] = [];
const realFetch = globalThis.fetch;

beforeAll(async () => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const mod = await import('../client/v2/assets/generate-ask.jsx');
  GenerateAsk = mod.GenerateAsk as never;
  askQuote = mod.askQuote;
  KEY_WORDS = (await import('../client/v2/assets/connect-key-sheet.jsx')).KEY_WORDS;
});
afterAll(() => {
  globalThis.fetch = realFetch;
  GlobalRegistrator.unregister();
});
afterEach(async () => {
  for (const r of roots.splice(0)) await act(async () => r.unmount());
  document.body.innerHTML = '';
});

type Studio = {
  keyConnected: boolean;
  generates: Array<Record<string, unknown>>;
  keyReads: number;
};
function studio(): Studio {
  return { keyConnected: false, generates: [], keyReads: 0 };
}
function fakeStudio(s: Studio) {
  return (async (url: string, init?: RequestInit) => {
    const path = String(url).replace(/\?.*$/, '');
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
    if (path === '/_api/generate-takes/quote') {
      if (!s.keyConnected) return json({ ok: false, reason: 'no-provider' }, 409);
      return json({
        ok: true,
        quote: 'q-1',
        provider: 'google',
        model: 'nano-banana-pro',
        n: 4,
        aspect: '4:5',
        lines: { time: 'About 30 s · billed to your Google key', licence: '' },
        models: [],
      });
    }
    if (path === '/_api/generate/keys') {
      s.keyReads += 1;
      return json({ configured: s.keyConnected ? ['google'] : [] });
    }
    if (path === '/_api/generate-takes' && init?.method === 'POST') {
      s.generates.push(JSON.parse(String(init.body)));
      return json({ ok: true, group: 'g-1' });
    }
    if (path === '/_api/generate-takes')
      return json({
        ok: true,
        status: 'done',
        best: 'assets/aaaa1111.png',
        takes: ['assets/aaaa1111.png'],
      });
    return json({ ok: false }, 404);
  }) as unknown as typeof fetch;
}

const tid = (s: string) => document.querySelector(`[data-testid="${s}"]`) as HTMLElement | null;
const tick = (ms: number) => act(async () => void (await new Promise((r) => setTimeout(r, ms))));
async function until(fn: () => unknown, ms = 1500) {
  const end = Date.now() + ms;
  while (!fn()) {
    if (Date.now() > end) throw new Error('timed out');
    await tick(10);
  }
}

async function mount(s: Studio, extra: Record<string, unknown> = {}) {
  const connects: number[] = [];
  document.body.innerHTML = '<div id="root"></div>';
  const root = createRoot(document.getElementById('root') as HTMLElement);
  roots.push(root);
  await act(async () => {
    root.render(
      <GenerateAsk
        target={TARGET}
        where="Gameweek 5"
        onClose={() => {}}
        onConnectKey={() => connects.push(1)}
        fetchImpl={fakeStudio(s)}
        keyPollMs={15}
        {...extra}
      />
    );
  });
  await until(() => tid('generate-ask-prompt'));
  // type the prompt the way a person does (the textarea's React handler)
  const ta = tid('generate-ask-prompt') as HTMLTextAreaElement;
  const propsKey = Object.keys(ta).find((k) => k.startsWith('__reactProps$')) as string;
  await act(async () => {
    ta.value = 'a goalkeeper at dusk';
    (ta as unknown as Record<string, { onChange: (e: unknown) => void }>)[propsKey].onChange({
      target: ta,
      currentTarget: ta,
    });
  });
  return connects;
}
const click = (id: string) => act(async () => void (tid(id) as HTMLButtonElement).click());

describe('Generate with no Google key (ia-edges H)', () => {
  test('askQuote tells the ask WHY it has no quote (no provider), not just a message', async () => {
    const r = await askQuote(TARGET, { n: 4 }, { fetch: fakeStudio(studio()) });
    expect(r).toMatchObject({ ok: false, noProvider: true });
  });

  test('no key → Generate answers with the sheet, in the board words; nothing is sent', async () => {
    const s = studio();
    await mount(s);
    await until(() => !(tid('generate-ask-go') as HTMLButtonElement).disabled);
    await click('generate-ask-go');
    const sheet = tid('generate-key-sheet');
    expect(sheet).not.toBeNull();
    expect(sheet?.textContent).toContain('Connect a Google key?');
    expect(sheet?.textContent).toContain(
      "Connect a Google AI key to make this image. Images are billed to your own key; the cloud plan doesn't include them."
    );
    expect(sheet?.getAttribute('role')).toBe('dialog');
    expect(s.generates).toHaveLength(0);
  });

  test('Connect opens the key flow, and when the key lands the waiting prompt runs once with the original words', async () => {
    const s = studio();
    const connects = await mount(s);
    await until(() => !(tid('generate-ask-go') as HTMLButtonElement).disabled);
    await click('generate-ask-go');
    await click('generate-key-connect');
    expect(connects).toHaveLength(1); // Settings › Connections, once
    expect(tid('generate-key-sheet')).toBeNull();
    expect(tid('generate-ask-waiting')).not.toBeNull(); // not silent: the ask says it is waiting
    await tick(80);
    expect(s.generates).toHaveLength(0); // still no key — nothing runs
    s.keyConnected = true;
    await until(() => s.generates.length > 0);
    await tick(120); // and it does not run twice
    expect(s.generates).toHaveLength(1);
    expect(s.generates[0]).toMatchObject({ prompt: 'a goalkeeper at dusk', quote: 'q-1', n: 4 });
  });

  test('Cancel drops it: no side effects, and a key connected later runs nothing', async () => {
    const s = studio();
    const connects = await mount(s);
    await until(() => !(tid('generate-ask-go') as HTMLButtonElement).disabled);
    await click('generate-ask-go');
    await click('generate-key-cancel');
    expect(tid('generate-key-sheet')).toBeNull();
    expect(connects).toHaveLength(0);
    expect(tid('generate-ask-waiting')).toBeNull();
    s.keyConnected = true;
    await tick(150);
    expect(s.generates).toHaveLength(0);
    expect(s.keyReads).toBe(0); // nothing is even watching for the key
  });

  test('closing the ask while it waits stops the waiting: a later key runs nothing', async () => {
    const s = studio();
    await mount(s);
    await until(() => !(tid('generate-ask-go') as HTMLButtonElement).disabled);
    await click('generate-ask-go');
    await click('generate-key-connect');
    await act(async () => roots[0].unmount());
    roots.length = 0;
    s.keyConnected = true;
    await tick(150);
    expect(s.generates).toHaveLength(0);
  });

  test('with a key connected there is no sheet — Generate goes straight to the quote', async () => {
    const s = studio();
    s.keyConnected = true;
    await mount(s);
    await until(() => !(tid('generate-ask-go') as HTMLButtonElement).disabled);
    await click('generate-ask-go');
    expect(tid('generate-key-sheet')).toBeNull();
    await until(() => s.generates.length === 1);
  });

  test('Connect goes through the existing settings.open action, landing on Connections', async () => {
    const { createMenuHandlers } = await import('../client/v2/shell/menu-runner.js');
    const seen: unknown[] = [];
    const h = createMenuHandlers({
      setSettingsOpen: (v: unknown) => seen.push(v),
    } as never) as Record<string, (p?: unknown) => void>;
    h['settings.open']({ tab: 'connections' });
    h['settings.open']();
    expect(seen).toEqual(['connections', true]); // a plain open is unchanged
    // and the Assets tab wires it
    const src = readFileSync(
      join(here, '..', 'client', 'v2', 'left-panel', 'assets-panel.jsx'),
      'utf8'
    );
    expect(src).toContain("menuRunner.run('settings.open', { tab: 'connections' })");
  });

  test('the words and testids are registered (testids are an API)', () => {
    expect(KEY_WORDS.title).toBe('Connect a Google key?');
    const json = JSON.parse(
      readFileSync(join(here, '..', 'client', 'testids.json'), 'utf8')
    ) as Array<{
      hook: string;
    }>;
    const md = readFileSync(join(here, '..', 'client', 'TESTIDS.md'), 'utf8');
    for (const hook of [
      'generate-key-sheet',
      'generate-key-connect',
      'generate-key-cancel',
      'generate-ask-waiting',
      'sync-assets-stay',
    ]) {
      expect({
        hook,
        json: json.some((e) => e.hook === hook),
        md: md.includes(`| \`${hook}\` |`),
      }).toEqual({
        hook,
        json: true,
        md: true,
      });
    }
  });
});
