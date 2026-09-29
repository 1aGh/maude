// EXP3 — #133(a) end-to-end: hub (source, node 24) + two SHIPPED maude-server studios W and D.
// node exp3-relaunch.mjs <legacy|transactions> <outJson> [reverse]
import { spawn, execSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync, cpSync } from 'node:fs';
import { join } from 'node:path';
const [mode, out, dir] = process.argv.slice(2);
const reverse = dir === 'reverse';
const nodelete = process.argv.includes('nodelete');
const tag = `${mode}${reverse ? '-rev' : ''}${nodelete ? '-nodel' : ''}`;
const R = new URL('.', import.meta.url).pathname;
const base = join(R, 'proj', `exp3-${tag}`);
rmSync(base, { recursive: true, force: true });
mkdirSync(base, { recursive: true });
const HUB_PORT = mode === 'legacy' ? 4783 : 4781;
const WP = mode === 'legacy' ? 4773 : 4771, DP = WP + 1;
const t0 = Date.now();
const log = [];
const L = (msg, x = {}) => { const e = { t: Date.now() - t0, msg, ...x }; log.push(e); console.log(JSON.stringify(e)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const procs = [];

function startHub() {
  return new Promise((res, rej) => {
    const args = ['/Users/iagh/git/personal/maude/apps/hub/test/fixtures/serve-hub.mjs', join(base, 'hub'), String(HUB_PORT)];
    if (mode === 'transactions') args.push('--transactions');
    const p = spawn(`${process.env.HOME}/.nvm/versions/node/v24.13.0/bin/node`, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    procs.push(p);
    let buf = '';
    p.stdout.on('data', (c) => { buf += c; const l = buf.split('\n').find((x) => x.startsWith('{')); if (l) res({ p, ...JSON.parse(l) }); });
    p.stderr.on('data', (c) => { buf += c; });
    setTimeout(() => rej(new Error('hub timeout ' + buf)), 30000);
  });
}
function mkProject(name, url, token) {
  const root = join(base, name);
  mkdirSync(join(root, '.design', 'ui'), { recursive: true });
  writeFileSync(join(root, '.design', 'config.json'), JSON.stringify({ name: 'e2e-exp3', designRoot: '.design', canvasGroups: [{ label: 'UI', path: 'ui' }], linkedHub: { url, linkedAt: 0, resolveFirstAnchor: name === 'W' ? 'keep-local' : 'keep-cloud' } }, null, 2));
  writeFileSync(join(root, 'hubs.json'), JSON.stringify({ hubs: { [url]: { token } } }), { mode: 0o600 });
  return root;
}
function startStudio(name, root, port) {
  const env = { ...process.env, MAUDE_DEV_SERVER_ROOT: '/Applications/Maude.app/Contents/Resources/apps/studio', MAUDE_PKG_ROOT: '/Applications/Maude.app/Contents/Resources', MAUDE_NO_AUTOBUILD: '1', HUBS_CONFIG_PATH: join(root, 'hubs.json'), MAUDE_SYNC_IN_CI: '1' };
  const p = spawn('/Applications/Maude.app/Contents/MacOS/maude-server', ['--root', root, '--port', String(port)], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  const lf = join(R, 'raw', `exp3-${tag}-${name}-${Date.now() - t0}.log`);
  let all = '';
  p.stdout.on('data', (c) => { all += c; writeFileSync(lf, all); });
  p.stderr.on('data', (c) => { all += c; writeFileSync(lf, all); });
  procs.push(p);
  return p;
}
async function health(port) { for (let i = 0; i < 80; i++) { try { const r = await fetch(`http://localhost:${port}/_health`); if (r.ok) return true; } catch {} await sleep(250); } return false; }
async function stop(p, root) { p.kill('SIGTERM'); await new Promise((r) => { if (p.exitCode !== null) return r(); p.once('exit', r); setTimeout(r, 8000); }); rmSync(join(root, '.design', '_server.json'), { force: true }); }
function ws(port) { return new Promise((res, rej) => { const w = new WebSocket(`ws://localhost:${port}/_ws`); w.onopen = () => res(w); w.onerror = (e) => rej(e); }); }
async function send(port, msg) { const w = await ws(port); w.send(JSON.stringify(msg)); await sleep(400); w.close(); }
const FILE = '.design/ui/board.tsx';
async function addComment(port, text) {
  await send(port, { type: 'comments-add', payload: { file: FILE, selector: '[data-dc-screen="a1"] h1', dom_path: [], tag: 'h1', classes: '', bounds: { x: 10, y: 10, w: 24, h: 24 }, html_excerpt: '', text } });
}
const diskFile = (root) => join(root, '.design', '_comments', 'ui-board.json');
function disk(root) { try { const j = JSON.parse(readFileSync(diskFile(root), 'utf8')); return (Array.isArray(j) ? j : j.comments || []).map((c) => c.text); } catch { return null; } }
async function all(port) { try { const r = await fetch(`http://localhost:${port}/_comments-all`); const j = await r.json(); const arr = Array.isArray(j) ? j : Object.values(j).flat(); return arr.flatMap((x) => (x && x.comments ? x.comments : [x])).map((c) => c && c.text).filter(Boolean); } catch (e) { return 'ERR ' + e.message; } }
async function idOf(root, text) { try { const j = JSON.parse(readFileSync(diskFile(root), 'utf8')); return (Array.isArray(j) ? j : j.comments).find((c) => c.text === text)?.id; } catch { return null; } }
async function waitDisk(root, pred, ms, what) { const end = Date.now() + ms; while (Date.now() < end) { const d = disk(root); if (d && pred(d)) { L('ok ' + what, { disk: d }); return true; } await sleep(250); } L('TIMEOUT ' + what, { disk: disk(root) }); return false; }

const result = { mode, reverse, nodelete };
try {
  const hub = await startHub();
  L('hub up', { http: hub.http });
  const url = `http://127.0.0.1:${HUB_PORT}`;
  // W = "web" (stays up), D = "desktop" (gets relaunched). reverse: swap who restarts.
  const Wroot = mkProject('W', url, hub.tokens.alice);
  const Droot = mkProject('D', url.replace('127.0.0.1', 'localhost'), hub.tokens.bob);
  writeFileSync(join(Droot, 'hubs.json'), JSON.stringify({ hubs: { [url.replace('127.0.0.1', 'localhost')]: { token: hub.tokens.bob } } }), { mode: 0o600 });
  writeFileSync(join(Wroot, '.design', 'ui', 'board.tsx'), `import { DesignCanvas, DCArtboard } from '@maude/canvas-lib';\nexport default function Board() {\n  return <DesignCanvas><DCArtboard id="a1" label="A1" width={400} height={300}><h1>Hello</h1></DCArtboard></DesignCanvas>;\n}\n`);
  let W = startStudio('W', Wroot, WP); L('W health', { ok: await health(WP) });
  await sleep(4000);
  let D = startStudio('D', Droot, DP); L('D health', { ok: await health(DP) });
  const gotCanvas = await (async () => { for (let i = 0; i < 120; i++) { if (existsSync(join(Droot, '.design', 'ui', 'board.tsx'))) return true; await sleep(250); } return false; })();
  L('D has board.tsx', { gotCanvas });
  await sleep(2000);
  const [P, Proot, Pport, Q, Qroot, Qport] = reverse ? [D, Droot, DP, W, Wroot, WP] : [W, Wroot, WP, D, Droot, DP];
  // P = the peer that keeps editing ("W"); Q = the one that is closed and relaunched ("D")
  await addComment(Pport, 'A'); await addComment(Pport, 'B');
  result.step1_P = await waitDisk(Proot, (d) => d.includes('A') && d.includes('B'), 15000, 'P disk has A,B');
  result.step1_Q = await waitDisk(Qroot, (d) => d.includes('A') && d.includes('B'), 30000, 'Q disk has A,B');
  result.step1_Q_all = await all(Qport); L('Q /_comments-all', { v: result.step1_Q_all });
  const idA = await idOf(Proot, 'A');
  await stop(Q, Qroot); L('Q stopped');
  if (!nodelete) await send(Pport, { type: 'comments-delete', id: idA });
  await addComment(Pport, 'C');
  await waitDisk(Proot, (d) => (nodelete || !d.includes('A')) && d.includes('C'), 15000, 'P disk [B,C] (or A,B,C)');
  await sleep(3000);
  const Q2 = startStudio(reverse ? 'W2' : 'D2', Qroot, Qport); L('Q restarted', { ok: await health(Qport) });
  if (reverse) W = Q2; else D = Q2;
  await sleep(10000);
  L('Q disk after restart+10s', { disk: disk(Qroot), all: await all(Qport) });
  await addComment(Pport, 'E');
  const samples = [];
  const start = Date.now();
  while (Date.now() - start < 60000) {
    samples.push({ dt: Date.now() - start, disk: disk(Qroot), all: await all(Qport), Pdisk: disk(Proot) });
    await sleep(5000);
  }
  result.samples = samples;
  const last = samples.at(-1);
  result.final = { Qdisk: last.disk, Qall: last.all, Pdisk: last.Pdisk };
  L('FINAL', result.final);
} catch (e) { L('ERROR', { e: String(e.stack || e) }); result.error = String(e); }
finally {
  for (const p of procs) { try { p.kill('SIGTERM'); } catch {} }
  await sleep(3000);
  for (const p of procs) { try { if (p.exitCode === null) p.kill('SIGKILL'); } catch {} }
  for (const n of ['W', 'D']) rmSync(join(base, n, '.design', '_server.json'), { force: true });
  writeFileSync(out, JSON.stringify({ result, log }, null, 2));
  process.exit(0);
}
