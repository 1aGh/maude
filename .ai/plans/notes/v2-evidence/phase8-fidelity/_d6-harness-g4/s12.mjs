import { photos } from './fx.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
export const fixture = photos;
const D = '12-import-and-assets';

export async function prepare(project) {
  // an artboard whose picture is not on this Mac and on no other (ia-missing-gone), beside a normal one
  const ui = join(project, '.design/ui');
  writeFileSync(
    join(ui, 'Gone.tsx'),
    `import { DCArtboard, DCSection, DesignCanvas } from "@maude/canvas-lib";
export default function G() {
  return (
    <DesignCanvas>
      <DCSection id="g" title="Gone">
        <DCArtboard id="g1" label="Hero" width={480} height={320}>
          <img data-cd-id="photo" src="assets/Nowhere-1.jpg" alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        </DCArtboard>
      </DCSection>
    </DesignCanvas>
  );
}
`
  );
}

export async function run(h) {
  const { page, sleep } = h;
  const palette = async (q) => {
    await page.keyboard.press('Meta+k');
    await sleep(500);
    await page.keyboard.type(q);
    await sleep(600);
    await page.keyboard.press('Enter');
    await sleep(1500);
  };
  await h.open('ui-photos', 2500);
  await h.step('ia-assets-panel', D, 'left panel › Assets tab', async () => { await h.click('panel-tab-assets'); });
  await h.step('ia-assets-keys', D, 'click a tile (select; ↵ places)', async () => {
    await page.locator('[data-testid="assets-tile"]').nth(2).click();
    await sleep(500);
  });
  await h.step('ia-asset-details', D, 'right-click a tile › Show details', async () => {
    await page.locator('[data-testid="assets-tile"]').nth(2).click({ button: 'right' });
    await sleep(500);
    await h.click('assets-menu-details');
    await sleep(800);
  });
  await h.step('ia-advanced', D, 'asset details › Advanced fold (how the file is stored)', async () => {
    await h.click('assets-details-advanced').catch(() => {});
  });
  await h.click('assets-details-close').catch(() => {});
  await h.step('ia-assets-find', D, 'type "Match" in the Assets search', async () => {
    await h.tid('assets-search').click();
    await page.keyboard.type('Match');
    await sleep(700);
  });
  await h.tid('assets-search').click(); await page.keyboard.press('Meta+a'); await page.keyboard.press('Backspace'); await sleep(600);
  await h.step('ia-assets-browse', D, 'click the Photos group heading (wide view)', async () => {
    await h.click('assets-group-image');
    await sleep(900);
  });
  await h.click('assets-browse-back').catch(() => {});
  await h.step('ia-assets-tidy', D, '"Not used" chip', async () => { await h.click('assets-chip-notused'); });
  await h.click('assets-chip-notused').catch(() => {});
  await h.click('panel-tab-tree').catch(() => {});
  await h.step('ia-photo-inspector', D, 'click the photo on the artboard', async () => {
    await page.mouse.click(900, 460);
    await sleep(1000);
  });
  await h.step('ia-photo-steps', D, 'inspector › Photo tab', async () => {
    await page.getByRole('tab', { name: /photo/i }).first().click().catch(() => {});
    await sleep(800);
  });
  await h.esc(2);
  // missing picture: the artboard's image is on no device
  await h.open('ui-gone', 3000);
  await h.step('ia-missing-gone', D, 'artboard references assets/Nowhere-1.jpg (absent)', async () => {});
  await h.open('ui-photos', 2500);
  await h.step('ia-gen-ask', D, '⌘K › Generate with AI…', async () => { await palette('Generate'); });
  await h.esc(3);
  await h.step('ia-figma-sheets', D, '⌘K › Import from Figma…', async () => { await palette('Figma'); });
  await h.esc(3);
  await h.step('ia-brand-steps', D, '⌘K › Import a brand', async () => { await palette('brand'); });
  await h.esc(3);
  // finder drop (synthetic dragenter/dragover with 6 files on the artboard) — the browser lane has no native drag-drop
  await h.open('ui-photos', 2500);
  await h.click('panel-tab-assets').catch(() => {});
  await h.step('ia-drop-photos', D, 'SYNTHETIC dragenter+dragover with a DataTransfer of files on the artboard (browser lane: no Tauri file-drop events)', async () => {
    const fr = page.frameLocator('[data-testid="canvas-frame"]');
    const ab = fr.locator('[data-dc-screen]').first();
    const handle = await ab.evaluateHandle(() => {
      const dt = new DataTransfer();
      for (let i = 0; i < 6; i++) dt.items.add(new File(['x'], `IMG_22${30 + i}.jpg`, { type: 'image/jpeg' }));
      return dt;
    });
    await ab.dispatchEvent('dragenter', { dataTransfer: handle });
    await ab.dispatchEvent('dragover', { dataTransfer: handle });
    await sleep(800);
  });
  await page.reload();
  await sleep(3500);
  await h.open('ui-photos', 2500);
  if (!(await page.locator('[data-testid="assets-panel"]').count())) {
    if (!(await page.locator('[data-testid="panel-tab-assets"]').count())) { await h.click('panel-icon-left').catch(() => {}); await sleep(600); }
    await h.click('panel-tab-assets').catch(() => {});
    await sleep(800);
  }
  await h.step('ia-placed', D, 'Assets › + (assets-add) › file chooser with 6 files (upload into the project; placing on the artboard needs the native drop)', async () => {
    const p = page.waitForEvent('filechooser', { timeout: 6000 }).catch(() => null);
    await page.locator('[data-testid="assets-add"]').first().click({ timeout: 6000 });
    const fc = await p;
    if (!fc) throw new Error('no filechooser');
    const as = join(h.project, '.design/assets');
    await fc.setFiles(['IMG_2231', 'IMG_2232', 'IMG_2240', 'Matchday-02', 'Matchday-03', 'Team-photo'].map((n) => join(as, n + '.jpg')));
    await sleep(1500);
  }, { notice: true });
}
