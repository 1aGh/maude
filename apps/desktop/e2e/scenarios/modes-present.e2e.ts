import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { $, browser, expect } from '@wdio/globals';
import { enterCanvasFrame, exitToTop, waitForCanvasRects } from '../helpers/canvas-frame';
import { capture, startReport } from '../helpers/evidence';
import { createFixtureGuard } from '../helpers/fixture-guard';
import { videoPlays } from '../helpers/modes-present-video';
import { waitForSidecar } from '../helpers/sidecar';
import { canvasRow } from '../helpers/tree';

/**
 * S3.13 — `modes-present`: Edit → Preview → follow a link → back → Present from selection → step → video →
 * presenter view (two displays only) → the esc ladder. 04 Modes, canvas rows md-preview … md-esc.
 *
 * The follow-a-link step has its own file (`modes-present-links.e2e.ts`, S3.10a); this one is the Present half
 * and the esc ladder. Everything is read from the SHELL DOM (the canvas iframe is not reachable by DOM — memory
 * maude-canvas-iframe-unreachable-by-dom), through the testids in `client/testids.json`.
 *
 * WRITTEN, NOT RUN by the slice (the lane has no desktop build); the agent-browser half of this scenario ran on a
 * scratch project copy — see `.ai/scenarios/modes-present/spec.md` and `.ai/plans/notes/v2-evidence/S3.13/`.
 * Run it with the `desktop-e2e` skill.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const SMOKE = join(HERE, '../fixtures/project/.design/ui/Smoke.tsx');
const fixtures = createFixtureGuard('modes-present', [SMOKE]);

const tid = (id: string) => `[data-testid="${id}"]`;
const text = async (id: string) => (await $(tid(id))).getText();
const exists = (id: string) => $(tid(id)).isExisting();

/** A synthetic chord on the shell document: the shell owns the mode keys (the iframe forwards its own). */
async function chord(key: string, code: string, mods: Partial<KeyboardEventInit> = {}) {
  await browser.execute(
    (k, c, m) => {
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: k, code: c, bubbles: true, cancelable: true, ...m })
      );
    },
    key,
    code,
    mods
  );
}

const pressed = () =>
  browser.execute(() =>
    Array.from(document.querySelectorAll('[data-testid^="palette-mode-"]'))
      .filter((e) => e.getAttribute('aria-pressed') === 'true')
      .map((e) => (e.getAttribute('data-testid') ?? '').replace('palette-mode-', ''))
  );

/** The switch lands a beat after its key: wait for it, then assert — a step that lands on the wrong mode is still red. */
async function landsOn(mode: string) {
  await browser
    .waitUntil(async () => (await pressed()).join() === mode, { timeout: 4000, interval: 100 })
    .catch(() => undefined);
  expect(await pressed()).toEqual([mode]);
}

describe('modes-present (S3.13)', () => {
  before(async () => {
    fixtures.snapshot();
    await waitForSidecar();
    await (await canvasRow('canvas-row-ui-smoke')).click();
    await waitForCanvasRects();
    await $(tid('canvas-frame')).waitForExist({ timeout: 15000 });
  });
  after(() => fixtures.restore());

  it('Edit: the switch holds Edit · Preview · Present, and Present has its small menu', async () => {
    startReport('modes-present');
    expect(await pressed()).toEqual(['edit']);
    await $(tid('mode-present-menu')).click();
    await $(tid('mode-present-list')).waitForExist({ timeout: 4000 });
    // 04 md-present-menu: the rows, each with its key / note. The presenter row needs a second display and
    // "Copy presentation link" a cloud project, so they are asserted only where the fixture has them.
    expect(await text('mode-present-from-selection')).toContain('⌥⌘↵');
    expect(await text('mode-present-from-start')).toContain('⇧⌥⌘↵');
    expect(await text('mode-present-canvas')).toContain('no chrome, no pins');
    expect(await exists('mode-present-order-notes')).toBe(true);
    await capture('present menu');
    await chord('Escape', 'Escape'); // a menu closes first, whatever the mode
    await browser
      .waitUntil(async () => !(await exists('mode-present-list')), { timeout: 4000, interval: 100 })
      .catch(() => undefined);
    expect(await exists('mode-present-list')).toBe(false);
    await landsOn('edit');
  });

  it('Preview ⇄ Edit: ⌥⌘P and esc', async () => {
    await chord('p', 'KeyP', { altKey: true, metaKey: true });
    await $(tid('preview-bar')).waitForExist({ timeout: 6000 });
    await landsOn('preview');
    // 04 md-preview: the faces and the status word step aside (CONTRACT §5.4)
    expect(await $(tid('share-cluster')).getAttribute('data-cluster')).toBe('compact');
    expect(await $(tid('share-cluster-faces')).isDisplayed()).toBe(false);
    await capture('preview');
    await chord('Escape', 'Escape');
    await landsOn('edit');
  });

  // Michal rc.1 F08 (UX audit P4): a comment this Mac writes is signed with the one local identity, so the Comments
  // panel counts it as Mine and the row says "You" beside the avatar letter the canvas pin wears. The comment is made
  // through the studio's own door (the canvas iframe is not reachable by DOM); the panel is read from the SHELL DOM.
  it('Comments: a comment signed by this Mac is Mine, "You", with one avatar letter (rc.1 F08)', async () => {
    const made = (await browser.executeAsync((done: (r: unknown) => void) => {
      fetch('/_api/comments/op', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          op: 'add',
          file: '.design/ui/Smoke.tsx',
          text: 'e2e identity probe',
        }),
      })
        .then((r) =>
          r.json().then((j) => done({ status: r.status, id: j.id, author: j.comment?.author }))
        )
        .catch((e) => done({ status: 0, error: String(e) }));
    })) as { status: number; id?: string; author?: string };
    expect(made.status).toBe(200);
    expect(made.author).toBeTruthy();
    try {
      await $(tid('share-cluster-comments')).click();
      await $(tid(`comment-item-${made.id}`)).waitForExist({ timeout: 8000 });
      const mine = await text('comment-filter-mine');
      expect(Number(mine.replace(/\D+/g, ''))).toBeGreaterThanOrEqual(1);
      const row = await $(tid(`comment-item-${made.id}`));
      expect(await row.getText()).toContain('You');
      expect(await (await row.$('.k-av')).getText()).toBe(
        (made.author ?? '?').charAt(0).toUpperCase()
      );
      await capture('comment row — You');
    } finally {
      await browser.executeAsync((id: string, done: (r: unknown) => void) => {
        fetch('/_api/comments/op', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ op: 'delete', id }),
        }).then(
          () => done(true),
          () => done(false)
        );
      }, made.id ?? '');
      await $(tid('share-cluster-comments')).click(); // close the panel again
    }
  });

  // Michal rc.1 #17/#18: Preview has its own Select (V, the resting pointer: marquee + ⇧-click on annotations) and a
  // Hand (H, pans). V no longer switches to Edit; F still crosses, so the key reached the canvas and a dead key cannot
  // pass this step. The marquee itself is pinned by the browser e2e (annotations-ui R3, annotations-lock L3).
  it('Preview: V arms Select and keeps Preview, H arms the Hand, F still crosses to Edit', async () => {
    const slotPressed = async (id: string) => {
      await enterCanvasFrame();
      try {
        return await $(tid(`toolbar-slot-${id}`)).getAttribute('aria-pressed');
      } finally {
        await exitToTop();
      }
    };
    await chord('p', 'KeyP', { altKey: true, metaKey: true });
    await $(tid('preview-bar')).waitForExist({ timeout: 6000 });
    await landsOn('preview');
    await chord('c', 'KeyC'); // Comment in hand
    await chord('v', 'KeyV');
    await browser.pause(600); // a crossing would land within this beat
    await landsOn('preview');
    expect(await slotPressed('browse')).toBe('true');
    await chord('h', 'KeyH');
    await browser.pause(300);
    await landsOn('preview');
    expect(await slotPressed('hand')).toBe('true');
    await chord('f', 'KeyF');
    await landsOn('edit');
  });

  // 04 md-motion (6 · Edit → Preview, in motion): "220 ms on --dur-panel, shaped by --ease-out … Reduce motion: a 1 ms
  // cut". The camera's own ease is pinned on a manual clock (preview-motion.test.tsx); this is the CHROME half, read
  // off the real elements while the real app does it: the Preview bar's entrance, and the picture of a panel that
  // folds toward its icon. The chord is dispatched INSIDE the page so the rAF sampler starts on the same tick.
  // WebKit prints `.25` where the token says `0.25`: compare the numbers, not the text
  const squash = (s: string) => (s.match(/-?\d*\.?\d+/g) ?? []).map(Number).join(',');
  const toMs = (v: string) =>
    v.endsWith('ms') ? Number.parseFloat(v) : Number.parseFloat(v) * 1000;
  const ROOT = ':root'; // the shell's tokens live on :root (client/styles/1-tokens-shell.css)
  type Seen = {
    name: string;
    target: string;
    duration: number;
    easing: string;
    samples: { at: number; opacity: number }[];
  };
  async function recordTransition(
    rootSel: string
  ): Promise<{ seen: Seen[]; dur: string; failure: string }> {
    // started and read back in two plain executes (the async form hides a page error behind one opaque message)
    const started = await browser.execute((sel: string) => {
      try {
        const w = window as unknown as {
          __rec?: { seen: Record<string, Seen>; failure: string; done: boolean; dur: string };
        };
        const rec = { seen: {} as Record<string, Seen>, failure: '', done: false, dur: '' };
        w.__rec = rec;
        const t0 = performance.now();
        const firstTiming = (list: string) => {
          const close = list.indexOf(')');
          return list.startsWith('cubic-bezier') && close > 0
            ? list.slice(0, close + 1)
            : list.split(',')[0].trim();
        };
        const tick = () => {
          try {
            for (const a of document.getAnimations()) {
              const eff = a.effect as KeyframeEffect | null;
              const target = eff?.target as HTMLElement | null;
              if (!target) continue;
              const isAnim = typeof (a as CSSAnimation).animationName === 'string';
              const name = isAnim
                ? (a as CSSAnimation).animationName
                : ((a as CSSTransition).transitionProperty ?? '');
              if (!name) continue;
              const tid = target.getAttribute('data-testid') ?? String(target.className);
              const cs = getComputedStyle(target);
              const key = `${name}@${tid}`;
              rec.seen[key] ??= {
                name,
                target: tid,
                duration: Number(eff?.getComputedTiming().duration),
                easing: firstTiming(
                  isAnim ? cs.animationTimingFunction : cs.transitionTimingFunction
                ),
                samples: [],
              };
              const row = rec.seen[key];
              row.samples.push({ at: Number(a.currentTime ?? 0), opacity: Number(cs.opacity) });
            }
          } catch (e) {
            rec.failure = String(e);
          }
          if (performance.now() - t0 < 480) requestAnimationFrame(tick);
          else {
            rec.dur = getComputedStyle(document.querySelector(sel) as Element)
              .getPropertyValue('--dur-panel')
              .trim();
            rec.done = true;
          }
        };
        requestAnimationFrame(tick);
        document.dispatchEvent(
          new KeyboardEvent('keydown', {
            key: 'p',
            code: 'KeyP',
            altKey: true,
            metaKey: true,
            bubbles: true,
            cancelable: true,
          })
        );
        return 'ok';
      } catch (e) {
        return `sampler setup threw ${String(e)}`;
      }
    }, rootSel);
    expect(started).toBe('ok');
    await browser.waitUntil(
      async () =>
        browser.execute(
          () => (window as unknown as { __rec?: { done: boolean } }).__rec?.done === true
        ),
      {
        timeout: 6000,
        interval: 100,
        timeoutMsg: 'the transition sampler never finished (no animation frames?)',
      }
    );
    const rec = (await browser.execute(
      () =>
        (
          window as unknown as {
            __rec: { seen: Record<string, Seen>; failure: string; dur: string };
          }
        ).__rec
    )) as { seen: Record<string, Seen>; failure: string; dur: string };
    return { seen: Object.values(rec.seen), dur: rec.dur, failure: rec.failure };
  }

  it('md-motion: Edit → Preview eases over --dur-panel (220 ms) on --ease-out, and the bar leads', async () => {
    await landsOn('edit');
    const tokens = await browser.execute((sel: string) => {
      const cs = getComputedStyle(document.querySelector(sel) as Element);
      return {
        dur: cs.getPropertyValue('--dur-panel').trim(),
        ease: cs.getPropertyValue('--ease-out').trim(),
      };
    }, ROOT);
    expect(toMs(tokens.dur)).toBe(220);
    expect(tokens.ease).toMatch(/^cubic-bezier\(/);
    const EASE_TOKEN = squash(tokens.ease);
    const run = await recordTransition(ROOT);
    expect(run.failure).toBe('');
    await landsOn('preview');
    const bar = run.seen.find((s) => s.target === 'preview-bar' && s.name === 'sh-pbar-in');
    if (!bar)
      throw new Error(
        `no entrance animation on the Preview bar; saw ${JSON.stringify(run.seen.map((s) => `${s.name}@${s.target}`))}`
      );
    expect(bar.duration).toBe(220);
    expect(squash(bar.easing)).toBe(EASE_TOKEN);
    // storyboard frame 2 (40 ms): ease-out has done most of the move already — a linear fade would sit at 0.18
    const near40 = bar.samples
      .filter((s) => s.at >= 30 && s.at <= 90)
      .sort((a, b) => a.at - b.at)[0];
    expect(near40).toBeDefined();
    expect(near40.opacity).toBeGreaterThan(0.3);
    // storyboard frame 3 (220 ms): landed
    expect(bar.samples.at(-1)?.opacity).toBeGreaterThan(0.99);
    // a panel that stopped showing leaves as a ghost on the same clock and curve
    for (const g of run.seen.filter((s) => s.name === 'sh-island-fold')) {
      expect(g.duration).toBe(220);
      expect(squash(g.easing)).toBe(EASE_TOKEN);
    }
    await capture('md-motion preview');
    await chord('Escape', 'Escape');
    await landsOn('edit');
  });

  it('md-motion: reduce motion is a 1 ms cut — the app’s own @media rule, applied to the real bar', async () => {
    await landsOn('edit');
    // WebDriver cannot flip the OS setting, so read the rule the app ships for it out of the live CSSOM and apply
    // exactly its declarations to the shell root (what the media query does once it matches), then press Preview.
    const rule = await browser.execute((sel: string) => {
      const walk = (list: CSSRuleList, inReduce: boolean): Record<string, string> | null => {
        for (const r of Array.from(list)) {
          const reduce =
            inReduce ||
            (r instanceof CSSMediaRule && /prefers-reduced-motion:\s*reduce/.test(r.conditionText));
          if (reduce && r instanceof CSSStyleRule) {
            if (
              r.selectorText.split(',').some((x) => x.trim() === sel) &&
              r.style.getPropertyValue('--dur-panel')
            ) {
              const decl: Record<string, string> = { __selector: r.selectorText };
              for (const p of Array.from(r.style)) decl[p] = r.style.getPropertyValue(p).trim();
              return decl;
            }
          }
          const nested = (r as CSSGroupingRule).cssRules;
          if (nested) {
            const hit = walk(nested, reduce);
            if (hit) return hit;
          }
        }
        return null;
      };
      for (const sheet of Array.from(document.styleSheets)) {
        let rules: CSSRuleList;
        try {
          rules = sheet.cssRules;
        } catch {
          continue;
        }
        const hit = walk(rules, false);
        if (hit) return hit;
      }
      return null;
    }, ROOT);
    expect(rule).not.toBeNull();
    const decl = rule ?? {};
    expect(toMs(decl['--dur-panel'])).toBe(1);
    expect(toMs(decl['--dur-soft'])).toBe(1);
    // the rule is on `:root, .maude`: every element it names takes it, as the media query would make it
    const { __selector: selector, ...props } = decl;
    await browser.execute(
      (d: Record<string, string>, sels: string) => {
        for (const el of Array.from(document.querySelectorAll<HTMLElement>(sels)))
          for (const [k, v] of Object.entries(d)) el.style.setProperty(k, v);
      },
      props,
      selector
    );
    try {
      const run = await recordTransition(ROOT);
      expect(run.failure).toBe('');
      await landsOn('preview');
      expect(toMs(run.dur)).toBe(1);
      const bar = run.seen.find((s) => s.target === 'preview-bar' && s.name === 'sh-pbar-in');
      // a 1 ms animation may be over before the first frame: then there is nothing to see, which is the cut
      if (bar) expect(bar.duration).toBe(1);
      expect(run.seen.some((s) => s.name === 'sh-island-fold')).toBe(false); // no ghost under reduced motion
      await capture('md-motion reduced');
    } finally {
      await browser.execute(
        (d: Record<string, string>, sels: string) => {
          for (const el of Array.from(document.querySelectorAll<HTMLElement>(sels)))
            for (const k of Object.keys(d)) el.style.removeProperty(k);
        },
        props,
        selector
      );
      await chord('Escape', 'Escape');
      await landsOn('edit');
    }
  });

  it('Present from selection: the counter, the label, then esc back to Edit', async () => {
    await chord('Enter', 'Enter', { altKey: true, metaKey: true });
    await $(tid('present-controls')).waitForExist({ timeout: 8000 });
    await landsOn('present');
    expect(await text('present-counter')).toMatch(/^\d+ \/ \d+$/);
    expect(await text('present-label')).not.toBe('');
    // 04 md-present-full: only the work — no shell chrome
    // the chrome stays mounted and `.maude.is-present` hides it, so "no chrome" is not-displayed
    expect(await $(tid('share-cluster')).isDisplayed()).toBe(false);
    await capture('present from selection');
    await chord('ArrowRight', 'ArrowRight'); // steps (a one-artboard canvas stays put)
    await chord('Escape', 'Escape');
    await browser.waitUntil(async () => (await pressed()).join() === 'edit', { timeout: 6000 });
    expect(await exists('present-controls')).toBe(false);
  });

  it('Present the canvas: the pill, no chrome, esc back to the same view', async () => {
    await $(tid('mode-present-menu')).click();
    await $(tid('mode-present-canvas')).click();
    await $(tid('present-pill')).waitForExist({ timeout: 8000 });
    expect(await text('present-pill')).toContain('Presenting the canvas');
    await capture('present the canvas');
    await chord('Escape', 'Escape');
    await landsOn('edit');
  });

  // Pending a fixture: the S3.3 helper steps `›` to a SECOND video artboard and checks the first clip stopped
  // (modes-present-video.ts header: "NOT the first in canvas order, a clip of at least 4 seconds"). The
  // project's Video fixture has ONE artboard, so the step ends on "did not move on from the playing clip".
  it.skip('video plays (S3.3 helper — needs a two-artboard video fixture)', async () => {
    await (await canvasRow('canvas-row-ui-video')).click();
    await waitForCanvasRects();
    await videoPlays();
  });

  it('Presenter view needs two displays', async function () {
    await $(tid('mode-present-menu')).click();
    // one display: the row is drawn greyed, "Needs a second display" (v2-p8-c7-presenter-row-greyed) — nothing to drive
    const hasRow =
      (await $(tid('mode-present-presenter-view')).getAttribute('aria-disabled')) !== 'true';
    await chord('Escape', 'Escape');
    if (!hasRow) {
      this.skip();
      return;
    }
    await $(tid('mode-present-menu')).click();
    await $(tid('mode-present-presenter-view')).click();
    await chord('Enter', 'Enter', { altKey: true, metaKey: true });
    await $(tid('presenter-now')).waitForExist({ timeout: 10000 });
    await capture('presenter view');
    await $(tid('presenter-end')).click(); // End closes both windows
    await browser.waitUntil(async () => (await pressed()).join() === 'edit', { timeout: 8000 });
  });

  it('the esc ladder: each press takes exactly one step', async () => {
    await chord('p', 'KeyP', { altKey: true, metaKey: true }); // Preview
    // Present remembers the mode it was entered FROM (`returnTo`, canvas-mode.js): the Preview switch has
    // to have landed before the next chord, or Present is entered from Edit and esc goes back there.
    await browser.waitUntil(async () => (await pressed()).join() === 'preview', { timeout: 6000 });
    await chord('Enter', 'Enter', { altKey: true, metaKey: true }); // Present from Preview
    await browser.waitUntil(async () => (await pressed()).join() === 'present', { timeout: 6000 });
    expect(await pressed()).toEqual(['present']);
    // each step lands a beat after its key (the 2026-10-27 record read `preview` right after the second esc):
    // wait for it; a step that lands on the wrong mode is still red
    await chord('Escape', 'Escape');
    // returnTo: Present entered from Preview goes back to Preview, not to Edit
    await landsOn('preview');
    await chord('Escape', 'Escape');
    await landsOn('edit');
    await chord('Escape', 'Escape'); // Edit with nothing selected: nothing happens
    await browser.pause(400);
    expect(await pressed()).toEqual(['edit']);
    await capture('esc ladder done');
  });
});
