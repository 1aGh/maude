// S3.8 (04 md-edge-offline, "Offline still presents") — presenter view with no internet.
//   · the top bar's "Audience on <display>" is replaced by "Offline — kept on this Mac"
//   · a clip whose file is not on this Mac: the Now box says why and offers Skip; Skip moves on
//   · local media needs no notice; online or off, only a missing file earns one
//   · Copy presentation link waits for a connection (its reason is the row's note)
// The host reads the existing GET /_api/assets for which files are here — no new endpoint.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

beforeAll(() => {
  if (typeof window === 'undefined') GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(async () => {
  if (GlobalRegistrator.isRegistered) await GlobalRegistrator.unregister();
});

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ACTIONS_BY_ID } from '../actions/index.ts';
import { isEnabled } from '../actions/resolve.ts';
import { ShellStoreContext } from '../client/stores/shell-store.jsx';
import { copyAvailability, copyPresentationLink } from '../client/v2/present/copy-link.js';
import { PresenterViewHost } from '../client/v2/present/presenter-host.jsx';
import { presenterStore, presentRunStore } from '../client/v2/present/presenter-store.js';
import { PresenterView } from '../client/v2/present/presenter-view.jsx';
import { menuCtx } from '../client/v2/shell/project-menu-model.js';
import { shellMode } from '../client/v2/shell/use-canvas-mode-lane.js';
import { watchArtboardMedia } from '../present/present-media.ts';

const BOARDS = [
  { id: 'a', label: 'Cover', x: 0, y: 0, w: 400, h: 300 },
  { id: 'b', label: 'Teaser', x: 500, y: 0, w: 225, h: 400 },
  { id: 'c', label: 'Poster', x: 0, y: 400, w: 400, h: 300 },
];
const SRC = (name: string) => `http://localhost:4399/.design/assets/${name}`;
const OFFLINE_WORD = 'Offline — kept on this Mac';
const NOTICE = "Clip isn't on this Mac — the audience sees its first frame";

let root: Root | null = null;
let host: HTMLElement | null = null;
const q = (id: string) => document.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
function render(ui: React.ReactNode) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root?.render(ui));
}
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

function view(over: Record<string, unknown> = {}) {
  const calls = { steps: [] as unknown[] };
  render(
    <PresenterView
      canvasName="Combine-kampan"
      position={{ index: 1, total: 3, artboardId: 'b' }}
      artboards={BOARDS}
      saved={null}
      elapsedMs={768_000}
      now={new Date(2026, 9, 18, 14, 5)}
      audience={{ status: 'on', displayName: 'LG UltraFine' }}
      onStep={(to: unknown) => calls.steps.push(to)}
      onEnd={() => {}}
      onRetry={() => {}}
      {...over}
    />
  );
  return calls;
}

describe('<PresenterView> offline', () => {
  test('online it says where the audience is; offline it says the project is kept on this Mac', () => {
    view();
    expect(q('presenter-audience')?.textContent).toBe('Audience on LG UltraFine');
    expect(q('presenter-offline')).toBeNull();
    act(() => root?.unmount());
    host?.remove();
    view({ offline: true });
    expect(q('presenter-offline')?.textContent).toBe(OFFLINE_WORD);
    expect(q('presenter-audience')).toBeNull();
  });

  test('an audience screen that would not open outranks the offline word — it is the one to act on', () => {
    view({
      offline: true,
      audience: {
        status: 'failed',
        displayName: 'LG UltraFine',
        message: 'That display went away.',
      },
    });
    expect(q('presenter-audience')?.textContent).toContain('That display went away.');
    expect(q('presenter-offline')).toBeNull();
  });

  test('a missing clip: the Now box says why, in the canvas’s words, with Skip', () => {
    const calls = view({ offline: true, clipMissing: true });
    expect(q('presenter-clip-missing')?.textContent).toContain(NOTICE);
    expect(q('presenter-now')?.contains(q('presenter-clip-missing'))).toBe(true);
    act(() => q('presenter-clip-skip')?.click());
    expect(calls.steps).toEqual(['next']);
  });

  test('no notice while every clip is here; Skip is out at the last artboard (nothing to skip to)', () => {
    view({ offline: true });
    expect(q('presenter-clip-missing')).toBeNull();
    act(() => root?.unmount());
    host?.remove();
    view({ clipMissing: true, position: { index: 2, total: 3, artboardId: 'c' } });
    expect(q('presenter-clip-missing')).not.toBeNull();
    expect(q('presenter-clip-skip')?.hasAttribute('disabled')).toBe(true);
  });
});

// ── the host: what is on this Mac, and whether the network is ─────────────────────────────────────
const g = globalThis as unknown as { window: Record<string, unknown> };
const realFetch = globalThis.fetch;
const realOnLine = Object.getOwnPropertyDescriptor(globalThis.navigator, 'onLine');
let asked: string[] = [];
let assets: string[] = [];

const store = (linked: boolean) => ({
  shellCore: {
    activePath: '.design/ui/campaign.tsx',
    cfg: { designRel: '.design', ...(linked ? { cloud: { projectName: 'p' } } : {}) },
  },
  photoAndTimeline: { exitPresent: () => {} },
});
const flush = () => act(async () => void (await new Promise((r) => setTimeout(r, 0))));
const setOnline = (on: boolean) => {
  Object.defineProperty(globalThis.navigator, 'onLine', { value: on, configurable: true });
  act(() => {
    window.dispatchEvent(new Event(on ? 'online' : 'offline'));
  });
};

beforeEach(() => {
  asked = [];
  assets = ['a.mp4'];
  shellMode.back();
  presenterStore.reset();
  presentRunStore.set(null);
  g.window.__TAURI__ = {
    core: {
      invoke: async (cmd: string) =>
        cmd === 'present_displays'
          ? [
              { id: 'aaaaaaaaaaaaaaaa', name: 'Built-in', primary: true, current: true },
              { id: 'bbbbbbbbbbbbbbbb', name: 'LG UltraFine', primary: false, current: false },
            ]
          : null,
    },
  };
  globalThis.fetch = (async (url: string) => {
    asked.push(String(url));
    if (String(url).startsWith('/_api/assets'))
      return new Response(
        JSON.stringify({ ok: true, assets: assets.map((n) => ({ path: `assets/${n}` })) })
      );
    return new Response(JSON.stringify({}));
  }) as unknown as typeof fetch;
});
afterEach(() => {
  g.window.__TAURI__ = undefined;
  globalThis.fetch = realFetch;
  if (realOnLine) Object.defineProperty(globalThis.navigator, 'onLine', realOnLine);
  else Reflect.deleteProperty(globalThis.navigator, 'onLine');
  act(() => {
    shellMode.back();
  });
  presenterStore.reset();
  presentRunStore.set(null);
});

async function mountHost(linked = true) {
  presentRunStore.set({ file: '.design/ui/campaign.tsx', artboards: BOARDS });
  act(() => presenterStore.setWanted(true));
  render(
    <ShellStoreContext.Provider value={store(linked) as never}>
      <PresenterViewHost />
    </ShellStoreContext.Provider>
  );
  act(() => {
    shellMode.present({ kind: 'artboards', from: 'start' });
  });
  act(() => {
    shellMode.position({ index: 1, total: 3, artboardId: 'b', sid: 'abcd1234' });
  });
  await flush();
}
const clip = (names: string[], over: Record<string, unknown> = {}) => {
  act(() => {
    shellMode.media({
      playing: false,
      t: 0,
      duration: 15,
      muted: false,
      sources: names.map(SRC),
      ...over,
    });
  });
  return flush();
};

describe('<PresenterViewHost> offline', () => {
  test('a linked project with the network off shows the offline word; online again, the audience', async () => {
    await mountHost();
    expect(q('presenter-audience')?.textContent).toBe('Audience on LG UltraFine');
    setOnline(false);
    await flush();
    expect(q('presenter-offline')?.textContent).toBe(OFFLINE_WORD);
    expect(q('presenter-audience')).toBeNull();
    setOnline(true);
    await flush();
    expect(q('presenter-offline')).toBeNull();
    expect(q('presenter-audience')).not.toBeNull();
  });

  test('a project that was never linked has nothing to keep: no offline word', async () => {
    await mountHost(false);
    setOnline(false);
    await flush();
    expect(q('presenter-offline')).toBeNull();
    expect(q('presenter-audience')).not.toBeNull();
  });

  test('local media plays without a word, offline or not', async () => {
    await mountHost();
    setOnline(false);
    await clip(['a.mp4']);
    expect(asked).toContain('/_api/assets');
    expect(q('presenter-clip-missing')).toBeNull();
  });

  test('a clip whose file is not on this Mac: the notice, with Skip', async () => {
    await mountHost();
    setOnline(false);
    await clip(['a.mp4', 'gone.mp4']);
    expect(q('presenter-clip-missing')?.textContent).toContain(NOTICE);
    // Skip is the view's own Next (present-step { to: 'next' }), wired like the Next button
    expect(q('presenter-clip-skip')).not.toBeNull();
  });

  test('the notice follows the artboard: moving on clears it; the file arriving clears it', async () => {
    await mountHost();
    await clip(['gone.mp4']);
    expect(q('presenter-clip-missing')).not.toBeNull();
    act(() => {
      shellMode.position({ index: 2, total: 3, artboardId: 'c', sid: 'abcd1234' });
    });
    await flush();
    expect(q('presenter-clip-missing')).toBeNull(); // the store drops the clip with the artboard
    await clip(['gone.mp4']);
    expect(q('presenter-clip-missing')).not.toBeNull();
    assets = ['gone.mp4']; // the file arrived while the network was out…
    setOnline(true); // …and the network is back: the list is read again
    await flush();
    expect(q('presenter-clip-missing')).toBeNull();
  });

  test('the list failing is not a verdict — no notice from a route that did not answer', async () => {
    await mountHost();
    globalThis.fetch = (async () => new Response('no', { status: 500 })) as never;
    await clip(['gone.mp4']);
    expect(q('presenter-clip-missing')).toBeNull();
  });

  test('a source that is not a project asset (a remote video) is not judged', async () => {
    await mountHost();
    act(() => {
      shellMode.media({
        playing: false,
        t: 0,
        duration: 15,
        muted: false,
        sources: ['https://cdn.example.com/x.mp4'],
      });
    });
    await flush();
    expect(q('presenter-clip-missing')).toBeNull();
  });
});

describe('Copy presentation link waits for a connection', () => {
  const WEB = 'https://a.cloud.maude.sh/?open=ui/A.tsx';

  test('availability: online and cloud-linked is enabled; offline waits, with the reason', () => {
    expect(copyAvailability({ webLink: WEB, online: true })).toEqual({ enabled: true });
    expect(copyAvailability({ webLink: WEB, online: false })).toEqual({
      enabled: false,
      reason: 'waits for a connection',
    });
    expect(copyAvailability({ webLink: null, online: true })).toEqual({
      enabled: false,
      reason: 'in a cloud project',
    });
    // no cloud link outranks offline: it is the more basic answer
    expect(copyAvailability({ webLink: null, online: false }).reason).toBe('in a cloud project');
  });

  test('the menu context carries the network as the `online` fact (the row’s enabled rule reads it)', () => {
    expect(menuCtx({}).facts.has('online')).toBe(true);
    expect(menuCtx({ online: true }).facts.has('online')).toBe(true);
    expect(menuCtx({ online: false }).facts.has('online')).toBe(false);
  });

  // A6c (S3.8 patches): the registry row reads the fact, and the shell's menu passes both facts —
  // `linkedHub` was missing on the desktop, so the row stayed greyed in every linked project.
  test('the row is enabled on online + a cloud link, greyed offline; app.jsx passes both facts', () => {
    const def = ACTIONS_BY_ID.get('present.copy-link');
    const linked = (online: boolean) => menuCtx({ native: true, linkedHub: true, online });
    expect(isEnabled(def, linked(true))).toBe(true);
    expect(isEnabled(def, linked(false))).toBe(false);
    expect(isEnabled(def, menuCtx({ cloudTab: true, online: false }))).toBe(false);
    expect(isEnabled(def, menuCtx({ native: true, online: true }))).toBe(false);
    const app = readFileSync(join(import.meta.dir, '..', 'client', 'app.jsx'), 'utf8');
    const call = app.slice(app.indexOf('menuCtx({\n        native,'));
    const args = call.slice(0, call.indexOf('})'));
    expect(args).toContain('linkedHub: !!cloudLinkedHub?.url');
    expect(args).toContain('online');
  });

  test('offline it copies nothing and says why', async () => {
    const toasts: { title: string; kind: string }[] = [];
    let wrote = 0;
    const ok = await copyPresentationLink({
      rel: 'ui/A.tsx',
      webLink: WEB,
      online: false,
      writeText: async () => {
        wrote += 1;
      },
      notify: (t: { title: string; kind: string }) => toasts.push(t),
    });
    expect(ok).toBe(false);
    expect(wrote).toBe(0);
    expect(toasts).toEqual([
      { title: 'Copy presentation link — waits for a connection', kind: 'error' },
    ]);
  });
});

// ── the DOM half of the engine's watch ────────────────────────────────────────────────────────────
describe('watchArtboardMedia — the media elements of one artboard', () => {
  const frame = (inner: string) => {
    document.body.innerHTML = `<div data-dc-screen="other"><video src="/.design/assets/x.mp4"></video></div>
      <div data-dc-screen="reel">${inner}</div>`;
  };
  afterEach(() => {
    document.body.innerHTML = '';
  });

  test('lists the files the artboard’s video and audio use, and nothing from another artboard', () => {
    frame(
      '<video src="/.design/assets/a.mp4"></video><audio src="/.design/assets/b.mp3"></audio><video src="/.design/assets/a.mp4"></video>'
    );
    const w = watchArtboardMedia(document, 'reel', () => {});
    expect(w.sources().map((s) => s.replace(/^.*\/assets\//, ''))).toEqual(['a.mp4', 'b.mp3']);
    w.off();
  });

  test('a media element failing to load (its error does not bubble) is heard, however late it mounts', () => {
    frame('');
    let fails = 0;
    const w = watchArtboardMedia(document, 'reel', () => {
      fails += 1;
    });
    const late = document.createElement('video');
    late.setAttribute('src', '/.design/assets/gone.mp4');
    document.querySelector('[data-dc-screen="reel"]')?.appendChild(late);
    late.dispatchEvent(new Event('error')); // like the browser: not bubbling
    expect(fails).toBe(1);
    // an unrelated element's error is not a media failure
    const img = document.createElement('img');
    document.querySelector('[data-dc-screen="reel"]')?.appendChild(img);
    img.dispatchEvent(new Event('error'));
    expect(fails).toBe(1);
    w.off();
    late.dispatchEvent(new Event('error'));
    expect(fails).toBe(1);
  });

  test('an element that had already failed counts at once; an unknown artboard watches nothing', () => {
    frame('<video src="/.design/assets/gone.mp4"></video>');
    const v = document.querySelector('[data-dc-screen="reel"] video') as HTMLVideoElement;
    Object.defineProperty(v, 'error', { value: { code: 4 } });
    let fails = 0;
    watchArtboardMedia(document, 'reel', () => {
      fails += 1;
    }).off();
    expect(fails).toBe(1);
    const none = watchArtboardMedia(document, 'nope', () => {
      fails += 1;
    });
    expect(none.sources()).toEqual([]);
    expect(fails).toBe(1);
  });
});
