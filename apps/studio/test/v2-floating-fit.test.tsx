// V2-4.1 (T7) — against the REAL shell pieces: render the actual DockSlot / CornerIcons markup, lay its
// `[data-occludes]` islands out with floating-panels.css's own numbers, measure them the way the shell
// does (`measureShellInsets`), then fit with the canvas's own `computeFit` — no artboard screen rect may
// intersect any island, in every layout: floating with panels open, floating with panels folded to their
// corner icons, ⌘\ hidden, and pinned (which must come out 0 by itself).
// The browser-level proof of the same claim (a live canvas iframe in Chromium) is in the V2-4.1 hand-back.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { renderToStaticMarkup } from 'react-dom/server';
import { type Insets, ZERO_INSETS } from '../bridge/occlusion.ts';
import { type ArtboardRect, computeFit } from '../canvas-lib.tsx';
import { DockSlot } from '../client/shell/dock.jsx';
import { CornerIcons } from '../client/v2/shell/corner-icons.jsx';
import { measureShellInsets } from '../client/v2/shell/occlusion-insets.js';
import { menuCtx } from '../client/v2/shell/project-menu-model.js';
import { ProjectPill } from '../client/v2/shell/project-pill.jsx';
import { facesOf, saveStatus } from '../client/v2/shell/save-status.js';
import { ShareCluster } from '../client/v2/shell/share-cluster.jsx';

beforeAll(() => {
  if (typeof window === 'undefined') GlobalRegistrator.register();
});
afterAll(async () => {
  if (GlobalRegistrator.isRegistered) await GlobalRegistrator.unregister();
});

const CSS = readFileSync(join(import.meta.dir, '../client/v2/shell/floating-panels.css'), 'utf8');
const GAP = Number(/--float-gap:\s*(\d+)px/.exec(CSS)?.[1]);
const PILL = readFileSync(join(import.meta.dir, '../client/v2/shell/project-pill.css'), 'utf8');
const PILL_H = Number(/--pill-h:\s*(\d+)px/.exec(PILL)?.[1]);
const PILL_GAP = Number(/--pill-gap:\s*(\d+)px/.exec(PILL)?.[1]);
const BELOW_PILL = GAP + PILL_H + PILL_GAP; // V2-4.2: the left panel and its corner icon start under the pill
const PILL_W = 220;
const CLUSTER_W = 380; // faces + status word + comments + Hide panels + Share (measured on screen)
const ICON = 28 + 2 * 2; // .st-corner .st-iconbtn 28px + the island's 2×--space-1 (v1: 2px)

const AI_H = Number(/--ai-h,\s*(\d+)px/.exec(CSS)?.[1]);
const W = 1440;
const H = 830; // the body: window minus menubar + status bar
type Box = { left: number; top: number; right: number; bottom: number };

/** Where floating-panels.css puts each island: slots are `GAP` in from the window edge; the slot's inline
 *  width includes that gap (padding), so the island ends at `width` from its own edge. */
function layout(el: Element, sbW: number, rpW: number): Box {
  const edge = el.getAttribute('data-occludes');
  const cls0 = el.className;
  const isSlot = el.getAttribute('data-testid')?.startsWith('dock-slot-');
  const side = el.getAttribute('data-testid') === 'dock-slot-left' ? 'left' : 'right';
  // V2-4.4b — the AI chat is its own island at the slot's bottom (floating-panels.css `--ai-h`: 460), and the
  // main island above it gives way (`.has-ai`).
  if (el.getAttribute('data-testid') === 'dock-ai-right')
    return { left: W - rpW, top: H - GAP - AI_H, right: W - GAP, bottom: H - GAP };
  if (isSlot && side === 'right' && el.closest('.has-ai'))
    return { left: W - rpW, top: BELOW_PILL, right: W - GAP, bottom: H - GAP - AI_H - GAP };
  if (cls0 === 'st-pill island')
    return { left: GAP, top: GAP, right: GAP + PILL_W, bottom: GAP + PILL_H };
  if (isSlot && side === 'left') return { left: GAP, top: BELOW_PILL, right: sbW, bottom: H - GAP };
  if (cls0 === 'st-share island')
    return { left: W - GAP - CLUSTER_W, top: GAP, right: W - GAP, bottom: GAP + PILL_H };
  // V2-4.3a: the right panel and the right corner icon start under the Share cluster, like the left under the pill.
  if (isSlot) return { left: W - rpW, top: BELOW_PILL, right: W - GAP, bottom: H - GAP };
  const cls = el.className;
  const corner = (x: number, y: number) => ({ left: x, top: y, right: x + ICON, bottom: y + ICON });
  if (cls.includes('st-corner--left') && !cls.includes('ai')) return corner(GAP, BELOW_PILL);
  if (cls.includes('st-corner--right')) return corner(W - GAP - ICON, BELOW_PILL);
  if (cls.includes('st-corner--ai-left')) return corner(GAP, H - GAP - ICON);
  if (cls.includes('st-corner--ai')) return corner(W - GAP - ICON, H - GAP - ICON);
  throw new Error(`unplaced island ${edge}`);
}

function shell(opts: {
  floating: boolean;
  hidden: boolean;
  leftActive: string | null;
  rightActive: string | null;
  ai?: boolean; // the AI chat island is showing on the right
}) {
  const { floating, hidden, leftActive, rightActive, ai = false } = opts;
  const noop = () => {};
  const html = renderToStaticMarkup(
    <div className="st-body">
      <div className="main" />
      <ProjectPill
        project="Studio site"
        ctx={menuCtx({ native: true })}
        state={{}}
        run={noop}
        docked={!floating && !hidden && !!leftActive}
      />
      <ShareCluster
        faces={facesOf({ you: 'Studio' })}
        status={saveStatus({ linked: true })}
        ctx={menuCtx({ native: true })}
        run={noop}
        docked={!floating && !hidden && !!rightActive}
      />
      {leftActive && (
        <DockSlot
          side="left"
          width={252}
          open
          ids={['tree', 'layers']}
          activeId={leftActive}
          onPick={noop}
          floating={floating}
          hidden={hidden}
        >
          <aside className="st-sidebar" />
        </DockSlot>
      )}
      {(rightActive || ai) && (
        <DockSlot
          side="right"
          width={304}
          open={!!rightActive}
          ids={['inspector', 'comments']}
          activeId={rightActive}
          onPick={noop}
          floating={floating}
          hidden={hidden}
          aiShown={ai}
          ai={<aside className="st-rpanel" />}
        >
          <aside className="st-rpanel" />
        </DockSlot>
      )}
      <CornerIcons
        hidden={hidden}
        leftActive={leftActive}
        rightActive={rightActive}
        leftIds={['tree', 'layers']}
        rightIds={['inspector', 'comments']}
        assistant={{ side: 'right', shown: ai, busy: false }}
        onOpen={noop}
        onShow={noop}
      />
    </div>
  );
  document.body.innerHTML = html;
  const body = document.body.firstElementChild as HTMLElement;
  const main = body.querySelector('.main') as HTMLElement;
  main.getBoundingClientRect = () =>
    ({ left: 0, top: 0, right: W, bottom: H, width: W, height: H }) as DOMRect;
  for (const el of body.querySelectorAll('[data-occludes]')) {
    const b = layout(el, 252, 304);
    (el as HTMLElement).getBoundingClientRect = () =>
      ({ ...b, width: b.right - b.left, height: b.bottom - b.top }) as DOMRect;
  }
  return { body, main };
}

const RECTS: ArtboardRect[] = [
  { id: 'a', x: 0, y: 0, w: 800, h: 500, kind: 'digital' },
  { id: 'b', x: 840, y: 0, w: 800, h: 500, kind: 'digital' },
  { id: 'c', x: 1680, y: 0, w: 800, h: 500, kind: 'digital' },
];

function fitAndCheck(insets: Insets) {
  const host = { clientWidth: W, clientHeight: H } as HTMLElement;
  const cam = computeFit(RECTS, host, 24, insets);
  return RECTS.map((r) => ({
    left: r.x * cam.zoom + cam.x,
    top: r.y * cam.zoom + cam.y,
    right: (r.x + r.w) * cam.zoom + cam.x,
    bottom: (r.y + r.h) * cam.zoom + cam.y,
  }));
}
const intersects = (a: Box, b: Box) =>
  Math.min(a.right, b.right) > Math.max(a.left, b.left) &&
  Math.min(a.bottom, b.bottom) > Math.max(a.top, b.top);

const CASES: Array<[string, Parameters<typeof shell>[0], boolean]> = [
  [
    'floating, both panels open',
    { floating: true, hidden: false, leftActive: 'tree', rightActive: 'inspector' },
    true,
  ],
  [
    'floating, panels folded to their corner icons',
    { floating: true, hidden: false, leftActive: null, rightActive: null },
    true,
  ],
  [
    'floating, AI chat open on the right',
    { floating: true, hidden: false, leftActive: null, rightActive: null, ai: true },
    true,
  ],
  [
    'floating, Inspector with the AI chat island under it',
    { floating: true, hidden: false, leftActive: 'tree', rightActive: 'inspector', ai: true },
    true,
  ],
  [
    '⌘\\ hidden (icons stay)',
    { floating: true, hidden: true, leftActive: 'tree', rightActive: 'inspector' },
    true,
  ],
  [
    'pinned, both panels and the AI chat open',
    { floating: false, hidden: false, leftActive: 'tree', rightActive: 'inspector', ai: true },
    false,
  ],
];

describe('after the shell insets + a Fit, no artboard meets an island', () => {
  for (const [name, opts, occludes] of CASES) {
    test(name, () => {
      const { body, main } = shell(opts);
      const insets = measureShellInsets(main, body);
      if (!occludes) {
        expect(insets).toEqual(ZERO_INSETS); // pinned: the panels sit beside the frame, not over it
        expect(body.querySelectorAll('[data-occludes]').length).toBe(0);
        return;
      }
      expect(insets.left + insets.right).toBeGreaterThan(0);
      const islands = [...body.querySelectorAll('[data-occludes]')].map((e) =>
        (e as HTMLElement).getBoundingClientRect()
      );
      expect(islands.length).toBeGreaterThan(0);
      for (const ab of fitAndCheck(insets))
        for (const isl of islands) expect(intersects(ab, isl)).toBe(false);
    });
  }

  test('without the insets the same fit DOES land under a panel (the test can fail)', () => {
    const { body } = shell(CASES[0]?.[1] as Parameters<typeof shell>[0]);
    const islands = [...body.querySelectorAll('[data-occludes]')].map((e) =>
      (e as HTMLElement).getBoundingClientRect()
    );
    const hit = fitAndCheck(ZERO_INSETS).some((ab) => islands.some((isl) => intersects(ab, isl)));
    expect(hit).toBe(true);
  });
});

describe('every floating island root declares its edge', () => {
  test('left slot = left, right slot = right, icons = their side, hidden slot = none', () => {
    const { body } = shell({
      floating: true,
      hidden: false,
      leftActive: 'tree',
      rightActive: 'inspector',
      ai: true,
    });
    expect(
      body.querySelector('[data-testid="dock-slot-left"]')?.getAttribute('data-occludes')
    ).toBe('left');
    expect(
      body.querySelector('[data-testid="dock-slot-right"]')?.getAttribute('data-occludes')
    ).toBe('right');
    expect(body.querySelector('[data-testid="dock-ai-right"]')?.getAttribute('data-occludes')).toBe(
      'right'
    );
    const hiddenBody = shell({
      floating: true,
      hidden: true,
      leftActive: 'tree',
      rightActive: 'inspector',
      ai: true,
    }).body;
    expect(
      hiddenBody.querySelector('[data-testid="dock-slot-left"]')?.hasAttribute('data-occludes')
    ).toBe(false);
    const edges = [...hiddenBody.querySelectorAll('.st-corner')].map((e) =>
      e.getAttribute('data-occludes')
    );
    expect(edges.sort()).toEqual(['left', 'right', 'right']);
  });
});

describe('V2-4.3a — the Share cluster is the top-right island', () => {
  const ROOT = join(import.meta.dir, '..');
  test('it declares the top edge, and the right island starts under it', () => {
    const { body } = shell({
      floating: true,
      hidden: false,
      leftActive: 'tree',
      rightActive: 'inspector',
    });
    const cluster = body.querySelector('[data-testid="share-cluster"]') as HTMLElement;
    expect(cluster.getAttribute('data-occludes')).toBe('top');
    const c = cluster.getBoundingClientRect();
    for (const el of body.querySelectorAll('[data-occludes="right"]'))
      expect((el as HTMLElement).getBoundingClientRect().top).toBeGreaterThanOrEqual(c.bottom);
  });
  test('the top inset reaches the cluster’s bottom edge', () => {
    const { body, main } = shell({
      floating: true,
      hidden: false,
      leftActive: null,
      rightActive: null,
    });
    const insets = measureShellInsets(main, body);
    expect(insets.top).toBeGreaterThanOrEqual(GAP + PILL_H);
  });
  test('the model above matches the CSS: the right slot, grip and corner icon sit under the cluster', () => {
    const below = 'calc(var(--float-gap) + var(--pill-h, 40px) + var(--pill-gap, 12px))';
    const slot = /\.st-body--float > \.st-dockslot--right \{[^}]*\}/.exec(CSS)?.[0] ?? '';
    expect(slot).toContain(`padding-top: ${below}`);
    const grip = /\.st-body--float > \.st-grip--r \{[^}]*\}/.exec(CSS)?.[0] ?? '';
    expect(grip).toContain(`top: ${below}`);
    const corner = /\.st-corner--right \{[^}]*\}/.exec(CSS)?.[0] ?? '';
    expect(corner).toContain('var(--pill-h, 40px)');
    const cluster = readFileSync(join(ROOT, 'client/v2/shell/share-cluster.css'), 'utf8');
    expect(cluster).toMatch(/\.st-share \{[^}]*height: var\(--pill-h, 40px\)/);
    expect(cluster).not.toMatch(/backdrop-filter\s*:\s*(?!none)/); // M1: material is the island's
  });
  test('pinned with a right panel showing, the cluster heads the column and declares no edge', () => {
    const { body } = shell({
      floating: false,
      hidden: false,
      leftActive: 'tree',
      rightActive: 'inspector',
    });
    expect(body.querySelector('[data-testid="share-cluster"]')?.hasAttribute('data-occludes')).toBe(
      false
    );
  });
});
