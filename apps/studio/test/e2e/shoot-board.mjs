// Visual parity helper (not a test): screenshot the fixture board with the
// studio at STUDIO_DIR, so two renderers can be compared by eye.
//
//   node apps/studio/test/e2e/shoot-board.mjs <out.png>
//   STUDIO_DIR=<other checkout>/apps/studio node apps/studio/test/e2e/shoot-board.mjs <out.png>

import { REPORT_BOARD } from './fixtures.mjs';
import { makeProjectFor, openCanvas, sleep, startServer } from './harness.mjs';

const out = process.argv[2];
if (!out) {
  console.error('usage: shoot-board.mjs <out.png>');
  process.exit(2);
}
const server = await startServer(await makeProjectFor(REPORT_BOARD));
const c = await openCanvas(server);
try {
  await sleep(800);
  const frame = await c.page.locator('[data-testid="canvas-frame"]').boundingBox();
  await c.page.screenshot({ path: out, clip: frame ?? undefined });
  console.log(out);
} finally {
  await c.close();
  server.stop();
}
