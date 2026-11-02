import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { photos2 } from './fx2.mjs';
export const fixture = photos2;
export const page = { tauri: false };
const D = '12-import-and-assets';

export async function prepare(project) {
  writeFileSync(
    join(project, '.design/ui/Gone.tsx'),
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
  const only = (process.env.ONLY || '').split(',').filter(Boolean);
  const want = (id) => !only.length || only.includes(id);
  const openAssets = async () => {
    if (!(await page.locator('[data-testid="assets-panel"]').count())) {
      if (!(await page.locator('[data-testid="panel-tab-assets"]').count())) { await h.click('panel-icon-left').catch(() => {}); await sleep(600); }
      await h.click('panel-tab-assets').catch(() => {});
      await sleep(900);
    }
  };
  // ── ia-assets-keys: an artboard is selected; a right-click on a tile opens the tile menu ──
  if (want('ia-assets-keys')) {
    await h.open('ui-photos', 3500);
    await page.mouse.click(900, 460); // the artboard
    await sleep(900);
    await openAssets();
    await h.step('ia-assets-keys', D, 'artboard selected; right-click a tile in Assets (the tile menu: Place in <artboard> ↵ · Show details · Rename… · Copy · Move to trash)', async () => {
      await page.locator('[data-testid="assets-tile"]').nth(2).click({ button: 'right' });
      await sleep(500);
      await page.mouse.move(330, 274); // off the tile (its tooltip) onto the menu's first row
      await sleep(400);
    });
    await h.esc(2);
  }
  // ── ia-assets-browse: Photos group heading → ⇧-click six tiles → the selection foot ──
  if (want('ia-assets-browse')) {
    await h.open('ui-photos', 3500);
    await page.mouse.click(900, 460);
    await sleep(900);
    await openAssets();
    await h.click('assets-group-image');
    await sleep(1200);
    const tiles = page.locator('[data-testid="assets-browse"] [data-testid="assets-tile"]');
    await tiles.nth(0).click();
    await sleep(300);
    await tiles.nth(5).click({ modifiers: ['Shift'] });
    await sleep(700);
    await h.step('ia-assets-browse', D, 'Photos heading (wide view); click a tile, ⇧-click the sixth (six picked) → "6 selected · size · Clear · Place 6 in <artboard>"', async () => {});
    await h.click('assets-browse-back').catch(() => {});
    await h.esc(2);
  }
  // ── ia-assets-tidy: the Not used chip ──
  if (want('ia-assets-tidy')) {
    await h.open('ui-photos', 3500);
    await openAssets();
    await h.step('ia-assets-tidy', D, '"Not used" chip', async () => { await h.click('assets-chip-notused'); });
    await h.click('assets-chip-notused').catch(() => {});
  }
  // ── ia-photo-inspector / ia-photo-steps (crop): ⌘-click the photo ──
  if (want('ia-photo-inspector') || want('ia-photo-steps')) {
    await h.open('ui-photos', 3500);
    await page.keyboard.down('Meta');
    await page.mouse.click(900, 460);
    await page.keyboard.up('Meta');
    await sleep(1800);
    await h.step('ia-photo-inspector', D, 'fixture photo named assets/<sha8>.jpg; ⌘-click the photo (deep select): Photo tab = Placement · Look · Light · Colour', async () => {
      const t = page.getByRole('tab', { name: /photo/i }).first();
      if (await t.count()) await t.click().catch(() => {});
      const t2 = page.getByRole('button', { name: /^Photo$/ }).first();
      if (await t2.count()) await t2.click().catch(() => {});
      await sleep(1200);
    });
    // the crop step: Placement › Crop (the file is written, the canvas re-reads), select the photo again, then double-click it
    // (crop mode: the whole photo faded beyond the frame)
    const center = async () => {
      const b = await page.frameLocator('[data-testid="canvas-frame"]').locator('[data-dc-screen]').first().boundingBox();
      return b ? { x: b.x + b.width / 2, y: b.y + b.height / 2 } : { x: 900, y: 460 };
    };
    const crop = page.locator('[data-testid="photo-placement"] button', { hasText: 'Crop' }).first();
    if (await crop.count()) await crop.click().catch(() => {});
    await sleep(3500);
    let c = await center();
    await page.keyboard.down('Meta');
    await page.mouse.click(c.x, c.y);
    await page.keyboard.up('Meta');
    await sleep(1500);
    for (const loc of [page.getByRole('tab', { name: /photo/i }).first(), page.getByRole('button', { name: /^Photo$/ }).first()]) {
      if (await loc.count()) await loc.click().catch(() => {});
    }
    await sleep(900);
    await h.step('ia-photo-steps', D, 'Photo tab › Placement › Crop, then double-click the photo → crop mode + "The whole photo stays — only the frame moves."', async () => {
      c = await center();
      await page.mouse.dblclick(c.x, c.y);
      await sleep(1500);
    });
    await h.esc(3);
  }
  // ── ia-missing-gone: the missing frame selected, the inspector's Missing box ──
  if (want('ia-missing-gone')) {
    await h.open('ui-gone', 3500);
    // the picture inside the missing frame (the shell's own select-by-id lane, like a Layers click)
    await page.evaluate(() => {
      const f = document.querySelector('[data-testid="canvas-frame"]');
      f?.contentWindow?.postMessage({ dgn: 'select-by-id', id: 'photo', artboardId: 'g1', index: 0 }, '*');
    });
    await sleep(1800);
    await h.step('ia-missing-gone', D, 'artboard references assets/Nowhere-1.jpg (absent); ⌘-click the frame: the inspector Missing box (Relink… · Replace…)', async () => {});
  }
}
