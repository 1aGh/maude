// node pairs.mjs <NN>…  — builds <repo>/.scr/pairs/<NN>/<id>-<theme>.png (full size, spec | impl) and overwrites the committed JPEG
// copies phase8-fidelity/<dir>/<id>-<theme>.jpg. Impl frames: .scr/d5-g3/impl/<NN>/ (fetched from the shoot); spec: .scr/spec/<NN>/.
// ONLY=id,id limits the ids. Same pair format/size as stage A (spec height 900, header strip, JPEG q55 at <=1100 wide).
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const R = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../../..');
const FONT = '/System/Library/Fonts/Supplemental/Arial.ttf';
const CANV = { '07': '07-video-editing', '08': '08-artboard-kinds', '09': '09-export' };
const made = [];
for (const nn of process.argv.slice(2)) {
  const full = join(R, '.scr/pairs', nn);
  const out = join(R, '.ai/plans/notes/v2-evidence/phase8-fidelity', CANV[nn]);
  mkdirSync(full, { recursive: true });
  mkdirSync(out, { recursive: true });
  for (const f of readdirSync(join(R, '.scr/d5-g3/impl', nn)).sort()) {
    const m = f.match(/^(.*)-(light|dark)\.jpg$/);
    if (!m) continue;
    const [, id, theme] = m;
    if (process.env.ONLY && !process.env.ONLY.split(',').includes(id)) continue;
    const spec = join(R, '.scr/spec', nn, `${id}-${theme}.png`);
    if (!existsSync(spec)) { console.log('no spec for', nn, id, theme); continue; }
    const impl = join(R, '.scr/d5-g3/impl', nn, f);
    const tmpS = join(full, '_s.png'), tmpI = join(full, '_i.png');
    // spec: drop the note strip under a 1440x900 stage (artboard 982 tall)
    const dims = execFileSync('magick', ['identify', '-format', '%w %h', spec]).toString().trim().split(' ').map(Number);
    const cropArgs = dims[1] >= 975 && dims[1] <= 985 && dims[0] >= 1440 ? ['-crop', `${dims[0]}x902+0+0`, '+repage'] : [];
    execFileSync('magick', [spec, ...cropArgs, '-resize', 'x900', tmpS]);
    execFileSync('magick', [impl, '-resize', 'x900', tmpI]);
    const pair = join(full, `${id}-${theme}.png`);
    execFileSync('magick', [tmpS, '(', '-size', '10x900', 'xc:#888', ')', tmpI, '+append', '-background', '#1c1c1c', '-gravity', 'North', '-splice', '0x34', '-font', FONT, '-pointsize', '20', '-fill', 'white', '-annotate', '+10+6', `${id} · ${theme}      SPEC (left)   |   IMPL (right)`, pair]);
    execFileSync('magick', [pair, '-resize', '1100x>', '-quality', '55', join(out, `${id}-${theme}.jpg`)]);
    made.push(`${nn}/${id}-${theme}`);
  }
}
console.log(made.length, 'pairs');
