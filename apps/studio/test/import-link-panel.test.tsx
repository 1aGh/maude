// p8-import-link (F16 · 12 ia-edges F "A link instead of a file") — the client half: the Assets tab's Add from a
// link… field and a link dropped on the tab both go to `POST /_api/import-link`; the line says "Preparing <name>"
// while it comes in, then the board's "Saved a copy from the link — the page can change, your copy won't." A refusal
// says its reason in plain words (CONTRACT §4: what happened · what is safe · one verb at most).
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { ARRIVAL_LINES, importLine, linkName } from '../client/v2/assets/import-lines.js';
import { arrivalNote } from '../client/v2/assets/import-toast.js';

describe('the words', () => {
  test('a link that landed says the board’s line; its name is the last segment, else the site', () => {
    expect(
      arrivalNote([
        { name: 'combine-2025-12.jpg', fromLink: true, result: { path: 'assets/a1.jpg' } },
      ])
    ).toEqual({ tone: 'info', text: ARRIVAL_LINES.fromLink() });
    expect(ARRIVAL_LINES.fromLink()).toBe(
      'Saved a copy from the link — the page can change, your copy won’t.'
    );
    expect(linkName('https://alligators.cz/foto/combine-2025-12.jpg?w=2')).toEqual({
      name: 'combine-2025-12.jpg',
      host: 'alligators.cz',
    });
    expect(linkName('https://alligators.cz/')).toEqual({
      name: 'alligators.cz',
      host: 'alligators.cz',
    });
    expect(linkName('nonsense')).toEqual({ name: 'the link', host: '' });
  });

  test('every refusal has its own plain line — no route, no status, no "Maude"', () => {
    const reasons = [
      'link-bad',
      'link-not-https',
      'link-refused',
      'link-private',
      'link-unreachable',
      'link-http',
      'link-redirects',
      'link-not-media',
      'link-svg',
      'link-not-on-mac',
    ];
    const generic = importLine({ ok: false, reason: 'no-such-reason' }, { name: 'x' })?.text;
    const texts = reasons.map(
      (reason) => importLine({ ok: false, reason }, { name: 'a.png', host: 'media.example' })?.text
    );
    for (const [i, t] of texts.entries()) {
      expect({ reason: reasons[i], t: typeof t }).toEqual({ reason: reasons[i], t: 'string' });
      expect(t).not.toBe(generic);
      expect(t).not.toMatch(/Maude|\/_api|HTTP|[0-9]{3}|!|Oops|\bwe\b|\bI\b/);
    }
    expect(new Set(texts).size).toBe(reasons.length);
    expect(importLine({ ok: false, reason: 'link-private' }, {})?.text).toBe(
      'That link points inside a private network, so nothing was added.'
    );
    expect(
      importLine({ ok: false, reason: 'link-unreachable' }, { host: 'media.example' })
    ).toEqual({
      tone: 'warn',
      text: 'media.example didn’t answer, so nothing was added.',
      verb: 'Try again',
    });
  });
});

describe('the Assets tab', () => {
  const realFetch = globalThis.fetch;
  let answer: { status: number; body: Record<string, unknown> } = { status: 201, body: {} };
  let release: (() => void) | null = null;
  const posted: unknown[] = [];
  beforeAll(() => {
    GlobalRegistrator.register();
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
      true;
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      if (url.startsWith('/_api/index?part=assets'))
        return new Response(JSON.stringify({ seq: 1, history: 'ready', assets: [] }), {
          status: 200,
        });
      if (url === '/_api/import-link') {
        posted.push(JSON.parse(String(init?.body)));
        await new Promise<void>((r) => {
          release = r;
        });
        return new Response(JSON.stringify(answer.body), { status: answer.status });
      }
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;
  });
  afterAll(() => {
    globalThis.fetch = realFetch;
    GlobalRegistrator.unregister();
  });
  const roots: Root[] = [];
  afterEach(async () => {
    for (const r of roots.splice(0)) await act(async () => r.unmount());
    document.body.innerHTML = '';
    posted.length = 0;
  });

  async function mount(props: Record<string, unknown>) {
    const { AssetsPanel } = await import('../client/v2/left-panel/assets-panel.jsx');
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () => root.render(<AssetsPanel designRel=".design" {...props} />));
    await act(async () => new Promise((r) => setTimeout(r, 40)));
    return host;
  }
  const tick = (ms = 40) => act(async () => new Promise((r) => setTimeout(r, ms)));

  test('the field: paste a link, ↵ — "Preparing <name>", then "Saved a copy from the link"', async () => {
    answer = {
      status: 201,
      body: {
        ok: true,
        path: 'assets/abcd1234.jpg',
        kind: 'jpg',
        name: 'combine-2025-12.jpg',
        host: 'alligators.cz',
      },
    };
    const seen: Array<[string, boolean]> = [];
    const host = await mount({ toast: (m: string, ok: boolean) => seen.push([m, ok]) });
    const button = host.querySelector('[data-testid="assets-add-link"]') as HTMLButtonElement;
    expect(button.getAttribute('aria-label')).toBe('Add from a link…');
    await act(async () => button.click());
    const input = host.querySelector('[data-testid="assets-link-input"]') as HTMLInputElement;
    expect(input).not.toBeNull();
    // React's own handlers (happy-dom does not drive React's input tracking from a synthetic event)
    const props = (el: HTMLElement) =>
      (el as unknown as Record<string, Record<string, (e: unknown) => void>>)[
        Object.getOwnPropertyNames(el).find((k) => k.startsWith('__reactProps')) as string
      ] as Record<string, (e: unknown) => void>;
    await act(async () => {
      const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
      set?.call(input, 'https://alligators.cz/foto/combine-2025-12.jpg');
      props(input).onChange?.({ target: input, currentTarget: input });
    });
    await act(async () => {
      props(host.querySelector('[data-testid="assets-link-input"]') as HTMLElement).onKeyDown?.({
        key: 'Enter',
        preventDefault() {},
        stopPropagation() {},
      });
    });
    await tick();
    expect(posted).toEqual([{ url: 'https://alligators.cz/foto/combine-2025-12.jpg' }]);
    expect(host.querySelector('[data-testid="assets-link"]')).toBeNull();
    expect(host.querySelector('[data-testid="assets-link-preparing"]')?.textContent).toBe(
      'Preparing combine-2025-12.jpg — keeps working in the background.'
    );
    await act(async () => release?.());
    await tick(80);
    expect(host.querySelector('[data-testid="assets-link-preparing"]')).toBeNull();
    expect(seen).toEqual([
      ['Saved a copy from the link — the page can change, your copy won’t.', true],
    ]);
  });

  test('a link dropped on the tab comes in the same way; a refusal says why', async () => {
    answer = {
      status: 403,
      body: { ok: false, reason: 'link-private', error: 'a private address' },
    };
    const seen: Array<[string, boolean]> = [];
    const host = await mount({ toast: (m: string, ok: boolean) => seen.push([m, ok]) });
    const panel = host.querySelector('[data-testid="assets-panel"]') as HTMLElement;
    const ev = new window.Event('drop', { bubbles: true, cancelable: true }) as Event & {
      dataTransfer?: unknown;
    };
    ev.dataTransfer = {
      types: ['text/uri-list'],
      files: [],
      getData: (t: string) =>
        t === 'text/uri-list' ? '# a comment\r\nhttps://10.0.0.1/a.png\r\n' : '',
    };
    await act(async () => {
      panel.dispatchEvent(ev);
    });
    await tick();
    expect(posted).toEqual([{ url: 'https://10.0.0.1/a.png' }]);
    await act(async () => release?.());
    await tick(80);
    expect(seen).toEqual([
      ['That link points inside a private network, so nothing was added.', false],
    ]);
  });

  test('a viewer has no link button', async () => {
    const host = await mount({ readOnly: true });
    expect(host.querySelector('[data-testid="assets-add-link"]')).toBeNull();
  });
});
