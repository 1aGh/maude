import { readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { $, browser, expect } from '@wdio/globals';
import { capture, startReport } from '../helpers/evidence';
import { createFixtureGuard } from '../helpers/fixture-guard';
import { waitForSidecar } from '../helpers/sidecar';

/**
 * In-canvas TEXT EDITING in the real WKWebView — the verification backbone for
 * feature-unified-text-editing (.ai/plans/feature-unified-text-editing.md).
 *
 * Driving model (measured 2026-07-09): native WebDriver pointer/keys do NOT
 * penetrate the canvas iframe, so every interaction is a SYNTHETIC event
 * dispatched inside the same-origin frame (MAUDE_CANVAS_ORIGIN_SPLIT=0),
 * reached via `iframe.contentDocument` from the top frame — robust against the
 * canvas's post-build hot-reload, which invalidates a switchFrame context.
 * Synthetic events faithfully exercise the app's own handlers (edit-mode
 * entry, caret placement, keydown commit); what they can NOT prove is the
 * temporal feel of the native caret blink — that is Task 7.2's user-visual
 * gate. The custom [data-maude-caret] element + its animationName is the
 * harness-assertable proxy (Phase 1).
 *
 * Suite layout mirrors the plan's phases. Not-yet-built behaviors are
 * `it.skip` TODOs so the suite documents the target; each phase flips its
 * skip off as the behavior lands.
 */

const H1 = '[data-testid="smoke-h1"]';
const MIXED = '[data-testid="smoke-mixed"]';
const STICKY = '[data-id="s_e2esticky1"]';
const TEXT_STROKE = '[data-id="s_e2etext1"]';
const SECTION = '[data-id="s_e2esection1"]';

// Commit tests WRITE THROUGH to disk (annotations PUT + /_api/edit-text on the
// canvas source) — snapshot the committed fixture files and restore them
// byte-exact after the run so the repo never dirties. The guard survives a
// killed run (see helpers/fixture-guard.ts); a plain after()-only restore did
// not, and the dirt cascaded into the next run's baseline.
const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_FILES = [
  join(HERE, '../fixtures/project/.design/ui/Smoke.tsx'),
  join(HERE, '../fixtures/project/.design/ui-smoke.annotations.json'),
];
const fixtures = createFixtureGuard('canvas-text-editing', FIXTURE_FILES);

type Probe = {
  frame: boolean;
  exists: boolean;
  text: string | null;
  ce: string | null;
  editingClass: boolean;
  caretColor: string | null;
  activeTag: string | null;
  selCollapsed: boolean | null;
  selAnchorOffset: number | null;
  selText: string | null;
  customCaret: boolean;
  customCaretAnim: string | null;
};

/** State of one element + the live selection, read inside the canvas frame. */
function probe(sel: string): Promise<Probe> {
  return browser.execute((q) => {
    const iframe = document.querySelector(
      '[data-testid="canvas-frame"]'
    ) as HTMLIFrameElement | null;
    const doc = iframe?.contentDocument;
    const win = iframe?.contentWindow as (Window & typeof globalThis) | null;
    if (!doc || !win) return { frame: false } as unknown as Probe;
    const el = doc.querySelector(q) as HTMLElement | null;
    const sc = win.getSelection?.();
    const a = doc.activeElement as HTMLElement | null;
    const customCaret = doc.querySelector('[data-maude-caret]') as HTMLElement | null;
    return {
      frame: true,
      exists: !!el,
      text: el?.textContent ?? null,
      ce: el?.getAttribute('contenteditable') ?? null,
      editingClass: el?.classList.contains('dc-text-editing') ?? false,
      caretColor: el ? win.getComputedStyle(el).caretColor : null,
      activeTag: a?.tagName ?? null,
      selCollapsed: sc ? sc.isCollapsed : null,
      selAnchorOffset: sc ? sc.anchorOffset : null,
      selText: sc ? sc.toString() : null,
      customCaret: !!customCaret,
      customCaretAnim: customCaret ? win.getComputedStyle(customCaret).animationName : null,
    } as Probe;
  }, sel) as Promise<Probe>;
}

/** The element's rect in IFRAME-LOCAL viewport coords (what synthetic
 * MouseEvent.clientX/Y and caretRangeFromPoint need — NOT top-frame coords;
 * the old diagnostic mixed these up). */
function frameLocalBox(sel: string) {
  return browser.execute((q) => {
    const iframe = document.querySelector(
      '[data-testid="canvas-frame"]'
    ) as HTMLIFrameElement | null;
    const el = iframe?.contentDocument?.querySelector(q) as HTMLElement | null;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { cx: r.left + r.width / 2, cy: r.top + r.height / 2, ...r.toJSON() };
  }, sel) as Promise<{
    cx: number;
    cy: number;
    left: number;
    top: number;
    width: number;
    height: number;
  } | null>;
}

/** Dispatch a real-shaped double-click (down/up/click ×2 + dblclick) on the
 * element, with IFRAME-LOCAL client coords. Exercises the app's capture-phase
 * dblclick handlers exactly like a user gesture (minus native caret motion —
 * the app places the caret itself via caretRangeFromPoint). */
function synthDblclick(sel: string, cx: number, cy: number) {
  return browser.execute(
    (q, x, y) => {
      const iframe = document.querySelector(
        '[data-testid="canvas-frame"]'
      ) as HTMLIFrameElement | null;
      const doc = iframe?.contentDocument;
      const win = iframe?.contentWindow as (Window & typeof globalThis) | null;
      const el = doc?.querySelector(q) as HTMLElement | null;
      if (!el || !win) return false;
      const opts = { bubbles: true, cancelable: true, view: win, clientX: x, clientY: y };
      el.dispatchEvent(new win.PointerEvent('pointerdown', { ...opts, pointerId: 1 }));
      el.dispatchEvent(new win.MouseEvent('mousedown', { ...opts, detail: 1 }));
      el.dispatchEvent(new win.PointerEvent('pointerup', { ...opts, pointerId: 1 }));
      el.dispatchEvent(new win.MouseEvent('mouseup', { ...opts, detail: 1 }));
      el.dispatchEvent(new win.MouseEvent('click', { ...opts, detail: 1 }));
      el.dispatchEvent(new win.MouseEvent('mousedown', { ...opts, detail: 2 }));
      el.dispatchEvent(new win.MouseEvent('mouseup', { ...opts, detail: 2 }));
      el.dispatchEvent(new win.MouseEvent('click', { ...opts, detail: 2 }));
      el.dispatchEvent(new win.MouseEvent('dblclick', { ...opts, detail: 2 }));
      return true;
    },
    sel,
    Math.round(cx),
    Math.round(cy)
  );
}

/** feature-4 (2026-07-19) — the dblclick ladder is now Figma-exact: each
 * double-click DRILLS one level along the stamped chain, and text edit opens
 * only once the LEAF ITSELF is selected. Editing from a cold selection
 * therefore takes 2–4 dblclicks depending on depth — this helper repeats the
 * gesture until the predicate holds (edit mode entered / hint toast shown). */
/**
 * `maxTries` was 5, and that was too tight to be a budget at all. Measured by
 * hand against an IDLE same-origin Chromium (the fastest case this gesture ever
 * sees): the h1 needed 3 dblclicks and the `.map` card needed 4 — so the drill
 * routinely spent 80% of the allowance before doing anything, and WKWebView
 * under load simply ran out. That is the whole of this file's flakiness: runs
 * alternated between 3 and 4 failures depending on whether the ladder finished.
 * 12 is still bounded (each try costs one 300 ms pause) and no longer a coin
 * flip. A predicate that never holds still fails — just not for lack of room.
 */
async function synthDblclickUntil(
  sel: string,
  cx: number,
  cy: number,
  predicate: () => Promise<boolean>,
  maxTries = 12
): Promise<boolean> {
  for (let i = 0; i < maxTries; i++) {
    await synthDblclick(sel, cx, cy);
    await browser.pause(300);
    if (await predicate()) return true;
  }
  return false;
}

/** Post a shell-style message INTO the canvas window (zoom ops etc. — the
 * same messages the studio shell sends; canvas-shell listens on its own
 * window). */
function postToCanvas(msg: Record<string, unknown>) {
  return browser.execute((m) => {
    const iframe = document.querySelector(
      '[data-testid="canvas-frame"]'
    ) as HTMLIFrameElement | null;
    iframe?.contentWindow?.postMessage(m, '*');
    return true;
  }, msg);
}

/** State of the (single) active annotation editor, if any. */
function annotEditorProbe() {
  return browser.execute(() => {
    const iframe = document.querySelector(
      '[data-testid="canvas-frame"]'
    ) as HTMLIFrameElement | null;
    const doc = iframe?.contentDocument;
    if (!doc) return { frame: false, exists: false, inForeignObject: false, inWorld: false };
    const ed = doc.querySelector('.dc-annot-editor') as HTMLElement | null;
    return {
      frame: true,
      exists: !!ed,
      tag: ed?.tagName ?? null,
      inForeignObject: !!ed?.closest('foreignObject'),
      inWorld: !!ed?.closest('.dc-world'),
      // Ghost check: read-only sticky bodies still painted for a stroke that
      // is being edited (suppression must remove them).
      stickyReadBodies: doc.querySelectorAll('[data-id="s_e2esticky1"] .dc-sticky-body').length,
      text: ed?.textContent ?? null,
    };
  }) as Promise<{
    frame: boolean;
    exists: boolean;
    tag?: string | null;
    inForeignObject: boolean;
    inWorld: boolean;
    stickyReadBodies?: number;
    text?: string | null;
  }>;
}

/** Dispatch a keydown on the frame DOCUMENT body (tool shortcuts etc.). */
function synthKeyOnDoc(key: string) {
  return browser.execute((k) => {
    const iframe = document.querySelector(
      '[data-testid="canvas-frame"]'
    ) as HTMLIFrameElement | null;
    const doc = iframe?.contentDocument;
    const win = iframe?.contentWindow as (Window & typeof globalThis) | null;
    if (!doc || !win) return false;
    doc.body.dispatchEvent(
      new win.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true })
    );
    return true;
  }, key);
}

/** Dispatch a full synthetic pointer/mouse click sequence on an element at
 * frame-local coords (drives React onPointerDown/Up handlers — the tool
 * input-capture overlay). */
function synthPointerOn(sel: string, cx: number, cy: number) {
  return browser.execute(
    (q, x, y) => {
      const iframe = document.querySelector(
        '[data-testid="canvas-frame"]'
      ) as HTMLIFrameElement | null;
      const doc = iframe?.contentDocument;
      const win = iframe?.contentWindow as (Window & typeof globalThis) | null;
      const el = doc?.querySelector(q) as HTMLElement | null;
      if (!el || !win) return false;
      const opts = { bubbles: true, cancelable: true, view: win, clientX: x, clientY: y };
      el.dispatchEvent(
        new win.PointerEvent('pointerdown', { ...opts, pointerId: 1, isPrimary: true })
      );
      el.dispatchEvent(new win.MouseEvent('mousedown', { ...opts, detail: 1 }));
      el.dispatchEvent(
        new win.PointerEvent('pointerup', { ...opts, pointerId: 1, isPrimary: true })
      );
      el.dispatchEvent(new win.MouseEvent('mouseup', { ...opts, detail: 1 }));
      el.dispatchEvent(new win.MouseEvent('click', { ...opts, detail: 1 }));
      return true;
    },
    sel,
    Math.round(cx),
    Math.round(cy)
  );
}

/** Count annotation strokes currently rendered (top-level [data-id] nodes). */
function countStrokes(): Promise<number> {
  return browser.execute(() => {
    const iframe = document.querySelector(
      '[data-testid="canvas-frame"]'
    ) as HTMLIFrameElement | null;
    const doc = iframe?.contentDocument;
    return doc ? doc.querySelectorAll('.dc-annot-svg [data-id][data-tool]').length : -1;
  }) as Promise<number>;
}

/** Collapse the caret to the END of the frame's active editable and insert
 * text there via execCommand — the plan's prescribed substitute for native
 * typing, which synthetic keydowns can't produce (untrusted events run no UA
 * default action). Fires the app's input/selectionchange listeners exactly
 * like real typing. */
function typeAtEnd(text: string) {
  return browser.execute((t) => {
    const iframe = document.querySelector(
      '[data-testid="canvas-frame"]'
    ) as HTMLIFrameElement | null;
    const doc = iframe?.contentDocument;
    const win = iframe?.contentWindow as (Window & typeof globalThis) | null;
    const el = doc?.activeElement as HTMLElement | null;
    if (!doc || !win || !el) return false;
    const sel = win.getSelection();
    if (sel) {
      const r = doc.createRange();
      r.selectNodeContents(el);
      r.collapse(false);
      sel.removeAllRanges();
      sel.addRange(r);
    }
    return doc.execCommand('insertText', false, t);
  }, text);
}

/** Dispatch a synthetic keydown on the frame's ACTIVE element (the editor). */
function synthKey(key: string, mods: { shift?: boolean; meta?: boolean } = {}) {
  return browser.execute(
    (k, shift, meta) => {
      const iframe = document.querySelector(
        '[data-testid="canvas-frame"]'
      ) as HTMLIFrameElement | null;
      const doc = iframe?.contentDocument;
      const win = iframe?.contentWindow as (Window & typeof globalThis) | null;
      const el = doc?.activeElement as HTMLElement | null;
      if (!el || !win) return false;
      el.dispatchEvent(
        new win.KeyboardEvent('keydown', {
          key: k,
          bubbles: true,
          cancelable: true,
          shiftKey: shift,
          metaKey: meta,
        })
      );
      return true;
    },
    key,
    !!mods.shift,
    !!mods.meta
  );
}

/** Wait until the camera settles: an element's rect is identical across two
 * consecutive polls (zoom/fit animate; hit-test-based caret placement needs
 * final, ON-SCREEN coordinates). */
async function waitForStableRect(sel: string, timeout = 8_000): Promise<void> {
  let prev: string | null = null;
  await browser.waitUntil(
    async () => {
      const b = await frameLocalBox(sel);
      const cur = b ? `${Math.round(b.left)}:${Math.round(b.top)}:${Math.round(b.width)}` : null;
      const stable = cur !== null && cur === prev;
      prev = cur;
      return stable;
    },
    { timeout, interval: 250, timeoutMsg: `rect for ${sel} never stabilized` }
  );
}

describe('canvas-text-editing (native-desktop / WKWebView)', () => {
  before(() => {
    // Camera state persists per-user across runs (_canvas-state/<slug>.view.json,
    // DDR-115) — a previous run's pan/zoom would leave targets OFF-VIEWPORT,
    // where caretRangeFromPoint hit-testing cannot resolve them (measured:
    // elementFromPoint → null → select-all fallback). Reset to the default
    // camera before the canvas is first opened.
    rmSync(join(HERE, '../fixtures/project/.design/_canvas-state'), {
      recursive: true,
      force: true,
    });
    fixtures.snapshot();
    startReport('canvas-text-editing (native-desktop / WKWebView)');
  });

  after(() => {
    // Byte-exact restore of everything the commit tests wrote through to disk.
    fixtures.restore();
  });

  it('boots, opens the fixture canvas, and reaches every seeded surface', async () => {
    await waitForSidecar();
    const list = await $('[data-testid="canvas-list"]');
    await list.waitForDisplayed({ timeout: 60_000 });
    const row = await $('[data-testid="canvas-row-ui-smoke"]');
    await row.waitForExist({ timeout: 30_000 });
    await row.click();
    const frame = await $('[data-testid="canvas-frame"]');
    await frame.waitForExist({ timeout: 30_000 });
    await browser.waitUntil(async () => (await probe(H1)).exists, {
      timeout: 40_000,
      interval: 800,
      timeoutMsg: 'canvas h1 never rendered',
    });
    // Task 0.2 — the enriched fixture is reachable: mixed-content <p> for the
    // persistence gate, and the seeded sticky + standalone text strokes so
    // annotation editing needs no draw gesture.
    expect((await probe(MIXED)).exists).toBe(true);
    expect((await probe(MIXED)).text).toBe('Total: 2 items');
    await browser.waitUntil(async () => (await probe(STICKY)).exists, {
      timeout: 15_000,
      interval: 500,
      timeoutMsg: 'seeded sticky stroke never rendered',
    });
    expect((await probe(TEXT_STROKE)).exists).toBe(true);
    // Deterministic camera: fit + settle, so every hit-test target below is
    // on-screen at known coordinates.
    await postToCanvas({ dgn: 'zoom', op: 'fit' });
    await waitForStableRect(H1);
    await capture('canvas-rendered-with-seeded-annotations');
    // feature-4 (browse/move split, DDR-187) — the canvas now BOOTS in the
    // `browse` tool (the mock is alive; double-click passes through to the
    // content). Every edit gesture below (dblclick → text edit, annotation
    // editing) needs the `move` (select) tool, so press V once here. The
    // annotation/text-tool phases below switch away and back via Escape
    // (onEscape flips any non-move tool → move), so this single press holds.
    // This is also the harness's V-select posture coverage (T6).
    await synthKeyOnDoc('v');
    await browser.pause(150);
  });

  it('artboard: synthetic dblclick enters edit mode with the whole string selected (Figma steer 2026-07-20)', async () => {
    const box = await frameLocalBox(H1);
    if (!box) throw new Error('no h1 box');
    await synthDblclickUntil(
      H1,
      box.cx,
      box.cy,
      async () => (await probe(H1)).ce === 'plaintext-only'
    );
    const p = await probe(H1);
    // Edit-mode entry (DDR-103 path): plaintext-only contenteditable + ring.
    // (feature-4: dblclicks drill the chain first — the helper repeats until
    // the leaf is reached and the editor opens.)
    expect(p.ce).toBe('plaintext-only');
    expect(p.editingClass).toBe(true);
    // SELECT-ALL on entry, not caret-at-click.
    //
    // This asserted `selCollapsed === true` / `selText === ''` and had been red
    // ever since the user steer of 2026-07-20, which made the DBLCLICK entry
    // select the whole string (`enterEditModeAt`'s `opts.selectAll` branch:
    // "reaching the leaf via the drill ladder puts the whole string under your
    // fingers, ready to overwrite" — Figma's behaviour). Caret-at-click is
    // still the contract for the OTHER entry points (the annotation Text tool,
    // and any click INSIDE an already-open editor), which is where
    // `placeCaretAt` is exercised. The scenario simply outlived its premise.
    expect(p.selCollapsed).toBe(false);
    expect(p.selText).toBe('Maude desktop E2E');
    // Unified accent caret-color (explicit, not the UA 'auto').
    expect(p.caretColor).not.toBe('auto');
    expect(p.caretColor).toBeTruthy();
    await capture('artboard-edit-mode-caret-at-click');
    // Escape exits WITHOUT committing — fixture stays byte-identical on disk.
    await synthKey('Escape');
    await browser.pause(200);
    const after = await probe(H1);
    expect(after.ce).toBeNull();
    expect(after.text).toBe('Maude desktop E2E');
    await capture('artboard-escape-exits-edit');
  });

  // ── Phase 1 — shared custom blinking caret ────────────────────────────────
  it('artboard: [data-maude-caret] present, animated (maude-caret-blink), inside the h1 rect', async () => {
    const box = await frameLocalBox(H1);
    if (!box) throw new Error('no h1 box');
    await synthDblclickUntil(
      H1,
      box.cx,
      box.cy,
      async () => (await probe(H1)).ce === 'plaintext-only'
    );
    const p = await probe(H1);
    if (p.ce !== 'plaintext-only') {
      // Diagnostic dump — what state is the frame actually in?
      const diag = await browser.execute(() => {
        const iframe = document.querySelector(
          '[data-testid="canvas-frame"]'
        ) as HTMLIFrameElement | null;
        const doc = iframe?.contentDocument;
        if (!doc) return { frame: false };
        const anyCe = doc.querySelector('[contenteditable]');
        const h1 = doc.querySelector('[data-testid="smoke-h1"]');
        return {
          frame: true,
          anyCe: anyCe ? `${anyCe.tagName}#${anyCe.getAttribute('data-testid')}` : null,
          h1CdId: h1?.getAttribute('data-cd-id') ?? null,
          h1Kids: h1 ? Array.from(h1.childNodes).map((n) => n.nodeType) : null,
          activeEl: doc.activeElement?.tagName ?? null,
          caretEls: doc.querySelectorAll('[data-maude-caret]').length,
        };
      });
      console.log('[P1 diag]', JSON.stringify(diag));
    }
    expect(p.ce).toBe('plaintext-only');
    // The custom caret element exists, carries the blink animation (the
    // harness-assertable proxy for "the caret blinks" — see file docblock),
    // and the native caret is hidden underneath it.
    expect(p.customCaret).toBe(true);
    expect(p.customCaretAnim ?? '').toContain('maude-caret-blink');
    expect(p.caretColor).toBe('rgba(0, 0, 0, 0)'); // caret-color: transparent

    // COLLAPSE the selection before measuring the overlay.
    //
    // Entry now selects the whole string (see the previous test), and an
    // overlay drawn for a RANGE has no caret position to sit at — it measured
    // {left: 0}, which is what made the geometry assertions below fail. So put
    // the caret where a user would: a plain click inside the already-open
    // editor, which `enterEditModeAt`'s docblock names as the supported gesture
    // ("Subsequent clicks/dblclicks inside the editor are native … click =
    // caret"). That restores exactly what this test was written to prove — the
    // custom caret tracks the collapsed selection — under the current entry
    // contract rather than the retired one.
    await browser.execute(
      (x, y) => {
        const iframe = document.querySelector(
          '[data-testid="canvas-frame"]'
        ) as HTMLIFrameElement | null;
        const doc = iframe?.contentDocument;
        const win = iframe?.contentWindow as (Window & typeof globalThis) | null;
        const el = doc?.activeElement as HTMLElement | null;
        if (!doc || !win || !el) return false;
        const range = (
          doc as Document & { caretRangeFromPoint?: (x: number, y: number) => Range | null }
        ).caretRangeFromPoint?.(x, y);
        const sel = win.getSelection();
        if (range && sel) {
          range.collapse(true);
          sel.removeAllRanges();
          sel.addRange(range);
          return true;
        }
        return false;
      },
      Math.round(box.cx),
      Math.round(box.cy)
    );
    await browser.pause(200);
    const collapsed = await probe(H1);
    expect(collapsed.selCollapsed).toBe(true);

    // Positioned at the selection — inside the h1 rect (1px tolerance).
    const c = await frameLocalBox('[data-maude-caret]');
    if (!c) throw new Error('no caret box');
    const p1diag = await browser.execute(() => {
      const iframe = document.querySelector(
        '[data-testid="canvas-frame"]'
      ) as HTMLIFrameElement | null;
      const doc = iframe?.contentDocument;
      const win = iframe?.contentWindow as (Window & typeof globalThis) | null;
      if (!doc || !win) return null;
      const caret = doc.querySelector('[data-maude-caret]') as HTMLElement | null;
      const sel = win.getSelection();
      const h1 = doc.querySelector('[data-testid="smoke-h1"]');
      return {
        caretDisplay: caret ? win.getComputedStyle(caret).display : null,
        selCollapsed: sel?.isCollapsed ?? null,
        selRangeCount: sel?.rangeCount ?? null,
        anchorInH1: !!(h1 && sel?.anchorNode && h1.contains(sel.anchorNode)),
        activeTag: doc.activeElement?.tagName ?? null,
        activeIsH1: doc.activeElement === h1,
      };
    });
    console.log('[P1 pos diag]', JSON.stringify(p1diag), 'caretBox:', JSON.stringify(c));
    expect(c.left).toBeGreaterThanOrEqual(box.left - 1);
    expect(c.left).toBeLessThanOrEqual(box.left + box.width + 1);
    expect(c.top).toBeGreaterThanOrEqual(box.top - 1);
    expect(c.top + c.height).toBeLessThanOrEqual(box.top + box.height + 2);
    await capture('artboard-custom-caret');
    // Teardown disposes the caret and restores the element.
    await synthKey('Escape');
    await browser.pause(200);
    const after = await probe(H1);
    expect(after.ce).toBeNull();
    expect(after.customCaret).toBe(false);
  });

  // ── Phase 2 — annotation editors are plain HTML in the world div ──────────
  it('sticky + standalone-text editors mount as HTML in .dc-world, positioned, no ghost — at 2 zoom levels', async () => {
    for (const level of ['zoom-base', 'zoom-in'] as const) {
      if (level === 'zoom-in') {
        // Zoom via the same message the shell View menu sends — two steps so
        // the transform is clearly different from the fitted baseline.
        await postToCanvas({ dgn: 'zoom', op: 'in' });
        await postToCanvas({ dgn: 'zoom', op: 'in' });
        await waitForStableRect(STICKY);
      }
      // Sticky: rect measured BEFORE the editor opens (the read body hides).
      const srect = await frameLocalBox(STICKY);
      if (!srect) throw new Error(`no sticky rect (${level})`);
      await synthDblclick(STICKY, srect.cx, srect.cy);
      await browser.pause(300);
      const sed = await annotEditorProbe();
      expect(sed.exists).toBe(true);
      expect(sed.inForeignObject).toBe(false);
      expect(sed.inWorld).toBe(true);
      // Positioned over the stroke bbox (host div == sticky bbox; the SVG g's
      // rect can be inflated by the drop-shadow filter → generous tolerance).
      const hostBox = await frameLocalBox('[data-annot-editor]');
      if (!hostBox) throw new Error(`no editor host box (${level})`);
      expect(Math.abs(hostBox.left - srect.left)).toBeLessThanOrEqual(12);
      expect(Math.abs(hostBox.top - srect.top)).toBeLessThanOrEqual(12);
      // No ghost: the read-only sticky body is suppressed while editing.
      expect(sed.stickyReadBodies).toBe(0);
      await capture(`sticky-editor-html-${level}`);
      await synthKey('Escape');
      await browser.pause(200);
      expect((await annotEditorProbe()).exists).toBe(false);

      // Standalone text: the whole read <text> hides while editing.
      const trect = await frameLocalBox(TEXT_STROKE);
      if (!trect) throw new Error(`no text-stroke rect (${level})`);
      await synthDblclick(TEXT_STROKE, trect.cx, trect.cy);
      await browser.pause(300);
      const ted = await annotEditorProbe();
      expect(ted.exists).toBe(true);
      expect(ted.inForeignObject).toBe(false);
      expect(ted.inWorld).toBe(true);
      // Editor sits where the stroke was (same world x/y; hanging-baseline
      // text vs line-box → small offset tolerance).
      const edBox = await frameLocalBox('.dc-annot-editor');
      if (!edBox) throw new Error(`no editor box (${level})`);
      expect(Math.abs(edBox.left - trect.left)).toBeLessThanOrEqual(12);
      expect(Math.abs(edBox.top - trect.top)).toBeLessThanOrEqual(12);
      // No ghost: the read-only <text> node is gone from the DOM while its
      // editor is up.
      expect((await probe(TEXT_STROKE)).exists).toBe(false);
      await capture(`text-editor-html-${level}`);
      await synthKey('Escape');
      await browser.pause(200);
      expect((await annotEditorProbe()).exists).toBe(false);
      expect((await probe(TEXT_STROKE)).exists).toBe(true);
    }
    // Restore the viewport for the phases below.
    await postToCanvas({ dgn: 'zoom', op: 'fit' });
    await waitForStableRect(STICKY);
  });

  // ── Phase 3 — caret-at-click for annotation editors ───────────────────────
  it('sticky: dblclick at a char offset collapses the caret there; a second click moves it; custom caret mounted', async () => {
    // Aim inside the READ body's first text line: mono 14px ≈ 8.4px/char,
    // body padding 14px top / 16px left — all WORLD units, so scale them by
    // the live zoom (body.width / sticky world width 170) into viewport px.
    // ~5 chars in ("Stick|y seed text").
    const body = await frameLocalBox(`${STICKY} .dc-sticky-body`);
    if (!body) throw new Error('no sticky read body');
    const zf = body.width / 170;
    const nearStart = { x: body.left + (16 + 42) * zf, y: body.top + (14 + 9) * zf };
    await synthDblclick(STICKY, nearStart.x, nearStart.y);
    await browser.pause(300);
    const p = await probe('.dc-annot-editor');
    const diag = await browser.execute(
      (x, y) => {
        const iframe = document.querySelector(
          '[data-testid="canvas-frame"]'
        ) as HTMLIFrameElement | null;
        const doc = iframe?.contentDocument;
        const win = iframe?.contentWindow as (Window & typeof globalThis) | null;
        if (!doc || !win) return null;
        const hit = doc.elementFromPoint(x, y);
        const ed = doc.querySelector('.dc-annot-editor') as HTMLElement | null;
        const sel = win.getSelection();
        return {
          hitAtPoint: hit ? `${hit.tagName}.${(hit as HTMLElement).className}`.slice(0, 60) : null,
          hitInEditor: !!(ed && hit && ed.contains(hit)),
          editorRect: ed ? JSON.stringify(ed.getBoundingClientRect().toJSON()) : null,
          activeTag: doc.activeElement?.tagName ?? null,
          activeIsEditor: doc.activeElement === ed,
          anchorInEditor: !!(ed && sel?.anchorNode && ed.contains(sel.anchorNode)),
          carets: doc.querySelectorAll('[data-maude-caret]').length,
        };
      },
      Math.round(nearStart.x),
      Math.round(nearStart.y)
    );
    console.log('[P3 diag]', JSON.stringify(diag), 'point:', JSON.stringify(nearStart));
    expect(p.exists).toBe(true);
    // NOT select-all: collapsed caret, empty selection string, offset at the
    // clicked character (±3 chars tolerance for font metric drift).
    expect(p.selCollapsed).toBe(true);
    expect(p.selText).toBe('');
    expect(p.selAnchorOffset).toBeGreaterThanOrEqual(2);
    expect(p.selAnchorOffset).toBeLessThanOrEqual(8);
    // The shared custom blinking caret is mounted on annotation editors too.
    expect(p.customCaret).toBe(true);
    expect(p.customCaretAnim ?? '').toContain('maude-caret-blink');
    await capture('sticky-caret-at-click');
    // A second plain click at a farther offset MOVES the caret there (the
    // explicit pointerup re-placement — native placement never runs for
    // synthetic events, so this asserts the app's own path).
    const first = p.selAnchorOffset ?? 0;
    const farther = { x: body.left + (16 + 100) * zf, y: body.top + (14 + 9) * zf };
    await browser.execute(
      (x, y) => {
        const iframe = document.querySelector(
          '[data-testid="canvas-frame"]'
        ) as HTMLIFrameElement | null;
        const doc = iframe?.contentDocument;
        const win = iframe?.contentWindow as (Window & typeof globalThis) | null;
        const el = doc?.querySelector('.dc-annot-editor') as HTMLElement | null;
        if (!el || !win) return false;
        const opts = { bubbles: true, cancelable: true, view: win, clientX: x, clientY: y };
        el.dispatchEvent(new win.PointerEvent('pointerdown', { ...opts, pointerId: 1 }));
        el.dispatchEvent(new win.MouseEvent('mousedown', { ...opts, detail: 1 }));
        el.dispatchEvent(new win.PointerEvent('pointerup', { ...opts, pointerId: 1 }));
        el.dispatchEvent(new win.MouseEvent('mouseup', { ...opts, detail: 1 }));
        el.dispatchEvent(new win.MouseEvent('click', { ...opts, detail: 1 }));
        return true;
      },
      Math.round(farther.x),
      Math.round(farther.y)
    );
    await browser.pause(200);
    const p2 = await probe('.dc-annot-editor');
    expect(p2.selCollapsed).toBe(true);
    expect(p2.selAnchorOffset).toBeGreaterThan(first);
    await capture('sticky-caret-moved-by-click');
    await synthKey('Escape');
    await browser.pause(200);

    // Standalone text gets the same treatment (lighter assertion set).
    const trect = await frameLocalBox(TEXT_STROKE);
    if (!trect) throw new Error('no text-stroke rect');
    await synthDblclick(TEXT_STROKE, trect.left + 30, trect.cy);
    await browser.pause(300);
    const tp = await probe('.dc-annot-editor');
    expect(tp.exists).toBe(true);
    expect(tp.selCollapsed).toBe(true);
    expect(tp.selText).toBe('');
    expect(tp.customCaret).toBe(true);
    await capture('text-caret-at-click');
    await synthKey('Escape');
    await browser.pause(200);
  });

  // ── Phase 4 — text tool click-through onto existing text ──────────────────
  it('text tool: click on the seeded sticky edits IT (stroke count unchanged); empty space creates new', async () => {
    const strokesBefore = await countStrokes();
    expect(strokesBefore).toBeGreaterThanOrEqual(2); // seeded sticky + text

    // Arm the Text tool (its palette shortcut) and click the sticky THROUGH
    // the tool's input-capture overlay — the editor must open on the EXISTING
    // sticky (click-through), not drop a new standalone text over it.
    await synthKeyOnDoc('t');
    await browser.pause(200);
    const srect = await frameLocalBox(STICKY);
    if (!srect) throw new Error('no sticky rect');
    await synthPointerOn('.dc-annot-input', srect.cx, srect.cy);
    await browser.pause(300);
    const ed = await annotEditorProbe();
    expect(ed.exists).toBe(true);
    expect(ed.text ?? '').toContain('Sticky seed');
    expect(await countStrokes()).toBe(strokesBefore);
    await capture('text-tool-edits-existing-sticky');
    await synthKey('Escape');
    await browser.pause(200);

    // Empty space still creates a NEW pending text editor (no stroke until a
    // commit — Escape leaves nothing behind).
    await synthKeyOnDoc('t');
    await browser.pause(200);
    const h1box = await frameLocalBox(H1);
    if (!h1box) throw new Error('no h1 box');
    await synthPointerOn('.dc-annot-input', h1box.left - 12, h1box.top - 8);
    await browser.pause(300);
    const ed2 = await annotEditorProbe();
    expect(ed2.exists).toBe(true);
    expect((ed2.text ?? '').replace(/​/g, '')).toBe('');
    expect(await countStrokes()).toBe(strokesBefore);
    await capture('text-tool-creates-new-on-empty');
    await synthKey('Escape');
    await browser.pause(200);
    expect((await annotEditorProbe()).exists).toBe(false);
    expect(await countStrokes()).toBe(strokesBefore);
  });

  // ── Phase 5 — keyboard unification ────────────────────────────────────────
  it('keyboard: Enter commits / Shift+Enter stays open+newlines (sticky, text); section Shift+Enter commits; artboard Enter commits', async () => {
    // ---- Sticky (multi-line) ----
    const srect = await frameLocalBox(STICKY);
    if (!srect) throw new Error('no sticky rect');
    await synthDblclick(STICKY, srect.cx, srect.cy);
    await browser.pause(300);
    expect((await annotEditorProbe()).exists).toBe(true);
    await typeAtEnd(' plus');
    // Shift+Enter must NOT commit — the handler lets it fall through to the
    // engine's newline. Synthetic keys run no UA default action, so the
    // newline itself is emulated via insertText.
    await synthKey('Enter', { shift: true });
    await browser.pause(150);
    expect((await annotEditorProbe()).exists).toBe(true);
    await typeAtEnd('\nsecond line');
    const sed = await annotEditorProbe();
    expect(sed.text ?? '').toContain('plus');
    expect(sed.text ?? '').toContain('second line');
    // Plain Enter commits: editor closes, stroke re-renders the new text.
    await synthKey('Enter');
    await browser.pause(400);
    expect((await annotEditorProbe()).exists).toBe(false);
    await browser.waitUntil(
      async () => ((await probe(`${STICKY} .dc-sticky-body`)).text ?? '').includes('plus'),
      { timeout: 8_000, interval: 400, timeoutMsg: 'sticky text never committed' }
    );
    await capture('sticky-keyboard-committed');

    // ---- Standalone text ----
    const trect = await frameLocalBox(TEXT_STROKE);
    if (!trect) throw new Error('no text-stroke rect');
    await synthDblclick(TEXT_STROKE, trect.left + 10, trect.cy);
    await browser.pause(300);
    expect((await annotEditorProbe()).exists).toBe(true);
    await typeAtEnd(' tail');
    await synthKey('Enter', { shift: true });
    await browser.pause(150);
    expect((await annotEditorProbe()).exists).toBe(true); // stays open
    await synthKey('Enter');
    await browser.pause(400);
    expect((await annotEditorProbe()).exists).toBe(false);
    await browser.waitUntil(async () => ((await probe(TEXT_STROKE)).text ?? '').includes('tail'), {
      timeout: 8_000,
      interval: 400,
      timeoutMsg: 'standalone text never committed',
    });
    await capture('text-keyboard-committed');

    // ---- Section title (singleLine: Shift+Enter commits too, no newline) ----
    const chip = await frameLocalBox(`${SECTION} text`);
    if (!chip) throw new Error('no section chip');
    await synthDblclick(`${SECTION} text`, chip.cx, chip.cy);
    await browser.pause(300);
    expect((await annotEditorProbe()).exists).toBe(true);
    await typeAtEnd(' X');
    await synthKey('Enter', { shift: true });
    await browser.pause(400);
    expect((await annotEditorProbe()).exists).toBe(false); // committed
    const label = (await probe(`${SECTION} text`)).text ?? '';
    expect(label).toContain('X');
    expect(label).not.toContain('\n');
    await capture('section-title-committed');

    // ---- Artboard (last — its commit rewrites the canvas source + reloads) ----
    const box = await frameLocalBox(H1);
    if (!box) throw new Error('no h1 box');
    await synthDblclickUntil(
      H1,
      box.cx,
      box.cy,
      async () => (await probe(H1)).ce === 'plaintext-only'
    );
    expect((await probe(H1)).ce).toBe('plaintext-only');
    await typeAtEnd(' K');
    await synthKey('Enter', { shift: true });
    await browser.pause(150);
    expect((await probe(H1)).ce).toBe('plaintext-only'); // still editing
    await synthKey('Enter');
    await browser.pause(400);
    const after = await probe(H1);
    expect(after.ce).toBeNull(); // committed via blur
    expect(after.text ?? '').toContain('K');
    await capture('artboard-keyboard-committed');
    // after() restores every committed file byte-exact.
  });

  // ── Phase 6 — persistence gate ────────────────────────────────────────────
  it('persistence: mixed <p> gets NO dead-end editor (hint instead); h1 edit persists to disk + reload; sibling byte-identical', async () => {
    // P5's artboard commit triggered an HMR reload — settle first.
    await waitForStableRect(H1, 20_000);

    // Mixed content (`Total: {1 + 1} items` — leaf-looking in the DOM, mixed
    // in source): the build-time data-cd-editable gate refuses the editor and
    // surfaces the hint toast instead of the DDR-150 dead end.
    const mbox = await frameLocalBox(MIXED);
    if (!mbox) throw new Error('no mixed box');
    // feature-4 drill ladder: repeat until the leaf is reached and the
    // refusal toast fires (the editor must never open on mixed content).
    await synthDblclickUntil(
      MIXED,
      mbox.cx,
      mbox.cy,
      async () => (await probe('.dc-media-toast')).exists
    );
    const mp = await probe(MIXED);
    expect(mp.ce).toBeNull();
    const toast = await probe('.dc-media-toast');
    expect(toast.exists).toBe(true);
    expect(toast.text ?? '').toContain('/design:edit');
    await capture('mixed-p-refused-with-hint');

    // Static h1: the marker admits it → edit, commit, and the write-through
    // is REAL — assert the persisted source on disk, the sibling <p> stays
    // byte-identical, and the reloaded canvas renders the new text.
    const pTextBefore = (await probe('[data-testid="smoke-p"]')).text;
    const box = await frameLocalBox(H1);
    if (!box) throw new Error('no h1 box');
    await synthDblclickUntil(
      H1,
      box.cx,
      box.cy,
      async () => (await probe(H1)).ce === 'plaintext-only'
    );
    expect((await probe(H1)).ce).toBe('plaintext-only');
    await typeAtEnd(' P6');
    await synthKey('Enter');
    // The commit posts /_api/edit-text → source rewrite → file-watcher HMR
    // reload → the canvas re-renders FROM PERSISTED SOURCE (the ⌘R-equivalent
    // proof the baseline bug was about).
    await browser.waitUntil(
      async () => {
        const p = await probe(H1);
        return p.exists && (p.text ?? '').includes('P6') && p.ce === null;
      },
      { timeout: 20_000, interval: 600, timeoutMsg: 'h1 edit never persisted through reload' }
    );
    // Disk-level proof + sibling integrity: only the h1 line ever changed
    // (P5's earlier ' K' commit lives in the same h1 line — strip it from
    // both sides and the REST must be byte-identical to the pre-run snapshot).
    const smokePath = FIXTURE_FILES[0] as string;
    const src = readFileSync(smokePath, 'utf8');
    expect(src).toMatch(/<h1[^>]*>[^<]*P6<\/h1>/);
    const orig = fixtures.baselineOf(smokePath);
    const stripH1 = (s: string) => s.replace(/<h1[^>]*>[^<]*<\/h1>/, '<h1/>');
    expect(stripH1(src)).toBe(stripH1(orig));
    // On-canvas: the sibling <p> renders identically.
    expect((await probe('[data-testid="smoke-p"]')).text).toBe(pTextBefore);
    await capture('h1-persisted-sibling-untouched');
    // after() restores the fixture byte-exact.
  });

  // ── Variable-driven text: {c.body} in a .map traced back to the array ──────
  it('variable text: editing the 2nd .map card rewrites CARDS[1].body only, persists through reload', async () => {
    await waitForStableRect(H1, 20_000);
    // The `.map()` renders one source <p data-cd-id> three times — same testid,
    // same cd-id. Grab the SECOND card by DOM order and confirm it enters edit
    // mode (the var marker opened the gate — no dead-end hint).
    const cards = await browser.execute(() => {
      const iframe = document.querySelector(
        '[data-testid="canvas-frame"]'
      ) as HTMLIFrameElement | null;
      const doc = iframe?.contentDocument;
      const els = Array.from(
        doc?.querySelectorAll('[data-testid="smoke-card-body"]') ?? []
      ) as HTMLElement[];
      return {
        count: els.length,
        editable: els.map((e) => e.hasAttribute('data-cd-editable')),
        texts: els.map((e) => e.textContent),
        second: els[1]
          ? (() => {
              const r = els[1].getBoundingClientRect();
              return { cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
            })()
          : null,
      };
    });
    expect(cards.count).toBe(3);
    expect(cards.editable.every(Boolean)).toBe(true); // gate open (var marker)
    expect(cards.texts).toEqual(['First card body.', 'Second card body.', 'Third card body.']);
    if (!cards.second) throw new Error('no second card');

    // Edit the SECOND card — dispatch on that exact element (querySelector
    // would hit card 0). The commit carries occurrence=1 + before, so the
    // engine rewrites CARDS[1].body, not card 0 or 2.
    // feature-4 drill ladder: repeat the dblclick until the editor opens
    // (each dblclick drills one chain level first).
    // 12, not 5 — see `synthDblclickUntil`: this card measured 4 dblclicks on an
    // idle Chromium, so a 5-try budget was one slow frame from failing.
    for (let attempt = 0; attempt < 12; attempt++) {
      // eslint-disable-next-line no-await-in-loop
      await browser.execute(
        (x, y) => {
          const iframe = document.querySelector(
            '[data-testid="canvas-frame"]'
          ) as HTMLIFrameElement | null;
          const doc = iframe?.contentDocument;
          const win = iframe?.contentWindow as (Window & typeof globalThis) | null;
          const el = (
            Array.from(
              doc?.querySelectorAll('[data-testid="smoke-card-body"]') ?? []
            ) as HTMLElement[]
          )[1];
          if (!el || !win) return false;
          const opts = { bubbles: true, cancelable: true, view: win, clientX: x, clientY: y };
          el.dispatchEvent(new win.PointerEvent('pointerdown', { ...opts, pointerId: 1 }));
          el.dispatchEvent(new win.MouseEvent('mousedown', { ...opts, detail: 1 }));
          el.dispatchEvent(new win.PointerEvent('pointerup', { ...opts, pointerId: 1 }));
          el.dispatchEvent(new win.MouseEvent('mouseup', { ...opts, detail: 1 }));
          el.dispatchEvent(new win.MouseEvent('click', { ...opts, detail: 1 }));
          el.dispatchEvent(new win.MouseEvent('mousedown', { ...opts, detail: 2 }));
          el.dispatchEvent(new win.MouseEvent('mouseup', { ...opts, detail: 2 }));
          el.dispatchEvent(new win.MouseEvent('click', { ...opts, detail: 2 }));
          el.dispatchEvent(new win.MouseEvent('dblclick', { ...opts, detail: 2 }));
          return true;
        },
        Math.round(cards.second.cx),
        Math.round(cards.second.cy)
      );
      // eslint-disable-next-line no-await-in-loop
      await browser.pause(300);
      // eslint-disable-next-line no-await-in-loop
      const entered = await browser.execute(() => {
        const iframe = document.querySelector(
          '[data-testid="canvas-frame"]'
        ) as HTMLIFrameElement | null;
        const els = Array.from(
          iframe?.contentDocument?.querySelectorAll('[data-testid="smoke-card-body"]') ?? []
        ) as HTMLElement[];
        return els[1]?.getAttribute('contenteditable') === 'plaintext-only';
      });
      if (entered) break;
    }
    // The editing element is the 2nd card; assert it entered edit mode.
    const editingSecond = await browser.execute(() => {
      const iframe = document.querySelector(
        '[data-testid="canvas-frame"]'
      ) as HTMLIFrameElement | null;
      const doc = iframe?.contentDocument;
      const els = Array.from(
        doc?.querySelectorAll('[data-testid="smoke-card-body"]') ?? []
      ) as HTMLElement[];
      return els[1]?.getAttribute('contenteditable');
    });
    expect(editingSecond).toBe('plaintext-only');
    await typeAtEnd(' EDITED');
    await synthKey('Enter');
    await browser.waitUntil(
      async () => {
        const texts = await browser.execute(() => {
          const iframe = document.querySelector(
            '[data-testid="canvas-frame"]'
          ) as HTMLIFrameElement | null;
          const doc = iframe?.contentDocument;
          return Array.from(doc?.querySelectorAll('[data-testid="smoke-card-body"]') ?? []).map(
            (e) => e.textContent
          );
        });
        return texts[1]?.includes('EDITED') === true && !texts[0]?.includes('EDITED');
      },
      { timeout: 20_000, interval: 600, timeoutMsg: 'card edit never persisted through reload' }
    );
    // Disk proof: ONLY CARDS[1].body changed.
    const smokePath = FIXTURE_FILES[0] as string;
    const src = readFileSync(smokePath, 'utf8');
    expect(src).toContain('Second card body. EDITED');
    expect(src).toContain('First card body.'); // sibling untouched
    expect(src).toContain('Third card body.');
    await capture('var-card-persisted-only-second');

    // ── Undo / redo of the variable edit ──────────────────────────────────
    const cardText = (i: number) =>
      browser.execute((n) => {
        const iframe = document.querySelector(
          '[data-testid="canvas-frame"]'
        ) as HTMLIFrameElement | null;
        const doc = iframe?.contentDocument;
        return (
          Array.from(doc?.querySelectorAll('[data-testid="smoke-card-body"]') ?? [])[n]
            ?.textContent ?? null
        );
      }, i) as Promise<string | null>;

    // Undo (Edit-menu bridge) — re-targets CARDS[1] via the stored occurrence
    // + the current disk value, rewriting it back to the original.
    await postToCanvas({ dgn: 'undo' });
    await browser.waitUntil(async () => (await cardText(1)) === 'Second card body.', {
      timeout: 20_000,
      interval: 600,
      timeoutMsg: 'undo never reverted the variable edit',
    });
    expect(readFileSync(smokePath, 'utf8')).toContain('Second card body.');
    expect(readFileSync(smokePath, 'utf8')).not.toContain('Second card body. EDITED');
    await capture('var-card-undo-reverted');

    // Redo — re-applies to CARDS[1] only.
    await postToCanvas({ dgn: 'redo' });
    await browser.waitUntil(async () => (await cardText(1))?.includes('EDITED') === true, {
      timeout: 20_000,
      interval: 600,
      timeoutMsg: 'redo never re-applied the variable edit',
    });
    const afterRedo = readFileSync(smokePath, 'utf8');
    expect(afterRedo).toContain('Second card body. EDITED');
    expect(afterRedo).toContain('First card body.'); // still untouched
    expect(afterRedo).toContain('Third card body.');
    await capture('var-card-redo-reapplied');
  });
});
