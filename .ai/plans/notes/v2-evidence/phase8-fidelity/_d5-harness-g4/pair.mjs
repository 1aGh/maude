// usage: node pair.mjs <NN-canvas> <id> <theme> [specCrop=WxH+X+Y] [implCrop=WxH+X+Y]
// spec left, impl right, same height; label strip on top. Writes .scr/pairs/<NN-canvas>/<id>-<theme>.png and the
// committed JPEG (<=1100 px wide, q55) in .ai/plans/notes/v2-evidence/phase8-fidelity/<NN-canvas>/<id>-<theme>.jpg
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { REPO } from './paths.mjs';

export function pair(dir, id, theme, { specCrop, implCrop, label = '', implPath, specPath } = {}) {
  const spec = specPath || join(REPO, '.scr/spec', dir, `${id}-${theme}.png`);
  const impl = implPath || join(REPO, '.scr/impl', dir, `${id}-${theme}.png`);
  if (!existsSync(spec)) throw new Error('no spec ' + spec);
  if (!existsSync(impl)) throw new Error('no impl ' + impl);
  const outDir = join(REPO, '.scr/pairs', dir);
  const evDir = join(REPO, '.ai/plans/notes/v2-evidence/phase8-fidelity', dir);
  mkdirSync(outDir, { recursive: true });
  mkdirSync(evDir, { recursive: true });
  const tmp = join(REPO, '.scr/tmp');
  mkdirSync(tmp, { recursive: true });
  const prep = (src, crop, name) => {
    const out = join(tmp, name);
    const args = [src];
    if (crop) args.push('-crop', crop, '+repage');
    args.push(out);
    execFileSync('magick', args);
    return out;
  };
  const s = prep(spec, specCrop, 'p-spec.png');
  const i = prep(impl, implCrop, 'p-impl.png');
  const H = Number(execFileSync('magick', ['identify', '-format', '%h', s]).toString());
  const full = join(outDir, `${id}-${theme}.png`);
  const caption = `${id} · ${theme}${label ? ' · ' + label : ''}    SPEC (left) | IMPL (right)`;
  execFileSync('magick', [
    '(', s, ')',
    '(', '-size', `6x${H}`, 'xc:#888', ')',
    '(', i, '-resize', `x${H}`, ')',
    '+append', '+repage',
    '-gravity', 'NorthWest', '-background', '#222', '-fill', 'white', '-font', '/System/Library/Fonts/Supplemental/Arial.ttf', '-pointsize', '22',
    '-splice', '0x40', '-annotate', '+12+8', caption, full,
  ]);
  const jpg = join(evDir, `${id}-${theme}.jpg`);
  execFileSync('magick', [full, '-resize', '1100x>', '-quality', '55', jpg]);
  return full;
}

if (process.argv[1] && process.argv[1].endsWith('pair.mjs')) {
  const [dir, id, theme, specCrop, implCrop] = process.argv.slice(2);
  console.log(pair(dir, id, theme, { specCrop, implCrop }));
}
