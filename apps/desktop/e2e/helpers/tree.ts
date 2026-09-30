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

/** A canvas row by its test id, revealed first. */
export async function canvasRow(testId: string) {
  const sel = `[data-testid="${testId}"]`;
  await browser.waitUntil(
    async () => {
      if (await $(sel).isExisting()) return true;
      await expandTree();
      return $(sel).isExisting();
    },
    { timeout: 30_000, timeoutMsg: `${testId} never appeared in the Files panel` }
  );
  return $(sel).getElement();
}
