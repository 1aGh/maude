import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const R = '/Users/iagh/git/personal/maude/.claude/worktrees/agent-a88fc0565d3f0bdf8';
const EV = join(R, '.ai/plans/notes/v2-evidence/phase8-fidelity');
const TIP = 'd3881fe41';

const common = (dir, extra) =>
  `\n## FINAL (stage D2, ${TIP})\n\nFinal re-shoot, IMPL side, dark + light, on the release client built from \`feat/maude-v2\` @ \`${TIP}\` (all stage C rounds 1-4 merged; client bundle = \`fae2884fa\`). Every pair in this folder (\`<id>-<theme>.jpg\`) was overwritten with this shot, replacing every earlier round's. Spec side: **reused** — the board \`.design/ui/v2/${dir.startsWith('10') ? '10 Share and Collaboration' : dir.startsWith('11') ? '11 Projects and Navigation' : '12 Import and Assets'}.tsx\` has not changed since the stage-A shot (\`git log\` on it is empty after 2026-10-21), so the stage-A spec PNGs were reused. Full-size pairs: \`full-size-path.txt\` (the "final (D2)" line). No product code touched; no verdicts here (the critic judges).\n\nHarness: the committed \`_d-harness-g4\` scripts repointed to this worktree, plus \`_d2-harness-g4/\` (new scripts below). Playwright Chromium 1440x860, \`window.__TAURI__\` stub unless noted, throwaway HOME/XDG + stub claude, \`NO_OPEN=1 MAUDE_NO_AUTOBUILD=1\`.\n${extra}`;

const i10 = common(
  '10-share-and-collaboration',
  `
| id | dark · light | note |
|---|---|---|
| co-share-sheet, co-share-roles, co-share-advanced | re-shot | FAKED \`/_api/share/*\` (cloud, 4 people, 1 invite) |
| co-browser-view, co-presence | re-shot | presence is still one local face (no peers) |
| co-comment-thread, co-comment-video, co-comment-print | re-shot | real comment composer / Comments panel |
| co-sync-offline, co-sync-back | re-shot | FAKED linked project + browser offline + outbox 14; co-sync-back keeps the toast (\`notice\`) |
| co-conflict, co-trashed, co-local-cloud | re-shot | FAKED conflicts / trash routes; real local Share (Move to cloud) |
| co-access-ends | re-shot | \`s10c\`: FAKED 401 \`access-withdrawn\`, notices dismissed |
| co-ask-edit | re-shot | \`s10d\` frame \`co-ask-edit-tip\` (view-only tip after a >8 px drag on the faked read-only canvas) is the paired impl |
| co-follow, co-bring, co-spotlight, co-twelve | unreachable | need N live peers (Yjs awareness over \`/_ws/collab\`); no fixture, no route to fake presence |
| co-mention-notify | unreachable | OS banner / e-mail, native only |

Spec-only JPEGs of the five unreachable ids unchanged (\`spec-only/\`). New scripts: none beyond \`s10 / s10c / s10d\`.
`
);
const i11 = common(
  '11-projects-and-navigation',
  `
| id | dark · light | note |
|---|---|---|
| pn-tab-b, pn-tab-b20, pn-switch-ai-strip, pn-relaunch-strip | re-shot | the real \`apps/desktop/src/strip.html\` fed a stubbed \`tabs_state\`; native window chrome absent by construction |
| pn-switch-ai | re-shot | ⌘K › Keyboard shortcuts (\`s11d\`) |
| pn-relaunch | re-shot | stubbed \`take_tabs_restored {count: 20}\`; \`s11r2\` waits for the "20 tabs reopened" toast to be visible before the shot (a fixed sleep missed it under load) |
| pn-home, pn-home-search | re-shot | project-less \`--home\` server, 5-project seeded machine index (\`home11\`) |
| pn-ds, pn-ds-search | re-shot | scratch copy of this tree's \`.design\` (system + ui, refreshed); \`s11ds\` waits for "Loading canvases…" to go |
| pn-organise, pn-move, pn-trash, pn-jump | re-shot | real panel interactions (\`s11\`); pn-jump retaken in \`s11r\` (first frame caught "server isn't responding" under load) |
| pn-k-across | re-shot | \`s11k\`: fresh boot on Uniformy-2027, ⌘K "mobil" with stubbed \`index_search\` (the \`s11\` frame came after the trash step and carried its toast) |
| pn-k-close | re-shot | \`s11e\`: "unifromy 2027" |
| pn-history, pn-compare | re-shot | \`s11b\`: file edited 3x, second version viewed, then Compare; waits lengthened to 6 s so the viewed version has drawn |
| pn-deeplink | re-shot | stubbed \`take_pending_navigate\` |
| pn-tab-a, pn-tab-a20 | unreachable | variant A not picked (decision \`v2-3.7-own-tab-bar\`), superseded boards |
| pn-ab | unreachable | decision board, no UI |
| pn-tab-menu, pn-windows | unreachable | native NSMenu / multi-window, not drawable in a browser |
| pn-accounts | unreachable | the account card by the faces is not built |
| pn-cant-open | unreachable | needs a moved project root / removed access in the Rust shell + hub |

Extra unpaired frames in the worktree \`.scr/impl\`: \`strip-b20-overview-*\`, \`pn-home-top-*\`, \`pn-home-search-typed-*\`, \`pn-k-close-2-*\`.
`
);
const i12 = common(
  '12-import-and-assets',
  `
| id | dark · light | note |
|---|---|---|
| ia-assets-panel, ia-assets-keys, ia-assets-browse, ia-assets-find, ia-assets-tidy, ia-asset-details, ia-missing-gone | re-shot | \`s12\` on the \`photos\` fixture (18 plasma JPEGs + a Photos canvas + Gone) |
| ia-advanced | re-shot | \`s12e\` (dark) and \`s12f\` (light; the \`s12e\` light step timed out), \`photos2\` fixture, details › Advanced |
| ia-photo-inspector, ia-photo-steps | re-shot | \`s12h\`: the photo is selected with a **⌘-click** (a plain click now selects the artboard); the Image / Photo tab pair and the Photo section (Look tiles, Remove background, Replace, Only this use changes) draw |
| ia-gen-ask | re-shot | \`s12e\`: artboard selected, ⌘K › Generate with AI… |
| ia-drop-photos | re-shot | \`s12e\`: SYNTHETIC dragenter + dragover inside the canvas frame at the artboard's centre (no native file drop in a browser) |
| ia-placed | re-shot | \`s12h\`: Spread artboard selected, Assets › From this Mac… with 6 files (plain browser, no Tauri stub), shot after 7 s so the frames are filled and the toast shows |
| ia-figma-sheets, ia-figma-sheets-connect | re-shot | ⌘K › Import from Figma… (\`s12\`); paste a link, Enter → Connect step (\`s12b\`) |
| ia-brand-steps | re-shot | ⌘K › Import a brand, just opened (\`s12\`) |
| ia-brand-steps-1, -2, -3 | re-shot | \`s12g\` in a plain browser (the Tauri stub made the logo pick a native dialog): logo chosen via the file chooser + website typed → Import → Reading… → the site does not answer. \`AGENT_BROWSER_SOCKET_DIR=/tmp/abg4\` is set because the logo read shells out to agent-browser and a throwaway-HOME session name was too long for the socket path (earlier shots of this id showed "Couldn't read the logo" for that reason — harness, not product) |
| ia-more-ways, ia-gen-placed, ia-figma-arrived, ia-figjam, ia-brand, ia-missing, ia-edges | unreachable | stubs not built (network, hub peer, providers, nine conditions) |
`
);

for (const [dir, idx, txt] of [
  ['10-share-and-collaboration', 'i10', i10],
  ['11-projects-and-navigation', 'i11', i11],
  ['12-import-and-assets', 'i12', i12],
]) {
  appendFileSync(join(EV, dir, 'INDEX.md'), txt);
  const f = join(EV, dir, 'full-size-path.txt');
  const old = readFileSync(f, 'utf8').replace(/\s+$/, '');
  writeFileSync(
    f,
    `${old}\n\nfinal (D2, ${TIP}): ${R}/.scr/pairs/${dir}\n(full-size PNG pairs: <id>-<theme>.png; spec PNGs, reused from stage A: ${R}/.scr/spec/${dir}/<id>-<theme>.png; raw impl frames: ${R}/.scr/impl/${dir}/)\n`
  );
}
console.log('ok');
