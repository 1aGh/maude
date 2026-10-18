// S9.23 — the canvas half of presence, through the real hook + overlay (happy-dom + React, stub deps):
//   canvas 10 co-follow (frame + pill, ends on esc / scroll / click), co-bring (the glide), co-spotlight
//   (Everyone here is following you · N, Stop), Q9 (idle after 3 min, the fields publish).
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
import { Cursor } from '../cursors-overlay.tsx';
import {
  canSummonWith,
  type PresenceDeps,
  PresenceOverlay,
  runPresenceAction,
  usePresence,
} from '../presence/canvas-presence.tsx';
import { IDLE_MS } from '../presence/fields.ts';
import type { ForeignAwareness } from '../use-collab.tsx';

const T0 = 1_800_000_000_000;
let clock = T0;
let root: Root | null = null;
let host: HTMLElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  clock = T0;
});

const peer = (
  clientID: number,
  name: string,
  over: Partial<ForeignAwareness> = {}
): ForeignAwareness =>
  ({
    clientID,
    name,
    color: 'x',
    cursor: null,
    selection: null,
    annotationSelection: [],
    viewport: { x: clientID * 10, y: 0, zoom: 1 },
    ...over,
  }) as ForeignAwareness;

function makeDeps(over: Partial<PresenceDeps> = {}) {
  const published: Array<Record<string, unknown>> = [];
  const viewports: Array<{ x: number; y: number; zoom: number }> = [];
  const framed: string[] = [];
  const deps: PresenceDeps = {
    publish: (p) => published.push(p),
    myClientID: () => 1,
    myCursor: () => ({ x: 500, y: 300 }),
    setViewport: (v) => viewports.push(v),
    frameArtboard: (id) => {
      framed.push(id);
      return true;
    },
    camera: () => ({ x: 0, y: 0, zoom: 1 }),
    viewCentre: () => ({ x: 400, y: 300 }),
    canSummon: () => true,
    reducedMotion: () => false,
    now: () => clock,
    idlePollMs: 5,
    ...over,
  };
  return { deps, published, viewports, framed };
}

type View = ReturnType<typeof usePresence>;
let latest: View | null = null;
function Harness({
  peers,
  deps,
  artboard = 'a4',
}: {
  peers: ForeignAwareness[];
  deps: PresenceDeps;
  artboard?: string | null;
}) {
  const view = usePresence(peers, deps, { artboard, surface: 'app' });
  latest = view;
  return <PresenceOverlay view={view} camera={deps.camera()} />;
}
async function mount(peers: ForeignAwareness[], deps: PresenceDeps) {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root?.render(<Harness peers={peers} deps={deps} />));
  const rerender = async (next: ForeignAwareness[]) =>
    act(async () => root?.render(<Harness peers={next} deps={deps} />));
  const q = (id: string) => host?.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
  const all = (sel: string) => Array.from(host?.querySelectorAll(sel) ?? []);
  return { rerender, q, all };
}
const key = async (k: string) =>
  act(async () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
  });

describe('publishing where I am (Q9)', () => {
  test('artboard and surface go into awareness, and re-publish when the artboard changes', async () => {
    const { deps, published } = makeDeps();
    const { rerender } = await mount([], deps);
    expect(published).toContainEqual({ artboard: 'a4', surface: 'app' });
    await act(async () => root?.render(<Harness peers={[]} deps={deps} artboard="web" />));
    expect(published.at(-1)).toMatchObject({ artboard: 'web' });
    void rerender;
  });

  test('3 minutes without input → idleSince = the last input; any input clears it', async () => {
    const { deps, published } = makeDeps();
    await mount([], deps);
    expect(published.some((p) => 'idleSince' in p)).toBe(false);
    clock = T0 + IDLE_MS + 1000;
    await act(async () => new Promise((r) => setTimeout(r, 30)));
    expect(published.find((p) => 'idleSince' in p)).toEqual({ idleSince: T0 });
    await act(async () => {
      window.dispatchEvent(new Event('pointermove'));
    });
    expect(published.at(-1)).toEqual({ idleSince: null });
  });

  test('input in the shell (the chat, the inspector) is the person being here', async () => {
    const { deps, published } = makeDeps();
    await mount([], deps);
    clock = T0 + IDLE_MS + 1000;
    await act(async () => latest?.setContext({ active: true }));
    await act(async () => new Promise((r) => setTimeout(r, 30)));
    expect(published.some((p) => 'idleSince' in p && p.idleSince !== null)).toBe(false);
  });

  test('the Comments panel is told to it as inComments', async () => {
    const { deps, published } = makeDeps();
    await mount([], deps);
    await act(async () => latest?.setContext({ inComments: true }));
    expect(published.at(-1)).toEqual({ inComments: true });
  });
});

describe('Follow (co-follow)', () => {
  const tereza = () => peer(7, 'Tereza K', { viewport: { x: -120, y: 40, zoom: 0.57 } });
  test('following mirrors her camera; the frame and the pill say so; her tone, not mine', async () => {
    const { deps, viewports, published } = makeDeps();
    const { q } = await mount([tereza()], deps);
    expect(q('presence-follow-pill')).toBeNull();
    expect(runPresenceAction(latest as never, 'presence.follow', { clientID: 7 })).toBe(true);
    await act(async () => {});
    expect(viewports.at(-1)).toEqual({ x: -120, y: 40, zoom: 0.57 });
    expect(q('presence-follow-pill')?.textContent).toContain('Following Tereza');
    expect(q('presence-follow-pill')?.textContent).toContain('esc');
    expect(q('presence-frame')?.dataset.kind).toBe('follow');
    expect(published.at(-1)).toEqual({ followTarget: 7 });
  });

  test('following again stops it; the retired peer.follow id is no longer presence’s', async () => {
    const { deps } = makeDeps();
    const { q } = await mount([tereza()], deps);
    expect(runPresenceAction(latest as never, 'peer.follow', { clientID: 7 })).toBe(false);
    runPresenceAction(latest as never, 'presence.follow', { clientID: 7 });
    await act(async () => {});
    expect(q('presence-follow-pill')).not.toBeNull();
    runPresenceAction(latest as never, 'presence.follow', { clientID: 7 });
    await act(async () => {});
    expect(q('presence-follow-pill')).toBeNull();
  });

  test('esc, a scroll and a click each end it', async () => {
    for (const end of [
      () => key('Escape'),
      () => act(async () => void window.dispatchEvent(new Event('wheel'))),
      () => act(async () => void window.dispatchEvent(new Event('pointerdown', { bubbles: true }))),
    ]) {
      const { deps } = makeDeps();
      const { q } = await mount([tereza()], deps);
      runPresenceAction(latest as never, 'presence.follow', { clientID: 7 });
      await act(async () => {});
      expect(q('presence-follow-pill')).not.toBeNull();
      await end();
      expect(q('presence-follow-pill')).toBeNull();
      act(() => root?.unmount());
      host?.remove();
    }
  });

  test('other keys do not end it; the target leaving does', async () => {
    const { deps } = makeDeps();
    const { q, rerender } = await mount([tereza()], deps);
    runPresenceAction(latest as never, 'presence.follow', { clientID: 7 });
    await act(async () => {});
    await key('a');
    expect(q('presence-follow-pill')).not.toBeNull();
    await rerender([]);
    expect(q('presence-follow-pill')).toBeNull();
  });

  test('Go to frames the artboard they are on, and does not follow', async () => {
    const { deps, framed } = makeDeps();
    const { q } = await mount([peer(7, 'Tereza K', { artboard: 'a4' })], deps);
    runPresenceAction(latest as never, 'presence.go-to', { clientID: 7 });
    expect(framed).toEqual(['a4']);
    expect(q('presence-follow-pill')).toBeNull();
  });
});

describe('Bring everyone here (co-bring / co-spotlight)', () => {
  test('without the capability nothing is published and nothing moves', async () => {
    const { deps, published } = makeDeps({ canSummon: () => false });
    const { q } = await mount([peer(7, 'Tereza K')], deps);
    runPresenceAction(latest as never, 'presence.bring-everyone', undefined);
    await act(async () => {});
    expect(published.some((p) => 'summon' in p)).toBe(false);
    expect(q('presence-spotlight-pill')).toBeNull();
  });

  test('it publishes {id, at}, draws the glide nearest first, and the pill counts who follows me', async () => {
    const { deps, published } = makeDeps();
    const peers = [
      peer(7, 'Tereza K', { cursor: { x: 900, y: 300 } }),
      peer(9, 'Jonas', { cursor: { x: 520, y: 300 } }),
    ];
    const { q, all, rerender } = await mount(peers, deps);
    runPresenceAction(latest as never, 'presence.bring-everyone', undefined);
    await act(async () => {});
    const sent = published.find((p) => 'summon' in p)?.summon as { id: string; at: number };
    expect(sent.at).toBe(T0);
    expect(sent.id).toMatch(/^[a-z0-9]{8,32}$/);
    expect(q('presence-frame')?.dataset.kind).toBe('spotlight');
    const ghosts = all('[data-testid^="presence-bring-ghost-"]');
    expect(ghosts.map((g) => g.getAttribute('data-testid'))).toEqual([
      'presence-bring-ghost-9',
      'presence-bring-ghost-7',
    ]);
    expect(ghosts.map((g) => g.getAttribute('data-delay'))).toEqual(['0', '40']);
    expect(ghosts.every((g) => g.getAttribute('data-duration') === '420')).toBe(true);
    expect(q('presence-spotlight-pill')?.textContent).toContain(
      'Everyone here is following you · 0 people'
    );
    await rerender(peers.map((p) => ({ ...p, followTarget: 1 })));
    expect(q('presence-spotlight-pill')?.textContent).toContain(
      'Everyone here is following you · 2 people'
    );
  });

  test('reduced motion: the glide is 1 ms with no stagger and no wake', async () => {
    const { deps } = makeDeps({ reducedMotion: () => true });
    const { all } = await mount(
      [peer(7, 'T', { cursor: { x: 900, y: 300 } }), peer(9, 'J', { cursor: { x: 520, y: 300 } })],
      deps
    );
    runPresenceAction(latest as never, 'presence.bring-everyone', undefined);
    await act(async () => {});
    const ghosts = all('[data-testid^="presence-bring-ghost-"]');
    expect(ghosts.length).toBe(2);
    expect(
      ghosts.every(
        (g) => g.getAttribute('data-duration') === '1' && g.getAttribute('data-delay') === '0'
      )
    ).toBe(true);
    expect(host?.querySelectorAll('.dc-bring-wake line').length).toBe(0);
  });

  test('Stop clears the field for everyone and takes the pill away', async () => {
    const { deps, published } = makeDeps();
    const { q } = await mount([peer(7, 'Tereza K', { followTarget: 1 })], deps);
    runPresenceAction(latest as never, 'presence.bring-everyone', undefined);
    await act(async () => {});
    expect(q('presence-spotlight-pill')).not.toBeNull();
    await act(async () => q('presence-spotlight-stop')?.click());
    expect(published.at(-1)).toEqual({ summon: null });
    expect(q('presence-spotlight-pill')).toBeNull();
  });

  test('a Bring nobody answered ends itself; one that is answered stays until Stop', async () => {
    const { deps, published } = makeDeps({ spotlightEmptyMs: 10 });
    const { q } = await mount([peer(7, 'Tereza K')], deps);
    runPresenceAction(latest as never, 'presence.bring-everyone', undefined);
    await act(async () => {});
    expect(q('presence-spotlight-pill')).not.toBeNull();
    await act(async () => new Promise((r) => setTimeout(r, 40)));
    expect(published.at(-1)).toEqual({ summon: null });
    expect(q('presence-spotlight-pill')).toBeNull();
  });

  test('an answered Bring stays until Stop', async () => {
    const { deps } = makeDeps({ spotlightEmptyMs: 10 });
    const { q } = await mount([peer(7, 'Tereza K', { followTarget: 1 })], deps);
    runPresenceAction(latest as never, 'presence.bring-everyone', undefined);
    await act(async () => {});
    await act(async () => new Promise((r) => setTimeout(r, 40)));
    expect(q('presence-spotlight-pill')).not.toBeNull();
  });

  test('hearing someone’s Bring moves me to them, esc leaves, and the same ask does not move me again', async () => {
    const { deps, viewports } = makeDeps();
    const asked = (n: number) => [
      peer(9, 'Jonas', {
        summon: { id: 'abcdefgh1234', at: T0 - 200 },
        viewport: { x: 5, y: 6, zoom: 2 },
        ...(n ? {} : {}),
      }),
    ];
    const { q, rerender } = await mount([], deps);
    await rerender(asked(0));
    expect(q('presence-follow-pill')?.textContent).toContain('Following Jonas');
    expect(viewports.at(-1)).toEqual({ x: 5, y: 6, zoom: 2 });
    await key('Escape');
    expect(q('presence-follow-pill')).toBeNull();
    await rerender(asked(1));
    expect(q('presence-follow-pill')).toBeNull();
  });

  test('Stop from the leader releases the followers they brought', async () => {
    const { deps } = makeDeps();
    const jonas = peer(9, 'Jonas', { summon: { id: 'abcdefgh1234', at: T0 - 200 } });
    const { q, rerender } = await mount([jonas], deps);
    expect(q('presence-follow-pill')).not.toBeNull();
    await rerender([{ ...jonas, summon: null }]);
    expect(q('presence-follow-pill')).toBeNull();
  });
});

describe('who may Bring everyone here', () => {
  test('only a canvas holding edit rights; a viewer, a commenter and an unseeded canvas may not', () => {
    expect(canSummonWith({ edit: true })).toBe(true);
    expect(canSummonWith({ edit: false })).toBe(false);
    expect(canSummonWith(null)).toBe(false);
    expect(canSummonWith(undefined)).toBe(false);
  });
});

describe('the shell’s lane', () => {
  test('unknown ids are not presence’s; a missing clientID follows no one', () => {
    const v = {
      toggle() {
        throw new Error('x');
      },
      goTo() {},
      bring() {},
      stop() {},
      setContext() {},
    };
    expect(runPresenceAction(v as never, 'edit.undo', undefined)).toBe(false);
    expect(runPresenceAction(v as never, 'presence.follow', { clientID: 'seven' })).toBe(true);
  });
});

describe('an idle cursor (Q9, co-twelve): grey, small, an initial', () => {
  test('active shows the name in the person’s colour; idle shows the initial in grey', async () => {
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    const vp = { x: 0, y: 0, zoom: 1 };
    const active = peer(7, 'Tereza K', { cursor: { x: 10, y: 20 }, color: 'oklch(0.78 0.10 230)' });
    await act(async () => root?.render(<Cursor peer={active} viewport={vp} />));
    expect(host.querySelector('.dc-cursor-label')?.textContent).toBe('Tereza K');
    expect(host.querySelector('.dc-cursor')?.getAttribute('data-idle')).toBeNull();
    const idle = { ...active, idleSince: T0 - IDLE_MS };
    await act(async () => root?.render(<Cursor peer={idle} viewport={vp} />));
    expect(host.querySelector('.dc-cursor-label')?.textContent).toBe('T');
    expect(host.querySelector('.dc-cursor')?.getAttribute('data-idle')).toBe('true');
  });
});
