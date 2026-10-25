// Round 7b (p8-c7-g0607b): ad-history on a git-backed project (versions up top, Advanced = branch, drafts, remote,
// changed files, git actions). The throwaway copy gets a real repo with three commits, a draft branch and a remote.
import { execFileSync } from 'node:child_process';
import { appendFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { alligators } from './fx3.mjs';
export const fixture = alligators;
export const keepState = false;
export const page = { w: 1440, h: 900, channel: true };
const D = '06-advanced';
const git = (cwd, ...a) => execFileSync('git', a, { cwd, stdio: 'pipe', env: { ...process.env, GIT_AUTHOR_NAME: 'Tereza', GIT_AUTHOR_EMAIL: 'tereza@alligators.cz', GIT_COMMITTER_NAME: 'Tereza', GIT_COMMITTER_EMAIL: 'tereza@alligators.cz', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' } });
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
}
export async function run(h) {
  const { page, sleep } = h;
  await h.open('ui-combine-kampan', 3000);
  await h.step(`${D}/ad-history`, 'Version history › Advanced (git-backed)', '⌥⌘H, open the fold', async () => {
    await page.keyboard.press('Alt+Meta+h');
    await sleep(1800);
    const t = page.locator('[data-testid="history-advanced-toggle"], [data-testid="fold-history-toggle"], [data-testid="vh-advanced-toggle"]').first();
    if (await t.count()) await t.click({ timeout: 4000 });
    else await page.locator('text="Advanced" >> visible=true').last().click({ timeout: 4000 });
    await sleep(1200);
  });
}
