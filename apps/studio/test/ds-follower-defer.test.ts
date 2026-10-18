// S10.4 (V2-1.6 §5.8 "Live updates") — a follower swap defers to the NEXT LOOK; Present defers it too.
// "Tereza's open Pricing updates when she next looks at it": the publisher's own window swaps at once,
// everyone else's waits for a visibility change, a canvas switch or an artboard move, and a canvas on screen
// in Present holds it until the presenter moves on or leaves. The shell frame then swaps its two links —
// from the parent only, only for a plain relative `.css` path (headless lane).

import { afterEach, describe, expect, test } from 'bun:test';

import { createFollowerSwap } from '../client/v2/ds/follower-swap.js';
import {
  createPinsHost,
  dsRevForPlacement,
  dsWaitingText,
  pinsReply,
} from '../client/v2/ds/pins.js';
import { type Frame, openShellFrame } from './ds-shell-harness.ts';

const R1 = 'a'.repeat(64);
const R2 = 'b'.repeat(64);
const f = (rev: string) => ({
  tokens: `system/s/revisions/${rev}.tokens.css`,
  components: `system/s/revisions/${rev}.components.css`,
});

function rig(presenting = false) {
  const sent: Array<{ key: string; tokens: string | null; components: string | null }> = [];
  const state = { presenting };
  const swap = createFollowerSwap({
    send: (key, m) => sent.push({ key, tokens: m.tokens, components: m.components }),
    presenting: () => state.presenting,
  });
  swap.seed('Pricing', f(R1).tokens, f(R1).components);
  swap.seed('Landing', f(R1).tokens, f(R1).components);
  return { sent, state, swap };
}

describe('follower swap — defers to the next look', () => {
  test("the publisher's own window swaps at once", () => {
    const { sent, swap } = rig();
    swap.headMoved({ key: 'Pricing', ...f(R2), own: true });
    expect(sent).toEqual([{ key: 'Pricing', ...f(R2) }]);
  });

  test('anyone else waits, then swaps once at their next look', () => {
    const { sent, swap } = rig();
    swap.headMoved({ key: 'Pricing', ...f(R2) });
    expect(sent).toEqual([]);
    expect(swap.pending()).toEqual(['Pricing']);
    expect(swap.look('visible', 'Pricing')).toBe(1);
    expect(sent).toEqual([{ key: 'Pricing', ...f(R2) }]);
    expect(swap.look('visible', 'Pricing')).toBe(0);
    expect(sent.length).toBe(1);
  });

  test('a canvas switch and an artboard move are looks; something else is not', () => {
    for (const reason of ['canvas-switch', 'artboard-move']) {
      const { sent, swap } = rig();
      swap.headMoved({ key: 'Pricing', ...f(R2) });
      expect(swap.look(reason, 'Pricing')).toBe(1);
      expect(sent.length).toBe(1);
    }
    const { sent, swap } = rig();
    swap.headMoved({ key: 'Pricing', ...f(R2) });
    expect(swap.look('hover', 'Pricing')).toBe(0);
    expect(sent).toEqual([]);
  });

  test('a look at one canvas leaves the others waiting', () => {
    const { sent, swap } = rig();
    swap.headMoved({ key: 'Pricing', ...f(R2) });
    swap.headMoved({ key: 'Landing', ...f(R2) });
    swap.look('canvas-switch', 'Pricing');
    expect(sent.map((s) => s.key)).toEqual(['Pricing']);
    expect(swap.pending()).toEqual(['Landing']);
  });

  test('the newest head wins; a move back to what the frame shows swaps nothing', () => {
    const { sent, swap } = rig();
    swap.headMoved({ key: 'Pricing', ...f(R2) });
    swap.headMoved({ key: 'Pricing', ...f('c'.repeat(64)) });
    swap.look('visible', 'Pricing');
    expect(sent).toEqual([{ key: 'Pricing', ...f('c'.repeat(64)) }]);
    const again = rig();
    again.swap.headMoved({ key: 'Pricing', ...f(R2) });
    again.swap.headMoved({ key: 'Pricing', ...f(R1) });
    expect(again.swap.pending()).toEqual([]);
    expect(again.swap.look('visible', 'Pricing')).toBe(0);
    expect(again.sent).toEqual([]);
  });

  test('Present holds it — even the publisher’s — until the presenter moves on or leaves', () => {
    const a = rig(true);
    a.swap.headMoved({ key: 'Pricing', ...f(R2), own: true });
    expect(a.sent).toEqual([]);
    expect(a.swap.look('visible', 'Pricing')).toBe(0);
    expect(a.swap.look('canvas-switch', 'Pricing')).toBe(0);
    expect(a.sent).toEqual([]);
    expect(a.swap.look('artboard-move', 'Pricing')).toBe(1);
    expect(a.sent.length).toBe(1);

    const b = rig(true);
    b.swap.headMoved({ key: 'Pricing', ...f(R2) });
    b.swap.headMoved({ key: 'Landing', ...f(R2) });
    b.state.presenting = false;
    expect(b.swap.presentEnded()).toBe(2);
    expect(b.sent.length).toBe(2);
  });

  test('a closed canvas is forgotten', () => {
    const { sent, swap } = rig();
    swap.headMoved({ key: 'Pricing', ...f(R2) });
    swap.forget('Pricing');
    expect(swap.look('visible')).toBe(0);
    expect(sent).toEqual([]);
  });
});

describe('pins — the studio side', () => {
  test('⇧I on a left-out canvas places an instance that arrives current; a follower needs nothing', () => {
    expect(dsRevForPlacement({ converted: true, canvasDsRev: R1 })).toBe('head');
    expect(dsRevForPlacement({ converted: true, canvasDsRev: null })).toBeNull();
    expect(dsRevForPlacement({ converted: false, canvasDsRev: R1 })).toBeNull();
  });

  test('the quiet waiting line names the Mac, or the device when nobody is named', () => {
    expect(dsWaitingText('Jonas')).toBe("Waiting for Jonas's Mac");
    expect(dsWaitingText(null)).toBe('Waiting for another device');
    expect(dsWaitingText('  ')).toBe('Waiting for another device');
  });

  test('the reply lists siblings for what is held, never a path the canvas named', () => {
    const ds = { path: 'system/s', rootClass: 'ds' };
    const r = pinsReply({
      want: ['head', R1, '../../x', 'https://evil.test/a.css', R2],
      ds,
      head: R2,
      canvasRev: R2,
      gaps: {},
    });
    expect(r.dgn).toBe('ds-pins');
    expect(r.rootClass).toBe('ds');
    // head IS the canvas's own revision and R2 likewise: nothing to scope for them
    expect(Object.keys(r.revs)).toEqual([R1]);
    expect(r.revs[R1]).toEqual(f(R1));
    // a left-out canvas (own = R1): `head` is a different revision and gets its sheet
    const left = pinsReply({ want: ['head'], ds, head: R2, canvasRev: R1, gaps: {} });
    expect(left.revs.head).toEqual(f(R2));
    // a revision this Mac does not hold is not listed
    const gap = pinsReply({
      want: ['head', R1],
      ds,
      head: R2,
      canvasRev: null,
      gaps: { [R2]: 'Jonas' },
    });
    expect(Object.keys(gap.revs)).toEqual([R1]);
  });

  test('the host answers a want and answers again when the head moves', () => {
    const posted: Array<{ key: string; revs: string[] }> = [];
    let head = R2;
    const host = createPinsHost({
      state: (key: string) =>
        key === 'Pricing'
          ? { ds: { path: 'system/s', rootClass: null }, head, canvasRev: R1, gaps: {} }
          : null,
      post: (key: string, m: { revs: Record<string, unknown> }) =>
        posted.push({ key, revs: Object.keys(m.revs) }),
    });
    expect(host.onMessage('Pricing', { dgn: 'ds-pins-want', revs: ['head', 'junk'] })).toBe(true);
    expect(posted).toEqual([{ key: 'Pricing', revs: ['head'] }]);
    expect(host.onMessage('Other', { dgn: 'ds-pins-want', revs: ['head'] })).toBe(false); // no converted system
    expect(host.onMessage('Pricing', { dgn: 'something-else' })).toBe(false);
    head = R1; // the head moved onto the canvas's own revision: the pin needs no sheet any more
    expect(host.refresh()).toBe(1);
    expect(posted[1]).toEqual({ key: 'Pricing', revs: [] });
  });
});

// ─── the shell frame (headless lane) ────────────────────────────────────────────────────────────────

let frame: Frame | null = null;
afterEach(async () => {
  await frame?.close();
  frame = null;
});

const hrefs = (fr: Frame) =>
  fr.evalInFrame<string[]>(
    `[document.getElementById('canvas-tokens'), document.getElementById('canvas-components')].map((l) => l.getAttribute('href'))`
  );

describe('headless lane — the shell frame swaps its two links', () => {
  test('from the parent, for a plain relative .css path', async () => {
    frame = await openShellFrame({ body: '<p>x</p>' });
    await frame.post({ dgn: 'ds-css', ...f(R2) });
    await frame.page.waitForFunction(
      (want: string) =>
        (document.getElementById('f') as HTMLIFrameElement).contentDocument
          ?.getElementById('canvas-tokens')
          ?.getAttribute('href') === want,
      `/.design/${f(R2).tokens}`
    );
    expect(await hrefs(frame)).toEqual([
      `/.design/${f(R2).tokens}`,
      `/.design/${f(R2).components}`,
    ]);
  });

  test('not from the canvas itself, and never for a URL, an absolute path, `..` or a non-css file', async () => {
    frame = await openShellFrame({ body: '<p>x</p>' });
    await frame.selfPost({ dgn: 'ds-css', ...f(R2) });
    for (const bad of [
      'https://evil.test/x.css',
      '//evil.test/x.css',
      '/etc/passwd.css',
      '../../secret.css',
      'system/s/revisions/x.json',
      'system/s/../x.css',
      'a'.repeat(300) + '.css',
    ])
      await frame.post({ dgn: 'ds-css', tokens: bad, components: bad });
    await frame.page.waitForTimeout(300);
    expect(await hrefs(frame)).toEqual(['', '']);
  });
});
