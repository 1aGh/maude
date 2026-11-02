// S3.10b — external link targets (contract client/v2/contracts/S3-links-format.md §6, §10 row 7).
//
// The scheme gate at every layer the shell owns (the canvas message carries no URL; the shell re-parses
// what `/_api/links` said; the controller re-parses again before any open), the host shown, once per host
// per window session, a browser `window.open` from the confirm click only, a planted canvas follow that
// cannot skip the confirm, and the desktop fallback (URL + Copy link, nothing opened) when the opener
// refuses or is missing.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

beforeAll(() => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(() => {
  GlobalRegistrator.unregister();
});

import { act } from 'react';
import { createRoot } from 'react-dom/client';

import { acceptFromCanvas } from '../bridge/dgn-protocol.ts';
import {
  checkExternal,
  createExternalLinks,
  EXTERNAL_PASTE,
  EXTERNAL_TITLE,
  ExternalLinkConfirm,
  ExternalLinkConfirmHost,
  hasUserActivation,
  OPEN_FEATURES,
} from '../client/v2/preview/external-link-confirm.jsx';
import { createLinkFollow, followPlan } from '../client/v2/preview/link-follow.js';
import { createPreviewHistory } from '../client/v2/preview/preview-history.js';

const REFUSED = [
  'javascript:alert(1)',
  'JAVASCRIPT:alert(1)',
  'javascript://cal.com/%0aalert(1)',
  'file:///etc/passwd',
  'data:text/html,<script>alert(1)</script>',
  'blob:https://cal.com/x',
  'mailto:a@cal.com',
  'ftp://cal.com/',
  'https://user@cal.com/',
  'https://user:pw@cal.com/',
  'http://localhost:4399/',
  'http://127.0.0.1/',
  'http://[::1]/',
  'http://169.254.169.254/',
  '//cal.com/x',
  '',
  null,
  42,
];

type Call = [string, ...unknown[]];

function rig(o: { native?: boolean; activation?: boolean; invokeFails?: boolean } = {}) {
  const calls: Call[] = [];
  const state = { activation: o.activation ?? false, invokeFails: o.invokeFails ?? false };
  const links = createExternalLinks({
    native: () => !!o.native,
    invoke: async (cmd: string, args: unknown) => {
      calls.push(['invoke', cmd, args]);
      if (state.invokeFails) throw new Error('Command open_link_external not found');
    },
    windowOpen: (url: string, name: string, feats: string) => {
      calls.push(['window.open', url, name, feats]);
      return null;
    },
    activation: () => state.activation,
    copy: async (text: string) => {
      calls.push(['copy', text]);
    },
  });
  return { links, calls, state };
}

const opens = (calls: Call[]) => calls.filter((c) => c[0] === 'window.open' || c[0] === 'invoke');

describe('the scheme gate', () => {
  test('http and https websites pass, in href form, with the host', () => {
    expect(checkExternal('https://cal.com/studio')).toEqual({
      url: 'https://cal.com/studio',
      host: 'cal.com',
      display: 'cal.com/studio',
    });
    expect(checkExternal('http://example.com')?.url).toBe('http://example.com/');
  });

  test('every other scheme, userinfo and a local host are refused', () => {
    for (const u of REFUSED) expect(checkExternal(u)).toBeNull();
  });

  test('the shell re-parses what /_api/links said: a forged "external" javascript: entry is dropped', () => {
    for (const url of REFUSED) {
      expect(
        followPlan({ id: 'x', kind: 'external', state: 'ok', url, label: 'Opens x' })
      ).toBeNull();
    }
    expect(
      followPlan({
        id: 'x',
        kind: 'external',
        state: 'ok',
        url: 'https://cal.com/studio',
        label: '',
      })
    ).toEqual({ kind: 'external', url: 'https://cal.com/studio', host: 'cal.com' });
  });

  test('the controller re-parses before any sheet or open', () => {
    const r = rig({ activation: true });
    for (const u of REFUSED) expect(r.links.request(u as string)).toBeNull();
    expect(r.links.sheet.get()).toBeNull();
    expect(opens(r.calls)).toEqual([]);
  });

  test('a planted canvas message cannot carry a destination: parse keeps the ids only', () => {
    const win = { postMessage() {} } as unknown as Window;
    const m = acceptFromCanvas(
      {
        origin: 'http://localhost:5000',
        source: win,
        data: {
          dgn: 'link-follow',
          elementId: 'book',
          artboardId: null,
          url: 'javascript:alert(1)',
          target: 'file:///etc/passwd',
        },
      } as unknown as MessageEvent,
      { canvasOrigin: 'http://localhost:5000', active: win }
    );
    expect(m).toMatchObject({ dgn: 'link-follow', elementId: 'book', artboardId: null });
    expect(m && ('url' in m || 'target' in m)).toBe(false);
  });
});

describe('the confirmation', () => {
  test('a follow shows the sheet and opens nothing; Open opens with noopener inside the click', () => {
    const r = rig();
    expect(r.links.request('https://cal.com/studio')).toBe('sheet');
    expect(r.links.sheet.get()).toMatchObject({
      host: 'cal.com',
      display: 'cal.com/studio',
      fallback: false,
    });
    expect(opens(r.calls)).toEqual([]);
    void r.links.confirm();
    // synchronously — before any await — so the browser counts it as the click's own popup
    expect(r.calls).toEqual([['window.open', 'https://cal.com/studio', '_blank', OPEN_FEATURES]]);
    expect(OPEN_FEATURES).toContain('noopener');
  });

  test('once per host per session: a later follow with a real click opens straight away', async () => {
    const r = rig();
    r.links.request('https://cal.com/studio');
    await r.links.confirm();
    expect(r.links.sheet.get()).toBeNull();
    r.state.activation = true;
    expect(r.links.request('https://cal.com/other')).toBe('open');
    await Promise.resolve();
    expect(r.links.sheet.get()).toBeNull();
    expect(opens(r.calls).length).toBe(2);
    // a host change always asks again
    expect(r.links.request('https://calendly.com/x')).toBe('sheet');
    expect(opens(r.calls).length).toBe(2);
  });

  test('a planted follow with no user activation cannot skip the sheet, even for a confirmed host', async () => {
    const r = rig();
    r.links.request('https://cal.com/studio');
    await r.links.confirm();
    r.state.activation = false;
    expect(r.links.request('https://cal.com/studio')).toBe('sheet');
    expect(opens(r.calls).length).toBe(1);
  });

  test('activation alone never opens an unconfirmed host', () => {
    const r = rig({ activation: true });
    expect(r.links.request('https://cal.com/studio')).toBe('sheet');
    expect(opens(r.calls)).toEqual([]);
  });

  test('one sheet at a time; Cancel opens nothing and confirms nothing', async () => {
    const r = rig({ activation: true });
    r.links.request('https://cal.com/studio');
    expect(r.links.request('https://evil.example/')).toBeNull();
    expect(r.links.sheet.get()?.host).toBe('cal.com');
    r.links.cancel();
    expect(r.links.request('https://cal.com/studio')).toBe('sheet');
    expect(opens(r.calls)).toEqual([]);
    expect(await r.links.confirm()).toBe(true);
  });

  test('user activation fails closed when the browser cannot say', () => {
    expect(hasUserActivation(undefined)).toBe(false);
    expect(hasUserActivation({} as Navigator)).toBe(false);
    expect(hasUserActivation({ userActivation: { isActive: false } } as unknown as Navigator)).toBe(
      false
    );
    expect(hasUserActivation({ userActivation: { isActive: true } } as unknown as Navigator)).toBe(
      true
    );
  });
});

describe('desktop', () => {
  test('Open calls open_link_external (and never window.open)', async () => {
    const r = rig({ native: true });
    r.links.request('https://cal.com/studio');
    expect(await r.links.confirm()).toBe(true);
    expect(r.calls).toEqual([['invoke', 'open_link_external', { url: 'https://cal.com/studio' }]]);
    expect(r.links.sheet.get()).toBeNull();
  });

  test('a refused or missing opener shows the URL with Copy link and opens nothing', async () => {
    const r = rig({ native: true, invokeFails: true });
    r.links.request('https://cal.com/studio?a=1');
    expect(await r.links.confirm()).toBe(false);
    expect(r.links.sheet.get()).toMatchObject({
      url: 'https://cal.com/studio?a=1',
      fallback: true,
    });
    // the fallback has no Open: confirm() is inert there
    expect(await r.links.confirm()).toBe(false);
    expect(r.calls.filter((c) => c[0] === 'invoke').length).toBe(1);
    expect(await r.links.copy()).toBe(true);
    expect(r.calls.at(-1)).toEqual(['copy', 'https://cal.com/studio?a=1']);
    expect(r.links.sheet.get()?.copied).toBe(true);
  });

  test('a confirmed host whose straight open is refused falls back to the sheet', async () => {
    const r = rig({ native: true });
    r.links.request('https://cal.com/studio');
    await r.links.confirm();
    r.state.invokeFails = true;
    r.state.activation = true;
    expect(r.links.request('https://cal.com/x')).toBe('open');
    await new Promise((res) => setTimeout(res, 0));
    expect(r.links.sheet.get()).toMatchObject({ url: 'https://cal.com/x', fallback: true });
  });
});

describe('through the link-follow handler', () => {
  test('a followed website reaches the sheet, never an open', async () => {
    const r = rig({ activation: true });
    const lf = createLinkFollow({
      mode: () => 'preview',
      modalOpen: () => false,
      now: () => 1000,
      activePath: () => '.design/Home.tsx',
      fetchLinks: async () => ({
        links: [
          {
            id: 'book',
            artboard: 'a',
            kind: 'external',
            state: 'ok',
            url: 'https://cal.com/studio',
            label: '',
          },
          {
            id: 'evil',
            artboard: 'a',
            kind: 'external',
            state: 'ok',
            url: 'javascript:alert(1)',
            label: '',
          },
        ],
      }),
      zoomTo: () => {},
      openCanvas: () => {},
      openTab: () => {},
      toast: () => {},
      external: (u: string) => r.links.request(u),
      history: createPreviewHistory(),
      nameOf: () => 'Home',
    });
    await lf.follow({ elementId: 'evil', artboardId: 'a' });
    expect(r.links.sheet.get()).toBeNull();
    await lf.follow({ elementId: 'book', artboardId: 'a' });
    expect(r.links.sheet.get()?.host).toBe('cal.com');
    expect(opens(r.calls)).toEqual([]);
  });
});

describe('the sheet', () => {
  function mount(node: React.ReactNode) {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const root = createRoot(el);
    act(() => root.render(node));
    return {
      el,
      q: (id: string) => el.querySelector(`[data-testid="${id}"]`) as HTMLElement | null,
      rerender: (n: React.ReactNode) => act(() => root.render(n)),
      done: () => {
        act(() => root.unmount());
        el.remove();
      },
    };
  }

  test('title, the host in bold, the display beneath; Open opens from the click', () => {
    const r = rig();
    r.links.request('https://cal.com/studio');
    const m = mount(<ExternalLinkConfirmHost links={r.links} />);
    const dlg = m.q('ext-link-confirm');
    expect(dlg?.getAttribute('role')).toBe('dialog');
    expect(dlg?.getAttribute('aria-modal')).toBe('true');
    expect(dlg?.textContent).toContain(EXTERNAL_TITLE);
    expect(m.q('ext-link-host')?.tagName).toBe('STRONG');
    expect(m.q('ext-link-host')?.textContent).toBe('cal.com');
    expect(m.q('ext-link-display')?.textContent).toBe('cal.com/studio');
    expect(opens(r.calls)).toEqual([]);
    act(() => m.q('ext-link-open')?.click());
    expect(r.calls).toEqual([['window.open', 'https://cal.com/studio', '_blank', OPEN_FEATURES]]);
    m.done();
  });

  test('esc cancels', () => {
    const r = rig();
    r.links.request('https://cal.com/studio');
    const m = mount(<ExternalLinkConfirmHost links={r.links} />);
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(r.links.sheet.get()).toBeNull();
    expect(m.q('ext-link-confirm')).toBeNull();
    m.done();
  });

  test('the desktop fallback: no Open, the full URL as text, Copy link primary, the paste line', () => {
    const m = mount(
      <ExternalLinkConfirm
        sheet={{
          url: 'https://cal.com/studio?a=1',
          host: 'cal.com',
          display: 'cal.com/studio',
          fallback: true,
          copied: false,
        }}
        onOpen={() => {}}
        onCopy={() => {}}
        onCancel={() => {}}
      />
    );
    expect(m.q('ext-link-open')).toBeNull();
    expect(m.q('ext-link-url')?.textContent).toBe('https://cal.com/studio?a=1');
    expect(m.q('ext-link-copy')?.className).toContain('btn--primary');
    expect(m.q('ext-link-copy')?.textContent).toBe('Copy link');
    expect(m.el.textContent).toContain(EXTERNAL_PASTE);
    m.done();
  });

  test('leaving Preview cancels the sheet', () => {
    const r = rig();
    r.links.request('https://cal.com/studio');
    const m = mount(<ExternalLinkConfirmHost links={r.links} active />);
    expect(m.q('ext-link-confirm')).not.toBeNull();
    m.rerender(<ExternalLinkConfirmHost links={r.links} active={false} />);
    expect(r.links.sheet.get()).toBeNull();
    expect(m.q('ext-link-confirm')).toBeNull();
    m.done();
  });
});
