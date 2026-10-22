// node gen-index.mjs — writes INDEX.md + full-size-path.txt for the three canvases.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const W = '/Users/iagh/git/personal/maude/.claude/worktrees/agent-a45b4750975bd8337';
const EV = `${W}/.ai/plans/notes/v2-evidence/phase8-fidelity`;
const map = JSON.parse(readFileSync(`${W}/.scr/pairs-map.json`, 'utf8'));
const labels = JSON.parse(readFileSync(`${W}/.scr/labels.json`, 'utf8'));

const COMMON = {
  '03-ai-chat': `
**Common differences (not repeated per row; C1-C6):**
- **C1** The spec draws the macOS title bar and the project tab strip (traffic lights, "Studio site | Alligators brand"); the browser lane has no native title bar or tabs. Desktop-shell only, expected.
- **C2** The spec folds the left panel on most boards (or draws the 93-canvas Alligators tree: 2026 > combine ...); the app opens Canvases by default and lists the fixture's flat canvas list (11 canvases).
- **C3** Share cluster: spec shows two faces (T, J) and "Saved/Syncing" (a cloud team project); the app shows "YO - Local project" (local project, no collaborators).
- **C4** Canvas content and camera: the spec draws the designed Alligators artwork on 5 to 15 artboards at a fixed 38 % camera; the app shows a 5-artboard stand-in "Combine-kampan" (fixture) at fit-all, wrapped in a different layout. Artwork is fixture; camera and layout are real differences.
- **C5** The 80 px note strip under each spec Stage has no app counterpart; the IMPL side is the 1440x900 window only, padded grey under it. Panel-detail boards compare against a crop of the app panel (crop rect in the pair's label strip).
- **C6** The scope chip reads the artboard id in lowercase ("post") or "Whole canvas"; the spec draws "(diamond) Post 1:1" (the artboard label). Check whether the chip should use the label.
- **H** Harness limits (not app findings): the AI is a scripted fake ACP agent (\`.scr/impl/fake-agent.mjs\`, kept next to the full-size pairs' scripts), so working-line words come from generic tool titles ("Edit the canvas") not the model's description, there is no second person (Tereza, Jonas) and Version history rows are attributed "You - changed outside the app" instead of "Made by AI".`,
  '04-modes': `
**Common differences (C1-C5):**
- **C1** The spec draws the macOS title bar and project tab strip; the browser lane has none.
- **C2** The spec's Preview and Present frames hide every panel (immersive); the app also hides panels in Preview but leaves the AI/left corner icons, and in several frames the left Canvases panel is still open after a mode change (see rows).
- **C3** Share cluster: spec "T J - Saved - Share" (cloud, two people); app "YO - Local project - Share".
- **C4** Spec canvases are "Studio site > Homepage / Pricing" (Calm software, made in Brno; Studio, Pricing) and "Alligators > Combine-kampan" (15 artboards). The app runs a rebuilt stand-in Homepage (Desktop 1440 / Tablet 834 / Mobile 390), Pricing and a 5-artboard Combine-kampan; content differs by fixture, behaviours do not.
- **C5** Spec note strip under each Stage has no app counterpart; documentation boards (md-model, md-keys, md-annotate, md-esc, md-motion, md-present-lift, md-edge-mixed) are info-graphics with tables and storyboards, compared only against the live state they describe.
- **C6** Camera: entering Preview in the app lands at 65-81 % centred on whichever artboard is nearest the centre (it started on Tablet, not Desktop); the spec's Preview frames sit at 76 % on Desktop.`,
  '06-advanced': `
**Common differences (C1-C4):**
- **C1** The spec draws closed-vs-open pairs side by side ("Closed - what everyone sees" next to "Advanced open"); the app can only show one state per frame, so each row is the OPEN state, cropped to the panel where the spec is a panel excerpt.
- **C2** The spec project is a cloud/git team project with hub, branches and teammates (Teresa, Jonas); the app lane is a LOCAL project, so Share, Version history > Advanced and Sync show the local variants (move-to-cloud offer, "not versioned yet").
- **C3** Title bar and tab strip (desktop shell) are absent in the browser lane.
- **C4** The spec note strip has no app counterpart; documentation boards (ad-map, ad-why, ad-trace) have no app surface.`,
};

const R = JSON.parse(readFileSync(`${W}/.scr/rows.json`, 'utf8'));

for (const [canvas, c] of Object.entries(map)) {
  const dir = `${EV}/${canvas}`;
  mkdirSync(dir, { recursive: true });
  writeFileSync(`${dir}/full-size-path.txt`, `${W}/.scr/pairs/${canvas}/\n(one PNG per artboard id and theme: <id>-<dark|light>.png, spec left | impl right, same height, label strip on top)\nSPEC images alone: ${W}/.scr/spec/${c.nn}/\nIMPL frames alone: ${W}/.scr/impl-out/${c.dir}/\nHarness (scenarios, fake agent, fixtures): ${W}/.scr/impl/\n`);
  const ids = Object.keys(c.ids);
  const reached = ids.filter((i) => c.ids[i].impl);
  let md = `# ${labels[canvas].title} - spec vs implementation, evidence (V2-8.5 stage A)\n\n`;
  md += `Canvas \`.design/ui/v2/${labels[canvas].file}.tsx\`. **${ids.length} artboards**, ${ids.length * 2} pairs (dark + light), **${reached.length} reached in the app**, ${ids.length - reached.length} not reachable (placeholder on the right of the pair, reason in the row).\n\n`;
  md += `How the two sides were made. SPEC: the board rendered from a scratch copy of \`.design/\` (\`.scr/design-copy\`, own studio, throwaway HOME, claude stubbed), camera forced to 1:1, host theme set dark (default) then light (\`data-maude-theme\`: the host re-themes every unpinned artboard; pinned user designs stay light). IMPL: Playwright Chromium 1440x900 (the spec's Stage window size) with a \`window.__TAURI__\` stub, release client, \`theme\` in prefs.json, on a generated fixture project. ${labels[canvas].how}\n`;
  md += `Theme: both themes were made for every artboard. Differences below are the dark pair's unless the "theme" column says otherwise; a theme-only difference (a token that does not flip) is called out there.\n`;
  md += COMMON[canvas] + '\n\n';
  md += `| id | state (spec) | how the impl was reached | impl reachable? | first-glance differences | theme | pair |\n|---|---|---|---|---|---|---|\n`;
  for (const id of ids) {
    const r = R[canvas][id];
    for (const theme of ['dark', 'light']) {
      md += `| \`${id}\` | ${r.state} | ${r.how} | ${r.reach} | ${r.diff} | ${theme === 'dark' ? (r.dark || 'base') : (r.light || 'same structure; chrome follows the light host theme')} | \`${canvas}/${id}-${theme}.jpg\` |\n`;
    }
  }
  writeFileSync(`${dir}/INDEX.md`, md);
}
