// Round 8 (p8-c8-adv): the 06 states the round-7 critic called HARNESS problems, on one git-backed alligators project:
//   ad-diag      Menu > Diagnostics with its Advanced row OPEN (Address, Process, Project folder, Resync now, Download all)
//   ad-code      the read-only code panel, open (⌘K > View code, Enter)
//   ad-search    the whole ⌘K list for the board's query "copy" (7 results fit; Ask AI at the foot)
//   ad-history   a VERSION selected, the fold open (Changed in this version)
//   ad-inspector the whole Advanced fold of a text element, in a tall window (the fold is ~20 rows)
//   ad-export    the whole Advanced body of the export sheet incl. File names + From the terminal, in a tall window
//   ad-left      Canvases > Advanced with Show file names ON and Show hidden files ON (shot last: it changes the tree)
import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { alligators } from './fx3.mjs';

export const fixture = alligators;
export const keepState = false;
export const page = { w: 1440, h: 900, channel: true };
const D = '06-advanced';
const git = (cwd, ...a) =>
  execFileSync('git', a, {
    cwd,
    stdio: 'pipe',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'Tereza',
      GIT_AUTHOR_EMAIL: 'tereza@alligators.cz',
      GIT_COMMITTER_NAME: 'Tereza',
      GIT_COMMITTER_EMAIL: 'tereza@alligators.cz',
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_CONFIG_SYSTEM: '/dev/null',
    },
  });
export async function prepare(project) {
  writeFileSync(join(project, '.gitignore'), '.design/_*\n.design/_*/\n');
  git(project, 'init', '-q', '-b', 'main');
  git(project, 'add', '-A');
  git(project, 'commit', '-q', '-m', 'Alligators brand starts here');
  appendFileSync(join(project, '.design/ui/Combine-kampan.tsx'), '\n// greener\n');
  git(project, 'commit', '-q', '-am', 'Post 1:1 greener');
  writeFileSync(join(project, 'brief.md'), '# Brief\n');
  git(project, 'add', 'brief.md');
  git(project, 'commit', '-q', '-m', 'Story copy');
  git(project, 'branch', 'tereza/uniformy-v2');
  git(project, 'remote', 'add', 'origin', 'https://github.com/brno-alligators/brand.git');
  appendFileSync(join(project, 'brief.md'), 'draft\n');
  mkdirSync(join(project, '.design/_canvas-state'), { recursive: true });
}
export async function run(h) {
  const { page, sleep } = h;
  const f = page.frameLocator('[data-testid="canvas-frame"]');
  const size = async (w, hh) => {
    await page.setViewportSize({ width: w, height: hh });
    await sleep(900);
  };
  await h.open('ui-combine-kampan', 3500);

  // ad-diag: Menu > Diagnostics, then its Advanced row (the nested panel with the exact values)
  await h.step(`${D}/ad-diag`, 'Menu › Diagnostics › Advanced open', 'project pill, Diagnostics, Advanced', async () => {
    await page.locator('[data-tour="menus"]').first().click({ timeout: 5000 });
    await sleep(700);
    await page.locator('[data-testid="project-menu-row-sub-diagnostics"]').first().click({ timeout: 5000 });
    await sleep(800);
    await page
      .locator('[data-testid="project-menu-sub-diagnostics"] [data-testid="project-menu-row-sub-advanced"]')
      .first()
      .click({ timeout: 5000 });
    await sleep(900);
  });
  await h.esc(3);

  // ad-code: the code panel
  await h.step(`${D}/ad-code`, 'The canvas as code (read-only panel)', '⌘K, "view code", Enter', async () => {
    await page.keyboard.press('Meta+k');
    await sleep(500);
    await page.keyboard.type('view code');
    await sleep(800);
    await page.keyboard.press('Enter');
    await sleep(1800);
    // the board draws the panel's Advanced open: "From the terminal — this canvas" and "In Claude Code"
    const ft = page.locator('[data-testid="fold-code-toggle"]').first();
    if (await ft.count()) await ft.click({ timeout: 4000 }).catch(() => {});
    await sleep(900);
  });
  await page.locator('[data-testid="code-view-close"]').first().click({ timeout: 3000 }).catch(() => {});
  await h.esc(2);
  await sleep(500);

  // ad-search: the board's query, the whole list
  await h.step(`${D}/ad-search`, '⌘K finds the advanced rows too — the whole list for "copy"', '⌘K, type "copy"', async () => {
    await page.keyboard.press('Meta+k');
    await sleep(500);
    await page.keyboard.type('copy');
    await sleep(900);
  });
  await h.esc(2);

  // ad-inspector: the WHOLE fold (tall window, the fold scrolled to its top)
  await size(1440, 1760);
  await h.step(`${D}/ad-inspector`, 'Inspector › Advanced open — the whole fold', 'meta-click the headline, open Advanced, scroll its top into frame', async () => {
    await f.locator('[data-cd-id="post-headline"]').first().click({ modifiers: ['Meta'], timeout: 5000 });
    await sleep(1000);
    const fold = page.locator('[data-testid="fold-inspector"]').first();
    if (!(await fold.getAttribute('data-open').catch(() => null))) await page.locator('[data-testid="fold-inspector-toggle"]').first().click({ timeout: 4000 });
    await sleep(900);
    await page.evaluate(() => {
      const b = document.querySelector('[data-testid="fold-inspector-toggle"]');
      b?.scrollIntoView({ block: 'start' });
    });
    await sleep(800);
  });
  await h.esc(2);

  // ad-export: the whole Advanced body of the sheet
  await size(1440, 1500);
  await h.step(`${D}/ad-export`, 'Export › Advanced open — File names and the command', '⇧⌘E, open the fold', async () => {
    await page.keyboard.press('Shift+Meta+e');
    await sleep(1100);
    await h.click('export-advanced-toggle');
    await sleep(900);
  });
  await h.esc(3);
  const cx = page.locator('[data-testid="export-cancel"]').first();
  if (await cx.count()) await cx.click().catch(() => {});
  await size(1440, 900);

  // ad-history: a version selected, the fold open
  await h.step(`${D}/ad-history`, 'Version history › a version selected, Advanced open', '⌥⌘H, pick the 2nd row, open the fold', async () => {
    await page.keyboard.press('Alt+Meta+h');
    await sleep(1800);
    const rows = page.locator('[data-testid^="vh-row-"]');
    const n = await rows.count();
    if (n) await rows.nth(Math.min(1, n - 1)).click({ timeout: 4000 }).catch(() => {});
    await sleep(900);
    const t = page.locator('[data-testid="history-advanced-toggle"], [data-testid="fold-history-toggle"], [data-testid="vh-advanced-toggle"]').first();
    if (await t.count()) await t.click({ timeout: 4000 });
    else await page.locator('text="Advanced" >> visible=true').last().click({ timeout: 4000 });
    await sleep(1400);
  });
  await page.locator('[data-testid="vh-close"]').first().click({ timeout: 3000 }).catch(() => {});
  await h.esc(3);
  await sleep(600);

  // ad-left: Show file names ON, Show hidden files ON
  await h.step(`${D}/ad-left`, 'Canvases › Advanced, file names and hidden files shown', 'open the fold, switch both on', async () => {
    if (!(await page.locator('[data-testid="canvases-advanced"]').first().isVisible().catch(() => false))) {
      await page.locator('[data-testid="panel-icon-left"]').first().click().catch(() => {});
      await sleep(900);
    }
    await h.click('canvases-advanced');
    await sleep(600);
    for (const id of ['canvases-show-file-names', 'canvases-hidden-files']) {
      const sw = page.locator(`[data-testid="${id}"]`).first();
      if ((await sw.getAttribute('aria-checked')) !== 'true') await sw.click({ timeout: 4000 });
      await sleep(700);
    }
    await sleep(900);
  });
}
