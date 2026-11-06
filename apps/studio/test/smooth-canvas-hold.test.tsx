// 2.0.7 regression (desktop e2e video-*): the mount ring released or re-placeholdered the artboard the shell was
// working in. Every write soft-reloads the canvas (canvas-comment-mount.tsx `key=attempt` remounts the subtree);
// the remounted gate fell back to a placeholder for a few frames, right when the shell reselects after `loaded`,
// so the selected clip was gone and the Transcript / Re-frame panel closed and Present lost its selection.
// The rules pinned here, on a mounted DesignCanvas:
//   - an edit's remount keeps a mounted artboard's children in the same commit — never a placeholder in between;
//   - an artboard holding the selection is never released, however far it is panned away;
//   - the runtime lives on the document, so a soft reload (a fresh copy of the gate module) keeps what was mounted.
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act, createElement, useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';

type IOEntry = { target: Element; isIntersecting: boolean };
const observers: FakeIO[] = [];
class FakeIO {
  els = new Set<Element>();
  constructor(
    public cb: (e: IOEntry[]) => void,
    public opts?: { rootMargin?: string }
  ) {
    observers.push(this);
  }
  observe(el: Element) {
    this.els.add(el);
  }
  unobserve(el: Element) {
    this.els.delete(el);
  }
  disconnect() {
    this.els.clear();
  }
}
/** near = the prefetch + keep rings; visible = on screen */
function report(id: string, near: boolean, visible = near) {
  for (const o of observers) {
    for (const el of o.els) {
      if (el.getAttribute('data-dc-screen') !== id) continue;
      o.cb([{ target: el, isIntersecting: o.opts?.rootMargin ? near : visible }]);
    }
  }
}

describe('the mount ring never drops what the shell is working in', () => {
  let lib: typeof import('../canvas-lib.tsx');
  let gate: typeof import('../artboard-live-gate.tsx');
  let sel: typeof import('../use-selection-set.tsx');

  beforeAll(async () => {
    GlobalRegistrator.register();
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
      true;
    (globalThis as unknown as { IntersectionObserver: unknown }).IntersectionObserver = FakeIO;
    lib = await import('../canvas-lib.tsx');
    gate = await import('../artboard-live-gate.tsx');
    sel = await import('../use-selection-set.tsx');
  });
  afterAll(() => {
    GlobalRegistrator.unregister();
  });
  beforeEach(() => {
    observers.length = 0;
    gate.resetArtboardLive();
  });

  const wait = (ms: number) =>
    act(async () => {
      await new Promise((r) => setTimeout(r, ms));
    });

  const mounts: Record<string, number> = {};
  function Probe({ id }: { id: string }) {
    useEffect(() => {
      mounts[id] = (mounts[id] ?? 0) + 1;
    }, [id]);
    return createElement('div', { 'data-body': id });
  }

  let pick: ((s: { selector: string; artboardId: string }) => void) | null = null;
  function Picker() {
    const set = sel.useSelectionSetOptional();
    pick = set ? (s) => set.replace(s) : null;
    return null;
  }

  function tree(attempt: number, ids: string[]) {
    return (
      <sel.SelectionSetProvider postTarget={{ postMessage() {} }}>
        <Picker />
        {/* key=attempt: what canvas-comment-mount does on every soft reload */}
        <lib.DesignCanvas key={attempt}>
          <lib.DCSection id="s" title="S">
            {ids.map((id) => (
              <lib.DCArtboard key={id} id={id} label={id} width={200} height={150}>
                <Probe id={id} />
              </lib.DCArtboard>
            ))}
          </lib.DCSection>
        </lib.DesignCanvas>
      </sel.SelectionSetProvider>
    );
  }

  async function mount(ids: string[]) {
    window.happyDOM.setURL('http://localhost/?artboard-live=sleep');
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => root.render(tree(0, ids)));
    for (const id of ids) await act(async () => report(id, true));
    await wait(60);
    const bodies = () =>
      [...host.querySelectorAll('[data-body]')].map((e) => e.getAttribute('data-body'));
    return {
      host,
      root,
      bodies,
      done: async () => {
        await act(async () => root.unmount());
        host.remove();
      },
    };
  }

  test('an edit (soft-reload remount) keeps every mounted artboard mounted — no placeholder in between', async () => {
    const m = await mount(['a0', 'a1']);
    expect(m.bodies()).toEqual(['a0', 'a1']);
    for (const k of Object.keys(mounts)) delete mounts[k];
    // the write lands: the subtree remounts. No observer has reported on the new articles yet.
    await act(async () => m.root.render(tree(1, ['a0', 'a1'])));
    expect(m.host.querySelectorAll('.dc-artboard-sleeping')).toHaveLength(0);
    expect(m.bodies()).toEqual(['a0', 'a1']);
    await wait(60);
    expect(m.bodies()).toEqual(['a0', 'a1']);
    // mounted once by the remount — not mounted, dropped and mounted again
    expect(mounts).toEqual({ a0: 1, a1: 1 });
    await m.done();
  });

  test('the artboard holding the selection is never released; the others are', async () => {
    const m = await mount(['a0', 'a1', 'a2']);
    await act(async () => pick?.({ selector: '[data-dc-screen="a2"] video', artboardId: 'a2' }));
    await wait(30);
    // pan far away from a1 and a2 (outside the keep ring, off screen) for longer than the release grace
    await act(async () => {
      report('a1', false);
      report('a2', false);
    });
    await wait(2900);
    expect(m.bodies()).toEqual(['a0', 'a2']);
    await m.done();
  });

  // The real soft reload: each canvas module bundles its OWN copy of canvas-lib (Bun.build inlines
  // `@maude/canvas-lib`), so the remounted gate is a fresh evaluation of artboard-live-gate.tsx. A module-level
  // runtime started it with an empty registry — every artboard a placeholder — which is what the e2e hit.
  test('a soft reload that re-evaluates the gate module keeps the mounted artboards mounted', async () => {
    const copyA = await import('../artboard-live-gate.tsx?copy=a');
    const copyB = await import('../artboard-live-gate.tsx?copy=b');
    expect(copyA.ArtboardLiveGate).not.toBe(copyB.ArtboardLiveGate);
    const board = (G: typeof gate) =>
      function Board({ id }: { id: string }) {
        const a = useRef<HTMLElement>(null);
        const b = useRef<HTMLDivElement>(null);
        return (
          <article data-dc-screen={id} ref={a}>
            <div ref={b}>
              <G.ArtboardLiveGate id={id} articleRef={a} bodyRef={b} heightFloor={10}>
                <Probe id={id} />
              </G.ArtboardLiveGate>
            </div>
          </article>
        );
      };
    const BoardA = board(copyA);
    const BoardB = board(copyB);
    window.happyDOM.setURL('http://localhost/?artboard-live=sleep');
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => root.render(<BoardA key="0" id="r" />));
    await act(async () => report('r', true));
    await wait(60);
    expect(host.querySelectorAll('[data-body]')).toHaveLength(1);
    // the write lands: the new module's gate mounts in place of the old one, before any observer reports
    await act(async () => root.render(<BoardB key="1" id="r" />));
    expect(host.querySelectorAll('.dc-artboard-sleeping')).toHaveLength(0);
    expect(host.querySelectorAll('[data-body]')).toHaveLength(1);
    await wait(60);
    expect(host.querySelectorAll('[data-body]')).toHaveLength(1);
    await act(async () => root.unmount());
    host.remove();
  });
});
