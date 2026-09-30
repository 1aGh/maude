// export-e2e-lanes.test.ts — DDR-231 Phase 2 T7.
//
// The end-to-end export test the first live cloud run needed and did not have.
//
// Every export gate before this one tested a LAYER: `capture-core` against a
// synthetic fixture, lane resolution as pure data, the render service's body
// validation over curl. All of them were green while a real member's PNG came
// out carrying the artboard's title bar and with every photo missing — because
// nothing drove the actual Export dialog against an actual canvas and looked
// at the actual file.
//
// So this boots a REAL workspace-shaped studio, opens the REAL dialog in
// Chromium, clicks Export, catches the download, and asserts the bytes:
//
//   * no editor chrome in the artifact (the `.dc-artboard-label` leak)
//   * no remote resource refs, and the artboard's image actually embedded
//     (the dom-to-svg inlining defect — see capture-core.inlineCaptureResources)
//   * the export is visible afterwards: a status line, and a ledger row
//     (the "modal closes and I see nothing" report)
//
// Lane note: `MAUDE_WORKSPACE_MODE=1` with NO `MAUDE_RENDER_URL` resolves to
// lane `none`, which is precisely the browser lane with its jobs-lane fallback
// removed. That makes this test both fast and honest — nothing can silently
// pass because the render service quietly did the work instead.

import { describe, expect, test } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { bootServer, killProc, makeSandbox, nextPort } from './_helpers.ts';

/** 8×8 solid-green PNG — big enough that a dropped image is unmistakable. */
const PNG_8PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAFklEQVR42mNkYPhfz0BFwDiq' +
    'YVTDsNAAAOKcA/3fzWvKAAAAAElFTkSuQmCC',
  'base64'
);

const CANVAS_TSX = `import { DesignCanvas, DCSection, DCArtboard } from "@maude/canvas-lib";

export default function ExportE2E() {
  return (
    <DesignCanvas>
      <DCSection id="s" title="Export E2E">
        <DCArtboard id="board-a" label="Board A · export fixture" width={400} height={260}>
          <div style={{ padding: 24, background: "#132038", color: "#f2efe6", height: "100%" }}>
            <h1 style={{ fontSize: 20, margin: 0 }}>Summer Camp</h1>
            <img src="assets/pic.png" width={96} height={96} alt="fixture" />
          </div>
        </DCArtboard>
      </DCSection>
    </DesignCanvas>
  );
}
`;

/** The shape that refused on the desktop and silently degraded on the worker:
 * `<Audio>` reached through a barrel that re-exports it from `remotion`. */
const AUDIO_BARREL_TSX = `export { Audio } from "remotion";
`;
const VIDEO_AUDIO_TSX = `import { DesignCanvas, DCSection, DCArtboard, VideoComp } from "@maude/canvas-lib";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { Audio } from "./_audio-barrel";

const W = 320, H = 180, FPS = 12, TOTAL = 12;
function Clip() {
  const f = useCurrentFrame();
  return (
    <AbsoluteFill style={{ background: "#132038", color: "#f2efe6" }}>
      <Audio src="assets/pic.png" />
      <div style={{ fontSize: 48 }}>{f}</div>
    </AbsoluteFill>
  );
}
export default function VideoAudioE2E() {
  return (
    <DesignCanvas>
      <DCSection id="va" title="Video+Audio E2E">
        <DCArtboard id="clip-audio" label="Clip · audio" width={W} height={H}>
          <VideoComp component={Clip} durationInFrames={TOTAL} fps={FPS} width={W} height={H} />
        </DCArtboard>
      </DCSection>
    </DesignCanvas>
  );
}
`;

/** One A6 print artboard with 3 mm bleed — the print-PDF path (BleedBox /
 * TrimBox / marks) is only reachable from a `kind="print"` artboard. */
const PRINT_TSX = `import { DesignCanvas, DCSection, DCArtboard } from "@maude/canvas-lib";

export default function PrintE2E() {
  return (
    <DesignCanvas>
      <DCSection id="p" title="Print E2E">
        <DCArtboard id="flyer" label="Flyer · A6 print" kind="print" print={{ paper: "a6", bleedMm: 3 }} width={397} height={559}>
          <div style={{ padding: 16, background: "#fff", color: "#111", height: "100%" }}>
            <h2 style={{ margin: 0 }}>Print flyer</h2>
          </div>
        </DCArtboard>
      </DCSection>
    </DesignCanvas>
  );
}
`;

/** A 12-frame, 320×180 video comp — the smallest thing the video adapters
 * accept, so the worker-lane mp4 test measures the LANE, not the render. */
const VIDEO_TSX = `import { DesignCanvas, DCSection, DCArtboard, VideoComp } from "@maude/canvas-lib";
import { AbsoluteFill, useCurrentFrame } from "remotion";

const W = 320, H = 180, FPS = 12, TOTAL = 12;
function Clip() {
  const f = useCurrentFrame();
  return (
    <AbsoluteFill style={{ background: "#132038", color: "#f2efe6", justifyContent: "center", alignItems: "center" }}>
      <div style={{ fontSize: 48, transform: \`translateX(\${f * 6}px)\` }}>{f}</div>
    </AbsoluteFill>
  );
}
export default function VideoE2E() {
  return (
    <DesignCanvas>
      <DCSection id="v" title="Video E2E">
        <DCArtboard id="clip" label="Clip · 320×180" width={W} height={H}>
          <VideoComp component={Clip} durationInFrames={TOTAL} fps={FPS} width={W} height={H} />
        </DCArtboard>
      </DCSection>
    </DesignCanvas>
  );
}
`;

/** Build a sandbox whose canvas has BOTH defect surfaces: editor chrome (the
 * artboard label is rendered by canvas-lib itself) and a real image asset. */
function makeExportSandbox() {
  const box = makeSandbox();
  mkdirSync(join(box.designRoot, 'assets'), { recursive: true });
  writeFileSync(join(box.designRoot, 'assets', 'pic.png'), PNG_8PX);
  writeFileSync(join(box.designRoot, 'ui', 'e2e-export.tsx'), CANVAS_TSX);
  writeFileSync(join(box.designRoot, 'ui', 'e2e-video.tsx'), VIDEO_TSX);
  writeFileSync(join(box.designRoot, 'ui', 'e2e-print.tsx'), PRINT_TSX);
  writeFileSync(join(box.designRoot, 'ui', '_audio-barrel.tsx'), AUDIO_BARREL_TSX);
  writeFileSync(join(box.designRoot, 'ui', 'e2e-video-audio.tsx'), VIDEO_AUDIO_TSX);
  return box;
}

interface PwPage {
  goto(url: string, o?: unknown): Promise<unknown>;
  keyboard: { press(k: string): Promise<void> };
  click(sel: string, o?: unknown): Promise<void>;
  waitForSelector(sel: string, o?: unknown): Promise<unknown>;
  selectOption(sel: string, v: string): Promise<unknown>;
  textContent(sel: string): Promise<string | null>;
  waitForEvent(e: string, o?: unknown): Promise<PwDownload>;
  evaluate<T>(fn: (...a: never[]) => T, arg?: unknown): Promise<T>;
  waitForFunction(fn: (...a: never[]) => unknown, arg?: unknown, o?: unknown): Promise<unknown>;
  on(e: string, fn: (x: unknown) => void): void;
  frames(): Array<{
    url(): string;
    waitForSelector(s: string, o?: unknown): Promise<unknown>;
    click(s: string, o?: unknown): Promise<void>;
  }>;
}
interface PwDownload {
  suggestedFilename(): string;
  path(): Promise<string>;
}

/**
 * Open the studio, open a canvas, and open the Export dialog.
 * Returns the page plus a `download(format)` driver.
 */
async function openExportDialog(port: number) {
  const { launchChromium } = (await import('../bin/_pw-launch.mjs')) as {
    launchChromium: () => Promise<{
      newContext: (o: unknown) => Promise<{ newPage: () => Promise<PwPage> }>;
      close: () => Promise<void>;
    }>;
  };
  const browser = await launchChromium();
  const ctx = await browser.newContext({
    viewport: { width: 1400, height: 900 },
    acceptDownloads: true,
  });
  const page = await ctx.newPage();
  await page.goto(`http://localhost:${port}/`, { waitUntil: 'domcontentloaded' });
  // Open the canvas from the tree — the artboard must be MOUNTED for the
  // browser lane to have anything to capture.
  await page.waitForSelector('[data-testid="canvas-list"]', { timeout: 30_000 });
  // The Files panel starts collapsed (#124): open the closed sections/folders
  // the way a user would, until the row exists.
  const row = '[data-testid="canvas-row-ui-e2e-export"]';
  for (let pass = 0; pass < 8 && (await page.locator(row).count()) === 0; pass++) {
    await page.evaluate(() => {
      for (const el of document.querySelectorAll<HTMLElement>(
        '[data-testid^="tree-section-"][aria-expanded="false"], [data-testid^="tree-folder-"][aria-expanded="false"]'
      ))
        el.click();
    });
    await page.waitForTimeout(150);
  }
  await page.click(row, { timeout: 30_000 });
  await page.waitForSelector('[data-testid="canvas-frame"]', { timeout: 30_000 });
  // The capture reaches INTO the canvas iframe, which the shell's own DOM
  // cannot see through — the canvas runs on its own origin (DDR-054), so
  // `contentDocument` is null from page scripts (memory
  // `maude-canvas-iframe-unreachable-by-dom`). Playwright is not bound by the
  // same-origin policy, so drive the FRAME directly.
  const deadline = Date.now() + 60_000;
  for (;;) {
    const frame = page
      .frames()
      .find((f) => f.url().includes('_canvas-shell') || f.url().includes('canvas='));
    if (frame) {
      try {
        await frame.waitForSelector('[data-dc-screen]', { timeout: 5_000 });
        break;
      } catch {
        /* still building — the first load transpiles the canvas */
      }
    }
    if (Date.now() > deadline) throw new Error('artboard never mounted in the canvas iframe');
    await Bun.sleep(250);
  }
  // ⌘⇧E opens the dialog. Dispatch it on the SHELL window rather than through
  // `keyboard.press`: once the canvas iframe has mounted it holds focus, and a
  // synthetic keypress would be delivered to the iframe's document instead of
  // the shell's (the shortcut handler is a shell `window` listener). Focus
  // routing is not what this test is about — the dialog, the lane and the
  // artifact are.
  await page.evaluate(() => {
    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'E', metaKey: true, shiftKey: true, bubbles: true })
    );
  });
  await page.waitForSelector('[data-testid="export-submit"]', { timeout: 15_000 });
  return { browser, page };
}

/**
 * Click Export and return the download — but surface an ERROR STATUS as a
 * failure instead of blocking on a download that will never arrive. Without
 * this a refused export (the viewer-role 403 on `/_api/export-assemble`, found
 * exactly this way) reads as a test timeout with no cause attached.
 */
async function exportAndDownload(page: PwPage, timeoutMs = 180_000): Promise<PwDownload> {
  const failed = page
    .waitForSelector('[data-testid="export-status"][data-ok="0"]', { timeout: timeoutMs })
    .then(async () => {
      throw new Error(`export failed: ${await page.textContent('[data-testid="export-status"]')}`);
    });
  const [download] = await Promise.all([
    Promise.race([page.waitForEvent('download', { timeout: timeoutMs }), failed]),
    page.click('[data-testid="export-submit"]'),
  ]);
  return download as PwDownload;
}

/**
 * Wait for the dialog to report the export finished.
 *
 * `waitForEvent('download')` resolves when the download STARTS, but the dialog
 * sets its "Saved …" line only after the ledger write it awaits — so reading
 * the status straight after the download raced it, and the test failed roughly
 * one run in four while claiming the export was broken. Wait for the state
 * instead of assuming it has landed.
 */
async function waitForSavedStatus(page: PwPage): Promise<void> {
  await page.waitForFunction(
    () => !!document.querySelector('[data-testid="export-status"]')?.textContent?.includes('Saved'),
    undefined,
    { timeout: 30_000 }
  );
}

describe('export E2E — browser lane, real dialog, real artifact', () => {
  test(
    'PNG and SVG export with no editor chrome and every asset embedded',
    async () => {
      const box = makeExportSandbox();
      const port = nextPort();
      const proc = await bootServer(box.root, port, {
        MAUDE_WORKSPACE_MODE: '1',
        // The dev checkout carries playwright as a devDependency; the cell
        // image never does (scripts/check-containment.sh is the real gate).
        MAUDE_WORKSPACE_ALLOW_DEV_MODULES: '1',
      });
      let browser: { close(): Promise<void> } | null = null;
      try {
        const opened = await openExportDialog(port);
        browser = opened.browser;
        const { page } = opened;

        for (const format of ['png', 'svg'] as const) {
          await page.click(`[data-testid="export-format-${format}"]`);
          await page.selectOption('[data-testid="export-scope"]', 'artboard');
          const download = await exportAndDownload(page, 120_000);
          const file = await download.path();
          const bytes = await Bun.file(file).arrayBuffer();
          expect(bytes.byteLength).toBeGreaterThan(200);

          if (format === 'svg') {
            const svg = new TextDecoder().decode(bytes);
            // The two live defects, asserted on the delivered file.
            expect(svg).not.toContain('dc-artboard-label');
            expect(svg).not.toContain('Board A');
            expect(svg.match(/(?:xlink:)?href="https?:\/\/[^"]+"/g) ?? []).toEqual([]);
            expect(svg).toContain('data:image/png');
          } else {
            // PNG magic — a real raster, not an error page or an empty blob.
            const head = new Uint8Array(bytes.slice(0, 8));
            expect(Array.from(head)).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
          }

          // The export must be VISIBLE when it finishes: the dialog says so…
          await waitForSavedStatus(page);
        }

        // The DECK: every artboard captured here, composed in-cell. The
        // reported symptom was a silent modal close with nothing to show for
        // it, so assert the artifact AND the finished status.
        await page.click('[data-testid="export-format-pptx"]');
        const deck = await exportAndDownload(page);
        const deckBytes = new Uint8Array(await Bun.file(await deck.path()).arrayBuffer());
        // PPTX is a zip — PK\x03\x04.
        expect(Array.from(deckBytes.slice(0, 4))).toEqual([0x50, 0x4b, 0x03, 0x04]);
        expect(deckBytes.byteLength).toBeGreaterThan(1000);
        await waitForSavedStatus(page);

        // …and it left a row in the ledger the Recent tab and the notification
        // center read (the Phase-1 gap: a browser-lane export wrote nothing).
        const history = (await (
          await fetch(`http://localhost:${port}/_api/export-history`)
        ).json()) as { history: Array<{ format: string; deliveredInBrowser?: boolean }> };
        const browserRows = history.history.filter((h) => h.deliveredInBrowser);
        expect(browserRows.map((h) => h.format).sort()).toEqual(['png', 'pptx', 'svg']);
      } finally {
        await browser?.close().catch(() => {});
        killProc(proc);
      }
    },
    { timeout: 300_000 }
  );

  test(
    'a format the chosen scope cannot render is refused before any job is created',
    async () => {
      // The reproduced production failure, driven through the HTTP surface the
      // dialog uses. Kept next to the UI test because the UI can no longer
      // PRODUCE this pair — the guarantee is that the server refuses it anyway.
      const box = makeExportSandbox();
      const port = nextPort();
      const proc = await bootServer(box.root, port, {
        MAUDE_WORKSPACE_MODE: '1',
        MAUDE_WORKSPACE_ALLOW_DEV_MODULES: '1',
        MAUDE_RENDER_URL: 'http://127.0.0.1:1',
      });
      try {
        for (const format of ['pdf', 'html']) {
          const r = await fetch(`http://localhost:${port}/_api/export-jobs`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', origin: `http://localhost:${port}` },
            body: JSON.stringify({ format, scope: 'project-raw', options: {} }),
          });
          expect(r.status).toBe(400);
          const text = await r.text();
          expect(text).toContain('project-raw');
          // Names the way out, rather than the render service's old opaque
          // "invalid render job".
          expect(text).toContain('artboard');
        }
      } finally {
        killProc(proc);
      }
    },
    { timeout: 120_000 }
  );
});

/**
 * Spawn a real `maude-render` next to the studio.
 *
 * Its env is built from scratch rather than inherited: the service refuses to
 * boot if the environment carries ANY credential-shaped variable but its own
 * ingress bearer (DDR-230 §1, enforced at boot), and a developer shell
 * routinely carries several.
 */
/** A booted render service plus a live view of what it logged — the CI hang
 * this instrumentation exists for burned the whole 600 s budget in total
 * silence because the child's piped output was never read. Now every render
 * line is teed to this process's stderr (so a CI run shows the worker's real
 * activity) AND kept in a rolling tail the test attaches to any failure. */
interface RenderHandle {
  kill(): void;
  tail(): string;
}
async function bootRenderService(
  port: number,
  canvasOrigin: string,
  secret: string
): Promise<RenderHandle> {
  const { spawn } = await import('bun');
  const proc = spawn({
    cmd: ['bun', 'run', join(import.meta.dir, '..', '..', 'render', 'server.ts')],
    env: {
      PATH: process.env.PATH ?? '',
      HOME: process.env.HOME ?? '',
      PORT: String(port),
      MAUDE_RENDER_SECRET: secret,
      MAUDE_RENDER_CANVAS_ORIGINS: canvasOrigin,
      // The render worker resolves the SAME Chromium the studio uses. In a
      // from-scratch env it must still be able to FIND it, or a headless render
      // wedges with no error — so forward the browser-locating vars (never a
      // credential; the DDR-230 boot guard refuses secret-shaped names).
      ...(process.env.PLAYWRIGHT_BROWSERS_PATH
        ? { PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH }
        : {}),
      ...(process.env.MAUDE_BROWSER_EXECUTABLE
        ? { MAUDE_BROWSER_EXECUTABLE: process.env.MAUDE_BROWSER_EXECUTABLE }
        : {}),
      ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
        ? { PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
        : {}),
      // NB: video-encode GPU is NOT special-cased here — the render service
      // enables it for itself (apps/render/server.ts), so this gate exercises
      // the SAME behavior production has instead of a test-only green.
    },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  // Pump both streams: tee to our stderr (CI visibility) and keep a rolling
  // tail. Fire-and-forget — the loops end when the child's pipes close.
  const logLines: string[] = [];
  const pump = async (stream: ReadableStream<Uint8Array> | null) => {
    if (!stream) return;
    const dec = new TextDecoder();
    for await (const chunk of stream as unknown as AsyncIterable<Uint8Array>) {
      const text = dec.decode(chunk);
      for (const line of text.split('\n')) {
        if (!line) continue;
        logLines.push(line);
        if (logLines.length > 400) logLines.shift();
        process.stderr.write(`[render] ${line}\n`);
      }
    }
  };
  void pump(proc.stdout as unknown as ReadableStream<Uint8Array>);
  void pump(proc.stderr as unknown as ReadableStream<Uint8Array>);
  const handle: RenderHandle = {
    kill: () => proc.kill(),
    tail: () => logLines.slice(-40).join('\n') || '(render logged nothing)',
  };
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/_health`, {
        signal: AbortSignal.timeout(300),
      });
      if (r.ok) return handle;
    } catch {
      /* not up yet */
    }
    await Bun.sleep(100);
  }
  proc.kill();
  throw new Error(`render service did not start\n[render tail]\n${handle.tail()}`);
}

/** Poll the job ledger until a job for this format that is NOT in `seen`
 * finishes, then return it. `seen` lets one format run under several scopes. */
async function waitForJob(port: number, format: string, timeoutMs: number, seen: Set<string>) {
  // Hard race, NOT a `Date.now() < deadline` loop: Bun's `fetch` does not
  // reliably honour `AbortSignal.timeout` against a wedged server (measured —
  // the studio's /_api/export-history stopped answering after a failed job and
  // an "aborted" fetch hung anyway), so the loop's deadline check never re-ran
  // and it ate the whole 600 s budget. A Promise.race against a real timer
  // cannot be defeated by a stuck await.
  const poll = (async () => {
    for (;;) {
      try {
        const { history } = (await (
          await fetch(`http://localhost:${port}/_api/export-history`, {
            signal: AbortSignal.timeout(10_000),
          })
        ).json()) as {
          history: Array<{ id: string; format: string; status: string; error?: string }>;
        };
        const job = history.find((h) => h.format === format && !seen.has(h.id));
        if (job) {
          seen.add(job.id);
          return job;
        }
      } catch {
        /* transient (abort / studio busy) — keep polling until the race fires */
      }
      await Bun.sleep(500);
    }
  })();
  let timer: ReturnType<typeof setTimeout>;
  const bail = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`no new ${format} job finished within ${timeoutMs}ms`)),
      timeoutMs
    );
  });
  try {
    return await Promise.race([poll, bail]);
  } finally {
    clearTimeout(timer);
  }
}

describe('export E2E — worker lane, real render service, real artifact', () => {
  test(
    'every worker-lane format renders on maude-render and comes back as a real file',
    async () => {
      const box = makeExportSandbox();
      const studioPort = nextPort();
      const renderPort = nextPort();
      const secret = 'e2e-render-secret';
      const proc = await bootServer(box.root, studioPort, {
        MAUDE_WORKSPACE_MODE: '1',
        MAUDE_WORKSPACE_ALLOW_DEV_MODULES: '1',
        MAUDE_RENDER_URL: `http://127.0.0.1:${renderPort}`,
        MAUDE_RENDER_SECRET: secret,
      });
      // Tee the STUDIO's stderr too — a video job can render in-process here
      // (when the lane resolves local, or a remote dispatch degrades), and its
      // render logs then live in THIS process, not the render worker's. Without
      // this, a video hang on the studio side is as silent as the worker one was.
      void (async () => {
        try {
          const dec = new TextDecoder();
          for await (const chunk of proc.stderr as unknown as AsyncIterable<Uint8Array>) {
            for (const line of dec.decode(chunk).split('\n')) {
              if (line) process.stderr.write(`[studio] ${line}\n`);
            }
          }
        } catch {
          /* stream closed */
        }
      })();
      let render: RenderHandle | null = null;
      let browser: { close(): Promise<void> } | null = null;
      try {
        // The render worker fetches the canvas the way a member's browser
        // does — through the canvas origin, which only exists once the server
        // has bound both listeners.
        let canvasOrigin = '';
        const originDeadline = Date.now() + 20_000;
        while (Date.now() < originDeadline) {
          try {
            const cfg = (await (await fetch(`http://localhost:${studioPort}/_config`)).json()) as {
              canvasOrigin?: string;
            };
            if (cfg.canvasOrigin) {
              canvasOrigin = cfg.canvasOrigin;
              break;
            }
          } catch {
            /* not ready */
          }
          await Bun.sleep(200);
        }
        expect(canvasOrigin).not.toBe('');
        render = await bootRenderService(renderPort, canvasOrigin, secret);

        const opened = await openExportDialog(studioPort);
        browser = opened.browser;
        const { page } = opened;

        // These enqueue a background JOB rather than downloading in-page (the
        // notification center owns completion), so drive the real dialog to
        // submit and then assert the artifact the job produced.
        //
        // pdf + html are worker-ONLY formats. png/svg/pptx are here too because
        // the worker is the browser lane's automatic FALLBACK on a remote-lane
        // workspace (a capture failure degrades to the jobs lane) — a live
        // path, and worker-lane SVG was failing 100% before Phase 2 without a
        // single test noticing. The dialog routes these through the browser
        // lane when it can, so they are posted to the job route directly.
        const WORKER_FORMATS = [
          { format: 'pdf', scope: 'artboard', viaDialog: true },
          { format: 'html', scope: 'artboard', viaDialog: true },
          { format: 'png', scope: 'artboard', viaDialog: false },
          { format: 'svg', scope: 'artboard', viaDialog: false },
          { format: 'pptx', scope: 'canvas-as-separate', viaDialog: false },
          // The two scopes the browser lane does NOT take (it captures the
          // active artboard only) — they ride the worker on every workspace.
          { format: 'png', scope: 'selection', viaDialog: false, selector: 'h1' },
          { format: 'png', scope: 'canvas-as-separate', viaDialog: false },
          // Print PDF — bleed + crop/registration marks. The geometry has a
          // pure pdf-lib golden gate (test/pdf-print-boxes.test.ts); this is
          // the end-to-end proof that the dialog's options reach the adapter
          // and a real render carries the boxes.
          {
            format: 'pdf',
            scope: 'artboard',
            viaDialog: false,
            artboardId: 'flyer',
            pdfPrint: { includeBleed: true, marks: { crop: true, registration: true } },
          },
          // Video — the lane that was blocked 100% by the canvas-origin CSP
          // until bin/_pw-launch.mjs addScriptCspSafe (DDR-232 §3). Posted
          // against the video fixture's artboard; the dialog would do the same.
          { format: 'mp4', scope: 'artboard', viaDialog: false, artboardId: 'clip' },
          { format: 'webm', scope: 'artboard', viaDialog: false, artboardId: 'clip' },
          { format: 'gif', scope: 'artboard', viaDialog: false, artboardId: 'clip' },
        ] as const;
        const seenJobs = new Set<string>();
        let openCanvasSlug = 'e2e-export';
        // Keep the whole loop inside the outer 600 s test budget with headroom,
        // and never spend it in silence: each format logs when it starts and
        // how long its render took, and a stuck one throws WITH the render log
        // tail rather than letting the bun-level timeout kill everything blind.
        const workerStart = Date.now();
        const WORKER_BUDGET_MS = 540_000;
        let fmtIndex = 0;
        for (const entry of WORKER_FORMATS) {
          const { format, scope, viaDialog } = entry;
          const artboardId = 'artboardId' in entry ? entry.artboardId : undefined;
          const selector = 'selector' in entry ? entry.selector : undefined;
          const pdfPrint = 'pdfPrint' in entry ? entry.pdfPrint : undefined;
          const wantCanvas =
            artboardId === 'clip'
              ? 'e2e-video'
              : artboardId === 'flyer'
                ? 'e2e-print'
                : 'e2e-export';
          if (artboardId && wantCanvas !== openCanvasSlug) {
            openCanvasSlug = wantCanvas;
            // Renders target the ACTIVE canvas's artboard — switch to the
            // fixture this entry needs. The dialog's scrim is still up from
            // the last submit and would swallow the tree click; dismiss it.
            await page.evaluate(() => {
              window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
            });
            await page.waitForSelector('[data-testid="export-submit"]', {
              state: 'detached',
              timeout: 5_000,
            });
            await page.click(`[data-testid="canvas-row-ui-${wantCanvas}"]`, { timeout: 30_000 });
            await page.waitForSelector(
              `[data-testid="canvas-frame"][data-path$="${wantCanvas}.tsx"]`,
              { timeout: 30_000 }
            );
            // The job resolves its targets against the SERVER's `_active.json`,
            // which the shell updates asynchronously after the tab switch — a
            // job posted before it lands renders the previous canvas.
            const activeDeadline = Date.now() + 15_000;
            for (;;) {
              const act = (await (
                await fetch(`http://localhost:${studioPort}/_active`)
              ).json()) as {
                active?: string | null;
              };
              const activeFile = act.active ?? '';
              if (activeFile.endsWith(`${wantCanvas}.tsx`)) break;
              if (Date.now() > activeDeadline)
                throw new Error(
                  `server active canvas never became ${wantCanvas} (is ${activeFile})`
                );
              await Bun.sleep(250);
            }
          }
          if (viaDialog) {
            await page.click(`[data-testid="export-format-${format}"]`);
            await page.selectOption('[data-testid="export-scope"]', scope);
            await page.click('[data-testid="export-submit"]');
          } else {
            const r = await fetch(`http://localhost:${studioPort}/_api/export-jobs`, {
              method: 'POST',
              headers: {
                'content-type': 'application/json',
                origin: `http://localhost:${studioPort}`,
              },
              body: JSON.stringify({
                format,
                scope,
                options: {
                  ...(artboardId ? { artboardId } : {}),
                  ...(selector ? { selection: { selector } } : {}),
                  ...(pdfPrint ? { pdfPrint } : {}),
                },
              }),
            });
            expect(r.status).toBe(202);
          }
          fmtIndex += 1;
          const remaining = WORKER_BUDGET_MS - (Date.now() - workerStart);
          const label = `${fmtIndex}/${WORKER_FORMATS.length} ${format}/${scope}`;
          console.log(
            `[worker-lane] → ${label} (${Math.round((Date.now() - workerStart) / 1000)}s in, ` +
              `${Math.round(remaining / 1000)}s of budget left)`
          );
          if (remaining <= 5_000) {
            throw new Error(
              `worker-lane budget exhausted before ${label}\n[render tail]\n${render.tail()}`
            );
          }
          const fmtStart = Date.now();
          let job: { id: string; format: string; status: string; error?: string };
          try {
            job = await waitForJob(studioPort, format, Math.min(180_000, remaining), seenJobs);
          } catch (e) {
            throw new Error(
              `${label} never finished: ${e instanceof Error ? e.message : e}\n[render tail]\n${render.tail()}`
            );
          }
          console.log(`[worker-lane] ✓ ${label} in ${Math.round((Date.now() - fmtStart) / 1000)}s`);
          expect(`${format}: ${job.status} ${job.error ?? ''}`).toBe(`${format}: done `);
          // Bounded — a done job whose artifact download stalls must not hang
          // the whole test (it did, on the mp4 download, masking where the
          // NEXT format actually stood).
          const dl = await fetch(
            `http://localhost:${studioPort}/_api/export-jobs/download?id=${job.id}`,
            { signal: AbortSignal.timeout(60_000) }
          ).catch((e) => {
            throw new Error(
              `${label} download stalled: ${e instanceof Error ? e.message : e}\n[render tail]\n${render.tail()}`
            );
          });
          const bytes = new Uint8Array(await dl.arrayBuffer());
          const head4 = Array.from(bytes.slice(0, 4));
          if (format === 'pdf') {
            expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-');
            if (pdfPrint) {
              // The print path sets BleedBox + TrimBox INSIDE MediaBox and
              // draws the marks as vector content; a PDF that skipped it has
              // only a MediaBox. Read the page dict through pdf-lib — it writes
              // page objects into compressed object streams, so the keys are
              // not greppable in the raw bytes.
              const { PDFDocument, PDFName } = await import('pdf-lib');
              const doc = await PDFDocument.load(bytes);
              const page = doc.getPage(0);
              expect(page.node.get(PDFName.of('TrimBox'))).toBeDefined();
              expect(page.node.get(PDFName.of('BleedBox'))).toBeDefined();
              const media = page.getMediaBox();
              const trim = page.getTrimBox();
              // Trim strictly inside media — the bleed + marks slug is real.
              expect(trim.width).toBeLessThan(media.width);
              expect(trim.height).toBeLessThan(media.height);
            }
          } else if (format === 'png' && scope === 'canvas-as-separate') {
            // N artboards → one zip of PNGs; a single artboard → the bare PNG
            // (png.ts). The export fixture has one, so the bare form is right.
            expect(head4).toEqual([0x89, 0x50, 0x4e, 0x47]);
          } else if (format === 'png') {
            expect(head4).toEqual([0x89, 0x50, 0x4e, 0x47]);
          } else if (format === 'svg') {
            const svg = new TextDecoder().decode(bytes);
            // The worker runs the SAME capture spine the browser lane runs —
            // so it is held to the same artifact contract.
            expect(svg).not.toContain('dc-artboard-label');
            expect(svg).not.toContain('Board A');
            expect(svg.match(/(?:xlink:)?href="https?:\/\/[^"]+"/g) ?? []).toEqual([]);
            expect(svg).toContain('data:image/png');
          } else if (format === 'mp4') {
            // ISO BMFF — `ftyp` box at offset 4.
            expect(new TextDecoder().decode(bytes.slice(4, 8))).toBe('ftyp');
          } else if (format === 'webm') {
            // EBML header.
            expect(head4).toEqual([0x1a, 0x45, 0xdf, 0xa3]);
          } else if (format === 'gif') {
            expect(new TextDecoder().decode(bytes.slice(0, 4))).toBe('GIF8');
          } else if (format === 'html') {
            // A zip of pages — and each page must be SELF-CONTAINED: every
            // image embedded, no `<base>` pointing at the worker's throwaway
            // proxy origin (the cloud HTML export had no assets at all).
            expect(head4).toEqual([0x50, 0x4b, 0x03, 0x04]);
            const JSZip = (await import('jszip')).default;
            const zip = await JSZip.loadAsync(bytes);
            const pages = Object.keys(zip.files).filter((n) => n.endsWith('.html'));
            expect(pages.length).toBeGreaterThan(0);
            const html = await zip.file(pages[0] as string)?.async('string');
            expect(html).toBeDefined();
            expect(html as string).not.toContain('<base ');
            expect(html as string).toContain('data:image/png');
            expect((html as string).match(/src="https?:\/\/[^"]+"/g) ?? []).toEqual([]);
            expect((html as string).match(/src="\/\.design\/[^"]+"/g) ?? []).toEqual([]);
            // The CHROME ELEMENT is gone (a stylesheet rule naming the class
            // may legitimately remain — every rule is inlined).
            expect(html as string).not.toMatch(/<[a-z]+[^>]*class="[^"]*dc-artboard-label/);
            expect(html as string).not.toContain('Board A · export fixture');
          } else {
            // pptx IS a zip — PK\x03\x04.
            expect(head4).toEqual([0x50, 0x4b, 0x03, 0x04]);
          }
          // A `selection` of one <h1> is legitimately a tiny PNG; everything
          // else in this loop is a whole artboard or a container.
          expect(bytes.byteLength).toBeGreaterThan(scope === 'selection' ? 100 : 500);
          if (!viaDialog) continue;
          // Re-open the dialog for the next format (submitting closes it).
          await page.evaluate(() => {
            window.dispatchEvent(
              new KeyboardEvent('keydown', {
                key: 'E',
                metaKey: true,
                shiftKey: true,
                bubbles: true,
              })
            );
          });
          await page.waitForSelector('[data-testid="export-submit"]', { timeout: 15_000 });
        }
        // The <Audio>-from-'remotion' guard must refuse on the WORKER exactly as
        // it does on the desktop. It reads the canvas source, which the worker
        // does not have — so the cell resolves the finding and ships it in the
        // job. Before that, the worker ran the frame-step fallback ~40× slower
        // and delivered a MUTED file: the precise silent degrade the guard
        // exists to prevent (found hands-on on the local cell, 2026-08-23).
        await page.evaluate(() => {
          window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        });
        await page
          .waitForSelector('[data-testid="export-submit"]', { state: 'detached', timeout: 5_000 })
          .catch(() => {});
        await page.click('[data-testid="canvas-row-ui-e2e-video-audio"]', { timeout: 30_000 });
        await page.waitForSelector(
          '[data-testid="canvas-frame"][data-path$="e2e-video-audio.tsx"]',
          { timeout: 30_000 }
        );
        {
          const deadline = Date.now() + 15_000;
          for (;;) {
            const act = (await (await fetch(`http://localhost:${studioPort}/_active`)).json()) as {
              active?: string | null;
            };
            if ((act.active ?? '').endsWith('e2e-video-audio.tsx')) break;
            if (Date.now() > deadline)
              throw new Error('active canvas never became e2e-video-audio');
            await Bun.sleep(250);
          }
        }
        const r = await fetch(`http://localhost:${studioPort}/_api/export-jobs`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', origin: `http://localhost:${studioPort}` },
          body: JSON.stringify({
            format: 'mp4',
            scope: 'artboard',
            options: { artboardId: 'clip-audio' },
          }),
        });
        expect(r.status).toBe(202);
        console.error('[worker-lane] audio mp4 posted (202) — waiting for the refusal');
        const refused = await waitForJob(studioPort, 'mp4', 120_000, seenJobs);
        console.error(`[worker-lane] audio refusal seen: status=${refused.status}`);
        expect(refused.status).toBe('failed');
        expect(refused.error ?? '').toContain("mounts <Audio> from 'remotion'");
        // And the reason names the barrel, like the desktop message does.
        expect(refused.error ?? '').toContain('_audio-barrel');
        console.error('[worker-lane] all assertions passed — entering teardown');
      } finally {
        // Bound teardown: a Playwright browser.close() that hangs after a long
        // export batch must not turn a PASSED test into a 600s timeout. Race it
        // against a timer; the process exits regardless.
        await Promise.race([
          browser?.close().catch(() => {}) ?? Promise.resolve(),
          new Promise((r) => setTimeout(r, 10_000)),
        ]);
        render?.kill();
        killProc(proc);
        console.error('[worker-lane] teardown complete');
      }
    },
    { timeout: 600_000 }
  );
});

// ── PDF text modes against REAL Chromium output (issue #116) ─────────────────
//
// Every other gate for this feature reads hand-built pdf-lib fixtures, which
// prove how we CLASSIFY a font dictionary but say nothing about what Chromium
// actually emits. That gap is the whole bug: the classifier could be perfect
// and still never fire on a real export. So this drives the real adapter over
// a real print artboard and asserts on the delivered bytes.
describe('export E2E — PDF text modes over a real capture', () => {
  test(
    'keep / embed agree with the delivered bytes, and outline leaves no font behind',
    async () => {
      const box = makeExportSandbox();
      const port = nextPort();
      // Plain local lane (no MAUDE_WORKSPACE_MODE) so the real pdf adapter runs
      // in-process — this is the desktop/CLI path.
      const proc = await bootServer(box.root, port);
      try {
        const exportPdf = (text?: string) =>
          fetch(`http://localhost:${port}/_api/export`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              format: 'pdf',
              scope: 'artboard',
              options: {
                // `canvasFile` overrides the server's `_active.json` (scope.ts
                // readHints), so this needs no browser to set the active canvas
                // — the point here is the ADAPTER over a real capture, not the
                // shell's tab state, which the worker-lane test already drives.
                canvasFile: '.design/ui/e2e-print.tsx',
                artboardId: 'flyer',
                pdfPrint: { includeBleed: true, marks: { crop: true, registration: true } },
                ...(text ? { text } : {}),
              },
            }),
          });

        const { PDFDocument } = await import('pdf-lib');
        const { analyzePdfFonts } = await import('../exporters/pdf-fonts.ts');

        // 1. Default (`keep`) — a real PDF, and the preflight's verdict on real
        //    Chromium output must match what is actually in the file.
        const keepRes = await exportPdf();
        expect(keepRes.status).toBe(200);
        const keepBytes = new Uint8Array(await keepRes.arrayBuffer());
        expect(new TextDecoder().decode(keepBytes.slice(0, 5))).toBe('%PDF-');
        const fonts = analyzePdfFonts(await PDFDocument.load(keepBytes));
        console.error(
          `[pdf-text] Chromium emitted ${fonts.length} font(s): ${fonts
            .map((f) => `${f.name}=${f.kind}`)
            .join(', ')}`
        );
        // The fixture renders real text, so the capture must contain SOME font.
        // If this ever reads 0, the preflight has gone blind on real output —
        // exactly the failure a hand-built fixture cannot detect.
        expect(fonts.length).toBeGreaterThan(0);

        // 2. `embed` must AGREE with `keep`'s own analysis — refuse iff the
        //    delivered file genuinely carries an unprintable font. Asserting the
        //    agreement rather than a fixed outcome keeps this honest on a
        //    machine whose font stack differs from this one's.
        const unprintable = fonts.filter((f) => f.kind !== 'embedded');
        const embedRes = await exportPdf('embed');
        if (unprintable.length === 0) {
          expect(embedRes.status).toBe(200);
        } else {
          expect(embedRes.status).toBe(500);
          expect(await embedRes.text()).toContain(unprintable[0]?.name ?? '');
        }

        // 3. `outline` — gated on gs, since without it the correct behaviour is
        //    a refusal, which the unit test asserts.
        const { ghostscriptAvailable } = await import('../exporters/ghostscript.ts');
        if (await ghostscriptAvailable()) {
          const outRes = await exportPdf('outline');
          expect(outRes.status).toBe(200);
          const outDoc = await PDFDocument.load(new Uint8Array(await outRes.arrayBuffer()));
          // No fonts left to fail a printer's preflight…
          expect(analyzePdfFonts(outDoc)).toHaveLength(0);
          // …and the print geometry the same request asked for still survives
          // the Ghostscript rewrite (the risk of running this post-pass LAST).
          const page = outDoc.getPage(0);
          const media = page.getMediaBox();
          const trim = page.getTrimBox();
          expect(trim.width).toBeLessThan(media.width);
          expect(trim.height).toBeLessThan(media.height);
        } else {
          console.error('[pdf-text] no ghostscript — outline assertions skipped');
        }
      } finally {
        killProc(proc);
      }
    },
    { timeout: 300_000 }
  );
});
