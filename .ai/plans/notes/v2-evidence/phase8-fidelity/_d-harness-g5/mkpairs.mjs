// Build SPEC | IMPL pairs. usage: bun mkpairs.mjs [canvas-dir ...]
// impl image: .scr/impl/<dir>/<id>-<theme>.png (optional crop override: <id>-<theme>.crop.png wins).
// A missing impl becomes a grey "not reachable" card so every artboard still has a pair.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = import.meta.dirname;
const OUTC = join(ROOT, '..', '.ai/plans/notes/v2-evidence/phase8-fidelity');
const dirs = process.argv.slice(2).length ? process.argv.slice(2) : ['13-design-system', '14-editing', '15-annotations'];
const sh = (cmd, args) => spawnSync(cmd, args, { encoding: 'utf8' });
const dims = (f) => sh('magick', ['identify', '-format', '%w %h', f]).stdout.trim().split(' ').map(Number);
const notes = existsSync(join(ROOT, 'impl-notes.json')) ? JSON.parse(readFileSync(join(ROOT, 'impl-notes.json'), 'utf8')) : {};

for (const dir of dirs) {
  const specDir = join(ROOT, 'spec', dir);
  mkdirSync(join(ROOT, 'pairs', dir), { recursive: true });
  mkdirSync(join(OUTC, dir), { recursive: true });
  for (const f of readdirSync(specDir).filter((x) => x.endsWith('.png')).sort()) {
    const base = f.replace(/\.png$/, '');
    const m = base.match(/^(.*)-(light|dark)$/);
    const [id, theme] = [m[1], m[2]];
    const spec = join(specDir, f);
    let impl = join(ROOT, 'impl', dir, f);
    const cropF = join(ROOT, 'impl', dir, `${base}.crop.png`);
    if (existsSync(cropF)) impl = cropF;
    const missing = !existsSync(impl);
    if (missing && process.env.ONLY_EXISTING) continue; // round 3: keep the committed pair of an id this run did not re-shoot
    const [sw, sh0] = dims(spec);
    if (missing) {
      impl = join(ROOT, 'pairs', dir, `_nr-${base}.png`);
      const why = (notes[id] && notes[id].blocker) || 'not reachable in the app yet';
      sh('magick', ['-background', '#d9d9d9', '-fill', '#444', '-font', '/System/Library/Fonts/Supplemental/Arial.ttf', '-size', `${Math.round(sw * 0.7)}x`, '-pointsize', '34', '-gravity', 'center', `caption:IMPL: not reachable — ${why}`, '-gravity', 'center', '-extent', `${sw}x${sh0}`, impl]);
    }
    const [iw, ih] = dims(impl);
    const H = Math.max(sh0, ih);
    const pad = (src, w, h, out) => sh('magick', [src, '-background', '#c8c8c8', '-gravity', 'NorthWest', '-extent', `${w}x${H}`, out]);
    const a = join(ROOT, 'pairs', dir, `_a-${base}.png`);
    const b = join(ROOT, 'pairs', dir, `_b-${base}.png`);
    pad(spec, sw, sh0, a);
    pad(impl, iw, ih, b);
    const out = join(ROOT, 'pairs', dir, `${base}.png`);
    const labW = sw + iw + 20;
    sh('magick', [
      '(', a, b, '-background', '#ffffff', '-splice', '10x0', '+append', ')',
      '-gravity', 'North', '-background', '#202020', '-splice', '0x56',
      '-font', '/System/Library/Fonts/Supplemental/Arial.ttf', '-fill', 'white', '-pointsize', '30', '-gravity', 'NorthWest',
      '-annotate', '+14+10', `${id} · ${theme}`,
      
      '-fill', '#9fd0ff', '-annotate', `+${sw - 260}+10`, 'SPEC (board)',
      '-fill', '#ffd29f', '-annotate', `+${sw + iw - 300}+10`, missing ? 'IMPL (not reachable)' : 'IMPL (app)',
      out,
    ]);
    sh('magick', [out, '-resize', '1100x>', '-quality', '55', '-strip', join(OUTC, dir, `${base}.jpg`)]);
    sh('rm', ['-f', a, b]);
    if (missing) sh('rm', ['-f', impl]);
  }
  console.log('pairs', dir, readdirSync(join(OUTC, dir)).filter((x) => x.endsWith('.jpg')).length);
}
