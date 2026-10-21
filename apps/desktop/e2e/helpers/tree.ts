/**
 * The Files panel starts collapsed (issue #124): a folder or section row the
 * user never opened renders no children, so a `canvas-row-*` inside it does not
 * exist yet. Scenarios that open a canvas from the tree reveal it first, the way
 * a user would — by clicking the closed section headers and folder rows.
 */

const CLOSED =
  '[data-testid^="tree-section-"][aria-expanded="false"], [data-testid^="tree-folder-"][aria-expanded="false"]';

/** Open every closed section and folder in the Files panel (bounded passes). */
export async function expandTree(): Promise<void> {
  for (let pass = 0; pass < 12; pass++) {
    const clicked = await browser.execute((sel: string) => {
      const closed = Array.from(document.querySelectorAll<HTMLElement>(sel));
      for (const el of closed) el.click();
      return closed.length;
    }, CLOSED);
    if (!clicked) return;
    await browser.pause(150);
  }
}

/**
 * The default lane drives ONE app process through every spec, so the left dock stays on whatever tab
 * the last spec left it on (Layers, after an unlock). The Files rows only exist on the Files tab.
 */
export async function ensureFilesTab(): Promise<void> {
  // esbuild keepNames needs the shell window to carry `__name` (see helpers/sidecar.ts installNameShim)
  await browser.execute(() => {
    const w = window as unknown as { __name?: unknown };
    if (!w.__name) w.__name = (f: unknown) => f;
  });
  await browser.execute(() => {
    const tab = document.querySelector<HTMLElement>('[data-testid="panel-tab-tree"]');
    if (tab && tab.getAttribute('aria-selected') !== 'true') tab.click();
  });
}

/** A canvas row by its test id, revealed first. */
export async function canvasRow(testId: string) {
  const sel = `[data-testid="${testId}"]`;
  await browser.waitUntil(
    async () => {
      if (await $(sel).isExisting()) return true;
      await ensureFilesTab();
      await expandTree();
      return $(sel).isExisting();
    },
    { timeout: 30_000, timeoutMsg: `${testId} never appeared in the Files panel` }
  );
  return $(sel).getElement();
}

/**
 * A design system's pinned row in the Canvases panel (`canvases-ds-row`, one per system the project holds). The
 * Design system canvas has no row in the file tree: the project's `system/` group is the DESIGN SYSTEM group, so
 * its systems are drawn pinned above the canvases and a click on the row opens the system's canvas (`ds.go-to`).
 */
export async function dsRow(ds: string) {
  const sel = `[data-testid="canvases-ds-row"][data-ds="${ds}"]`;
  await browser.waitUntil(
    async () => {
      if (await $(sel).isExisting()) return true;
      await ensureFilesTab();
      return $(sel).isExisting();
    },
    { timeout: 60_000, timeoutMsg: `the pinned row for the ${ds} design system never appeared` }
  );
  return $(sel).getElement();
}
