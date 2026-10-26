// D7: append the "FINAL (D7, <tip>)" section to <dir>/INDEX.md and the "final (D7):" LAST line to <dir>/full-size-path.txt.
//   node mkindex.mjs <dir> <tip> <pairs-abs-dir> <rows.json>
// rows.json = { intro: "...", rows: [[ "id, id", "light", "dark", "note" ], ...], tail?: "..." }  (light/dark = "re-shot" or "unreachable - why")
import { appendFileSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const [dir, tip, pairs, rowsFile] = process.argv.slice(2);
const root = join(dirname(fileURLToPath(import.meta.url)), '..', dir);
const { intro, rows, tail } = JSON.parse(readFileSync(rowsFile, 'utf8'));
let md = `\n## FINAL (D7, ${tip})\n\n${intro}\n\n| artboard id | light | dark | note |\n|---|---|---|---|\n`;
for (const [ids, l, d, n] of rows) md += `| ${ids} | ${l} | ${d} | ${n || ''} |\n`;
if (tail) md += `\n${tail}\n`;
appendFileSync(join(root, 'INDEX.md'), md);
appendFileSync(
  join(root, 'full-size-path.txt'),
  `\nfinal (D7, ${tip}): ${pairs} (full-size PNG pairs: <id>-<theme>.png, spec | impl; spec PNGs reused from stage A (boards unchanged since), raw impl frames in ${pairs.replace('/pairs/', '/impl/')}; merged tip of feat/maude-v2 after stage C round 10, release-built client, Mac mini with Google Chrome, harness _d7-harness-g3)\n`,
);
console.log('index + path written for', dir);
