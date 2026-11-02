import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import data from './index-data.mjs';
const R = '/Users/iagh/git/personal/maude/.claude/worktrees/agent-a1266e1495ea7588d';
const DIRS = { '01': ['01-create-flow', '01 Create Flow'], '02': ['02-onboarding', '02 Onboarding'], '05': ['05-empty-states', '05 Empty States'] };
const esc = (s) => String(s).replace(/\|/g, '\\|');
for (const [nn, [dir, canvas]] of Object.entries(DIRS)) {
  const out = join(R, '.ai/plans/notes/v2-evidence/phase8-fidelity', dir);
  const meta = JSON.parse(readFileSync(join(R, '.design/ui/v2', `${canvas}.meta.json`), 'utf8'));
  const rows = [];
  let pairs = 0, unreachable = [], partial = [];
  for (const a of meta.artboards) {
    const d = data[nn][a.id];
    if (!d) throw new Error('no data for ' + a.id);
    const has = ['light', 'dark'].filter((t) => existsSync(join(out, `${a.id}-${t}.jpg`)));
    pairs += has.length;
    if (d.reach.startsWith('no')) unreachable.push(a.id);
    else if (d.reach.startsWith('partial')) partial.push(a.id);
    const links = has.length ? has.map((t) => `[${t}](${a.id}-${t}.jpg)`).join(' · ') : '— no pair (nothing to show)';
    const diffs = d.diffs.length ? d.diffs.map((x) => `• ${x}`).join('<br>') : '—';
    rows.push(`| \`${a.id}\` | ${esc(a.label)} | ${esc(d.how)} | ${esc(d.reach)} | ${esc(diffs)} | ${links} |`);
  }
  const md = `# Phase 8 fidelity — stage A evidence — ${canvas}

Branch \`p8-fid-g1\` (from \`feat/maude-v2\` 6d780ab1b). ${meta.artboards.length} artboards · ${pairs} pairs (light + dark where an implementation frame exists) · ${unreachable.length} not reachable · ${partial.length} reachable only in part.
Evidence only — no product code changed. Pair = SPEC left, IMPL right, same height, strip \`<id> · <theme>\` on top; committed copies are JPEG q55 ≤ 1100 px wide, full-size PNGs are at the path in \`full-size-path.txt\`.

## How the frames were made
- **SPEC.** The board rendered from a scratch copy of this repo's \`.design/\` (\`.scr/design-copy\`, \`linkedHub\` stripped), studio booted with \`NO_OPEN=1 MAUDE_NO_AUTOBUILD=1\`, throwaway HOME / XDG (stub \`claude\`), release-built client. Each \`<DCArtboard>\` captured through the canvas shell (capture origin, 307 from the main origin) at 100 % (⇧0, panned to the artboard), element screenshot. Stage boards are 1440 × 980 (window 1440 × 900 + a note strip): the pair crops the window (1440 × 900) so it compares like for like; other boards (close-ups, filmstrips) are shown whole. The "Note" strip text is quoted in the meta / canvas, not in the pair.
- **Light vs dark.** The boards DRAW light only (\`data-theme="light"\` scopes; the studio host injects the app theme's tokens on \`[data-dc-screen] [data-theme]\`, pinned-light pictures keep their palette). **Light SPEC** = the host rule removed, the board exactly as authored. **Dark SPEC** = the host's own dark injection (what a dark-theme studio shows) — it is NOT a designed dark artboard, so a dark-only difference is as likely the board's as the app's. IMPL dark/light = prefs \`theme\` + colour scheme.
- **IMPL.** Release client, Playwright Chromium 1600 × 1000, \`window.__TAURI__\` stub, throwaway HOME / XDG / machine file, \`claude\` stubbed. Screens: the e2e fixture project, a generated 93-canvas project, an empty project, a "g1" fixture (base + an empty folder, a video artboard with no clips, a two-artboard canvas), and the project-less Home server (\`--home\`) with route interception of Home's own APIs. AI states use the e2e FAKE ACP agent (a slowed variant of \`apps/desktop/e2e/fixtures/fake-acp/first-canvas-agent.mjs\`, never a provider). Intercepted: \`/_home/*\`, \`/_api/sync/availability\`; "offline" = \`navigator.onLine=false\` (the local server stays up) except where a row says otherwise.
- **Systematic differences (every pair, not repeated per row).** The browser lane has no native window chrome or tab strip (spec draws them); the impl left panel is a full-height column, the spec's a floating island; the spec shows a bottom-left undo / redo / zoom chip, the impl does not (Settings › Zoom controls is off by default); the status cluster reads "Local project" + avatar YO in the fixture project where the spec shows "Saved" + faces; fixtures are not the Studio site / Alligators data the boards draw (no real covers, names, collaborators).

## Not reachable (findings, not skips)
${unreachable.length ? unreachable.map((id) => `- \`${id}\` — ${data[nn][id].reach.replace(/^no: ?/, '')}`).join('\n') : '- none'}

## Artboards
| id | state (board label) | how reached | impl reachable? | first-glance differences | pairs |
| --- | --- | --- | --- | --- | --- |
${rows.join('\n')}
`;
  writeFileSync(join(out, 'INDEX.md'), md);
  writeFileSync(join(out, 'full-size-path.txt'), `${join(R, '.scr/pairs', nn)}\n`);
  console.log(nn, meta.artboards.length, 'artboards', pairs, 'pairs', 'unreachable', unreachable.join(','), 'partial', partial.length);
}
