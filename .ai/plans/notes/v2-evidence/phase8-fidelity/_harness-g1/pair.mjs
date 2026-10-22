// usage: node pair.mjs <NN> [theme,theme] [id,id]   — reads ./pairs-config.mjs (id -> { impl?: [sub...], spec?: 'win'|'full', note? })
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const R = '/Users/iagh/git/personal/maude/.claude/worktrees/agent-af49de751057c2ee5';
const [NN, themesArg = 'light,dark', onlyArg] = process.argv.slice(2);
const themes = themesArg.split(',');
const cfgAll = (await import(pathToFileURL(join(R, '.scr/h/pairs-config.mjs')).href)).default;
const cfg = cfgAll[NN] || {};
const outFull = join(R, '.scr/pairs', NN);
const outCommit = join(R, '.ai/plans/notes/v2-evidence/phase8-fidelity', NN === '01' ? '01-create-flow' : NN === '02' ? '02-onboarding' : '05-empty-states');
mkdirSync(outFull, { recursive: true });
mkdirSync(outCommit, { recursive: true });
const m = (...a) => execFileSync('magick', a, { stdio: ['ignore', 'pipe', 'pipe'] }).toString();
const dim = (p) => m('identify', '-format', '%w %h', p).trim().split(' ').map(Number);
const only = onlyArg ? onlyArg.split(',') : null;
const made = [];
for (const [id, c] of Object.entries(cfg)) {
  if (only && !only.includes(id)) continue;
  for (const theme of themes) {
    const specRaw = join(R, `.scr/spec-raw/${NN}/${id}-${theme}.png`);
    if (!existsSync(specRaw)) continue;
    let names = c.impl || [id];
    if (c.landing) {
      // the spring: the 4 frames from the first one that shows the words
      const fs = readdirSync(join(R, `.scr/impl-raw/${NN}`)).filter((f) => f.startsWith(`${c.landing}.f`) && f.endsWith(`-${theme}.png`)).sort();
      const tone = (f) => Number(m(join(R, `.scr/impl-raw/${NN}/${f}`), '-crop', '240x26+300+290', '+repage', '-colorspace', 'Gray', '-format', '%[fx:mean]', 'info:'));
      const base0 = tone(fs[0]);
      let at = fs.findIndex((f) => tone(f) < base0 * 0.93);
      if (at < 1) at = 4;
      names = fs.slice(Math.max(0, at), at + 4).map((f) => f.replace(`-${theme}.png`, ''));
    }
    const subs = names
      .map((s) => join(R, '.scr/impl-raw', s.includes('/') ? '' : NN, `${s}-${theme}.png`))
      .filter(existsSync)
      .map((p, i) => {
        const cr = c.crops ? c.crops[i] : c.crop;
        if (!cr) return p;
        const cp = join(R, `.scr/tmp-crop-${NN}-${i}.png`);
        m(p, '-crop', cr, '+repage', cp);
        return cp;
      });
    if (!subs.length) continue;
    // spec side
    const [sw, sh] = dim(specRaw);
    const mode = c.spec || (sw === 1442 && sh === 982 ? 'win' : 'full');
    const specPng = join(R, `.scr/tmp-spec-${NN}.png`);
    if (mode === 'win') m(specRaw, '-crop', '1440x900+1+1', '+repage', specPng);
    else m(specRaw, '-shave', '1x1', '+repage', specPng);
    const [pw, ph] = dim(specPng);
    // impl side
    const implPng = join(R, `.scr/tmp-impl-${NN}.png`);
    if (subs.length === 1) m(subs[0], '-resize', `x${ph}`, implPng);
    else {
      const cols = subs.length <= 4 ? 2 : 3;
      m('montage', '-font', '/System/Library/Fonts/Supplemental/Arial.ttf', ...subs, '-tile', `${cols}x`, '-geometry', '800x500>+6+6', '-background', theme === 'dark' ? '#111' : '#ddd', implPng);
      m(implPng, '-resize', `x${ph}`, implPng);
    }
    const label = `${id} · ${theme}   |   SPEC (left, ${mode === 'win' ? 'window crop' : 'whole board'}${theme === 'dark' ? ', host-dark of the light-drawn board' : ''})   IMPL (right${subs.length > 1 ? `, ${subs.length} frames` : ''})`;
    const strip = join(R, `.scr/tmp-strip-${NN}.png`);
    const [iw] = dim(implPng);
    m('-size', `${pw + iw + 16}x30`, 'xc:#222', '-font', '/System/Library/Fonts/Supplemental/Arial.ttf', '-pointsize', '16', '-fill', 'white', '-annotate', '+10+21', label, strip);
    const full = join(outFull, `${id}-${theme}.png`);
    const row = join(R, `.scr/tmp-row-${NN}.png`);
    m(specPng, '(', '-size', '16x' + ph, 'xc:#c33', ')', implPng, '+append', row);
    m(strip, row, '-append', full);
    // committed copy: <=1100 px wide, jpeg q55
    const jpg = join(outCommit, `${id}-${theme}.jpg`);
    m(full, '-resize', '1100x>', '-quality', '55', jpg);
    made.push(`${id}-${theme} ${Math.round(statSync(jpg).size / 1024)}k`);
  }
}
console.log(made.join('\n'), `\n${made.length} pairs`);
