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
const ICON = 28 + 2 * 2; // .st-corner .st-iconbtn 28px + the island's 2×--space-1 (v1: 2px)

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
  if (cls0 === 'st-pill island')
    return { left: GAP, top: GAP, right: GAP + PILL_W, bottom: GAP + PILL_H };
  if (isSlot && side === 'left') return { left: GAP, top: BELOW_PILL, right: sbW, bottom: H - GAP };
  if (isSlot) return { left: W - rpW, top: GAP, right: W - GAP, bottom: H - GAP };
  const cls = el.className;
  const corner = (x: number, y: number) => ({ left: x, top: y, right: x + ICON, bottom: y + ICON });
  if (cls.includes('st-corner--left') && !cls.includes('ai')) return corner(GAP, BELOW_PILL);
  if (cls.includes('st-corner--right')) return corner(W - GAP - ICON, GAP);
  if (cls.includes('st-corner--ai-left')) return corner(GAP, H - GAP - ICON);
  if (cls.includes('st-corner--ai')) return corner(W - GAP - ICON, H - GAP - ICON);
  throw new Error(`unplaced island ${edge}`);
}

function shell(opts: {
  floating: boolean;
  hidden: boolean;
  leftActive: string | null;
  rightActive: string | null;
}) {
  const { floating, hidden, leftActive, rightActive } = opts;
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
      {rightActive && (
        <DockSlot
          side="right"
          width={304}
          open
          ids={['inspector', 'comments', 'assistant']}
          activeId={rightActive}
          onPick={noop}
          floating={floating}
          hidden={hidden}
        >
          <aside className="st-rpanel" />
        </DockSlot>
      )}
      {(floating || hidden) && (
        <CornerIcons
          hidden={hidden}
          leftActive={leftActive}
          rightActive={rightActive}
          leftIds={['tree', 'layers']}
          rightIds={['inspector', 'comments', 'assistant']}
          assistant={{ side: 'right', shown: rightActive === 'assistant', busy: false }}
          onOpen={noop}
          onShow={noop}
        />
      )}
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
    { floating: true, hidden: false, leftActive: null, rightActive: 'assistant' },
    true,
  ],
  [
    '⌘\\ hidden (icons stay)',
    { floating: true, hidden: true, leftActive: 'tree', rightActive: 'inspector' },
    true,
  ],
  [
    'pinned, both panels open',
    { floating: false, hidden: false, leftActive: 'tree', rightActive: 'inspector' },
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
      rightActive: 'assistant',
    });
    expect(
      body.querySelector('[data-testid="dock-slot-left"]')?.getAttribute('data-occludes')
    ).toBe('left');
    expect(
      body.querySelector('[data-testid="dock-slot-right"]')?.getAttribute('data-occludes')
    ).toBe('right');
    const hiddenBody = shell({
      floating: true,
      hidden: true,
      leftActive: 'tree',
      rightActive: 'assistant',
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
