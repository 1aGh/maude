// node shoot.mjs <scenario-stem> <theme> — one scenario run with a watchdog (the runs sometimes hang in browser.close after the
// last shot, which would leave the bun server behind). Kills the whole process group when stdout is silent for IDLE s or MAX s pass.
import { spawn } from 'node:child_process';
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HARNESS = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HARNESS, '../../../../../..');
const [stem, theme] = process.argv.slice(2);
const W = join(ROOT, '.scr/d5-g3');
mkdirSync(join(W, 'logs'), { recursive: true });
mkdirSync(join(W, 'rows'), { recursive: true });
mkdirSync(join(W, 'tmp'), { recursive: true });
const log = join(W, 'logs', `${stem}-${theme}.log`);
const IDLE = Number(process.env.IDLE || 240) * 1000;
const MAX = Number(process.env.MAX || 1500) * 1000;
const child = spawn('node', [join(HARNESS, 'run.mjs'), join(HARNESS, `${stem}.mjs`), theme], {
  cwd: ROOT,
  detached: true,
  env: { ...process.env, SHOT_CHANNEL: 'chrome', SHOTS_OUT: join(W, 'impl'), ROWS: join(W, 'rows', `rows-${stem}-${theme}.jsonl`), TMPDIR: join(W, 'tmp') + '/' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let last = Date.now();
const t0 = Date.now();
const onData = (d) => {
  last = Date.now();
  appendFileSync(log, d);
  const t = String(d);
  if (/shot |FAIL|RUN ERROR|pageerrors/.test(t)) process.stdout.write(t);
};
child.stdout.on('data', onData);
child.stderr.on('data', onData);
let killed = '';
const timer = setInterval(() => {
  const why = Date.now() - last > IDLE ? 'idle' : Date.now() - t0 > MAX ? 'max' : '';
  if (why) {
    killed = why;
    try { process.kill(-child.pid, 'SIGKILL'); } catch {}
  }
}, 5000);
child.on('exit', (code) => {
  clearInterval(timer);
  try { process.kill(-child.pid, 'SIGKILL'); } catch {}
  console.log(`== ${stem} ${theme}: exit ${code}${killed ? ' (watchdog: ' + killed + ')' : ''} in ${Math.round((Date.now() - t0) / 1000)}s`);
  process.exit(0);
});
