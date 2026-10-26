import { $, $$, browser, expect } from '@wdio/globals';
import { capture, startReport } from '../helpers/evidence';
import { waitForSidecar } from '../helpers/sidecar';
import { ensureFilesTab } from '../helpers/tree';

/**
 * 08 Artboard Kinds — the kind chips over the Canvases list (S7.24, ak-mixed-filter): All · Fixed size · Web page ·
 * Print · Video, each with its count. Video turns the tree into the canvases that have video, each with its folder
 * and "N of M"; the foot says "N of T canvases have video…"; pressing the chip again (or All) brings the tree back.
 *
 * Plain wdio DOM on the shell frame — the chips and rows are shell, not canvas. Selection/view only: nothing is
 * written, so no fixture guard is needed. The fixture has `ui/Video.tsx` (one `kind="video"` artboard), so the
 * Video chip is never empty; counts are READ from the chips, not hard-coded. WRITTEN, NOT RUN in the S7.24
 * hand-back (the lead runs the desktop lane; it needs an unlocked screen and the e2e lock).
 */

const chip = (kind: string) => $(`[data-testid="kind-chip-${kind}"]`);
const foot = () => $('[data-testid="canvases-foot"]');

/** The count printed on a chip. */
async function countOf(kind: string): Promise<number> {
  const label = (await chip(kind).getAttribute('aria-label')) ?? '';
  return Number(label.split(', ').pop());
}

/** The chips print 0 until the sidecar's kind probe lands; wait for Video's count, never read it cold. */
async function settledCount(kind: string): Promise<number> {
  await browser.waitUntil(async () => (await countOf(kind)) > 0, {
    timeout: 30_000,
    timeoutMsg: `the ${kind} chip never got a count`,
  });
  return countOf(kind);
}

describe('canvases-kind-filter — the kind chips over the Canvases list', () => {
  before(() => {
    startReport('canvases-kind-filter');
  });

  it('five chips, each named "<word>, <count>"; All is on', async () => {
    await waitForSidecar();
    await ensureFilesTab();
    await $('[data-testid="kind-chips"]').waitForExist({ timeout: 60_000 });
    const names = await $$('[data-testid^="kind-chip-"]').map((c) => c.getAttribute('aria-label'));
    expect(names.map((n) => (n ?? '').split(',')[0])).toEqual([
      'All',
      'Fixed size',
      'Web page',
      'Print',
      'Video',
    ]);
    expect(await chip('all').getAttribute('aria-pressed')).toBe('true');
    expect(await settledCount('video')).toBeGreaterThan(0);
    await capture('kind-chips-all');
  });

  it('Video: only canvases that have video, each with "N of M"; the foot says how many', async () => {
    // The left panel folds to its corner icon once a canvas is being worked on; a person brings it back, so does this.
    await ensureFilesTab();
    const videos = await settledCount('video');
    const all = await settledCount('all');
    await chip('video').click();
    await browser.waitUntil(
      async () => (await chip('video').getAttribute('aria-pressed')) === 'true'
    );
    const rows = await $$('.cv-meta--count');
    expect(rows.length).toBe(videos);
    expect(await foot().getText()).toContain(`${videos} of ${all} canvases have video`);
    await capture('kind-chips-video');
  });

  it('pressing the chip that is on brings the tree back', async () => {
    await ensureFilesTab();
    await chip('video').click();
    await browser.waitUntil(
      async () => (await chip('all').getAttribute('aria-pressed')) === 'true'
    );
    expect(await $$('.cv-meta--count').length).toBe(0);
    // P8 C5: the board draws no foot line at rest — the foot is a state's words, and the filter is off again.
    expect(await foot().isExisting()).toBe(false);
  });
});
