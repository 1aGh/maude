// usage: D5_REPO=<repo> node index.mjs <03-ai-chat|04-modes|06-advanced> <tip-sha> [note ...]
// Appends the FINAL (D6) section to <dir>/INDEX.md and a "final (D6):" block to full-size-path.txt.
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
const W = process.env.D5_REPO;
const [dir, tip, ...rest] = process.argv.slice(2);
const EV = `${W}/.ai/plans/notes/v2-evidence/phase8-fidelity`;
const map = JSON.parse(readFileSync(`${W}/.scr/pairs-map-only.json`, 'utf8'))[dir];
const rows = [];
for (const [id, m] of Object.entries(map.ids)) {
  const cell = (theme) => {
    if (!m.impl) return `unreachable (${(m.reason || 'no state in the app').replace(/\|/g, '/').replace(/\s+/g, ' ').slice(0, 180)})`;
    return existsSync(`${W}/.scr/d6/${map.dir}/${m.impl}-${theme}.jpg`) ? 're-shot' : 'unreachable (the scenario shot no frame on the tip; the pair carries the NOT REACHABLE caption)';
  };
  rows.push(`| \`${id}\` | ${cell('dark')} | ${cell('light')} |`);
}
let s = `\n\n## FINAL (D6, ${tip})\n\nFinal verification shoot on the merged tip after stage C round 8 (harness \`_c10m-harness-g2/\`, a flattened copy of the newest per-canvas layers; shot on the Mac mini with Google Chrome, not the Playwright headless shell). Spec side reused (the boards \`.design/ui/v2/03|04|06\` are unchanged since 2026-10-19). Committed JPEG pairs overwritten (spec left | impl right). The critic judges; this builder does not.\n\n`;
for (const n of rest) s += `- ${n}\n`;
s += '\n| id | dark | light |\n|---|---|---|\n' + rows.join('\n') + '\n';
appendFileSync(`${EV}/${dir}/INDEX.md`, s);
const fp = `${EV}/${dir}/full-size-path.txt`;
const old = readFileSync(fp, 'utf8').replace(/\n+$/, '');
writeFileSync(
  fp,
  `${old}\n\nfinal (D6, ${tip}): ${W}/.scr/pairs/${dir}/\n(one PNG per artboard id and theme: <id>-<dark|light>.png, spec left | impl right, same height, label strip on top)\nfinal (D6) IMPL frames alone: ${W}/.scr/d6/${dir}/\nfinal (D6) SPEC images (reused from stage A): ${W}/.scr/spec/${dir.slice(0, 2)}/\nfinal (D6) harness: .ai/plans/notes/v2-evidence/phase8-fidelity/_c10m-harness-g2/ (chain.sh ${dir.slice(0, 2)} on the remote lane, then mkpairs.sh ${dir})\n`,
);
console.log(rows.length, 'ids');
