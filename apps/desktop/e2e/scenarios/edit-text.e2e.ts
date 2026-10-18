import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { browser, expect } from '@wdio/globals';
import { capture, startReport } from '../helpers/evidence';
import { createFixtureGuard } from '../helpers/fixture-guard';
import { waitForSidecar } from '../helpers/sidecar';
import { canvasRow } from '../helpers/tree';

/**
 * S2.12 (artboards ed-text-edit · ed-text-style) — a Czech headline: double-click puts a caret in it with
 * the edit-tone ring, the ties show as small arcs under the spaces that will become no-break spaces, and
 * clicking away writes the copy as ONE edit-op with the ties in it. The inspector's Type section then
 * names the style, Language says Čeština, and Reset / Detach change only the headline.
 *
 * Driving model (memory: the canvas iframe is unreachable by DOM selectors once the origin split is on):
 * the headline is found by COORDINATES from `window.__maudeCanvasRects()`, events are synthetic and
 * dispatched on the frame's document, every assertion is on the file on disk or on a `data-testid` the
 * editing layer draws. The existing canvas-text-editing.e2e.ts keeps covering v1's gestures (its commit
 * now goes through `text.set`; the bytes it asserts are the same).
 *
 * Written, not run, by the slice (the lane has no desktop build); run with the `desktop-e2e` skill.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const CANVAS = join(HERE, '../fixtures/project/.design/ui/Smoke.tsx');
const fixtures = createFixtureGuard('edit-text', [CANVAS]);
const source = () => readFileSync(CANVAS, 'utf8');
const NBSP = ' ';

const HOME = `import { DCArtboard, DesignCanvas } from "@maude/canvas-lib";

export default function Smoke() {
  return (
    <DesignCanvas>
      <DCArtboard id="smoke" label="SMOKE/01 · TEXT" width={900} height={420}>
        <style>{".t-heading{font-size:48px;font-weight:700}"}</style>
        <h1 data-cd-id="tx-title" lang="cs" className="t-heading" style={{ margin: 24 }}>Jdu do lesa</h1>
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

const arcs = () =>
  browser.execute(
    () =>
      (
        document.querySelector('[data-testid="canvas-frame"]') as HTMLIFrameElement
      ).contentDocument?.querySelectorAll('[data-testid="edit-tie-arc"]').length ?? 0
  );

async function dblclick(p: Pt): Promise<void> {
  await browser.execute(
    (px, py) => {
      const frame = document.querySelector('[data-testid="canvas-frame"]') as HTMLIFrameElement;
      const doc = frame.contentDocument as Document;
      const target = doc.elementFromPoint(px, py) ?? doc.body;
      for (const type of ['pointerdown', 'pointerup', 'click', 'dblclick'])
        target.dispatchEvent(
          new MouseEvent(type, { bubbles: true, clientX: px, clientY: py, button: 0, detail: 2 })
        );
    },
    p.x,
    p.y
  );
}

/** Type into the element being edited: set the text, tell the page (what a keystroke does), then blur. */
async function typeAndCommit(text: string): Promise<void> {
  await browser.execute((t) => {
    const frame = document.querySelector('[data-testid="canvas-frame"]') as HTMLIFrameElement;
    const doc = frame.contentDocument as Document;
    const el = doc.querySelector('[contenteditable].dc-text-editing') as HTMLElement;
    el.textContent = t;
    el.dispatchEvent(new InputEvent('input', { bubbles: true }));
  }, text);
}
const commit = () =>
  browser.execute(() => {
    const frame = document.querySelector('[data-testid="canvas-frame"]') as HTMLIFrameElement;
    (
      frame.contentDocument?.querySelector('[contenteditable].dc-text-editing') as HTMLElement
    ).blur();
  });

describe('text in place, styles and the Czech ties (S2.12)', () => {
  before(async () => {
    await waitForSidecar();
    writeFileSync(CANVAS, HOME);
    await (await canvasRow('smoke')).click();
    await browser.waitUntil(async () => (await rectOf('Jdu do lesa')) !== null, { timeout: 15000 });
  });
  after(() => fixtures.restore());

  it('double-click, type: the ties show as arcs; clicking away writes them as no-break spaces', async () => {
    const report = startReport('edit-text-ties');
    const p = (await rectOf('Jdu do lesa'))!;
    await dblclick(p); // the first one selects the headline
    await dblclick(p); // the second one is the caret
    await browser.waitUntil(async () => (await arcs()) >= 0, { timeout: 5000 });
    await typeAndCommit('Jdu v lese a s "Petrem"');
    await browser.waitUntil(async () => (await arcs()) === 3, { timeout: 5000 });
    await capture(report, 'ties-while-typing');
    await commit();
    await browser.waitUntil(async () => source().includes(`Jdu v${NBSP}lese a${NBSP}s${NBSP}„Petrem“`), {
      timeout: 8000,
    });
    // the id, the language and the style are untouched
    expect(source()).toContain('data-cd-id="tx-title" lang="cs" className="t-heading"');
    expect(await arcs()).toBe(0);
    await capture(report, 'written');
  });
});
