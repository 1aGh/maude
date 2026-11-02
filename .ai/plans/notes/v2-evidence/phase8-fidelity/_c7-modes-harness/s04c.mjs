import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { studio } from './fx4.mjs';
export const fixture = studio;
export const page = { w: 1440, h: 900, channel: true };
const D = '04-modes';
// 04 md-edge-ai: Preview a canvas while something else (a terminal agent) writes it: the artboard being previewed
// wears the file-write rim, its tag and the AI's pointer (+ AI), live, while Preview stays put
export async function run(h) {
  const { page, sleep } = h;
  await h.open('ui-combine-kampan', 3500);
  await page.mouse.click(780, 138);
  await sleep(500);
  await h.click('palette-mode-preview');
  await sleep(2500);
  const file = join(h.project, '.design/ui/Combine-kampan.tsx');
  const src = readFileSync(file, 'utf8');
  writeFileSync(file, src.replace('COMBINE 2026', 'COMBINE 2026 ').replace(/\n$/, '') + '\n');
  const t0 = Date.now();
  while (Date.now() - t0 < 9000) {
    let seen = 0;
    for (const fr of page.frames()) if (fr !== page.mainFrame()) seen += await fr.locator('.dc-activity-ptr').count().catch(() => 0);
    if (seen) break;
    await sleep(30);
  }
  await h.step(`${D}/md-edge-ai`, 'The artboard being previewed changes live: rim, tag and the AI pointer', 'Preview, then the file is written under it', async () => {}, { now: true });
  await sleep(2500);
  await h.step(`${D}/md-edge-ai-after`, 'after the change landed, still previewing', '+2.5 s', async () => {}, { now: true });
}
