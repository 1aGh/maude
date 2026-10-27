import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { browser, expect } from '@wdio/globals';
import { waitForCanvasRects } from '../helpers/canvas-frame';
import { capture, startReport } from '../helpers/evidence';
import { createFixtureGuard } from '../helpers/fixture-guard';
import { waitForSidecar } from '../helpers/sidecar';
import { canvasRow } from '../helpers/tree';

/**
 * S2.21 (artboard ed-edge-keys) — every object is reachable without a mouse.
 *
 * Driving model (memory: the canvas iframe is unreachable by DOM selectors once the origin split is on): keys are
 * synthetic `keydown`s dispatched on the frame's document — the canvas resolves them through the registry
 * (`object.select-next` / `-prev`, `tool.create-default`) — and what is asserted is read from the frame's own
 * test ids (`edit-order-badge`, `edit-focus-ring`, `edit-aria-live`) and the shell's (`canvas-frame`).
 *
 * What it proves: tab walks the five top-level cards in reading order with badges 1…5 (the one in front "on");
 * ↵ goes inside and tab then numbers 3.1…3.3; the live region says "Services, frame, 3 items, in a row — 3 of 5.
 * Press Return to go inside."; the focus ring shows after a key and goes after a pointer press; F6 from the canvas
 * puts the keyboard on a panel and F6 again comes back to the canvas frame; R then ↵ adds one 100 × 100 rectangle.
 *
 * Written, not run, by the slice (the lane has no desktop build); run with the `desktop-e2e` skill.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const CANVAS = join(HERE, '../fixtures/project/.design/ui/Smoke.tsx');
const fixtures = createFixtureGuard('edit-keyboard', [CANVAS]);

const PAGE = `import { DCArtboard, DesignCanvas } from "@maude/canvas-lib";

export default function Smoke() {
  return (
    <DesignCanvas>
      <DCArtboard id="smoke" label="SMOKE/01 · KEYS" width={640} height={560}>
        <div data-cd-id="k-nav" data-dc-element="Navigation" style={{ position: "absolute", left: 0, top: 0, width: 640, height: 60 }}>Nav</div>
        <div data-cd-id="k-hero" data-dc-element="Hero" style={{ position: "absolute", left: 0, top: 60, width: 640, height: 160 }}>Hero</div>
        <div data-cd-id="k-svc" data-dc-element="Services" style={{ position: "absolute", left: 0, top: 220, width: 640, height: 160, display: "flex", flexDirection: "row", gap: 16 }}>
          <div data-cd-id="k-c3" data-dc-element="Brand systems" style={{ width: 200, height: 120 }}>C</div>
          <div data-cd-id="k-c1" data-dc-element="Websites" style={{ width: 200, height: 120 }}>A</div>
          <div data-cd-id="k-c2" data-dc-element="Motion" style={{ width: 200, height: 120 }}>B</div>
        </div>
        <div data-cd-id="k-work" data-dc-element="Work" style={{ position: "absolute", left: 0, top: 380, width: 640, height: 100 }}>Work</div>
        <div data-cd-id="k-foot" data-dc-element="Footer" style={{ position: "absolute", left: 0, top: 480, width: 640, height: 80 }}>Foot</div>
      </DCArtboard>
    </DesignCanvas>
  );
}
`;

/** A keydown on the frame's document (the way a key reaches the canvas once focus is in the frame). `onBody`: on
 *  its body instead — where a real key lands with nothing focused (a real keydown never targets the document). */
async function press(
  key: string,
  init: Record<string, unknown> = {},
  onBody = false
): Promise<void> {
  await browser.execute(
    (k, i, b) => {
      const frame = document.querySelector('[data-testid="canvas-frame"]') as HTMLIFrameElement;
      const doc = frame.contentDocument as Document;
      (b ? doc.body : doc).dispatchEvent(
        new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...i })
      );
    },
    key,
    init,
    onBody
  );
}

/** Read from inside the frame: the on badge, the badge count, the ring, the live region. */
function readFrame(): Promise<{
  on: string | null;
  badges: string[];
  ring: boolean;
  said: string;
}> {
  return browser.execute(() => {
    const frame = document.querySelector('[data-testid="canvas-frame"]') as HTMLIFrameElement;
    const doc = frame.contentDocument as Document;
    const badges = Array.from(doc.querySelectorAll('[data-testid="edit-order-badge"]'));
    return {
      on: badges.find((b) => b.hasAttribute('data-on'))?.getAttribute('data-order') ?? null,
      badges: badges.map((b) => b.getAttribute('data-order') ?? ''),
      ring: !!doc.querySelector('[data-testid="edit-focus-ring"]'),
      said: (doc.querySelector('[data-testid="edit-aria-live"]')?.textContent ?? '').trim(),
    };
  });
}

const settle = () => browser.pause(250);

describe('keyboard only (S2.21)', () => {
  before(async () => {
    await waitForSidecar();
    writeFileSync(CANVAS, PAGE);
    await (await canvasRow('canvas-row-ui-smoke')).click();
    await waitForCanvasRects();
    await browser.waitUntil(
      async () =>
        browser.execute(() => {
          const f = document.querySelector(
            '[data-testid="canvas-frame"]'
          ) as HTMLIFrameElement | null;
          return !!f?.contentDocument?.querySelector('[data-cd-id="k-foot"]');
        }),
      { timeout: 15000 }
    );
  });
  after(() => fixtures.restore());

  it('tab walks the objects in reading order; the badges number the level 1…5', async () => {
    const report = startReport('edit-keyboard-tab');
    await press('Tab');
    await press('Tab');
    await press('Tab');
    await settle();
    const s = await readFrame();
    // 14 Editing · "26 · Keyboard only": the focused frame shows its own level 1…5 AND the numbers of what
    // is inside it (4.1…4.3 there, 3.1…3.3 here) at once — the level is the badges without a dot.
    expect(s.badges.filter((b) => !b.includes('.'))).toEqual(['1', '2', '3', '4', '5']);
    expect(s.badges.filter((b) => b.includes('.'))).toEqual(['3.1', '3.2', '3.3']);
    expect(s.on).toBe('3');
    await capture(report, 'tab-third');
  });

  it('VoiceOver hears the design’s sentence for the focused frame', async () => {
    const s = await readFrame();
    expect(s.said).toBe('Services, frame, 3 items, in a row — 3 of 5. Press Return to go inside.');
  });

  it('↵ goes inside; tab then numbers 3.1…3.3 in the order the cards are drawn', async () => {
    const report = startReport('edit-keyboard-inside');
    // On the BODY, as a real ↵ with nothing focused lands: the canvas's own ↵ listener takes only a bare-canvas
    // target (focus-model.tsx `isBareCanvasTarget` — body or html), and a key dispatched on the document itself went
    // through the shell's keymap round trip instead, which lost the walk in a loaded lane (r7, r7fix/a3, a4).
    await press('Enter', {}, true);
    await browser
      .waitUntil(async () => (await readFrame()).said.includes('Brand systems'), {
        timeout: 5000,
        interval: 100,
      })
      .catch(() => undefined);
    const s = await readFrame();
    expect(s.badges.filter((b) => b.includes('.'))).toEqual(['3.1', '3.2', '3.3']);
    // inside, the first stop is the first card DRAWN (Brand systems), not the one that reads first by name
    expect(s.said).toContain('Brand systems');
    await press('Tab');
    await settle();
    const second = await readFrame();
    expect(second.on).toBe('3.2');
    expect(second.said).toContain('Websites');
    await capture(report, 'inside');
    await press('Escape');
    // esc steps out through the same shell round trip (`object.step-out` comes back as a run-action)
    await browser
      .waitUntil(async () => (await readFrame()).on === '3', {
        timeout: 5000,
        interval: 100,
      })
      .catch(() => undefined);
    expect((await readFrame()).on).toBe('3');
  });

  it('the focus ring shows after a key and goes after a pointer press', async () => {
    expect((await readFrame()).ring).toBe(true);
    await browser.execute(() => {
      const frame = document.querySelector('[data-testid="canvas-frame"]') as HTMLIFrameElement;
      const doc = frame.contentDocument as Document;
      doc.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX: 5, clientY: 5 }));
    });
    await settle();
    expect((await readFrame()).ring).toBe(false);
  });

  it('F6 leaves the canvas for a panel, and F6 again comes back to the canvas frame', async () => {
    // the canvas has the keyboard (as in a person's session) before F6 leaves it
    await browser.execute(() => {
      const frame = document.querySelector('[data-testid="canvas-frame"]') as HTMLIFrameElement;
      frame.focus();
      frame.contentWindow?.focus();
    });
    await press('F6');
    await browser.waitUntil(
      async () =>
        browser.execute(
          () => document.activeElement?.getAttribute('data-testid') !== 'canvas-frame'
        ),
      { timeout: 6000, timeoutMsg: 'F6 never left the canvas' }
    );
    // the shell's own handler, whichever panel element holds focus now: the ring is panels → canvas → panels, so
    // the canvas frame comes back within one lap (the panels on show differ with what is selected)
    let back = false;
    for (let lap = 0; lap < 6 && !back; lap++) {
      await browser.execute(() => {
        document.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'F6', bubbles: true, cancelable: true })
        );
      });
      await browser.pause(150);
      back = await browser.execute(() => {
        const a = document.activeElement;
        return a?.getAttribute('data-testid') === 'canvas-frame' || a?.tagName === 'IFRAME';
      });
    }
    expect(back).toBe(true);
  });

  it('R then ↵ adds one rectangle at its default size, 100 × 100', async () => {
    const report = startReport('edit-keyboard-create');
    const before = await browser.execute(
      () =>
        (
          document.querySelector('[data-testid="canvas-frame"]') as HTMLIFrameElement
        ).contentDocument?.querySelectorAll('[data-shape="rectangle"]').length ?? 0
    );
    await press('r');
    await press('Enter');
    await browser.waitUntil(
      async () =>
        (await browser.execute(
          () =>
            (
              document.querySelector('[data-testid="canvas-frame"]') as HTMLIFrameElement
            ).contentDocument?.querySelectorAll('[data-shape="rectangle"]').length ?? 0
        )) ===
        before + 1,
      { timeout: 8000 }
    );
    const size = await browser.execute(() => {
      const doc = (document.querySelector('[data-testid="canvas-frame"]') as HTMLIFrameElement)
        .contentDocument as Document;
      const r = Array.from(doc.querySelectorAll('[data-shape="rectangle"]')).pop() as HTMLElement;
      return { w: r.style.width, h: r.style.height };
    });
    expect(size).toEqual({ w: '100px', h: '100px' });
    await capture(report, 'created');
  });
});
