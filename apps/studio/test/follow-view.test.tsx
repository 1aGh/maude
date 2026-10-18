// S3.7a (S3-present-session §4, 04 Modes md-present-link) — following the presenter.
//
//   the page    URL grammar (`present=follow`, `sid`, `audience=1`), the frame is read-only + follow
//               (`ro=1&comments=0&follow=1`), the bar's words per state, Catch up posts `present-follow
//               {live: true}`, `audience=1` has no bar
//   the canvas  a follower canvas (`follow=1`) under a real CollabProvider (fake socket): the presenter's
//               awareness `present`, relayed in, moves its stage; ← turns Live off (drifted) and the
//               presenter moving on no longer moves it; Catch up rejoins; locked ignores keys; it
//               publishes `watching`, never a `present` of its own; the presenter stopping = ended
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

beforeAll(() => {
  if (typeof window === 'undefined')
    GlobalRegistrator.register({
      url: 'http://127.0.0.1:4399/',
      settings: { disableIframePageLoading: true },
    } as never);
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(async () => {
  if (GlobalRegistrator.isRegistered) await GlobalRegistrator.unregister();
});

import { act, createElement, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate } from 'y-protocols/awareness';
import * as Y from 'yjs';
import { canvasModeStore } from '../bridge/canvas-mode-store.ts';
import type { ArtboardRect } from '../canvas-lib.tsx';
import { canvasUrl } from '../client/canvas-url.js';
import {
  followOpenRel,
  isFollowLocation,
  readFollowParams,
  supportsAudienceLock,
} from '../client/v2/present/follow-location.js';
import { cleanName, followBarModel } from '../client/v2/present/follow-model.js';
import FollowView, { FollowBar } from '../client/v2/present/follow-view.jsx';
import { type Camera, usePresentStage } from '../present/present-stage.tsx';
import { CollabProvider, useCollab } from '../use-collab.tsx';

const loc = (search: string) => ({ search }) as Location;
/** Point this document at `rel` on the studio origin (happy-dom's own setter when it has one). */
function setUrl(rel: string) {
  const href = new URL(rel, 'http://127.0.0.1:4399/').href;
  const hd = (window as unknown as { happyDOM?: { setURL(u: string): void } }).happyDOM;
  if (hd?.setURL) hd.setURL(href);
  else history.replaceState(null, '', href);
}
const flush = () => new Promise((r) => setTimeout(r, 0));

// ── the page ──────────────────────────────────────────────────────────────────────────────────────

describe('the follower URL', () => {
  test('present=follow selects the root, exactly', () => {
    expect(isFollowLocation(loc('?open=ui/deck.tsx&present=follow'))).toBe(true);
    expect(isFollowLocation(loc('?open=ui/deck.tsx&present=follow&embed=1'))).toBe(true); // before embed
    expect(isFollowLocation(loc('?present=Follow'))).toBe(false);
    expect(isFollowLocation(loc('?open=ui/deck.tsx'))).toBe(false);
  });

  test('sid: the grammar or nothing; audience=1 is a lock, nothing looser', () => {
    expect(
      readFollowParams(loc('?open=ui/deck.tsx&present=follow&sid=k3x9q2m7p0w4'))
    ).toMatchObject({
      open: 'ui/deck.tsx',
      sid: 'k3x9q2m7p0w4',
      audience: false,
    });
    for (const s of ['abc', 'K3X9Q2M7P0W4', 'a'.repeat(33), 'k3x9q2m7p0w4&sid=zzzzzzzz9'])
      expect(readFollowParams(loc(`?open=ui/deck.tsx&present=follow&sid=${s}`)).sid).toBeNull();
    expect(readFollowParams(loc('?open=a.tsx&present=follow&audience=1')).audience).toBe(true);
    expect(readFollowParams(loc('?open=a.tsx&present=follow&audience=true')).audience).toBe(false);
    expect(readFollowParams(loc('?present=follow')).open).toBeNull();
  });

  // S3.6a security review (1): an audience URL is the follower root's or nobody's.
  test('a URL carrying audience never reaches the editor root; without present=follow it is refused', () => {
    expect(isFollowLocation(loc('?open=ui/deck.tsx&audience=1'))).toBe(true);
    expect(isFollowLocation(loc('?open=ui/deck.tsx&audience=0'))).toBe(true);
    expect(readFollowParams(loc('?open=ui/deck.tsx&audience=1')).ok).toBe(false);
    expect(readFollowParams(loc('?open=ui/deck.tsx&present=follow&audience=0')).ok).toBe(false);
    expect(readFollowParams(loc('?open=ui/deck.tsx&present=follow&audience=1&audience=1')).ok).toBe(
      false
    );
    expect(readFollowParams(loc('?open=ui/deck.tsx&present=follow&audience=1')).ok).toBe(true);
    expect(supportsAudienceLock).toBe(true);
  });

  // S3.6a security review (2): `open` decoded once, then the canvas design-rel grammar.
  test('open: decoded once, re-checked on the decoded value', () => {
    const open = (raw: string) => readFollowParams(loc(`?present=follow&open=${raw}`)).open;
    expect(open('ui/deck.tsx')).toBe('ui/deck.tsx');
    expect(open('.design/ui/deck.tsx')).toBe('ui/deck.tsx');
    expect(open('Combine%20Kampan.tsx')).toBe('Combine Kampan.tsx');
    for (const bad of [
      '../secret.tsx',
      'ui/../../x.tsx',
      'ui/%2E%2E/x.tsx', // decodes to ui/../x.tsx
      'a%252e.tsx', // one decode leaves a `%` — never decoded twice
      '_state/x.tsx',
      'ui/_draw/a.proof.tsx',
      'a.tsx%3Fx=1',
      'a.tsx%23frag',
      'a%5Cb.tsx',
      'c%3A/x.tsx',
      'ui/deck.html',
      'ui/deck',
      'ui//deck.tsx',
      'a%00.tsx',
      `${'a/'.repeat(520)}x.tsx`,
    ])
      expect([bad, open(bad)]).toEqual([bad, null]);
    expect(followOpenRel('ui/deck.tsx')).toBe('ui/deck.tsx');
  });

  test('the canvas frame is read-only, comment-free and a follower', () => {
    const q = new URL(
      canvasUrl('.design/ui/deck.tsx', { designRel: '.design' }, { follow: true }),
      'http://x'
    ).searchParams;
    expect([q.get('ro'), q.get('comments'), q.get('follow'), q.get('embed')]).toEqual([
      '1',
      '0',
      '1',
      null,
    ]);
  });
});

const STATE = {
  live: true,
  sid: 'k3x9q2m7p0w4',
  presenterName: 'Tereza',
  presenterIndex: 5,
  index: 5,
  total: 14,
  watchers: 6,
  ended: false,
};

describe('the follow bar', () => {
  test('words per state', () => {
    expect(followBarModel(null).phase).toBe('waiting');
    expect(followBarModel({ ...STATE, sid: null, total: 0 }).phase).toBe('waiting');
    expect(followBarModel(STATE)).toMatchObject({
      phase: 'live',
      presenterAt: '6 of 14',
      action: null,
    });
    expect(followBarModel({ ...STATE, live: false, index: 4 })).toMatchObject({
      phase: 'drifted',
      presenterAt: '6 of 14',
      youAt: '5',
      action: 'catch-up',
    });
    expect(followBarModel({ ...STATE, ended: true })).toMatchObject({
      phase: 'ended',
      action: 'open-canvas',
    });
    expect(followBarModel({ ...STATE, watchers: 140 }).watchers).toBe('99+ watching');
  });

  test('the presenter name is text, re-clamped: bidi and control characters go', () => {
    expect(cleanName('Te‮reza\u0007')).toBe('Tereza');
    expect(cleanName('x'.repeat(200))).toHaveLength(64);
    expect(cleanName(5)).toBe('');
  });

  test('drifted renders Catch up; live does not', () => {
    const el = document.createElement('div');
    const root = createRoot(el);
    let caught = 0;
    act(() =>
      root.render(
        createElement(FollowBar, {
          state: { ...STATE, live: false, index: 4 },
          openHref: '/?open=ui/deck.tsx',
          onCatchUp: () => caught++,
        })
      )
    );
    expect(el.textContent).toContain("Tereza is on 6 of 14 · you're on 5");
    const btn = el.querySelector('[data-testid="follow-catch-up"]') as HTMLButtonElement;
    act(() => btn.click());
    expect(caught).toBe(1);
    act(() =>
      root.render(createElement(FollowBar, { state: STATE, openHref: null, onCatchUp: () => {} }))
    );
    expect(el.querySelector('[data-testid="follow-catch-up"]')).toBeNull();
    expect(el.querySelector('[data-testid="follow-watchers"]')?.textContent).toBe('6 watching');
    // a name is never markup
    act(() =>
      root.render(
        createElement(FollowBar, {
          state: { ...STATE, presenterName: '<img src=x onerror=alert(1)>' },
          openHref: null,
          onCatchUp: () => {},
        })
      )
    );
    expect(el.querySelector('img')).toBeNull();
    act(() => root.unmount());
  });
});

describe('the follower page', () => {
  const CANVAS_ORIGIN = 'http://127.0.0.1:5999';
  const realFetch = globalThis.fetch;
  const configReads: string[] = [];
  let root: Root | null = null;
  let el: HTMLElement;

  beforeAll(() => {
    globalThis.fetch = (async (url: string) => {
      const u = String(url);
      if (u.startsWith('/_config')) {
        configReads.push(u);
        return new Response(JSON.stringify({ designRoot: '.design', canvasOrigin: CANVAS_ORIGIN }));
      }
      if (u === '/_index-data')
        return new Response(JSON.stringify({ groups: [{ paths: ['.design/ui/deck.tsx'] }] }));
      return new Response('{}', { status: 404 });
    }) as unknown as typeof fetch;
  });
  afterAll(() => {
    globalThis.fetch = realFetch;
  });

  async function boot(search: string) {
    setUrl(`/${search}`);
    el = document.createElement('div');
    document.body.appendChild(el);
    root = createRoot(el);
    await act(async () => {
      root?.render(createElement(FollowView));
      for (let i = 0; i < 5; i++) await flush();
    });
    return el.querySelector('[data-testid="follow-canvas-frame"]') as HTMLIFrameElement;
  }
  function unmount() {
    act(() => root?.unmount());
    el.remove();
    root = null;
  }

  test('frames the canvas read-only and asks for the read-only capability', async () => {
    const frame = await boot('?open=ui/deck.tsx&present=follow&sid=k3x9q2m7p0w4');
    expect(frame).not.toBeNull();
    const q = new URL(frame.getAttribute('src') ?? '', CANVAS_ORIGIN).searchParams;
    expect([q.get('canvas'), q.get('ro'), q.get('comments'), q.get('follow')]).toEqual([
      'ui/deck.tsx',
      '1',
      '0',
      '1',
    ]);
    expect(configReads.every((u) => u === '/_config?embed=1')).toBe(true);
    // waiting until the canvas reports
    expect(el.querySelector('[data-testid="follow-bar"]')?.textContent).toContain(
      'Waiting for the presenter'
    );

    // the canvas says where it is → the bar; a message from anywhere else is ignored
    const win = frame.contentWindow as Window;
    const sent: unknown[] = [];
    (win as unknown as { postMessage: (m: unknown) => void }).postMessage = (m) => sent.push(m);
    const say = (data: unknown, source: unknown = win, origin = CANVAS_ORIGIN) =>
      act(() => {
        window.dispatchEvent(
          new MessageEvent('message', { data, source: source as Window, origin })
        );
      });
    say({ dgn: 'present-follow-state', ...STATE, live: false, index: 4 }, window, CANVAS_ORIGIN);
    say({ dgn: 'present-follow-state', ...STATE, live: false, index: 4 }, win, 'http://evil.test');
    expect(el.querySelector('[data-testid="follow-catch-up"]')).toBeNull();
    say({ dgn: 'present-follow-state', ...STATE, live: false, index: 4 });
    const btn = el.querySelector('[data-testid="follow-catch-up"]') as HTMLButtonElement;
    expect(btn).not.toBeNull();
    act(() => btn.click());
    expect(sent.at(-1)).toEqual({
      dgn: 'present-follow',
      sid: 'k3x9q2m7p0w4',
      live: true,
      locked: false,
    });

    // `loaded` seeds Present · Artboards with no caps, then the follow
    say({ dgn: 'loaded', file: 'ui/deck.tsx' });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    const setMode = sent.find((m) => (m as { dgn?: string }).dgn === 'set-mode') as Record<
      string,
      unknown
    >;
    expect(setMode).toMatchObject({
      mode: 'present',
      present: { kind: 'artboards', from: 'start' },
      caps: { edit: false, annotate: false, comment: false, present: false },
    });
    unmount();
  });

  test('an audience URL that is not a follower URL renders nothing and fetches nothing', async () => {
    const before = configReads.length;
    await boot('?open=ui/deck.tsx&audience=1');
    expect(configReads.length).toBe(before);
    expect(el.querySelector('[data-testid="follow-canvas-frame"]')).toBeNull();
    expect(el.querySelector('[data-testid="follow-view"]')?.textContent).toBe('');
    unmount();
  });

  test('audience=1: no bar, no pointer, the follow is locked', async () => {
    const frame = await boot('?open=ui/deck.tsx&present=follow&sid=k3x9q2m7p0w4&audience=1');
    expect(el.querySelector('[data-testid="follow-view"]')?.getAttribute('data-audience')).toBe(
      '1'
    );
    const win = frame.contentWindow as Window;
    const sent: Array<Record<string, unknown>> = [];
    (win as unknown as { postMessage: (m: Record<string, unknown>) => void }).postMessage = (m) =>
      sent.push(m);
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { dgn: 'present-follow-state', ...STATE, live: false, index: 4 },
          source: win,
          origin: CANVAS_ORIGIN,
        })
      );
    });
    expect(el.querySelector('[data-testid="follow-bar"]')).toBeNull();
    expect(el.querySelector('[data-testid="follow-catch-up"]')).toBeNull();
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { dgn: 'loaded', file: 'ui/deck.tsx' },
          source: win,
          origin: CANVAS_ORIGIN,
        })
      );
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(sent.find((m) => m.dgn === 'present-follow')).toEqual({
      dgn: 'present-follow',
      sid: 'k3x9q2m7p0w4',
      live: true,
      locked: true,
    });
    unmount();
  });
});

// ── the canvas ────────────────────────────────────────────────────────────────────────────────────

class FakeWS {
  static OPEN = 1;
  static CLOSED = 3;
  static closed = 0;
  readyState = 1;
  private handlers: Record<string, Array<(e: unknown) => void>> = {};
  constructor(public url: string) {
    queueMicrotask(() => this.dispatch('open', {}));
  }
  addEventListener(type: string, fn: (e: unknown) => void) {
    const bucket = this.handlers[type] ?? [];
    bucket.push(fn);
    this.handlers[type] = bucket;
  }
  removeEventListener() {}
  send() {}
  close() {
    if (this.readyState === FakeWS.CLOSED) return;
    this.readyState = FakeWS.CLOSED;
    FakeWS.closed++;
    this.dispatch('close', {});
  }
  private dispatch(type: string, e: unknown) {
    for (const fn of this.handlers[type] ?? []) fn(e);
  }
}

const BOARDS: ArtboardRect[] = [
  { id: 'post-1x1', x: 0, y: 0, w: 1080, h: 1080, kind: 'digital' },
  { id: 'story', x: 1300, y: 0, w: 1080, h: 1920, kind: 'video' },
  { id: 'home', x: 0, y: 2300, w: 1440, h: 2000, kind: 'web' },
];
const SID = 'k3x9q2m7p0w4z8a1';

describe('a follower canvas follows the presenter', () => {
  const posts: Array<Record<string, unknown>> = [];
  const fakeParent = { postMessage: (m: Record<string, unknown>) => posts.push(m) };
  const realWS = globalThis.WebSocket;
  const realFetch = globalThis.fetch;
  let realParent: PropertyDescriptor | undefined;
  let root: Root | null = null;
  let host: HTMLElement;
  let collab: ReturnType<typeof useCollab> = null;
  const camera = { current: { x: 0, y: 0, zoom: 1 } as Camera };
  const presenterDoc = new Y.Doc();
  const presenter = new Awareness(presenterDoc);

  const states = () => posts.filter((p) => p.dgn === 'present-follow-state');
  const at = () => posts.filter((p) => p.dgn === 'present-position').at(-1)?.artboardId;
  const fromShell = (data: Record<string, unknown>) =>
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', { source: fakeParent as unknown as Window, data })
      );
    });
  const present = (index: number, seq: number, artboardId = BOARDS[index].id) =>
    act(() => {
      presenter.setLocalState({
        name: 'Tereza',
        present: { v: 1, sid: SID, index, total: 3, artboardId, seq, media: null },
      });
      if (!collab) throw new Error('no collab');
      applyAwarenessUpdate(
        collab.awareness,
        encodeAwarenessUpdate(presenter, [presenter.clientID]),
        'relay'
      );
    });
  const press = (key: string) =>
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
    });

  function Probe() {
    collab = useCollab();
    const hostRef = { current: host };
    const worldRef = { current: host.firstElementChild as HTMLElement };
    usePresentStage({
      hostRef,
      worldRef,
      artboards: BOARDS,
      controller: { viewport: camera.current, setViewport: (v) => (camera.current = { ...v }) },
      selection: null,
    });
    useEffect(() => {});
    return null;
  }

  beforeAll(async () => {
    (globalThis as unknown as { WebSocket: unknown }).WebSocket = FakeWS;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ name: 'Audience' }))) as unknown as typeof fetch;
    setUrl('/_canvas-shell.html?canvas=ui/deck.tsx&ro=1&comments=0&follow=1');
    realParent = Object.getOwnPropertyDescriptor(window, 'parent');
    Object.defineProperty(window, 'parent', { configurable: true, get: () => fakeParent });
    (window as unknown as { matchMedia: unknown }).matchMedia = () => ({ matches: true });
    host = document.createElement('div');
    Object.defineProperty(host, 'clientWidth', { value: 1600 });
    Object.defineProperty(host, 'clientHeight', { value: 900 });
    host.appendChild(document.createElement('div'));
    document.body.appendChild(host);
    root = createRoot(document.createElement('div'));
    await act(async () => {
      root?.render(createElement(CollabProvider, { slug: 'ui-deck' }, createElement(Probe)));
      await flush();
    });
    // the follower page's seed: Present · Artboards, no caps — even if a shell sent present: true
    fromShell({
      dgn: 'set-mode',
      v: 2,
      seq: canvasModeStore(window).get().modeSeq + 1,
      mode: 'present',
      present: { kind: 'artboards', from: 'start' },
      caps: { edit: false, annotate: false, comment: false, present: true },
    });
    fromShell({ dgn: 'present-follow', sid: null, live: true, locked: false });
  });
  afterAll(async () => {
    act(() => root?.unmount());
    presenter.destroy();
    presenterDoc.destroy();
    // the session's grace period ends and its socket closes: nothing is left open
    await new Promise((r) => setTimeout(r, 4200));
    expect(FakeWS.closed).toBeGreaterThanOrEqual(1);
    host.remove();
    if (realParent) Object.defineProperty(window, 'parent', realParent);
    else Reflect.deleteProperty(window, 'parent');
    (globalThis as unknown as { WebSocket: unknown }).WebSocket = realWS;
    globalThis.fetch = realFetch;
    setUrl('/');
  });

  test('waiting: on the first artboard, no presenter yet', () => {
    expect(at()).toBe('post-1x1');
    expect(states().at(-1)).toMatchObject({ sid: null, ended: false, watchers: 1 });
  });

  test("live: the presenter's artboard, published by awareness", async () => {
    present(1, 0);
    expect(at()).toBe('story');
    expect(states().at(-1)).toMatchObject({
      live: true,
      sid: SID,
      presenterName: 'Tereza',
      presenterIndex: 1,
      index: 1,
      total: 3,
    });
    // a follower watches; it never publishes a position of its own (caps.present is forced off)
    await act(async () => {
      await new Promise((r) => setTimeout(r, 60));
    });
    const mine = collab?.awareness.getLocalState() as { watching?: unknown; present?: unknown };
    expect(mine.watching).toBe(SID);
    expect(mine.present ?? null).toBeNull();
    expect(canvasModeStore(window).get().caps?.present).toBe(false);
  });

  test('a late relay with a lower seq moves nothing', () => {
    present(2, 5);
    present(0, 3);
    expect(at()).toBe('home');
  });

  test('← turns Live off: drifted, and the presenter moving on no longer moves it', () => {
    press('ArrowLeft');
    expect(at()).toBe('story');
    expect(states().at(-1)).toMatchObject({ live: false, index: 1, presenterIndex: 2 });
    present(0, 6);
    expect(at()).toBe('story');
    expect(states().at(-1)).toMatchObject({ live: false, index: 1, presenterIndex: 0 });
  });

  test("Catch up rejoins: back on the presenter's artboard, live", () => {
    fromShell({ dgn: 'present-follow', sid: null, live: true, locked: false });
    expect(at()).toBe('post-1x1');
    expect(states().at(-1)).toMatchObject({ live: true, index: 0, presenterIndex: 0 });
  });

  test('locked (the audience window): keys do nothing', () => {
    fromShell({ dgn: 'present-follow', sid: null, live: true, locked: true });
    const before = posts.length;
    press('ArrowRight');
    press('Escape');
    expect(at()).toBe('post-1x1');
    expect(posts.slice(before).filter((p) => p.dgn === 'mode-request')).toEqual([]);
    expect(host.style.cursor).toBe('none');
    fromShell({ dgn: 'present-follow', sid: null, live: true, locked: false });
    expect(host.style.cursor).toBe('');
  });

  test('the presenter stops: ended, on the last artboard', () => {
    act(() => {
      presenter.setLocalState({ name: 'Tereza', present: null });
      if (collab)
        applyAwarenessUpdate(
          collab.awareness,
          encodeAwarenessUpdate(presenter, [presenter.clientID]),
          'relay'
        );
    });
    expect(states().at(-1)).toMatchObject({ ended: true, presenterName: 'Tereza' });
    expect(at()).toBe('post-1x1');
  });

  test('present-follow is ignored by a canvas that is not a follower', () => {
    setUrl('/_canvas-shell.html?canvas=ui/deck.tsx');
    const n = canvasModeStore(window).get().follow?.n;
    fromShell({ dgn: 'present-follow', sid: null, live: false, locked: true });
    expect(canvasModeStore(window).get().follow?.n).toBe(n);
    setUrl('/_canvas-shell.html?canvas=ui/deck.tsx&ro=1&comments=0&follow=1');
  });
});
