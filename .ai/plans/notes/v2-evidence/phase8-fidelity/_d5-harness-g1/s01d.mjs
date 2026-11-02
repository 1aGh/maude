import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { base } from './fx.mjs';
export const fixture = base;
const D = '01';
export async function run(h) {
  const { page, sleep, project } = h;
  await h.open('ui-smoke', 3500);
  await page.mouse.click(1000, 200);
  await sleep(1500);
  const f = join(project, '.design/ui/Smoke.tsx');
  const src = readFileSync(f, 'utf8');
  writeFileSync(f, src.replace('export default function Smoke() {', 'export default function Smoke() {\n  throw new Error("headline is not defined");'));
  await sleep(4500);
  await h.step(`${D}/cf-render-error.last-good`, 'A canvas that stops drawing after an edit', 'open Smoke, then an edit that compiles but throws while it draws (c7: the render card with Go back)', async () => {});
}
