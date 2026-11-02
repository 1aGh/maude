import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
const W = '/Users/iagh/git/personal/maude/.claude/worktrees/agent-ace93bd2b562b89ad';
const EV = `${W}/.ai/plans/notes/v2-evidence/phase8-fidelity`;
const map = JSON.parse(readFileSync(`${W}/.scr/pairs-map.json`, 'utf8'));
const TIP = '6d19daa9a';
const NOTES = {
  '03-ai-chat': [
    'Same harness as stage A (fake ACP agent, Alligators brand fixture, Chromium 1440x900 with a window.__TAURI__ stub, release-built client of the tip). Harness adaptations only, no product change: the What\'s new toast is dismissed through its close button; the composer is picked with `:visible` (a hidden earlier chat now keeps its composer in the DOM); the pin toggle is clicked through a dispatched click (the pin button sits under the settings corner icon while the chat is pinned, so a pointer click never lands).',
    'Panel-detail crops were widened from x 1130 / w 310 to x 1050 / w 390 because the chat is now a floating island (bottom right) instead of a docked column.',
    'Not reachable in the browser lane, unchanged since stage A: ai-queue-rule (a drawn rule), ai-other-tab / ai-needs-tab (second desktop tab), ai-needs-away (OS notification), ai-tereza (second person on a hub).',
  ],
  '04-modes': [
    'Same harness as stage A. Adaptations: the What\'s new toast dismissed through its close button, the composer picked with `:visible`. No spec side re-render (board 04 unchanged since stage A).',
    'Not reachable, unchanged since stage A: md-motion (a storyboard), md-present-video (no footage in the fixture), md-presenter / md-edge-offline (second display / desktop shell), md-present-link / md-comment-only / md-edge-viewer (hub or second person).',
  ],
  '06-advanced': [
    'Same harness as stage A. Adaptations: the What\'s new toast dismissed through its close button.',
    '**ad-share** was re-shot with the `window.__TAURI__` stub removed just before the Share click: in the desktop shell a local project\'s Share now opens "Move to the cloud?" and hides Share > Advanced (`offering`, share-sheet.jsx), so the Advanced fold is only drawn for a local project in the browser lane (or a linked one). The desktop-shell frame of the same click is not part of the pair.',
    '**ad-diag / ad-syncd / ad-ai-diag**: the Diagnostics sheet no longer has the Server / Sync / AI tabs; it draws Logs, Server and AI setup at once (a local project has no Sync card). The three ids therefore show the same sheet frame (taken after the Logs frame, no tab click).',
    '**ad-timeline** is newly reached (stage A: unreachable): the base fixture\'s VideoEdit canvas, Reel artboard selected, timeline expanded, its Advanced row opened (S7.18).',
    'Panel-detail crops (ad-ai, ad-pinned...) widened as in 03. ad-ds stays unreachable: no Design system canvas can be seeded in this lane (the sheet needs a real system/ folder with specimens).',
    'Not reachable, unchanged: ad-map, ad-why, ad-trace (explanation boards), ad-menus (native menu bar), ad-edge-sync / ad-edge-hub (hub), ad-edge-where, ad-edge-remember (multi-context stories).',
  ],
};
for (const [canvas, c] of Object.entries(map)) {
  const dir = `${EV}/${canvas}`;
  let s = `\n\n## after (stage D, ${TIP})\n\nRe-shoot of the IMPL side on tip ${TIP} (stage C round 2 merged), both themes, so the critic re-check compares the board with what the app draws now. No match / mismatch judged here. Pair images (\`<id>-<theme>.jpg\`, SPEC left | IMPL right) were overwritten in place; the SPEC side is **reused** from stage A for every id (no \`.design/ui/v2/${c.nn} *\` change since the stage-A shot; \`git log\` shows only 02 and 09 touched). The \`extra-impl-*\` frames were re-shot too.\n\n`;
  for (const n of NOTES[canvas]) s += `- ${n}\n`;
  s += `\n| id | dark | light |\n|---|---|---|\n`;
  for (const [id, m] of Object.entries(c.ids)) {
    if (m.impl) s += `| \`${id}\` | IMPL re-shot, SPEC reused | IMPL re-shot, SPEC reused |\n`;
    else s += `| \`${id}\` | unreachable (${(m.reason || '').replace(/\|/g, '/')}) | unreachable (same) |\n`;
  }
  appendFileSync(`${dir}/INDEX.md`, s);
  const fp = `${dir}/full-size-path.txt`;
  const old = readFileSync(fp, 'utf8').split('\n');
  const a = old[0];
  const dpath = `${W}/.scr/pairs/${canvas}/`;
  writeFileSync(
    fp,
    `stage D (${TIP}): ${dpath}\n(one PNG per artboard id and theme: <id>-<dark|light>.png, spec left | impl right, same height, label strip on top)\nstage D IMPL frames alone: ${W}/.scr/impl-out/${c.dir}/\nstage D SPEC images (reused from stage A): ${W}/.scr/spec/${c.nn}/\nstage D harness: .ai/plans/notes/v2-evidence/phase8-fidelity/_d-harness-g2/\n\nstage A: ${a}\n${old.slice(1).join('\n')}`
  );
}
