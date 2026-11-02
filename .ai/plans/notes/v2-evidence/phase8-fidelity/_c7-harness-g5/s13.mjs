import { cpSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { REPO } from './lib.mjs';
import { stubClaudeEnv } from '../scripts/lib/stub-claude.mjs';
import { kit } from './g5.mjs';
import { empty } from './fx.mjs';
import { makeSite } from './fx5.mjs';
export const fixture = async () => (process.env.G === 'd' ? empty() : process.env.G === 'g' ? makeSite({ key: 'unconv', systems: ['maude-v2', 'maude'], canvases: ['Homepage', 'Landing'] }) : join(REPO, '.scr/fx-cache/ds-converted'));
export const keepState = true;
// c7: ds-multi-switch / ds-many-switch need canvases that FOLLOW a system (a stamped `designSystem` in their meta) —
// without it the sheet reads "Follows no system yet" on every row and nothing can switch.
export async function prepare(project) {
  if (G === 'h') {
    // c7: ds-edit-instance needs a real component INSTANCE (a `@maude/ds` Button), not a plain <button>
    const { writeFileSync: w, readFileSync: r } = await import('node:fs');
    const f = join(project, '.design/ui/Pricing.tsx');
    let src = r(f, 'utf8');
    src = src.replace(/<button data-cd-id="buy"[^>]*>Buy<\/button>/, '<Button data-cd-id="buy">Buy</Button>');
    src = `import { Button } from "@maude/ds";\n${src}`;
    w(f, src);
    return;
  }
  if (G !== 'e') return;
  const { writeFileSync: w, existsSync: ex, readFileSync: r } = await import('node:fs');
  for (const n of ['Homepage', 'Landing', 'Pricing', 'Combine-kampan']) {
    const f = join(project, '.design/ui', `${n}.meta.json`);
    const j = ex(f) ? JSON.parse(r(f, 'utf8')) : {};
    w(f, JSON.stringify({ ...j, designSystem: 'maude-v2' }, null, 2));
  }
}
export const page = { w: 1440, h: 900 };
const D = '13-design-system';
const G = process.env.G || 'a';
export async function run(h) {
  const { page, sleep, project, scratch } = h;
  const k = kit(h);
  const home = join(scratch, 'home');
  const env = { ...process.env, HOME: home, XDG_CONFIG_HOME: join(home, 'xdg'), NO_OPEN: '1', MAUDE_NO_AUTOBUILD: '1', ...stubClaudeEnv(home) };
  const ds = (args) => {
    let r;
    for (let i = 0; i < 6; i++) {
      r = spawnSync('bun', [join(REPO, 'apps/studio/bin/_ds.mjs'), ...args, '--root', project], { env, encoding: 'utf8' });
      console.log('ds', args.join(' '), r.status, (r.stderr || '').slice(0, 300));
      if (r.status !== 3 || !/unavailable/.test(r.stderr || '')) break; // D3: the kernel is not up yet — try again
      spawnSync('sleep', ['3']);
    }
    return r;
  };
  const dsFile = (name, obj) => { const f = join(project, '.design', name); writeFileSync(f, JSON.stringify(obj)); return f; };
  const open = async (slug, ms = 5000) => {
    await h.open(slug, ms);
    // D3: a design-system board is a big canvas — wait for it instead of shooting its "Opening…" card
    if (/^system-/.test(slug)) await fr.locator('[data-dc-screen]').first().waitFor({ timeout: 60000 }).catch(() => {});
    await sleep(1500);
  };
  const fr = k.fr;
  // c7: the sheets' rows wear their canvas's cover, which the thumbnail service renders at background priority
  // (alphabetically, system previews first) — wait until the four ui canvases have theirs
  const waitCovers = async (max = 240000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < max) {
      const n = await page.evaluate(async () => { try { const j = await (await fetch('/_api/index', { cache: 'no-store' })).json(); return j.canvases.filter((c) => /^ui\//.test(c.rel) && c.cover).length; } catch { return 0; } });
      if (n >= 4) break;
      await sleep(2500);
    }
    await sleep(1500);
  };
  const dsBoard = 'system-maude-v2-design-system';
  const zoomColour = async () => {
    await fr.locator('.dc-artboard-label', { hasText: 'Colour' }).first().click().catch(() => {}); await sleep(600);
    await page.keyboard.press('Shift+2'); await sleep(1500);
  };
  if (G === 'a') {
    await open('ui-homepage', 3500);
    if (!(await page.locator('[data-testid="canvases-pinned"]').first().isVisible().catch(() => false))) { await page.locator('[data-testid="panel-icon-left"]').first().click().catch(() => {}); await sleep(900); }
    await h.step(`${D}/ds-where-studio`, 'The Design system row, pinned above every canvas; the inspector names the system', 'open Homepage, panel on, select the artboard, inspector on', async () => {
      await k.label('desktop'); await k.inspector(true);
      // D3: the inspector folds the panel at this width — open the panel again so the pinned row shows with the inspector
      if (!(await page.locator('[data-testid="canvases-pinned"]').first().isVisible().catch(() => false))) { await page.locator('[data-testid="panel-icon-left"]').first().click().catch(() => {}); await sleep(900); }
    });
    await h.esc(2);
    await h.step(`${D}/ds-where-gator`, '⌘K “design system”', '⌘K, type “design system”', async () => {
      await page.keyboard.press('Meta+k'); await sleep(500); await page.keyboard.type('design system'); await sleep(900);
    });
    await h.esc(2);
    await open(dsBoard, 6000);
    await h.step(`${D}/ds-board-studio`, 'The Design system canvas', 'open the pinned Design system row', async () => {});
    await h.step(`${D}/ds-board-dark`, 'The same system in Dark', 'bar › Dark', async () => {
      await fr.locator('[data-testid="ds-bar-mode-dark"]').first().click().catch(() => {}); await sleep(1500);
    });
    await fr.locator('[data-testid="ds-bar-mode-light"]').first().click().catch(() => {}); await sleep(800);
    await h.step(`${D}/ds-edit-colour`, 'Select a swatch, edit the colour', 'fold panels, inspector on, select the Accent swatch', async () => {
      await k.fold(); await k.inspector(true);
      await k.deep('[data-ds-token="--accent"]', 2); await sleep(1400);
    });
    await h.esc(2);
    await h.step(`${D}/ds-advanced`, 'Design system › Advanced', 'Canvases › Advanced', async () => {
      await page.locator('[data-testid="panel-icon-left"]').first().click().catch(() => {}); await sleep(500);
      await h.click('canvases-advanced').catch(() => {}); await sleep(800);
    });
  }
  if (G === 'b') {
    await sleep(4000);
    ds(['pending', 'maude-v2', '--set', dsFile('_p1.json', { tokens: { '--accent': { light: 'oklch(0.50 0.19 255)', dark: 'oklch(0.62 0.17 255)' } } })]);
    await open(dsBoard, 6000);
    await h.step(`${D}/ds-edit-colour-pending`, 'A colour edit waiting for review', 'ds pending, open the board', async () => {});
    await k.fold(); await k.inspector(true);
    await k.deep('[data-ds-token="--accent"]', 2).catch(() => {}); await sleep(1200);
    await h.step(`${D}/ds-edit-reach`, 'One colour, everywhere it lands — Show', 'inspector › Show', async () => {
      await h.click('ds-token-show').catch(() => {}); await sleep(3000);
    });
    await h.esc(2);
    await h.step(`${D}/ds-edit-review`, 'Update canvases — tick who follows', 'bar › Update canvases', async () => {
      await fr.locator('[data-testid="ds-bar-review"]').first().click().catch(() => {}); await waitCovers();
    });
  }
  if (G === 'c') {
    await sleep(4000);
    await open(dsBoard, 6000);
    const css = join(project, '.design/system/maude-v2/colors_and_type.css');
    const text = readFileSync(css, 'utf8');
    writeFileSync(css, text.replace('--accent:        oklch(0.53 0.175 238);', '--accent:        oklch(0.50 0.19 250);').replace('--bg-1: oklch(0.995 0.002 240);', '--bg-1: oklch(0.99 0.004 240);'));
    await sleep(9000);
    // C6: the card lives in the inspector's empty place — open it (nothing selected) and let the 6 s poll land
    await k.inspector(true); await sleep(8000);
    // c7: the board frames the Colour section at ~48 % so the "Changed outside" tags read (a wheel zoom keeps the selection empty)
    await page.keyboard.down('Control'); await page.mouse.move(620, 200); await page.mouse.wheel(0, -500); await page.keyboard.up('Control'); await sleep(900);
    await page.mouse.move(1000, 560); await sleep(500);
    await h.step(`${D}/ds-truth-outside`, 'Tokens changed outside the app (a file edit)', 'edit colors_and_type.css on disk while the board is open, inspector on', async () => {});
    ds(['keep', 'maude-v2']);
    await sleep(1500);
    ds(['pending', 'maude-v2', '--set', dsFile('_p2.json', { tokens: { '--accent': { light: 'oklch(0.55 0.2 20)', dark: 'oklch(0.65 0.18 20)' } } })]);
    writeFileSync(css, readFileSync(css, 'utf8').replace(/--accent:\s+oklch\([^)]*\);/, '--accent:        oklch(0.45 0.15 150);'));
    await sleep(9000);
    await h.step(`${D}/ds-truth-conflict`, 'You and the file changed the same token', 'pending edit + a different file edit of the same token', async () => {});
  }
  if (G === 'd') {
    await h.step(`${D}/ds-make-entry`, 'A project with no design system', 'empty project, Canvases panel', async () => {});
    await h.step(`${D}/ds-make-inputs`, 'Make a design system — three quick inputs', 'Canvases › Make a design system', async () => {
      await h.click('canvases-advanced').catch(() => {}); await sleep(700); // D3: the door sits under Canvases > Advanced
      await h.click('canvases-ds-make').catch(() => {}); await sleep(1200);
    });
    await h.step(`${D}/ds-make-sentence`, 'The sentence typed', 'type a sentence', async () => {
      await page.locator('[data-testid="ds-make-sentence"]').first().fill('Friendly football club, bold green and white').catch(() => {}); await sleep(500);
    });
    await h.esc(2);
    ds(['make', 'club', '--label', 'Club']);
    await sleep(2500);
    await open('system-club-design-system', 5000).catch(() => {});
    await h.step(`${D}/ds-make-filling`, 'The Design system as an outline — before anything is drawn', 'ds make club, open the new canvas', async () => {});
    const dir = (x, acc, bg) => dsFile('_d' + x + '.json', { label: 'Direction ' + x.toUpperCase(), tokens: { '--accent': acc, '--bg-1': bg, '--fg-0': { light: 'oklch(0.2 0.02 250)', dark: 'oklch(0.96 0.01 250)' } } });
    ds(['draft', 'club', '--direction', 'a', '--tokens', dir('a', { light: 'oklch(0.5 0.15 150)', dark: 'oklch(0.65 0.15 150)' }, { light: 'oklch(0.98 0.01 150)', dark: 'oklch(0.2 0.03 150)' })]);
    ds(['draft', 'club', '--direction', 'b', '--tokens', dir('b', { light: 'oklch(0.55 0.2 30)', dark: 'oklch(0.7 0.18 30)' }, { light: 'oklch(0.97 0.02 80)', dark: 'oklch(0.22 0.03 60)' })]);
    ds(['draft', 'club', '--direction', 'c', '--tokens', dir('c', { light: 'oklch(0.5 0.2 270)', dark: 'oklch(0.7 0.17 270)' }, { light: 'oklch(0.98 0.005 270)', dark: 'oklch(0.2 0.03 270)' })]);
    await sleep(4000);
    await h.step(`${D}/ds-make-directions`, 'Three directions on the Design system canvas', 'ds draft ×3', async () => {});
    ds(['mix', 'club', 'a', '--take', 'colour=b']);
    await sleep(3000);
    await h.step(`${D}/ds-make-mix`, 'Pick one, or mix', 'ds mix a with colour from b, select Direction A', async () => {
      await fr.locator('.dc-artboard-label', { hasText: 'Direction A' }).first().click().catch(() => {}); await sleep(700);
      await k.inspector(true); await sleep(1200);
    });
    ds(['use', 'club', 'a']);
    await sleep(2500);
    ds(['done', 'club']);
    await sleep(4000);
    await h.step(`${D}/ds-make-done`, 'Ready — use it as the project style', 'ds use a, ds done', async () => {});
  }
  if (G === 'e') {
    await page.locator('[data-testid="canvas-row-ui-homepage"]').first().waitFor({ timeout: 25000 }).catch(() => {});
    await open('ui-homepage', 3500);
    if (!(await page.locator('[data-testid="canvases-pinned"]').first().isVisible().catch(() => false))) { await page.locator('[data-testid="panel-icon-left"]').first().click().catch(() => {}); await sleep(900); }
    await k.inspector(true); await sleep(500); if (!(await page.locator('[data-testid="canvases-pinned"]').first().isVisible().catch(() => false))) { await page.locator('[data-testid="panel-icon-left"]').first().click().catch(() => {}); await sleep(900); }
    await h.step(`${D}/ds-multi-panel`, 'Two systems in use, pinned together', 'Canvases panel, pinned strip', async () => {});
    await h.step(`${D}/ds-multi-menu`, 'A system’s own menu', 'pinned row ⋯', async () => {
      await page.evaluate(() => { const m = document.querySelectorAll('[data-testid="canvases-ds-row-menu"]'); (m[m.length - 1])?.click(); }); await sleep(900);
    });
    await h.step(`${D}/ds-multi-switch`, 'Move canvases to another system — one review', 'menu › Switch canvases to another system', async () => {
      await page.getByRole('menuitem', { name: /Switch canvases to another system/ }).first().click().catch(() => {}); await waitCovers();
    });
    await h.esc(2);
    await page.evaluate(() => { const m = document.querySelectorAll('[data-testid="canvases-ds-row-menu"]'); (m[m.length - 1])?.click(); }); await sleep(700);
    await h.step(`${D}/ds-many-switch`, 'Preview the project in another system', 'menu › Preview in…', async () => {
      await page.getByRole('menuitem', { name: /Preview in/ }).first().click().catch(() => {}); await sleep(2500);
    });
  }
  if (G === 'f') {
    await sleep(4000);
    ds(['pending', 'maude-v2', '--set', dsFile('_p3.json', { tokens: { '--fg-2': { light: 'oklch(0.72 0.01 250)', dark: 'oklch(0.55 0.01 250)' } } })]);
    await open(dsBoard, 6000);
    await k.fold(); await k.inspector(true);
    await h.step(`${D}/ds-edge-contrast`, 'A change that breaks contrast', 'pending a too-light Text 3, open the board', async () => {
      await k.deep('[data-ds-token="--fg-2"]', 2).catch(() => {}); await sleep(1500);
    });
    await h.esc(2);
    ds(['pending', 'maude-v2', '--cancel']);
    await sleep(2500);
    await h.step(`${D}/ds-edge-trash`, 'Move a colour to the trash — the question', 'select --object-coral, Advanced › Move to the trash', async () => {
      console.log('coral swatches', await fr.locator('[data-ds-token="--palette-4"]').count());
      await k.deep('[data-ds-token="--palette-4"]', 2).catch((e) => console.log('deep fail', String(e.message).slice(0, 120))); await sleep(1500);
      console.log('trash btn', await page.locator('[data-testid="ds-token-trash"]').count(), 'title', await page.locator('[data-testid="inspector-title"]').first().textContent().catch(() => '-'));
      await h.click('ds-token-trash').catch((e) => console.log('click fail', String(e.message).slice(0, 120))); await sleep(1500);
    });
    await h.esc(2);
    ds(['trash', 'maude-v2', '--object-coral', '--replacement', '--object-yellow']);
    await sleep(4000);
    await h.step(`${D}/ds-edge-trash-board`, 'The board after the trash', 'board', async () => {});
  }
  if (G === 'g') {
    await open('ui-homepage', 3500);
    if (!(await page.locator('[data-testid="canvases-pinned"]').first().isVisible().catch(() => false))) { await page.locator('[data-testid="panel-icon-left"]').first().click().catch(() => {}); await sleep(900); }
    await h.step(`${D}/ds-multi-migrate`, 'System folders not yet on a Design system canvas', 'unconverted project: Canvases panel', async () => {});
    await h.step(`${D}/ds-edge-migrate`, 'Convert — one folder, up close', 'Convert affordance', async () => {
      if (!(await page.locator('[data-testid="canvases-pinned"]').first().isVisible().catch(() => false))) { await page.locator('[data-testid="panel-icon-left"]').first().click().catch(() => {}); await sleep(900); }
      await page.evaluate(() => document.querySelector('[data-testid="canvases-ds-row"]')?.click()); await sleep(2500);
      await page.evaluate(() => document.querySelector('[data-testid="ds-convert-open"]')?.click()); await sleep(1800);
    });
  }
  if (G === 'h') {
    await sleep(4000);
    ds(['pending', 'maude-v2', '--set', dsFile('_p5.json', { tokens: { '--accent': { light: 'oklch(0.50 0.19 255)', dark: 'oklch(0.62 0.17 255)' } } })]);
    ds(['publish', 'maude-v2', '--leave-out', 'ui/Pricing.tsx']);
    await sleep(3000);
    await page.reload(); await sleep(6000); // c7: the shell reads canvasDsRevs once per load — the CLI publish above is outside the app
    await open('ui-pricing', 4000);
    if (!(await page.locator('[data-testid="canvases-pinned"]').first().isVisible().catch(() => false))) { await page.locator('[data-testid="panel-icon-left"]').first().click().catch(() => {}); await sleep(900); }
    await k.deep('[data-dc-screen="desktop"] [data-cd-id="buy"]', 3).catch(() => {}); await k.inspector(true);
    console.log('UPD', await page.locator('[data-testid="ds-update-available"]').count(), await page.locator('[data-testid="ds-update-what"]').allTextContents());
    await h.step(`${D}/ds-edit-instance`, 'A canvas that was left out — update available', 'ds pending + publish --leave-out ui/Pricing, open Pricing, select the button', async () => {});
  }
  if (G === 'j') {
    await open('system-maude-design-system', 6000);
    await h.step(`${D}/ds-board-gator`, 'A second system on its own Design system canvas', 'open the second pinned system', async () => {});
  }
  if (G === 'i') {
    await sleep(4000);
    ds(['pending', 'maude-v2', '--set', dsFile('_p6.json', { components: { Button: { '.btn': { 'border-radius': { value: '6px' } } } } })]);
    await sleep(2000);
    await open(dsBoard, 6000);
    await k.fold(); await k.inspector(true);
    await h.step(`${D}/ds-edit-master`, 'Edit a component master — leave a folder out', 'ds pending components (Button corners), bar › Review', async () => {
      await fr.locator('[data-testid="ds-bar-review"]').first().click().catch(() => {}); await sleep(11000);
    });
  }
}
