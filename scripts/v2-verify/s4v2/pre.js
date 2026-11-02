const zlabel = () => page.evaluate(() => [...document.querySelectorAll('*')].map(e=>e.children.length===0 && /^\d+%$/.test(e.textContent||'') ? e.textContent : null).filter(Boolean).join(','));
const homeR = () => frect('[data-dc-screen="home"]');
const zoomBy = async (dy, x = 800, y = 500) => { await page.mouse.move(x, y); await page.keyboard.down('Control'); const n = Math.ceil(Math.abs(dy) / 300); for (let i = 0; i < n; i++) { await page.mouse.wheel(0, Math.sign(dy) * 300); await sleep(60); } await page.keyboard.up('Control'); await sleep(500); };
const pan = async (dx, dy) => { await page.mouse.move(800, 500); await page.mouse.wheel(dx, dy); await sleep(400); };
// view(z, hx, hy): zoom so the home artboard is ~z (e.g. 0.45) wide-scale and its top-left sits at screen (hx, hy)
let VW = { z: 0.45, hx: 280, hy: 90 };
const view = async (z = 0.45, hx = 280, hy = 90) => {
  for (let i = 0; i < 6; i++) {
    const r = await homeR(); const cur = r.w / 1200;
    if (Math.abs(cur - z) < 0.02) break;
    await zoomBy(Math.log(z / cur) / -0.000578 > 0 ? Math.min(Math.log(z / cur) / -0.000578, 2400) : Math.max(Math.log(z / cur) / -0.000578, -2400), 800, 500);
  }
  for (let i = 0; i < 4; i++) {
    const r = await homeR(); const dx = r.x - hx, dy = r.y - hy;
    if (Math.abs(dx) < 4 && Math.abs(dy) < 4) break;
    await pan(dx, dy);
  }
  const r2 = await homeR(); VW = { z: r2.w / 1200, hx: r2.x, hy: r2.y };
};
const prev = async (z = 0.45, hx = 280, hy = 90) => { await openSite(); await page.click('[data-testid="palette-mode-preview"]'); await sleep(1200); await view(z, hx, hy); };
const edit = async (z = 0.45, hx = 280, hy = 90) => { await openSite(); await sleep(500); await view(z, hx, hy); };
// world -> screen once the view is set (z, hx, hy as passed to view; home world origin = (3.78, 32.31))
const S = (wx, wy) => ({ x: VW.hx + (wx - 3.78) * VW.z, y: VW.hy + (wy - 32.31) * VW.z });
const sh = (cmd) => require('node:child_process').execSync(cmd, { cwd: '/Users/iagh/git/personal/maude/.claude/worktrees/agent-af2a233f610c7fca6', encoding: 'utf8' });
const board = () => JSON.parse(fs.readFileSync('/private/tmp/claude-501/sc/proj/.design/ui-site.annotations.json', 'utf8'));
