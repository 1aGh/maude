import { rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { $, browser, expect } from '@wdio/globals';
import { capture, startReport } from '../helpers/evidence';
import { createFixtureGuard } from '../helpers/fixture-guard';
import { waitForSidecar } from '../helpers/sidecar';
import { canvasRow } from '../helpers/tree';

/**
 * feature-file-tree-drag-drop-folders — the WKWebView verification gate for
 * Task 8's drag & drop layer. Native WebDriver pointer actions do NOT
 * reliably synthesize a custom-MIME `DataTransfer` payload across engines
 * (measured on the canvas-text-editing scenario's same-origin work); the
 * SAME synthetic-DragEvent-dispatch approach used there is used here, via
 * `browser.execute` inside the top frame (the file tree lives in the main
 * shell, not the canvas iframe — no frame-switch needed, unlike canvas-side
 * scenarios).
 *
 * Flow: new folder via the header composer → the EMPTY dir row renders (the
 * Task 6/7 payoff — an mkdir with zero files would otherwise be invisible) →
 * drag the fixture canvas row onto it → the row reparents to the new slug →
 * the canvas still opens (proves every sidecar/slug re-key held, not just
 * the file move).
 *
 * Mutates the fixture project's tracked `.design/ui/` (creates a folder,
 * moves Smoke.tsx into it) — `after()` restores it byte-exact / folder-free
 * so the repo never dirties, mirroring canvas-text-editing.e2e.ts's pattern.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const DESIGN = join(HERE, '../fixtures/project/.design');
const UI_DIR = join(DESIGN, 'ui');
const ARCHIVE_DIR = join(UI_DIR, 'Archive');

// The move re-keys every VERSIONED file of the canvas, not only the source:
// `ui/Smoke.tsx` + `ui/Smoke.meta.json` move into Archive/, and the annotations
// board `ui-smoke.annotations.json` (versioned per DDR-115) is renamed to
// `ui-archive-smoke.annotations.json`. Restoring only the two moved files left
// the committed board deleted and an untracked copy behind. The guard snapshots
// all three before the run and puts them back byte-exact — also after a killed
// run (helpers/fixture-guard.ts).
const fixtures = createFixtureGuard('file-tree-move', [
  join(UI_DIR, 'Smoke.tsx'),
  join(UI_DIR, 'Smoke.meta.json'),
  join(DESIGN, 'ui-smoke.annotations.json'),
]);

describe('file-tree-move (native-desktop / WKWebView)', () => {
  before(() => {
    fixtures.snapshot();
    startReport('file-tree-move (native-desktop / WKWebView)');
  });

  after(() => {
    // Every re-keyed copy gone first — the folder we created, the moved board,
    // and the slug-keyed runtime state (gitignored; tidied for a clean re-run,
    // not because it would dirty git) — then the originals back byte-exact, so
    // the watcher never sees two Smoke canvases at once.
    rmSync(ARCHIVE_DIR, { recursive: true, force: true });
    for (const rel of [
      'ui-archive-smoke.annotations.json',
      '_history/ui-archive-smoke',
      '_canvas-state/ui-archive-smoke.view.json',
      '_state/ui-archive-smoke.ydoc.bin',
    ]) {
      rmSync(join(DESIGN, rel), { recursive: true, force: true });
    }
    fixtures.restore();
  });

  it('new folder → drag canvas onto it → row reparents → canvas still opens', async () => {
    await browser.setTimeout({ script: 60_000 });
    await waitForSidecar();

    const list = await $('[data-testid="canvas-list"]');
    await list.waitForDisplayed({ timeout: 120_000 });
    const smokeRow = await canvasRow('canvas-row-ui-smoke');
    await smokeRow.waitForDisplayed({ timeout: 30_000 });
    await capture('booted-with-smoke-canvas');

    // 1 — new folder via the header composer.
    const newFolderBtn = await $('[data-testid="tree-new-folder"]');
    await newFolderBtn.waitForDisplayed({ timeout: 10_000 });
    await newFolderBtn.click();
    const nameInput = await $('[aria-label="New folder name"]');
    await nameInput.waitForDisplayed({ timeout: 5_000 });
    await nameInput.setValue('Archive');
    await browser.keys(['Enter']);

    // 2 — the EMPTY dir row renders (Task 6/7's payoff).
    const folderRow = await $('[data-testid="tree-folder-ui-archive"]');
    await folderRow.waitForDisplayed({ timeout: 15_000 });
    await capture('empty-folder-row-rendered');

    // 3 — drag the canvas row onto the folder row (synthetic DragEvent
    // dispatch — see the file-level comment for why not native pointer drag).
    //
    // No named function inside this callback. The spec is transpiled by tsx
    // with esbuild `keepNames`, which rewrites `const fire = (…) => …` into
    // `const fire = __name((…) => …, "fire")`; the callback is then serialized
    // into the webview, where `__name` does not exist — the script threw
    // ReferenceError before dispatching a single event ("A JavaScript exception
    // occurred when running execute/async"). A loop over [type, element] pairs
    // has nothing for esbuild to name.
    const dragResult = await browser.execute(() => {
      const src = document.querySelector('[data-testid="canvas-row-ui-smoke"]');
      const dest = document.querySelector('[data-testid="tree-folder-ui-archive"]');
      if (!src || !dest) return { ok: false, hasSrc: !!src, hasDest: !!dest };
      const dt = new DataTransfer();
      const steps: Array<[string, Element]> = [
        ['dragstart', src],
        ['dragenter', dest],
        ['dragover', dest],
        ['drop', dest],
        ['dragend', src],
      ];
      for (const [type, el] of steps) {
        el.dispatchEvent(
          new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt })
        );
      }
      return { ok: true };
    });
    expect(dragResult.ok).toBe(true);

    // 4 — the row reparents to the new slug; the old testid is gone.
    const movedRow = await canvasRow('canvas-row-ui-archive-smoke');
    await movedRow.waitForDisplayed({ timeout: 15_000 });
    expect(await $('[data-testid="canvas-row-ui-smoke"]').isExisting()).toBe(false);
    await capture('row-reparented-under-archive');

    // 5 — the canvas still opens (proves the primary + every sidecar re-key
    // held, not just the bare file move) — mirrors app-boots-and-renders-canvas's
    // canvas-frame assertion.
    await movedRow.click();
    const frame = await $('[data-testid="canvas-frame"]');
    await frame.waitForExist({ timeout: 20_000 });
    await capture('reparented-canvas-opens');
  });
});
