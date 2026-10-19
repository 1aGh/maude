import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { $, browser, expect } from '@wdio/globals';
import { capture, startReport } from '../helpers/evidence';
import { createFixtureGuard } from '../helpers/fixture-guard';
import { waitForSidecar } from '../helpers/sidecar';
import { canvasRow } from '../helpers/tree';

/**
 * S2.19 (artboard ed-edge-ask) — ⌘/ on a selection, in place.
 *
 * Driving model (memory: the canvas iframe is unreachable by DOM selectors once the origin split is on):
 * the cards are found by COORDINATES from `window.__maudeCanvasRects()`, the pointer and the ⌘/ key are
 * synthetic events dispatched on the frame's document, and every assertion is on a `data-testid` — the
 * SHELL's bubble (`ask-selection-*`, in the main document: a canvas never carries the words) or the
 * canvas's one AI outline (`edit-ai-scope`, inside the frame).
 *
 * What it proves here: three cards selected → ⌘/ opens the bubble under them with the chip "3 elements";
 * esc closes it and gives the canvas its focus back; and a second ⌘/ → words → ↵ turns the bubble into the
 * asked line with the one-step hint. What needs a live AI (the outline appearing while a run works, the
 * 409 on a held card) is covered by the server and canvas tests, not here.
 *
 * Written, not run, by the slice (the lane has no desktop build); run with the `desktop-e2e` skill.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const CANVAS = join(HERE, '../fixtures/project/.design/ui/Smoke.tsx');
const fixtures = createFixtureGuard('edit-ask-ai', [CANVAS]);

const POST = `import { DCArtboard, DesignCanvas } from "@maude/canvas-lib";

export default function Smoke() {
  return (
    <DesignCanvas>
      <DCArtboard id="smoke" label="SMOKE/01 · ASK" width={640} height={320}>
        <div data-cd-id="ask-a" style={{ position: "absolute", left: "24px", top: "40px", width: 180, height: 120 }}>Alfa</div>
        <div data-cd-id="ask-b" style={{ position: "absolute", left: "230px", top: "40px", width: 180, height: 120 }}>Beta</div>
        <div data-cd-id="ask-c" style={{ position: "absolute", left: "436px", top: "40px", width: 180, height: 120 }}>Gama</div>
      </DCArtboard>
    </DesignCanvas>
  );
}
`;

type Pt = { x: number; y: number };

function rectOf(text: string): Promise<Pt | null> {
  return browser.execute((t) => {
    const frame = document.querySelector('[data-testid="canvas-frame"]') as HTMLIFrameElement;
    const win = frame.contentWindow as (Window & { __maudeCanvasRects?: () => any }) | null;
    const hit = win?.__maudeCanvasRects?.().elements.find((e: any) => e.text.startsWith(t));
    if (!hit) return null;
    const el = frame.contentDocument?.querySelector(hit.selector) as HTMLElement | null;
    const r = el?.getBoundingClientRect();
    return r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null;
  }, text);
}

async function click(x: number, y: number, shift = false): Promise<void> {
  await browser.execute(
    (px, py, sh) => {
      const frame = document.querySelector('[data-testid="canvas-frame"]') as HTMLIFrameElement;
      const doc = frame.contentDocument as Document;
      const target = doc.elementFromPoint(px, py) ?? doc.body;
      for (const type of ['pointerdown', 'pointerup', 'click']) {
        target.dispatchEvent(
          new MouseEvent(type, { bubbles: true, clientX: px, clientY: py, button: 0, shiftKey: sh })
        );
      }
    },
    x,
    y,
    shift
  );
}

/** ⌘/ on the frame's document — the canvas resolves it through the registry (`ai.ask-selection`). */
async function pressAsk(): Promise<void> {
  await browser.execute(() => {
    const frame = document.querySelector('[data-testid="canvas-frame"]') as HTMLIFrameElement;
    const doc = frame.contentDocument as Document;
    doc.dispatchEvent(
      new KeyboardEvent('keydown', { key: '/', code: 'Slash', metaKey: true, bubbles: true })
    );
  });
}

describe('⌘/ on a selection, in place (S2.19)', () => {
  before(async () => {
    await waitForSidecar();
    writeFileSync(CANVAS, POST);
    await (await canvasRow('smoke')).click();
    await browser.waitUntil(async () => (await rectOf('Gama')) !== null, { timeout: 15000 });
  });
  after(() => fixtures.restore());

  async function selectThree(): Promise<void> {
    for (const [i, t] of ['Alfa', 'Beta', 'Gama'].entries()) {
      const p = await rectOf(t);
      expect(p).not.toBeNull();
      await click(p!.x, p!.y, i > 0);
    }
  }

  it('three cards selected: ⌘/ opens the bubble under them, chip "3 elements", the field has focus', async () => {
    const report = startReport('edit-ask-ai-bubble');
    await selectThree();
    await pressAsk();
    const bubble = await $('[data-testid="ask-selection-bubble"]');
    await bubble.waitForDisplayed({ timeout: 8000 });
    expect(await (await $('[data-testid="ask-selection-chip"]')).getText()).toContain('3 elements');
    expect(await (await $('[data-testid="ask-selection-input"]')).isFocused()).toBe(true);
    await capture(report, 'bubble');
  });

  it('esc closes it; the canvas keeps its selection', async () => {
    await browser.keys(['Escape']);
    await browser.waitUntil(
      async () => !(await $('[data-testid="ask-selection-bubble"]').isExisting()),
      {
        timeout: 4000,
      }
    );
  });

  it('words and ↵: the bubble becomes the asked line with the one-step hint', async () => {
    const report = startReport('edit-ask-ai-asked');
    await pressAsk();
    const input = await $('[data-testid="ask-selection-input"]');
    await input.waitForDisplayed({ timeout: 8000 });
    await input.setValue('Add a “Read more →” link to each card.');
    await browser.keys(['Enter']);
    const asked = await $('[data-testid="ask-selection-asked"]');
    await asked.waitForDisplayed({ timeout: 8000 });
    expect(await (await $('[data-testid="ask-selection-text"]')).getText()).toContain('Read more');
    expect(await (await $('[data-testid="ask-selection-hint"]')).getText()).toBe(
      'One step — ⌘Z undoes all of it · the rest of the page stays yours'
    );
    await capture(report, 'asked');
  });
});
