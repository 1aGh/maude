import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { $, $$, browser, expect } from '@wdio/globals';
import { capture, startReport } from '../helpers/evidence';
import { pointerClick } from '../helpers/pointer';
import { waitForCanvasOpened } from '../helpers/canvas-frame';
import { waitForSidecar } from '../helpers/sidecar';
import { canvasRow, dsRow, ensureFilesTab } from '../helpers/tree';

/*
 * The ds-review story (S10.21, V2-8.3): four parts, four worlds. Each part seeds its own project, so one boot can't
 * hold all four; `pnpm e2e:ds-review:all` (apps/desktop/e2e) runs them in order and stops at the first red.
 *
 *   part 1  this file, MAUDE_E2E_DS_REVIEW_PART=1   wdio.ds-review.conf.ts         fixtures/seed-ds-review.ts
 *           edit → review → untick → Update → the dot → ⌘Z                                (S10.8, ds-edit-review)
 *   part 2  this file, MAUDE_E2E_DS_REVIEW_PART=2   wdio.ds-review-master.conf.ts  fixtures/seed-ds-master.ts
 *           a master change, a folder left out with one tick                             (S10.10, ds-edit-master)
 *   part 3  ds-review-outside.e2e.ts                wdio.ds-outside.conf.ts        fixtures/seed-ds-outside.ts
 *           an agent edit behind the app arrives as a review: Keep, Undo                 (S10.11, ds-truth-outside)
 *   part 4  this file, MAUDE_E2E_DS_REVIEW_PART=4   wdio.ds-make.conf.ts           a copy of fixtures/project
 *           make a design system with a scripted agent: sentence, directions, mix, use   (S10.16b, ds-make-*)
 *
 * The parity half of S10.21 (every ds.* action: the button ≡ the agent on disk) is apps/studio/test/ds-agent-parity.test.ts.
 */

/**
 * 13 · ds-edit-review, part 1 (S10.8) — a design-system change waits; "Update N canvases" is the one place it
 * reaches the canvases: edit → review → untick a canvas → Update → it keeps the old look with a dot → ⌘Z takes
 * the update back. WRITTEN, NOT RUN in the S10.8 hand-back (the lead runs the desktop lane, under the lock).
 *
 * Boots into a generated project (wdio.ds-review.conf.ts → fixtures/seed-ds-review.ts): system `acme`
 * converted, three canvases that follow it (Home, Landing, Pricing), and one change waiting (Accent).
 *
 * Driving model: same as edit-artboards.e2e.ts — the pilot runs with MAUDE_CANVAS_ORIGIN_SPLIT=0, so the canvas
 * iframe is same-origin; the one click inside it ("Review…" on the Design system bar) is a DOM click in that
 * frame. Everything else is the shell's own DOM (the sheet, the Canvases rows). The project is a throwaway temp
 * dir, so there is nothing to restore.
 */
const ROOT = process.env.MAUDE_E2E_DS_REVIEW_ROOT ?? '';
const metaOf = (rel: string): Record<string, unknown> => {
  const file = join(ROOT, '.design', rel.replace(/\.tsx$/, '.meta.json'));
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
};
const tick = (path: string) => $(`[data-testid="ds-review-tick"][data-path="${path}"]`);
/** wdio.ds-review-master.conf.ts boots part 2's project (a master change, fourteen canvases); the default is part 1. */
const PART_N = process.env.MAUDE_E2E_DS_REVIEW_PART ?? '1';
const part = (n: '1' | '2' | '4') => (n === PART_N ? describe : describe.skip);

part('1')('ds-review (part 1) — edit, review, untick, Update, dot, ⌘Z', () => {
  before(() => {
    startReport('ds-review (part 1)');
  });

  it('opens the Design system canvas: the bar says one change waits', async () => {
    await waitForSidecar();
    const row = await dsRow('acme');
    await row.waitForExist({ timeout: 60_000 });
    await row.click();
    await (await $('[data-testid="canvas-frame"]')).waitForExist({ timeout: 30_000 });
    await waitForCanvasOpened();
    await browser.waitUntil(
      () =>
        browser.execute(() => {
          const f = document.querySelector('[data-testid="canvas-frame"]') as HTMLIFrameElement;
          return (
            f?.contentDocument?.querySelector('[data-testid="ds-bar-pending"]')?.textContent ===
            '1 change waiting'
          );
        }),
      { timeout: 30_000, timeoutMsg: 'the bar never said "1 change waiting"' }
    );
    await capture('ds-bar-one-change-waiting');
  });

  it('Review… opens "Update 3 canvases" — followers ticked, the head count in words', async () => {
    await browser.execute(() => {
      const f = document.querySelector('[data-testid="canvas-frame"]') as HTMLIFrameElement;
      const button = f.contentDocument?.querySelector('[data-testid="ds-bar-review"]');
      (button as HTMLElement).click();
    });
    await (await $('[data-testid="ds-review"]')).waitForExist({ timeout: 15_000 });
    expect(await (await $('[data-testid="ds-review-title"]')).getText()).toBe(
      'Update canvases with the new Accent?'
    );
    expect(await (await $('[data-testid="ds-review-update"]')).getText()).toBe('Update 3 canvases');
    expect((await $$('[data-testid="ds-review-row"]')).length).toBe(3);
    for (const p of ['ui/Home.tsx', 'ui/Landing.tsx', 'ui/Pricing.tsx'])
      expect(await (await tick(p)).getAttribute('aria-checked')).toBe('true');
    await capture('ds-review-three-ticked');
  });

  it('untick Landing: the button counts down and the row says what it keeps', async () => {
    await (await tick('ui/Landing.tsx')).click();
    expect(await (await $('[data-testid="ds-review-update"]')).getText()).toBe('Update 2 canvases');
    expect(await (await $('[data-testid="ds-review-head"]')).getText()).toBe('2 of 3 canvases');
    const note = await $(
      '[data-testid="ds-review-row"][data-path="ui/Landing.tsx"] [data-testid="ds-review-note"]'
    );
    expect(await note.getText()).toContain('keeps the old Accent');
    await capture('ds-review-landing-unticked');
  });

  it('Update: the followers carry on, Landing keeps the old head and its row says "update"', async () => {
    await (await $('[data-testid="ds-review-update"]')).click();
    await (await $('[data-testid="ds-review"]')).waitForExist({ reverse: true, timeout: 20_000 });
    await browser.waitUntil(() => typeof metaOf('ui/Landing.tsx').dsRev === 'string', {
      timeout: 20_000,
      timeoutMsg: 'Landing never got its dsRev (it should keep the old head)',
    });
    expect(metaOf('ui/Home.tsx').dsRev).toBeUndefined();
    expect(metaOf('ui/Pricing.tsx').dsRev).toBeUndefined();
    const landing = await canvasRow('canvas-row-ui-landing');
    await browser.waitUntil(async () => (await landing.getText()).includes('update'), {
      timeout: 15_000,
      timeoutMsg: 'the Landing row never showed the quiet "update" word',
    });
    await capture('ds-review-updated-landing-left-out');
  });

  it('⌘Z takes all of it back: Landing follows again and the row is quiet', async () => {
    await browser.execute(() => (document.activeElement as HTMLElement | null)?.blur?.());
    await browser.keys(['Meta', 'z']);
    await browser.waitUntil(() => metaOf('ui/Landing.tsx').dsRev === undefined, {
      timeout: 20_000,
      timeoutMsg: '⌘Z never took the update back',
    });
    const landing = await canvasRow('canvas-row-ui-landing');
    expect(await landing.getText()).not.toContain('update');
    await capture('ds-review-undone');
  });
});

/**
 * 13 · ds-edit-master, part 2 (S10.10) — a component master's change waits; leave a whole FOLDER out with one tick:
 * Tlačítko's corners went 4 → 6 px, ui/2026/combine stays out, so its six canvases keep 4 px and get the update dot.
 * WRITTEN, NOT RUN in the S10.10 hand-back (the lead runs the desktop lane, under the lock).
 *
 * Boots into wdio.ds-review-master.conf.ts's project: fourteen canvases (the review groups by folder from thirteen),
 * one waiting change (Button `.btn` border-radius 6px).
 */
const FOLDER = 'ui/2026/combine';
const COMBINE = ['Letak', 'Plakat', 'Sit', 'Banner', 'Karta', 'Cedule'].map(
  (n) => `${FOLDER}/${n}.tsx`
);
const cssOf = () => {
  const file = join(ROOT, '.design', 'system', 'acme', 'preview', '_components.css');
  return existsSync(file) ? readFileSync(file, 'utf8') : '';
};
const folderTick = (folder: string) =>
  $(`[data-testid="ds-review-folder-tick"][data-folder="${folder}"]`);

part('2')('ds-review (part 2) — a master change, a folder left out with one tick', () => {
  before(() => {
    startReport('ds-review (part 2)');
  });

  it('the bar says one change waits; Review… groups the fourteen canvases by folder', async () => {
    await waitForSidecar();
    const row = await dsRow('acme');
    await row.waitForExist({ timeout: 60_000 });
    await row.click();
    await (await $('[data-testid="canvas-frame"]')).waitForExist({ timeout: 30_000 });
    await waitForCanvasOpened();
    await browser.waitUntil(
      () =>
        browser.execute(() => {
          const f = document.querySelector('[data-testid="canvas-frame"]') as HTMLIFrameElement;
          return (
            f?.contentDocument?.querySelector('[data-testid="ds-bar-pending"]')?.textContent ===
            '1 change waiting'
          );
        }),
      { timeout: 30_000, timeoutMsg: 'the bar never said "1 change waiting"' }
    );
    await browser.execute(() => {
      const f = document.querySelector('[data-testid="canvas-frame"]') as HTMLIFrameElement;
      const button = f.contentDocument?.querySelector('[data-testid="ds-bar-review"]');
      (button as HTMLElement).click();
    });
    await (await $('[data-testid="ds-review"]')).waitForExist({ timeout: 15_000 });
    expect(await (await $('[data-testid="ds-review-update"]')).getText()).toBe(
      'Update 14 canvases'
    );
    expect((await $$('[data-testid="ds-review-folder"]')).length).toBe(3);
    await capture('ds-master-review-by-folder');
  });

  it('untick ui/2026/combine: eight canvases update, the folder says it is left out', async () => {
    await (await folderTick(FOLDER)).click();
    expect(await (await $('[data-testid="ds-review-update"]')).getText()).toBe('Update 8 canvases');
    const folder = await $(`[data-testid="ds-review-folder"][data-folder="${FOLDER}"]`);
    expect(await folder.getText()).toContain('6 canvases · left out');
    await capture('ds-master-folder-unticked');
  });

  it('Update: the file says 6 px, the six keep the head they had, the rest follow', async () => {
    await (await $('[data-testid="ds-review-update"]')).click();
    await (await $('[data-testid="ds-review"]')).waitForExist({ reverse: true, timeout: 20_000 });
    await browser.waitUntil(() => cssOf().includes('border-radius: 6px'), {
      timeout: 20_000,
      timeoutMsg: '_components.css never got the new corners',
    });
    for (const rel of COMBINE) expect(typeof metaOf(rel).dsRev).toBe('string');
    expect(metaOf('ui/Home.tsx').dsRev).toBeUndefined();
    expect(metaOf('ui/club-web/Web1.tsx').dsRev).toBeUndefined();
    await capture('ds-master-updated-folder-left-out');
  });
});

/**
 * 13 · ds-make-inputs … ds-make-done, part 4 (S10.16b) — making a design system with a SCRIPTED agent: the person's
 * gestures are DOM clicks in the shell; the agent's are the same route its `maude design ds` verbs call, driven from
 * the page (same origin) and, for "fill the sections", plain writes into the working files — exactly what the real
 * agent does, so nothing here waits on a real AI. WRITTEN, NOT RUN in the S10.16b hand-back (the lead runs the
 * desktop lane, under the lock).
 *
 * Boots into wdio.ds-make.conf.ts's project: a copy of fixtures/project (canvases, no design system), so the pinned
 * row says "Make a design system". AI is not asked for real: the brief is PARKED in the composer
 * (`window.__maudeAskAiPending`), which is what the spec reads.
 */
const ROOT4 = process.env.MAUDE_E2E_DS_MAKE_ROOT ?? '';
const SENTENCE = 'A small Brno studio that makes calm software. Friendly, precise, never loud.';
const DIRECTIONS = {
  a: {
    label: 'Calm daylight',
    tokens: {
      '--bg-0': { light: '#ffffff', dark: '#10141a' },
      '--fg-0': { light: '#111827', dark: '#eef2f7' },
      '--accent': { light: '#2563eb', dark: '#60a5fa', valueNames: { light: 'Azure' } },
      '--accent-fg': '#ffffff',
      '--font-body': 'system-ui, sans-serif',
      '--radius-md': '10px',
    },
  },
  b: {
    label: 'Warm paper',
    tokens: {
      '--bg-0': { light: '#fbf3e4', dark: '#2a211a', valueNames: { light: 'Cream' } },
      '--fg-0': { light: '#3b2a1a', dark: '#f5e9d3' },
      '--accent': { light: '#c4562d', dark: '#e07a50', valueNames: { light: 'Terracotta' } },
      '--accent-fg': '#ffffff',
      '--font-display': '"New York", serif',
      '--font-body': 'system-ui, sans-serif',
      '--radius-md': '2px',
    },
  },
} as const;
const sysDir = () => {
  const dir = join(ROOT4, '.design', 'system');
  return existsSync(dir) ? (readdirSync(dir)[0] ?? '') : '';
};
const headOf = () => {
  const file = join(ROOT4, '.design', 'system', sysDir(), 'revisions', 'head.json');
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;
};
const workingCss = () =>
  readFileSync(join(ROOT4, '.design', 'system', sysDir(), 'colors_and_type.css'), 'utf8');
/** The agent's route: one POST to /_api/ds/make from the page (same origin, the app's own session). */
const agent = (body: Record<string, unknown>) =>
  browser.executeAsync(
    (b: Record<string, unknown>, done: (r: { ok: boolean; status: number }) => void) => {
      fetch('/_api/ds/make', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(b),
      })
        .then((r) => done({ ok: r.ok, status: r.status }))
        .catch(() => done({ ok: false, status: 0 }));
    },
    body
  );
/** A real pointer click at the centre of a tile INSIDE the canvas frame (selection needs a pointer, not .click()). */
async function clickInFrame(selector: string) {
  const at = await browser.execute((sel: string) => {
    const f = document.querySelector('[data-testid="canvas-frame"]') as HTMLIFrameElement;
    const el = f?.contentDocument?.querySelector(sel) as HTMLElement | null;
    if (!el || !f) return null;
    const fr = f.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    return {
      x: Math.round(fr.left + r.left + r.width / 2),
      y: Math.round(fr.top + r.top + r.height / 2),
    };
  }, selector);
  if (!at) throw new Error(`nothing to click in the canvas for ${selector}`);
  await pointerClick(at.x, at.y);
}

part('4')(
  'ds-review (part 4) — make a design system: sentence, directions, mix, ready, use',
  () => {
    before(() => {
      startReport('ds-review (part 4)');
    });

    it('the empty pinned row opens the three-input sheet; only the sentence is needed', async () => {
      await waitForSidecar();
      await ensureFilesTab();
      const row = await $('[data-testid="canvases-ds-make"]');
      await row.waitForExist({ timeout: 60_000 });
      await row.click();
      await (await $('[data-testid="ds-make"]')).waitForExist({ timeout: 15_000 });
      expect(await (await $('[data-testid="ds-make-title"]')).getText()).toContain(
        'Make a design system for'
      );
      expect(await (await $('[data-testid="ds-make-go"]')).isEnabled()).toBe(false);
      await (await $('[data-testid="ds-make-sentence"]')).setValue(SENTENCE);
      expect(await (await $('[data-testid="ds-make-go"]')).isEnabled()).toBe(true);
      await capture('ds-make-inputs');
    });

    it('Make three directions: the outline exists and AI is handed the brief, the sentence verbatim', async () => {
      await (await $('[data-testid="ds-make-go"]')).click();
      await (await $('[data-testid="ds-make"]')).waitForExist({ reverse: true, timeout: 20_000 });
      await browser.waitUntil(() => headOf() !== null, {
        timeout: 20_000,
        timeoutMsg: 'no head.json: the outline was never made',
      });
      expect(headOf().head).toBeNull();
      expect(
        readFileSync(join(ROOT4, '.design', 'system', sysDir(), 'design-system.tsx'), 'utf8')
      ).toContain('ds-dir-a');
      const parked = await browser.execute(
        () => (window as unknown as { __maudeAskAiPending?: string }).__maudeAskAiPending ?? ''
      );
      expect(parked).toContain(`"""${SENTENCE}"""`);
      expect(parked).toContain(`/design:setup-ds ${sysDir()} --app`);
    });

    it('the scripted agent drafts two directions: they open as ds-dir-* artboards, the third waits', async () => {
      for (const [d, v] of Object.entries(DIRECTIONS))
        expect(
          (
            await agent({
              action: 'draft',
              ds: sysDir(),
              direction: d,
              label: v.label,
              tokens: v.tokens,
            })
          ).ok
        ).toBe(true);
      const row = await dsRow(sysDir());
      await row.waitForExist({ timeout: 30_000 });
      await row.click();
      await (await $('[data-testid="canvas-frame"]')).waitForExist({ timeout: 30_000 });
      await waitForCanvasOpened();
      await browser.waitUntil(
        () =>
          browser.execute(() => {
            const f = document.querySelector('[data-testid="canvas-frame"]') as HTMLIFrameElement;
            const d = f?.contentDocument;
            return (
              !!d?.querySelector('[data-ds-direction="a"]') &&
              !!d?.querySelector('[data-ds-direction="b"]') &&
              !!d?.querySelector('[data-ds-direction-wait="c"]')
            );
          }),
        {
          timeout: 30_000,
          timeoutMsg: 'directions A and B never drew (C should wait as an outline)',
        }
      );
      await capture('ds-make-directions');
    });

    it("select A: the inspector offers Use A and Mix with…; B's type is taken and the button reads Use this mix", async () => {
      await clickInFrame('[data-ds-direction="a"]');
      const use = await $('[data-testid="ds-dir-use"]');
      await use.waitForExist({ timeout: 15_000 });
      expect(await (await $('[data-testid="ds-dir-name"]')).getText()).toBe(
        'Direction A · Calm daylight'
      );
      expect(await use.getText()).toBe('Use A');
      await (await $('[data-testid="ds-dir-mix"]')).click();
      await (await $('[data-testid="ds-dir-mix-type-b"]')).click();
      expect(await (await $('[data-testid="ds-dir-summary"]')).getText()).toBe('A + B’s type');
      expect(await use.getText()).toBe('Use this mix');
      await capture('ds-make-mix');
    });

    it("Use this mix: the working files hold A with B's display face; Colour lands and is no longer an outline", async () => {
      await (await $('[data-testid="ds-dir-use"]')).click();
      await browser.waitUntil(() => workingCss().includes('New York'), {
        timeout: 20_000,
        timeoutMsg: "B's type never reached the working files",
      });
      expect(workingCss()).toContain('#2563eb');
      await browser.waitUntil(
        () =>
          browser.execute(() => {
            const f = document.querySelector('[data-testid="canvas-frame"]') as HTMLIFrameElement;
            return !f?.contentDocument?.querySelector('[data-testid="ds-outline-colour"]');
          }),
        { timeout: 30_000, timeoutMsg: 'Colour was still an outline after it landed' }
      );
      await capture('ds-make-filling');
    });

    it('the ready card says what is missing; "Use as … style" makes the first revision and the default', async () => {
      const card = await $('[data-testid="ds-make-ready"]');
      await card.waitForExist({ timeout: 30_000 });
      expect(await (await $('[data-testid="ds-make-ready-title"]')).getText()).toContain(
        'partly ready'
      );
      expect(await (await $('[data-testid="ds-make-ready-sub"]')).getText()).toContain(
        'Still missing'
      );
      await capture('ds-make-done');
      await (await $('[data-testid="ds-make-use"]')).click();
      await browser.waitUntil(() => typeof headOf()?.head === 'string', {
        timeout: 20_000,
        timeoutMsg: 'no first revision',
      });
      expect(headOf().log[0].action).toBe('make');
      const cfg = JSON.parse(readFileSync(join(ROOT4, '.design', 'config.json'), 'utf8'));
      expect(cfg.defaultDesignSystem).toBe(sysDir());
      await card.waitForExist({ reverse: true, timeout: 20_000 });
    });
  }
);
