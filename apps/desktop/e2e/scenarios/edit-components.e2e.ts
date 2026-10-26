import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { browser, expect } from '@wdio/globals';
import { waitForCanvasRects, waitForCanvasSettled } from '../helpers/canvas-frame';
import { capture, startReport } from '../helpers/evidence';
import { createFixtureGuard } from '../helpers/fixture-guard';
import { setSelect } from '../helpers/select';
import { waitForSidecar } from '../helpers/sidecar';
import { canvasRow } from '../helpers/tree';

/**
 * S2.16 (artboard ed-comp-pick) — part 1: ⇧I opens the Component picker (Brand · Components, no empty
 * Patterns group), a click on Button puts a ghost on the pointer, the ghost snaps onto the artboard's
 * centre guide, and a click places the instance linked: `import { Button } from "@maude/ds"` once and
 * the instance as the artboard's last child, in ONE write that ⌘Z takes back whole. ↵ places a pick in the
 * selected frame instead. A canvas left out of the design system's current revision (`meta.dsRev`) gives
 * the new instance `data-ds-rev="head"`; a canvas that follows the system does not.
 * Part 2 (instances: override, swap, reset, detach) is S2.17, at the end of this file.
 *
 * Driving model (memory: the canvas iframe is unreachable by DOM selectors once the origin split is on):
 * the toolbar slot and the pointer are driven by synthetic events on the frame's document, the picker is
 * the shell's own DOM (`data-testid="tool-panel-components"`), and every assertion is on the file on disk
 * or on a `data-testid` the picker / the editing layer draws.
 *
 * Written, not run, by the slice (the lane has no desktop build); run with the `desktop-e2e` skill.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const CANVAS = join(HERE, '../fixtures/project/.design/ui/Smoke.tsx');
const META = join(HERE, '../fixtures/project/.design/ui/Smoke.meta.json');
const fixtures = createFixtureGuard('edit-components', [CANVAS, META]);
const source = () => readFileSync(CANVAS, 'utf8');

const HOME = `import { DCArtboard, DesignCanvas } from "@maude/canvas-lib";

export default function Smoke() {
  return (
    <DesignCanvas>
      <DCArtboard id="smoke" label="SMOKE/01 · COMPONENTS" width={900} height={420}>
        <section data-cd-id="row" style={{ display: "flex", gap: 8, padding: 16 }}>
          <b data-cd-id="dot">·</b>
        </section>
      </DCArtboard>
    </DesignCanvas>
  );
}
`;

const inFrame = async <T>(
  fn: (doc: Document, win: Window, ...rest: any[]) => T,
  ...args: unknown[]
): Promise<T> => {
  // A throw inside `execute` reaches the spec as "A JavaScript exception occurred" and nothing else;
  // carry the page's own message out instead so a red run says WHY.
  const out = (await browser.execute(
    (src: string, a: unknown[]) => {
      try {
        const frame = document.querySelector('[data-testid="canvas-frame"]') as HTMLIFrameElement;
        return {
          v: new Function('doc', 'win', 'args', `return (${src})(doc, win, ...args)`)(
            frame.contentDocument,
            frame.contentWindow,
            a
          ),
        };
      } catch (e) {
        return { __inFrameError: String(e) };
      }
    },
    fn.toString(),
    args
  )) as { v?: T; __inFrameError?: string };
  if (out.__inFrameError) throw new Error(`inFrame: ${out.__inFrameError}`);
  return out.v as T;
};

const press = (key: string, shift = false) =>
  inFrame(
    (doc, _w, k: string, s: boolean) => {
      const e = new KeyboardEvent('keydown', { key: k, shiftKey: s, bubbles: true });
      doc.dispatchEvent(e);
    },
    key,
    shift
  );

/** The artboard body's box in the SHELL's viewport (the frame's origin added), for pointer events. */
const artboard = () =>
  browser.execute(() => {
    const frame = document.querySelector('[data-testid="canvas-frame"]') as HTMLIFrameElement;
    const body = frame.contentDocument?.querySelector('.dc-artboard-body') as HTMLElement;
    const r = body.getBoundingClientRect();
    return { left: r.left, top: r.top, width: r.width, height: r.height };
  });

const pointer = (type: 'pointermove' | 'pointerdown', x: number, y: number) =>
  browser.execute(
    (t, px, py) => {
      const frame = document.querySelector('[data-testid="canvas-frame"]') as HTMLIFrameElement;
      const doc = frame.contentDocument as Document;
      const target = doc.elementFromPoint(px, py) ?? doc.body;
      target.dispatchEvent(
        new PointerEvent(t, { bubbles: true, clientX: px, clientY: py, button: 0 })
      );
    },
    type,
    x,
    y
  );

const ghost = () =>
  browser.execute(() => {
    const frame = document.querySelector('[data-testid="canvas-frame"]') as HTMLIFrameElement;
    const g = frame.contentDocument?.querySelector('[data-testid="edit-place-ghost"]');
    return g ? { snapped: g.getAttribute('data-snapped') === 'true' } : null;
  });

/**
 * A person's ⌘-click on the element with this id: down, up and click AT ITS CENTRE (the router picks its target by
 * the pointer's position, not by where the event was fired), so the deepest object there is selected.
 */
/** The selection the server mirrors from the studio (`_active.json`, inspect.ts): the selected element's id. */
const ACTIVE = join(HERE, '../fixtures/project/.design/_active.json');
const selectedId = () => {
  try {
    const s = JSON.parse(readFileSync(ACTIVE, 'utf8'))?.selected;
    return (Array.isArray(s) ? s[0] : s)?.id ?? null;
  } catch {
    return null;
  }
};
const selectFrame = async (id: string) => {
  // r6 flake: a press sent while the canvas was still reloading from the step before (⌘Z rewrote the source)
  // landed in the outgoing document and selected nothing, so ↵ placed at the artboard. Press until the
  // selection the server holds IS this element.
  await browser.waitUntil(
    async () => {
      if (selectedId() === id) return true;
      await inFrame((doc, win, elId: string) => {
        const el = doc.querySelector(`[data-cd-id="${elId}"]`) as HTMLElement | null;
        if (!el) return;
        const r = el.getBoundingClientRect();
        const at = {
          bubbles: true,
          cancelable: true,
          clientX: r.left + r.width / 2,
          clientY: r.top + r.height / 2,
          button: 0,
          metaKey: true,
        };
        for (const t of ['pointerdown', 'pointerup', 'click'])
          el.dispatchEvent(new (win as any).MouseEvent(t, at));
      }, id);
      return browser
        .waitUntil(async () => selectedId() === id, { timeout: 1_500, interval: 100 })
        .then(() => true)
        .catch(() => false);
    },
    { timeout: 15_000, interval: 250, timeoutMsg: `the selection never became ${id}` }
  );
};

const openPicker = async () => {
  // the tool keys register once the editing layer has mounted over the canvas, a beat after it renders:
  // press again until the picker answers (a press on an open picker would close it, so only while it is shut)
  await browser.waitUntil(
    async () => {
      if (await $('[data-testid="tool-panel-components"]').isExisting()) return true;
      // the shell opens a tool panel only for a FOCUSED canvas (tool-panels gate, testids.json tool-panel-<panel>)
      await browser.execute(() => {
        const frame = document.querySelector('[data-testid="canvas-frame"]') as HTMLIFrameElement;
        frame.focus();
        frame.contentWindow?.focus();
      });
      await press('I', true);
      await browser.pause(700);
      if (await $('[data-testid="tool-panel-components"]').isExisting()) return true;
      // the toolbar's own Components slot, in the frame — what a person without the key presses
      await inFrame((doc) => {
        (
          doc.querySelector('[data-testid="toolbar-slot-components"]') as HTMLElement | null
        )?.click();
      });
      await browser.pause(700);
      return $('[data-testid="tool-panel-components"]').isExisting();
    },
    { timeout: 15000, timeoutMsg: '⇧I never opened the Component picker' }
  );
};

describe('the Component picker and placing from it (S2.16)', () => {
  before(async () => {
    await waitForSidecar();
    writeFileSync(CANVAS, HOME);
    writeFileSync(META, '{}\n');
    await (await canvasRow('canvas-row-ui-smoke')).click();
    await waitForCanvasRects();
    await browser.waitUntil(async () => (await $('[data-testid="canvas-frame"]')).isExisting(), {
      timeout: 15000,
    });
  });
  after(() => fixtures.restore());

  it('⇧I lists Brand and Components, no empty Patterns group; a pick puts a ghost on the pointer', async () => {
    const report = startReport('edit-components-pick');
    await openPicker();
    expect(
      await (await $('[data-testid="component-picker-search"]')).getAttribute('placeholder')
    ).toBe('Search components');
    expect(await (await $('[data-testid="component-picker-group-brand"]')).isExisting()).toBe(true);
    expect(await (await $('[data-testid="component-picker-group-components"]')).isExisting()).toBe(
      true
    );
    expect(await (await $('[data-testid="component-picker-group-patterns"]')).isExisting()).toBe(
      false
    );
    await capture(report, 'picker');
    await (await $('[data-testid="component-picker-row-Button"]')).click();
    // the picker lets go of the screen and the canvas carries the ghost
    await browser.waitUntil(
      async () => !(await (await $('[data-testid="tool-panel-components"]')).isExisting()),
      {
        timeout: 5000,
      }
    );
    const a = await artboard();
    await pointer('pointermove', a.left + a.width * 0.2, a.top + a.height * 0.6);
    await browser.waitUntil(async () => (await ghost()) !== null, { timeout: 5000 });
    expect((await ghost())?.snapped).toBe(false);
    // near the middle it snaps onto the centre guide
    await pointer('pointermove', a.left + a.width / 2 + 3, a.top + a.height * 0.6);
    await browser.waitUntil(async () => (await ghost())?.snapped === true, { timeout: 5000 });
    await capture(report, 'ghost-snapped');
  });

  it('a click places it linked: the import once, the instance centred, one write; ⌘Z takes it back whole', async () => {
    const report = startReport('edit-components-place');
    const before = source();
    expect(before).not.toContain('@maude/ds');
    const a = await artboard();
    await pointer('pointerdown', a.left + a.width / 2 + 3, a.top + a.height * 0.6);
    await browser.waitUntil(async () => source().includes('<Button '), { timeout: 8000 });
    const after = source();
    expect(after.split('from "@maude/ds"').length - 1).toBe(1);
    expect(after).toContain('import { Button } from "@maude/ds";');
    expect(after).toMatch(/<Button data-cd-id="button"[^>]*variant="primary"/);
    expect(after).toContain("left: '50%'");
    // a canvas that follows the system carries no per-instance revision
    expect(after).not.toContain('data-ds-rev');
    expect(await ghost()).toBeNull();
    await capture(report, 'placed');
    await browser.keys(['Meta', 'z']);
    await browser.waitUntil(async () => source() === before, { timeout: 8000 });
  });

  it('↵ in the picker puts it in the selected frame, in the flow, without a second import', async () => {
    const report = startReport('edit-components-enter');
    // select the flex frame by its id through the editing layer's selection
    await selectFrame('row');
    await openPicker();
    const search = await $('[data-testid="component-picker-search"]');
    await search.setValue('badge');
    await browser.keys(['Enter']);
    await browser.waitUntil(async () => source().includes('<Badge '), { timeout: 8000 });
    expect(source()).toMatch(/<b data-cd-id="dot">·<\/b>\s*<Badge /);
    expect(source().split('@maude/ds').length - 1).toBe(1);
    await capture(report, 'in-frame');
  });

  it('a canvas left out of the current revision gives the new instance data-ds-rev="head"', async () => {
    writeFileSync(CANVAS, HOME);
    writeFileSync(META, `${JSON.stringify({ dsRev: 'a'.repeat(64) })}\n`);
    await browser.pause(800);
    await (await canvasRow('canvas-row-ui-smoke')).click();
    await waitForCanvasRects();
    await selectFrame('row');
    await openPicker();
    await (await $('[data-testid="component-picker-search"]')).setValue('chip');
    await browser.keys(['Enter']);
    await browser.waitUntil(async () => source().includes('<Chip '), { timeout: 8000 });
    expect(source()).toMatch(/<Chip data-cd-id="chip" data-ds-rev="head"/);
  });
});

/**
 * S2.17 (artboard ed-comp-instance) — part 2: an instance of a design-system component. Selecting it makes
 * the inspector's chip say Instance; Component · Variant swap it (the words and the colour come along, ONE
 * write); the Content line counts what differs and Reset takes back only that; Detach turns it into a plain
 * frame with the same classes, id and token references and drops the `@maude/ds` import. Each step is one
 * undo. The inspector is the shell's own DOM (`data-testid`s from client/v2/inspector/kinds/instance.jsx);
 * the canvas is read as the file on disk. Written, not run, by the slice.
 */
const INSTANCE = `import { DCArtboard, DesignCanvas } from "@maude/canvas-lib";
import { Button } from "@maude/ds";

export default function Smoke() {
  return (
    <DesignCanvas>
      <DCArtboard id="smoke" label="SMOKE/02 · INSTANCE" width={900} height={420}>
        <Button data-cd-id="cta" variant="primary" style={{ background: "var(--accent)" }}>REGISTRUJ SE</Button>
      </DCArtboard>
    </DesignCanvas>
  );
}
`;

describe('an instance: override, swap, reset, detach (S2.17)', () => {
  before(async () => {
    await waitForSidecar();
    writeFileSync(CANVAS, INSTANCE);
    writeFileSync(META, '{}\n');
    await browser.pause(800);
    await (await canvasRow('canvas-row-ui-smoke')).click();
    await waitForCanvasRects();
    await browser.waitUntil(async () => (await $('[data-testid="canvas-frame"]')).isExisting(), {
      timeout: 15000,
    });
    // A person's plain click AT the button: the router selects on pointerdown, by the pointer's position (a bare
    // `click` event at 0,0 selects nothing — v2 input-router.tsx `onPointerDown`).
    await waitForCanvasSettled();
    await inFrame((doc, win) => {
      const el = doc.querySelector('[data-cd-id="cta"]') as HTMLElement;
      const r = el.getBoundingClientRect();
      const at = {
        bubbles: true,
        cancelable: true,
        clientX: r.left + r.width / 2,
        clientY: r.top + r.height / 2,
        button: 0,
      };
      const hit = doc.elementFromPoint(at.clientX, at.clientY) ?? el;
      for (const t of ['pointerdown', 'pointerup', 'click'])
        hit.dispatchEvent(new (win as any).MouseEvent(t, at));
    });
    await browser.waitUntil(
      async () => (await (await $('[data-testid="inspector-kind"]')).getText()) === 'Instance',
      { timeout: 10000 }
    );
  });
  after(() => fixtures.restore());

  it('says Instance, names the master, and counts what it changes', async () => {
    const report = startReport('edit-components-instance');
    expect(await (await $('[data-testid="insp-sec-component"]')).isExisting()).toBe(true);
    expect(await (await $('[data-testid="insp-content-text"]')).getValue()).toBe('REGISTRUJ SE');
    expect(await (await $('[data-testid="insp-instance-changes"]')).getText()).toMatch(
      /^2 changes from .+\./
    );
    await capture(report, 'instance');
  });

  it('another variant is ONE write: the words and the colour come along; ⌘Z takes it back', async () => {
    const before = source();
    await $('[data-testid="insp-variant-select"]').waitForExist({ timeout: 8000 });
    const values = (await browser.execute(() =>
      Array.from(
        document.querySelectorAll<HTMLOptionElement>('[data-testid="insp-variant-select"] option')
      ).map((o) => o.value)
    )) as string[];
    const other = values.find((v) => v && v !== 'primary') as string;
    // the embedded WebDriver's option click does not select in WKWebView: the select's own change (helpers/select.ts)
    expect(await setSelect('insp-variant-select', other)).toBe(true);
    await browser.waitUntil(async () => source().includes(`variant="${other}"`), { timeout: 8000 });
    expect(source()).toContain('REGISTRUJ SE');
    expect(source()).toContain('var(--accent)');
    await browser.keys(['Meta', 'z']);
    await browser.waitUntil(async () => source() === before, { timeout: 8000 });
  });

  it('Reset takes back the words and the colour, nothing else', async () => {
    await (await $('[data-testid="insp-instance-reset"]')).click();
    await browser.waitUntil(async () => !source().includes('REGISTRUJ SE'), { timeout: 8000 });
    expect(source()).toContain('>Button</Button>');
    expect(source()).not.toContain('var(--accent)');
    expect(source()).toContain('variant="primary"');
    await browser.keys(['Meta', 'z']);
    await browser.waitUntil(async () => source().includes('REGISTRUJ SE'), { timeout: 8000 });
  });

  it('Detach keeps the look as a plain frame: same classes, same id, same token reference, no import', async () => {
    const report = startReport('edit-components-detach');
    // Detach writes the subtree the canvas RENDERS (component.detach params.tree): the ⌘Z above restored the file,
    // and the frame re-renders a beat later — press Detach once the words are back on the canvas, as a person would.
    await browser.waitUntil(
      async () =>
        inFrame((doc) =>
          (doc.querySelector('[data-cd-id="cta"]')?.textContent ?? '').includes('REGISTRUJ SE')
        ),
      { timeout: 8000, timeoutMsg: 'the canvas never showed the restored words' }
    );
    await (await $('[data-testid="insp-instance-detach"]')).click();
    await browser.waitUntil(async () => !source().includes('@maude/ds'), { timeout: 8000 });
    const out = source();
    expect(out).toMatch(/<button data-cd-id="cta" className="btn btn--primary"/);
    expect(out).toContain('var(--accent)');
    expect(out).not.toMatch(/\d+px/);
    await capture(report, 'detached');
    await browser.keys(['Meta', 'z']);
    await browser.waitUntil(async () => source().includes('<Button '), { timeout: 8000 });
  });
});
