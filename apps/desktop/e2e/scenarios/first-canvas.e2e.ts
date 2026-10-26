import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { $, browser, expect } from '@wdio/globals';

import { waitForCanvasRects, waitForEditChrome } from '../helpers/canvas-frame';
import { syncStatusText } from '../helpers/chrome';
import { capture, startReport } from '../helpers/evidence';
import { invokeTauri } from '../helpers/native';
import {
  activeTab,
  closeTab,
  focusTab,
  HOME,
  handles,
  labels,
  waitWindow,
} from '../helpers/windows';

/**
 * The FIRST-CANVAS journey (S6.16 · 01 Create Flow rows cf-select-tweak, cf-add-artboard, cf-duplicate-width,
 * cf-duplicate-done, cf-frames-text, cf-sticky-comment, cf-status-words). One person, one sentence, one canvas:
 *
 *   1  Home: a sentence, aimed at a project → that project's tab opens a NEW canvas and the (fake) AI draws
 *      Desktop · Tablet · Mobile on it                                                           [S6.3 · S6.4]
 *   2  Select the Desktop artboard: the inspector arrives and names it                          [cf-select-tweak]
 *   3  F with nothing selected: the size picker; "Laptop" adds a 1280 × 800 artboard           [cf-add-artboard]
 *   4  Right-click Desktop › Duplicate at another width › Laptop: a 1280-wide copy, selected,
 *      written with its place; ⌘Z takes it back in one step      [cf-duplicate-width · cf-duplicate-done]
 *   5  Double-click the headline, type, click away: the words land in the file, in place       [cf-frames-text]
 *   6  N: Preview opens with Sticky in hand; a click leaves a sticky in the board file         [cf-sticky-comment]
 *   7  C: a click pins a comment with its words; the comment is stored                         [cf-sticky-comment]
 *   8  The Share cluster says the save state in ONE word, and that word is not a control        [cf-status-words]
 *
 * Fake ACP: wdio.first-canvas.conf.ts points the adapter at fixtures/fake-acp/first-canvas-agent.mjs and the
 * connected-gate probe at claude-stub.sh. No model is reached.
 *
 * Driving model (as edit-artboards / edit-text): the pilot runs with MAUDE_CANVAS_ORIGIN_SPLIT=0, so the canvas
 * iframe is same-origin and events are dispatched synthetically inside it; positions come from the canvas's own
 * DOM rects (frame-local px), assertions are on the files on disk or on a `data-testid` the layers draw.
 *
 * KNOWN GAPS NOT ASSERTED (named in .ai/scenarios/maude-v2/s6-first-canvas.md and the S6.16 evidence):
 *   · cf-select-tweak: the Canvases panel does not fold and the canvas does not slide on select.
 *   · cf-duplicate-done: the copy lands RIGHT of the row at its gap (14 ed-ab-menu), not under the source, and no
 *     "Duplicated at Laptop — 1280 wide." toast with Undo is shown.
 *
 * WRITTEN, NOT RUN by the slice (needs the debug app, an unlocked screen and the machine's e2e lock).
 */

interface Fixture {
  name: string;
  root: string;
  pid: string;
  rel: string;
}
const FIXTURES = JSON.parse(process.env.MAUDE_E2E_HOME_FIXTURES ?? '[]') as Fixture[];
const [, BETA] = FIXTURES;
const SENTENCE = 'A calm landing page for my studio';
const tid = (s: string) => `[data-testid="${s}"]`;
const label = (f: Fixture) => `p-${f.pid}`;

// ── the project's files ──────────────────────────────────────────────────────────────────────────────────────
const designDir = () => join(BETA.root, '.design');
const walk = (dir: string, keep: (rel: string) => boolean, base = dir): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = join(dir, d.name);
    if (d.isDirectory()) return d.name === 'node_modules' ? [] : walk(p, keep, base);
    const rel = p.slice(base.length + 1);
    return keep(rel) ? [p] : [];
  });
/** Canvas sources (not the system folder, not runtime state). */
const canvasFiles = () =>
  walk(
    designDir(),
    (rel) => /\.tsx$/.test(rel) && !rel.split('/').some((s) => s.startsWith('_') || s === 'system')
  );
let CANVAS = ''; // set in step 1: the file Home's sentence made
const source = () => readFileSync(CANVAS, 'utf8');
const metaOf = () =>
  JSON.parse(readFileSync(CANVAS.replace(/\.tsx$/, '.meta.json'), 'utf8')) as {
    layout?: { artboards?: Array<{ id: string; x: number; y: number }> };
  };
const artboardIds = () => [...source().matchAll(/<DCArtboard\s+id="([^"]+)"/g)].map((m) => m[1]);

// ── driving the shell and the canvas frame ───────────────────────────────────────────────────────────────────
async function onServer(tab: string): Promise<void> {
  await waitWindow(tab);
  await browser.switchToWindow(tab);
  await browser.waitUntil(
    async () => {
      try {
        return await browser.execute(
          () => location.protocol === 'http:' && document.readyState === 'complete'
        );
      } catch {
        return false; // mid-navigation
      }
    },
    { timeout: 120_000, interval: 250, timeoutMsg: `${tab} never reached its server` }
  );
  await focusTab(tab);
}

const inFrame = <T>(fn: (doc: Document) => T) =>
  browser.execute((src) => {
    const iframe = document.querySelector('[data-testid="canvas-frame"]') as HTMLIFrameElement;
    return new Function('doc', `return (${src})(doc)`)(iframe.contentDocument);
  }, fn.toString()) as Promise<T>;

type Pt = { x: number; y: number };

/** Centre of the element matching `sel` in the canvas frame (frame-local px), or null. */
const centreOf = (sel: string) =>
  browser.execute((s) => {
    const frame = document.querySelector('[data-testid="canvas-frame"]') as HTMLIFrameElement;
    const r = (
      frame.contentDocument?.querySelector(s) as HTMLElement | null
    )?.getBoundingClientRect();
    return r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null;
  }, sel) as Promise<Pt | null>;

/** A run of mouse events at a frame-local point — what a click is to the layers that listen in the canvas. */
function mouseAt(p: Pt, types: string[], extra: Record<string, unknown> = {}) {
  return browser.execute(
    (px, py, ts, ex) => {
      const frame = document.querySelector('[data-testid="canvas-frame"]') as HTMLIFrameElement;
      const doc = frame.contentDocument as Document;
      const win = frame.contentWindow as Window & typeof globalThis;
      const target = doc.elementFromPoint(px, py) ?? doc.body;
      for (const t of ts)
        target.dispatchEvent(
          new win.MouseEvent(t, {
            bubbles: true,
            cancelable: true,
            clientX: px,
            clientY: py,
            button: 0,
            ...ex,
          })
        );
    },
    p.x,
    p.y,
    types,
    extra
  );
}
const CLICK = ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'];

/** A key on the canvas document (the tool keys and ⌘D / ⌘Z are read there). */
function keyEvent(key: string, mods: Record<string, boolean>) {
  return browser.execute(
    (k, m) => {
      const frame = document.querySelector('[data-testid="canvas-frame"]') as HTMLIFrameElement;
      const doc = frame.contentDocument as Document;
      const win = frame.contentWindow as Window & typeof globalThis;
      doc.dispatchEvent(
        new win.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...m })
      );
    },
    key,
    mods
  );
}

/** Select an artboard the way a person does: its name, in the canvas. */
const selectArtboard = (id: string) =>
  centreOf(`[data-dc-screen="${id}"] .dc-artboard-label`).then((p) => {
    expect(p).not.toBeNull();
    return mouseAt(p as Pt, ['pointerdown', 'pointerup', 'click']);
  });
const selected = () =>
  inFrame(
    (d) =>
      d.querySelector('[data-dc-screen][data-ed-selected]')?.getAttribute('data-dc-screen') ?? null
  );

describe('first canvas (S6.16) — a sentence on Home to a saved, shared canvas', () => {
  before(async () => {
    startReport('first-canvas');
    expect(FIXTURES.length).toBe(2);
    await browser.setTimeout({ script: 60_000 });
    // A Mac lists only the projects it has opened: Home's shelf and its target picker are the app's registry,
    // and the machine index (what the lane seeds) holds those projects' canvases and pictures. A project the app
    // never opened is not on the shelf — "No projects on this Mac yet." is the right words for it (home.e2e step 1
    // asserts `shell_state.projects` is empty on a first launch). So the person of this journey has used Beta
    // before: open it once, close its tab, and it stays a known project Home can aim a sentence at.
    await onServer(HOME);
    await (await $(tid('home-root'))).waitForDisplayed({ timeout: 90_000 });
    await invokeTauri('open_project', { root: BETA.root });
    await waitWindow(label(BETA), true, 60_000);
    await closeTab(label(BETA), HOME);
    await onServer(HOME);
  });

  it('1 · Home: a sentence aimed at a project opens that tab with a NEW canvas, and the fake AI draws three artboards', async () => {
    await waitWindow(HOME);
    await onServer(HOME);
    await (await $(tid('home-root'))).waitForDisplayed({ timeout: 90_000 });
    const before = new Set(canvasFiles());
    await (await $(tid('home-target-chip'))).click();
    await (await $(tid('home-target-menu'))).waitForDisplayed({ timeout: 5_000 });
    await (await $(tid(`home-target-item-local:${BETA.pid}`))).click();
    await (await $(tid('home-ask-input'))).setValue(SENTENCE);
    await browser.keys('Enter');
    // the target tab opens (Home stays pinned), and the sentence is in no URL
    await waitWindow(label(BETA), true, 60_000);
    await browser.waitUntil(async () => (await activeTab()) === label(BETA), {
      timeout: 30_000,
      timeoutMsg: 'the project tab never came forward',
    });
    expect(await handles()).toContain(HOME);
    await onServer(label(BETA));
    expect(await browser.getUrl()).not.toContain(encodeURIComponent(SENTENCE));
    // the server made the canvas (named from the sentence), then the agent drew on it
    await browser.waitUntil(() => canvasFiles().some((f) => !before.has(f)), {
      timeout: 60_000,
      timeoutMsg: 'Home’s sentence made no canvas',
    });
    CANVAS = canvasFiles().find((f) => !before.has(f)) as string;
    await browser.waitUntil(() => artboardIds().length === 3, {
      timeout: 120_000,
      timeoutMsg: 'the fake agent never drew the three artboards',
    });
    expect(artboardIds()).toEqual(['desktop', 'tablet', 'mobile']);
    await (await $(tid('canvas-frame'))).waitForExist({ timeout: 30_000 });
    await waitForEditChrome();
    expect(await labels()).toContain(label(BETA));
    await capture('01-sentence-canvas-drawn');
  });

  it('2 · select Desktop: the artboard is chosen and the inspector arrives, naming it (cf-select-tweak)', async () => {
    await selectArtboard('desktop');
    await browser.waitUntil(async () => (await selected()) === 'desktop', {
      timeout: 15_000,
      timeoutMsg: 'Desktop never became the selection',
    });
    // CONTRACT §1: Open inspector on select (on by default) — the Inspector island appears in the shell
    const preset = await $(tid('insp-ab-preset'));
    await preset.waitForExist({ timeout: 20_000, timeoutMsg: 'the inspector did not arrive' });
    const read = await browser.execute(() => {
      const el = document.querySelector('[data-testid="insp-ab-preset"]') as
        | (HTMLElement & { value?: string })
        | null;
      return el ? `${el.value ?? ''} ${el.textContent ?? ''}` : '';
    });
    expect(read).toContain('Desktop'); // 1440 is the Desktop preset; a size that is no preset reads Custom
    await capture('02-select-inspector');
  });

  it('3 · F with nothing selected: the size picker; Laptop adds a 1280 × 800 artboard (cf-add-artboard)', async () => {
    await keyEvent('Escape', {});
    await browser.waitUntil(async () => (await selected()) === null, { timeout: 10_000 });
    const before = artboardIds().length;
    await keyEvent('f', {});
    await (await $(tid('size-picker-search'))).waitForDisplayed({
      timeout: 15_000,
      timeoutMsg: 'F opened no size picker',
    });
    await capture('03-f-size-picker');
    await (await $(tid('size-picker-tile-app-laptop'))).click();
    await browser.waitUntil(() => artboardIds().length === before + 1, {
      timeout: 20_000,
      timeoutMsg: 'the picked size added no artboard',
    });
    // the kind follows the preset: App sizes are fixed screens
    const added = source()
      .split(/<DCArtboard\s+id=/)
      .pop() as string;
    expect(added).toMatch(/width=\{1280\}/);
    expect(added).toMatch(/height=\{800\}/);
    await capture('03-f-laptop-added');
  });

  it('4 · right-click Desktop › Duplicate at another width › Laptop: a 1280-wide copy, selected, placed; one ⌘Z takes it back', async () => {
    const before = artboardIds().length;
    const label0 = await centreOf('[data-dc-screen="desktop"] .dc-artboard-label');
    expect(label0).not.toBeNull();
    await mouseAt(label0 as Pt, ['contextmenu']);
    const item = (id: string) => tid(`canvas-menu-item-${id}`);
    // the menu is drawn in the canvas frame
    await browser.waitUntil(
      async () =>
        inFrame((d) => !!d.querySelector('[data-testid="canvas-menu-item-duplicate-at-width"]')),
      { timeout: 10_000, timeoutMsg: 'the artboard menu never opened' }
    );
    const press = (testid: string) =>
      centreOf(item(testid)).then((p) => mouseAt(p as Pt, ['pointerenter', 'mouseover', ...CLICK]));
    await press('duplicate-at-width');
    await browser.waitUntil(
      async () =>
        inFrame((d) => !!d.querySelector('[data-testid="canvas-menu-item-duplicate-at-laptop"]')),
      { timeout: 10_000, timeoutMsg: 'the width submenu never opened' }
    );
    await capture('04-duplicate-width-menu');
    await press('duplicate-at-laptop');
    await browser.waitUntil(() => artboardIds().includes('desktop-1280'), {
      timeout: 20_000,
      timeoutMsg: 'Duplicate at Laptop wrote no copy',
    });
    expect(artboardIds().length).toBe(before + 1);
    const copy = source().split('id="desktop-1280"')[1].split('</DCArtboard>')[0];
    expect(copy).toMatch(/Calm software, made in Brno/); // the content came along
    expect(copy).not.toMatch(/data-cd-id="desktop-/); // no element id is inherited (the copy gets its own)
    // it is the selection, and it has a place in the layout lane (right of the row at the row's gap)
    await browser.waitUntil(async () => (await selected()) === 'desktop-1280', { timeout: 10_000 });
    const at = metaOf().layout?.artboards?.find((b) => b.id === 'desktop-1280');
    expect(at).toBeDefined();
    await capture('04-duplicate-width-done');
    // ONE ⌘Z takes the whole copy back
    await keyEvent('z', { metaKey: true });
    await browser.waitUntil(() => !artboardIds().includes('desktop-1280'), {
      timeout: 20_000,
      timeoutMsg: 'one ⌘Z did not take the copy back',
    });
    expect(artboardIds().length).toBe(before);
  });

  it('5 · double-click the headline, type, click away: the words land in the file, in place (cf-frames-text)', async () => {
    const sel = '[data-cd-id="desktop-headline"]';
    const p = await centreOf(sel);
    expect(p).not.toBeNull();
    await mouseAt(p as Pt, ['pointerdown', 'pointerup', 'click', 'dblclick'], { detail: 2 }); // selects
    await mouseAt(p as Pt, ['pointerdown', 'pointerup', 'click', 'dblclick'], { detail: 2 }); // the caret
    await browser.waitUntil(
      async () => inFrame((d) => !!d.querySelector('[contenteditable].dc-text-editing')),
      { timeout: 10_000, timeoutMsg: 'no caret in the headline' }
    );
    await browser.execute((t) => {
      const frame = document.querySelector('[data-testid="canvas-frame"]') as HTMLIFrameElement;
      const el = frame.contentDocument?.querySelector(
        '[contenteditable].dc-text-editing'
      ) as HTMLElement;
      el.textContent = t;
      el.dispatchEvent(new InputEvent('input', { bubbles: true }));
    }, 'Software that stays calm');
    await capture('05-text-in-place');
    await inFrame((d) => {
      (d.querySelector('[contenteditable].dc-text-editing') as HTMLElement).blur();
      return true;
    });
    await browser.waitUntil(() => source().includes('Software that stays calm'), {
      timeout: 15_000,
      timeoutMsg: 'the typed words were not written',
    });
    // only the Desktop headline changed; its id is still there; Tablet and Mobile keep the old words
    expect(source()).toContain('data-cd-id="desktop-headline"');
    expect(source().match(/Calm software, made in Brno/g)?.length).toBe(2);
  });

  it('6 · N: Preview opens with Sticky in hand; a click leaves a sticky on the board (cf-sticky-comment)', async () => {
    await keyEvent('n', {});
    await browser.waitUntil(
      async () => inFrame((d) => !!d.querySelector('[data-testid="toolbar-preview"]')),
      { timeout: 15_000, timeoutMsg: 'N did not open Preview' }
    );
    await browser.waitUntil(
      async () =>
        inFrame(
          (d) =>
            d
              .querySelector('[data-testid^="toolbar-slot-"][data-testid$="sticky"]')
              ?.getAttribute('aria-pressed') === 'true'
        ),
      { timeout: 10_000, timeoutMsg: 'Sticky was not in hand' }
    );
    await capture('06-n-sticky-in-hand');
    // anywhere: just right of the Mobile artboard's top-left corner
    const m = await centreOf('[data-dc-screen="mobile"] .dc-artboard-label');
    expect(m).not.toBeNull();
    await mouseAt({ x: (m as Pt).x + 40, y: (m as Pt).y + 160 }, CLICK);
    await browser.waitUntil(
      () =>
        walk(designDir(), (rel) => /\.annotations\.json$/.test(rel)).some((f) =>
          /sticky/i.test(readFileSync(f, 'utf8'))
        ),
      { timeout: 20_000, timeoutMsg: 'no sticky reached the board file' }
    );
    await capture('06-sticky-placed');
  });

  it('7 · C: a click pins a comment with its words, and the comment is stored (cf-sticky-comment)', async () => {
    await browser.keys('Escape'); // put the sticky down
    await keyEvent('c', {});
    const cta = await centreOf('[data-cd-id="desktop-cta"]');
    expect(cta).not.toBeNull();
    await mouseAt(cta as Pt, CLICK);
    await browser.waitUntil(
      async () => inFrame((d) => !!d.querySelector('.cm-composer__textarea')),
      { timeout: 15_000, timeoutMsg: 'no comment composer opened at the click' }
    );
    expect(
      await inFrame(
        (d) => d.querySelector('[data-testid="comment-composer-where"]')?.textContent ?? ''
      )
    ).not.toBe('');
    await browser.execute((t) => {
      const frame = document.querySelector('[data-testid="canvas-frame"]') as HTMLIFrameElement;
      const ta = frame.contentDocument?.querySelector(
        '.cm-composer__textarea'
      ) as HTMLTextAreaElement;
      const win = frame.contentWindow as Window & typeof globalThis;
      Object.getOwnPropertyDescriptor(win.HTMLTextAreaElement.prototype, 'value')?.set?.call(ta, t);
      ta.dispatchEvent(new win.Event('input', { bubbles: true }));
    }, 'Could the button say “Book a call”?');
    await capture('07-comment-composer');
    await inFrame((d) => {
      (d.querySelector('.cm-composer .cm-btn--primary') as HTMLElement).click();
      return true;
    });
    await browser.waitUntil(
      () =>
        walk(join(designDir(), '_comments'), (rel) => /\.json$/.test(rel)).some((f) =>
          readFileSync(f, 'utf8').includes('Book a call')
        ),
      { timeout: 20_000, timeoutMsg: 'the comment was not stored' }
    );
    await capture('07-comment-pinned');
  });

  it('8 · the Share cluster says the save state in one word, and the word is not a control (cf-status-words)', async () => {
    const word = await browser.execute(() => {
      const el = document.querySelector(
        '[data-testid="share-cluster-status"]'
      ) as HTMLElement | null;
      return el
        ? {
            text: (el.textContent ?? '').trim(),
            status: el.getAttribute('data-status'),
            control: !!el.closest('button, [role="button"], a[href]'),
          }
        : null;
    });
    expect(word).not.toBeNull();
    // the fixture project is unlinked: nothing can be offline or syncing
    expect(word?.status).toBe('local');
    expect(word?.text).toContain('Local project');
    // shown, never operated: no resync, retry or other verb sits in the cluster while nothing has failed
    expect(word?.control).toBe(false);
    expect(await $(tid('share-cluster-retry')).isExisting()).toBe(false);
    expect(await syncStatusText()).toContain('Local project');
    await waitForCanvasRects();
    await capture('08-status-word');
  });
});
