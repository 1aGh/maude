// INDEX.md per canvas from rows-<NN>.json: [{id, state, how, reach, diffs, themes?: ['light','dark']}]
import { existsSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = import.meta.dirname;
const OUTC = join(ROOT, '..', '.ai/plans/notes/v2-evidence/phase8-fidelity');
const TITLES = { '13-design-system': '13 Design System', '14-editing': '14 Editing', '15-annotations': '15 Annotations' };
for (const dir of Object.keys(TITLES)) {
  const rf = join(ROOT, `rows-${dir}.json`);
  if (!existsSync(rf)) continue;
  const rows = JSON.parse(readFileSync(rf, 'utf8'));
  const pairs = readdirSync(join(OUTC, dir)).filter((f) => f.endsWith('.jpg'));
  const total = rows.length;
  const yes = rows.filter((r) => r.reach.startsWith('yes')).length;
  const part = rows.filter((r) => r.reach.startsWith('partially')).length;
  const no = rows.filter((r) => r.reach.startsWith('no')).length;
  let md = `# Phase 8 fidelity — ${TITLES[dir]} (stage A evidence)\n\n`;
  md += `Branch p8-fid-g5 from feat/maude-v2 6d780ab1b. SPEC = the board artboard rendered 1:1 from a scratch copy of \`.design/ui/v2/${TITLES[dir]}.tsx\` through the capture origin (app theme light / dark; the designs inside an artboard stay theme-pinned, as designed). IMPL = the release-built v2 app (Playwright Chromium 1440×900 with a \`window.__TAURI__\` stub, throwaway HOME/XDG, \`claude\` stubbed signed-out, \`NO_OPEN=1 MAUDE_NO_AUTOBUILD=1\`) driven into the artboard's state; theme set through prefs.json \`theme\`. Pairs: spec left, impl right, label strip \`<id> · <theme>\`; the artboard is padded (grey) to the taller side so nothing is rescaled in the full-size copy.\n\n`;
  md += `Full-size pairs: see \`full-size-path.txt\`. Committed copies here are JPEG q55, max 1100 px wide (an artboard larger than 1440 px wide is therefore small — read the full-size one).\n\n`;
  md += `**${total} artboards · ${pairs.length} pairs (${total} × light + dark where drawn) · impl reachable: ${yes} yes, ${part} partially, ${no} no.**\n\n`;
  md += `Reading the impl side: most artboards are a 1440×900 window plus an 80 px note strip (the spec is 1440×980 — the grey band under the impl is that strip, not a defect). Close-up artboards (a sheet, a menu, several panes side by side) depict a region; the impl is the whole window with that region on it — the "how reached" column says where to look.\n\n`;
  const nf = join(ROOT, `notes-${dir}.md`);
  if (existsSync(nf)) md += readFileSync(nf, 'utf8') + '\n\n';
  md += `| id | theme | state (as the board draws it) | how reached | impl reachable? | first-glance differences |\n| --- | --- | --- | --- | --- | --- |\n`;
  for (const r of rows) {
    for (const t of r.themes ?? ['light', 'dark']) {
      if (!pairs.includes(`${r.id}-${t}.jpg`)) continue;
      md += `| \`${r.id}\` | ${t} | ${r.state} | ${r.how} | ${r.reach} | ${t === 'light' ? r.diffs : 'As the light row. ' + (r.dark ?? 'No dark-only difference noticed (dark pairs not all inspected one by one — see the note above).')} |\n`;
    }
  }
  writeFileSync(join(OUTC, dir, 'INDEX.md'), md);
  writeFileSync(join(OUTC, dir, 'full-size-path.txt'), join(ROOT, 'pairs', dir) + '\n');
  console.log(dir, total, 'rows');
}
