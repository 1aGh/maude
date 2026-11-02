import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { g1 } from './fx3.mjs';
export const fixture = g1;
const D = '05';
export async function run(h) {
  const { page, sleep, project } = h;
  const fr = page.frameLocator('[data-testid="canvas-frame"]');
  await h.open('ui-two', 3500);
  await fr.locator('[data-dc-screen="desktop"] .dc-artboard-label').first().click({ button: 'right', timeout: 6000 });
  await sleep(700);
  await fr.getByText('Move to trash', { exact: false }).first().click({ timeout: 3000 }).catch((e) => console.log('trash fail', String(e.message).split('\n')[0]));
  await sleep(2500);
  await h.step(`${D}/es-all-trashed.one`, 'One artboard moved to the trash (the canvas still has Mobile)', 'right-click Desktop label › Move to trash', async () => {});
  // another person removes the rest: the canvas file keeps no artboard
  const f = join(project, '.design/ui/Two.tsx');
  writeFileSync(f, 'import { DesignCanvas, DCSection } from "@maude/canvas-lib";\nexport default function Two() {\n  return (\n    <DesignCanvas>\n      <DCSection id="s" title="Landing" />\n    </DesignCanvas>\n  );\n}\n');
  await sleep(4500);
  await h.step(`${D}/es-all-trashed`, 'Every artboard of the canvas is in the Trash', 'trash Desktop in the UI, then the canvas file is rewritten with no artboard (the last artboard cannot be trashed in the UI)', async () => {});
}
