import { $, browser, expect } from '@wdio/globals';
import { capture, startReport } from '../helpers/evidence';
import { isNativeShell } from '../helpers/native';
import { waitForSidecar } from '../helpers/sidecar';
import { canvasRow } from '../helpers/tree';

/**
 * Export, from the bundled Maude `.app` (DDR-231 Phase 2 T8).
 *
 * WHY THIS EXISTS. The desktop `local` lane is the FIDELITY REFERENCE the other
 * two lanes are measured against — "tohle už v desktop máme vyladěné". Phase 2
 * changed the shared capture spine (`exporters/capture-core.ts`) to fix the
 * browser lane, and that spine is the same code this lane runs. Nothing was
 * asserting the native app's exports at all, so a fix aimed at the cloud could
 * silently regress the reference and nobody would know until a user noticed.
 *
 * The web counterpart is `apps/studio/test/export-e2e-lanes.test.ts`; between
 * them every lane has an end-to-end test that looks at real bytes.
 *
 * SHAPE. DOM-driven only — no computer-use (memory
 * `feedback_prefer_dom_driven_e2e_not_computer_use`). The dialog is driven by
 * `data-testid`; the ARTIFACT is then read back over the sidecar's own HTTP API
 * from inside the webview, which keeps the assertion off the native save panel
 * (a real file dialog is not DOM, and driving one would need computer-use).
 */

/** Formats this scenario exports, with a recogniser for the produced bytes and
 * the fixture canvas each renders from. `zip` is the only format the `local`
 * lane shares byte-for-byte with a workspace (browser-free, in-process). */
const FORMATS: Array<{
  id: string;
  label: string;
  canvas: 'export' | 'video';
  scope?: string;
  magic?: number[];
  magicText?: { at: number; is: string };
}> = [
  { id: 'png', label: 'PNG', canvas: 'export', magic: [0x89, 0x50, 0x4e, 0x47] },
  { id: 'svg', label: 'SVG', canvas: 'export' },
  { id: 'pdf', label: 'PDF', canvas: 'export', magic: [0x25, 0x50, 0x44, 0x46] },
  { id: 'html', label: 'HTML', canvas: 'export', magic: [0x50, 0x4b, 0x03, 0x04] },
  {
    id: 'pptx',
    label: 'PPTX',
    canvas: 'export',
    scope: 'canvas-as-separate',
    magic: [0x50, 0x4b, 0x03, 0x04],
  },
  {
    id: 'zip',
    label: 'ZIP',
    canvas: 'export',
    scope: 'project-raw',
    magic: [0x50, 0x4b, 0x03, 0x04],
  },
  { id: 'mp4', label: 'MP4', canvas: 'video', magicText: { at: 4, is: 'ftyp' } },
  { id: 'gif', label: 'GIF', canvas: 'video', magicText: { at: 0, is: 'GIF8' } },
];

/** Open a fixture canvas from the tree and wait for its frame. */
async function openCanvas(slug: 'export' | 'video'): Promise<void> {
  const row = await canvasRow(`canvas-row-ui-${slug}`);
  await row.waitForExist({ timeout: 30_000 });
  await row.click();
  const frame = await $('[data-testid="canvas-frame"]');
  await frame.waitForExist({ timeout: 30_000 });
  await browser.waitUntil(
    async () =>
      (await frame.getAttribute('data-path')) ===
      `.design/ui/${slug === 'export' ? 'Export' : 'Video'}.tsx`,
    { timeout: 30_000, timeoutMsg: `canvas ${slug} never became the active frame` }
  );
}

/** Open the Export dialog. ⌘⇧E is a shell `window` listener, and the canvas
 * iframe holds focus once mounted, so dispatch on the shell window directly —
 * focus routing is not what this scenario is about. */
async function openExportDialog(): Promise<void> {
  await browser.execute(() => {
    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'E', metaKey: true, shiftKey: true, bubbles: true })
    );
  });
  const submit = await $('[data-testid="export-submit"]');
  await submit.waitForDisplayed({ timeout: 20_000 });
}

/** Every job id already in the ledger. The queue SEEDS itself from the
 * committed `_export-history.json`, and this fixture ships a done `png` row
 * from 2026-08-19 whose bytes are long gone — without this the poll below
 * matches that row instantly and then "downloads" a 404 body. */
async function existingJobIds(): Promise<string[]> {
  return browser.execute(async () => {
    const r = await fetch('/_api/export-history');
    const { history } = (await r.json()) as Array<never> & {
      history: Array<{ id: string }>;
    };
    return history.map((h) => h.id);
  });
}

/** Poll the sidecar's own ledger from inside the webview until a NEW job for
 * this format finishes, then hand back its id + status (+ failure `reason`).
 *
 * The ledger row's `error` field is RENAMED to `reason` before it leaves the
 * webview. A WebDriver script result whose value carries an `error` key is
 * read by the client as a protocol ERROR response (W3C: `{value: {error, …}}`),
 * so the moment a job failed every poll threw `WebDriverError: <the job's
 * error text>`, `waitUntil` swallowed it as "not yet", and a failed export
 * surfaced as mocha's bare `Timeout` minutes later instead of as its reason. */
async function waitForJob(format: string, ignore: string[], timeoutMs = 240_000) {
  let last: { id?: string; status?: string; reason?: string } = {};
  await browser.waitUntil(
    async () => {
      last = await browser.execute(
        async (f: string, seen: string[]) => {
          const r = await fetch('/_api/export-history');
          const { history } = (await r.json()) as {
            history: Array<{ id: string; format: string; status: string; error?: string }>;
          };
          const row = history.find((h) => h.format === f && !seen.includes(h.id));
          return row ? { id: row.id, status: row.status, reason: row.error } : {};
        },
        format,
        ignore
      );
      return last.status === 'done' || last.status === 'failed';
    },
    {
      timeout: timeoutMs,
      interval: 1000,
      timeoutMsg: `no NEW ${format} export job finished within ${timeoutMs}ms`,
    }
  );
  return last;
}

describe('export-formats (native-desktop)', () => {
  // Which fixture canvas is in front — shared across the per-format tests.
  let open: 'export' | 'video' | null = null;

  before(async () => {
    startReport('export-formats (native-desktop)');
    expect(await isNativeShell()).toBe(true);
    const url = await waitForSidecar();
    expect(url).toMatch(/^http:\/\/(localhost|127\.0\.0\.1):\d+/);

    const list = await $('[data-testid="canvas-list"]');
    await list.waitForDisplayed({ timeout: 60_000 });
  });

  // One test per format. This was a single test looping over all eight under
  // mocha's 180 s budget while each job alone may take 240 s — so one slow or
  // failed format turned into a bare `Timeout` for the whole matrix and hid
  // which formats were fine.
  for (const format of FORMATS) {
    it(`exports ${format.label} from the bundled app, and the file is real`, async function () {
      this.timeout(300_000); // > waitForJob's 240 s, so its message is the one reported
      // The export fixture carries an image asset, so a dropped asset is
      // observable (Smoke.tsx has none); the video fixture is the smallest
      // comp the video adapters accept.
      if (open !== format.canvas) {
        await openCanvas(format.canvas);
        open = format.canvas;
        await capture(`fixture-open-${format.canvas}`);
      }
      const before = await existingJobIds();
      await openExportDialog();
      await (await $(`[data-testid="export-format-${format.id}"]`)).click();
      const wantScope = format.scope ?? 'artboard';
      await browser.execute((want: string) => {
        const sel = document.querySelector(
          '[data-testid="export-scope"]'
        ) as HTMLSelectElement | null;
        if (sel && Array.from(sel.options).some((o) => o.value === want)) {
          sel.value = want;
          sel.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }, wantScope);
      await capture(`export-dialog-${format.id}`);
      await (await $('[data-testid="export-submit"]')).click();

      const job = await waitForJob(format.id, before);
      // Put the reason in the assertion, not in a separate log line — a bare
      // `toBe('done')` on a failed render says nothing about why.
      expect(`${format.label}: ${job.status} ${job.reason ?? ''}`.trim()).toBe(
        `${format.label}: done`
      );

      const probe = await browser.execute(async (id: string) => {
        const r = await fetch(`/_api/export-jobs/download?id=${id}`);
        const buf = new Uint8Array(await r.arrayBuffer());
        return {
          size: buf.byteLength,
          head: Array.from(buf.slice(0, 4)),
          head8: Array.from(buf.slice(0, 8)),
          text: new TextDecoder().decode(buf.slice(0, 200_000)),
        };
      }, job.id as string);

      expect(probe.size).toBeGreaterThan(500);
      if (format.magic) expect(probe.head).toEqual(format.magic);
      if (format.magicText) {
        const { at, is } = format.magicText;
        const got = String.fromCharCode(...probe.head8.slice(at, at + is.length));
        expect(got).toBe(is);
      }

      if (format.id === 'svg') {
        // The two DDR-231 Phase 2 defects, asserted on the reference lane's own
        // artifact: editor chrome must not be in it, and every resource must be
        // embedded rather than pointing back at the dev-server.
        expect(probe.text).not.toContain('dc-artboard-label');
        expect(probe.text).not.toContain('EXPORT/01');
        expect(probe.text).toContain('data:image/png');
        expect(probe.text.match(/(?:xlink:)?href="https?:\/\/[^"]+"/g) ?? []).toEqual([]);
      }
      await capture(`export-done-${format.id}`);
    });
  }
});
