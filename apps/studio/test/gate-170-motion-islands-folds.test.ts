// #170 R29 rest (burndown T2.4b): the two motions the first R29 pass left.
//   · a floating island that comes back (a panel shown again, the AI chat reopened) grows OUT OF ITS CORNER ICON —
//     the reverse of the fold (sh-island-fold shrinks toward the icon) — instead of a centred 0.96 fade;
//   · an Advanced fold's body eases open instead of snapping in.
// Both on the shell's motion tokens (so reduced motion collapses them to 1 ms), both compositor-only
// (transform + opacity), and both off outright under prefers-reduced-motion.
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (rel: string) => readFileSync(join(import.meta.dir, '..', rel), 'utf8');
const keyframes = (css: string, name: string) => {
  const at = css.indexOf(`@keyframes ${name} {`);
  if (at < 0) return null;
  let depth = 0;
  for (let i = css.indexOf('{', at); i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}' && --depth === 0) return css.slice(at, i + 1);
  }
  return null;
};
/** Only transform and opacity: no layout or paint property animates. */
const compositorOnly = (block: string) => {
  const props = [...block.matchAll(/([a-z-]+)\s*:/g)].map((m) => m[1]);
  return props.every((p) => p === 'transform' || p === 'opacity');
};

describe('islands grow out of their icon', () => {
  const css = read('client/v2/shell/floating-panels.css');

  test('a floating island enters with sh-island-grow on the panel token', () => {
    const rule = css.match(/\.sh-body--float \.sh-dockslot-inner \{([^}]*)\}/)?.[1] ?? '';
    expect(rule).toContain('animation: sh-island-grow var(--dur-panel) var(--ease-out)');
  });

  test('sh-island-grow starts at the icon size the fold ends at, and animates only transform + opacity', () => {
    const k = keyframes(css, 'sh-island-grow');
    expect(k).not.toBeNull();
    expect(k).toMatch(/from\s*\{[^}]*opacity:\s*0;[^}]*transform:\s*scale\(0\.12\)/s);
    expect(compositorOnly((k ?? '').replace(/@keyframes[^{]*\{/, ''))).toBe(true);
  });

  test('each island grows from the corner its icon sits in', () => {
    const origin = (sel: string) =>
      css.match(
        new RegExp(
          `${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\{\\s*transform-origin: ([a-z ]+);`
        )
      )?.[1];
    expect(origin('.sh-body--float .sh-dockslot-inner')).toBeUndefined(); // the shared rule names no corner
    expect(origin('.sh-body--float > .sh-dockslot--left > .sh-dockslot-inner')).toBe('top left');
    expect(origin('.sh-body--float > .sh-dockslot--right > .sh-dockslot-inner')).toBe('top right');
    expect(origin('.sh-body--float > .sh-dockslot--left > .sh-dockslot-ai')).toBe('bottom left');
    expect(origin('.sh-body--float > .sh-dockslot--right > .sh-dockslot-ai')).toBe('bottom right');
  });

  test('reduced motion: the island enters with no animation', () => {
    const at = css.lastIndexOf('@media (prefers-reduced-motion: reduce)');
    expect(css.slice(at)).toMatch(
      /\.sh-body--float \.sh-dockslot-inner,[^{]*\{\s*animation: none;/s
    );
  });
});

describe('Advanced folds ease open', () => {
  const kit = read('client/styles/3-kit-maude-v2.css');

  test('every fold body (the kit class all folds carry) eases in on a motion token', () => {
    const m = kit.match(
      /@media \(prefers-reduced-motion: no-preference\) \{\s*:where\(\.maude\) \.k-adv-body \{([^}]*)\}/
    );
    expect(m).not.toBeNull();
    expect(m?.[1]).toContain('animation: k-adv-open var(--dur-soft) var(--ease-out)');
  });

  test('k-adv-open moves only transform + opacity', () => {
    const k = keyframes(kit, 'k-adv-open');
    expect(k).not.toBeNull();
    expect(k).toMatch(/from\s*\{[^}]*opacity:\s*0;/s);
    expect(compositorOnly((k ?? '').replace(/@keyframes[^{]*\{/, ''))).toBe(true);
  });
});

// The grow starts at scale(0.12): getBoundingClientRect reads the SCALED box, so an island measured mid-grow would
// tell the canvas it covers 12 % of what it will (the mode lane flushes insets the frame a panel comes back, before
// `set-mode`). The measure reads the island's layout box instead — offsetWidth/Height with the transform origin.
describe('occluded insets measure the island, not its grow animation', () => {
  type R = { left: number; top: number; right: number; bottom: number };
  const box = (r: R) => ({ ...r, width: r.right - r.left, height: r.bottom - r.top });
  const frame = { getBoundingClientRect: () => box({ left: 0, top: 0, right: 1200, bottom: 800 }) };
  const root = (els: unknown[]) => ({ querySelectorAll: () => els });
  /** An island whose layout box is `r`, drawn at `scale` about `origin` (px within the box). */
  const island = (edge: string, r: R, scale: number, origin: [number, number]) => {
    const w = r.right - r.left;
    const h = r.bottom - r.top;
    const ox = r.left + origin[0];
    const oy = r.top + origin[1];
    const drawn = {
      left: ox - origin[0] * scale,
      top: oy - origin[1] * scale,
      right: ox + (w - origin[0]) * scale,
      bottom: oy + (h - origin[1]) * scale,
    };
    return {
      getBoundingClientRect: () => box(drawn),
      getAttribute: (k: string) => (k === 'data-occludes' ? edge : null),
      offsetWidth: w,
      offsetHeight: h,
      ownerDocument: {
        defaultView: {
          getComputedStyle: () => ({ transformOrigin: `${origin[0]}px ${origin[1]}px` }),
        },
      },
    };
  };

  test('a right island at the start of its grow (scale 0.12 about its top right) covers what it will', async () => {
    const { measureShellInsets } = await import('../client/v2/shell/occlusion-insets.js');
    const r = { left: 900, top: 16, right: 1184, bottom: 784 };
    const settled = measureShellInsets(frame, root([island('right', r, 1, [284, 0])]));
    const growing = measureShellInsets(frame, root([island('right', r, 0.12, [284, 0])]));
    expect(settled.right).toBeGreaterThan(280);
    expect(growing).toEqual(settled);
  });

  test('a left island growing from its top left, and the AI chat from its bottom corner', async () => {
    const { measureShellInsets } = await import('../client/v2/shell/occlusion-insets.js');
    const left = { left: 16, top: 16, right: 264, bottom: 784 };
    expect(measureShellInsets(frame, root([island('left', left, 0.12, [0, 0])]))).toEqual(
      measureShellInsets(frame, root([island('left', left, 1, [0, 0])]))
    );
    const ai = { left: 860, top: 400, right: 1184, bottom: 784 };
    expect(measureShellInsets(frame, root([island('right', ai, 0.3, [324, 384])]))).toEqual(
      measureShellInsets(frame, root([island('right', ai, 1, [324, 384])]))
    );
  });
});
