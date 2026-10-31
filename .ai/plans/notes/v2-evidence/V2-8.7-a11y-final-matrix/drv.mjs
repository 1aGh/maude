// V2-8.7 final audit driver: agent-browser (axe 4.12.1 via `a11y`) + helpers.
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const W =
  '/private/tmp/claude-501/-Users-iagh-git-personal-maude/87d978ed-80c9-4461-b6c8-391c975c5c9a/scratchpad/a11y';
export const OUT = join(W, 'out');
mkdirSync(OUT, { recursive: true });
const ENV = { ...process.env, AGENT_BROWSER_SOCKET_DIR: '/private/tmp/mab-a11y', FARM_LOCAL: '1' };

let launched = false;
export function ab(...args) {
  if (process.env.AB_SESSION) {
    const pre = ['--session', process.env.AB_SESSION];
    if (process.env.AB_INIT && !launched && args[0] === 'open') pre.push('--init-script', process.env.AB_INIT);
    if (args[0] === 'open') launched = true;
    args = [...pre, ...args];
  }
  const r = spawnSync('agent-browser', args, { env: ENV, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return { out: r.stdout ?? '', err: r.stderr ?? '', code: r.status };
}
export const sleep = (ms) => spawnSync('sleep', [String(ms / 1000)]);

/** eval JS in the page; returns the parsed JSON value (or raw string). */
export function ev(js) {
  const r = ab('eval', js);
  const t = r.out.trim();
  try {
    return JSON.parse(t);
  } catch {
    return t;
  }
}

/** click the first visible control whose accessible name (aria-label | title | text) matches `re`. */
export function clickName(re, { scope = 'document', roles = 'button,[role=button],[role=tab],[role=menuitem],[role=menuitemradio],[role=menuitemcheckbox],[role=option],[role=radio],[role=switch],a,summary,[role=treeitem],[role=checkbox],input[type=checkbox],input[type=radio],input[type=search],[role=searchbox],[role=combobox]' } = {}) {
  const js = `(()=>{const re=new RegExp(${JSON.stringify(re.source)},${JSON.stringify(re.flags)});
const root=${scope};
const nm=e=>(e.getAttribute('aria-label')||e.getAttribute('title')||e.textContent||'').trim().replace(/\\s+/g,' ');
const vis=e=>{const r=e.getBoundingClientRect();const s=getComputedStyle(e);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none'};
const els=[...root.querySelectorAll(${JSON.stringify(roles)})].filter(e=>vis(e)&&!e.disabled&&re.test(nm(e)));
if(!els.length)return JSON.stringify({ok:false});
document.querySelectorAll('[data-abx]').forEach(x=>x.removeAttribute('data-abx'));els[0].setAttribute('data-abx','1');return JSON.stringify({ok:true,name:nm(els[0]).slice(0,60)})})()`;
  const r = ev(js);
  const o = typeof r === 'string' ? JSON.parse(r) : r;
  if (o.ok) {
    const c = ab('click', '[data-abx="1"]');
    if (c.code) o.ok = false;
  }
  return o;
}
export const clickTid = (tid) => ab('click', `[data-testid="${tid}"]`).code === 0;
export const press = (k) => ab('press', k);

export function setTheme(base, theme) {
  spawnSync('curl', ['-s', '-X', 'POST', '-H', 'content-type: application/json', '-H', `origin: ${base}`, '--data', JSON.stringify({ theme }), `${base}/_api/ui-prefs`]);
  const prefs = spawnSync('curl', ['-s', `${base}/_api/ui-prefs`], { encoding: 'utf8' }).stdout;
  return JSON.parse(prefs).theme;
}

export function open(url) {
  ab('open', url);
  sleep(1800);
}

/** run axe; drop `region`; drop nodes inside artboard content. Returns {viol, inc, counts}. */
export function scan(label, theme) {
  const r = ab('a11y', '--json');
  let j;
  try {
    j = JSON.parse(r.out).data;
  } catch {
    console.log(`${label} [${theme}] SCAN-FAILED ${r.out.slice(0, 200)} ${r.err.slice(0, 200)}`);
    return null;
  }
  const filt = (list) => {
    const out = [];
    for (const v of list) {
      if (v.id === 'region') continue;
      const nodes = v.nodes.filter((n) => !inArtboard(n.target));
      if (nodes.length) out.push({ id: v.id, impact: v.impact, help: v.help, nodes });
    }
    return out;
  };
  const viol = filt(j.violations);
  const inc = filt(j.incomplete);
  writeFileSync(join(OUT, `${theme}-${label.replace(/[^a-z0-9]+/gi, '_')}.json`), JSON.stringify({ viol, inc }, null, 1));
  const fmt = (l) => l.map((v) => `${v.id}(${v.impact ?? '-'})x${v.nodes.length}`).join(' ');
  const blockers = viol.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  console.log(`${blockers.length ? 'BLOCK' : 'ok   '} ${theme} ${label}: ${fmt(viol) || '-'}  | incomplete: ${fmt(inc) || '-'}`);
  for (const v of blockers)
    for (const n of v.nodes.slice(0, 4)) console.log(`      ${v.id}: ${JSON.stringify(n.target)} ${n.html.slice(0, 140)}`);
  return { viol, inc };
}

function inArtboard(target) {
  // a same-document node is never artboard content (the artboard bodies live in the canvas iframe);
  // an iframe node is resolved in the page.
  if (!Array.isArray(target) || target.length < 2 || !Array.isArray(target[0]) && typeof target[0] !== 'string') return false;
  const flat = target.map((t) => (Array.isArray(t) ? t.join(' ') : t));
  const js = `(()=>{try{let d=document;const t=${JSON.stringify(flat)};for(let i=0;i<t.length-1;i++){const f=d.querySelector(t[i]);if(!f||!f.contentDocument)return 'n';d=f.contentDocument}const e=d.querySelector(t[t.length-1]);return e&&e.closest('.dc-artboard-body')?'y':'n'}catch(e){return 'n'}})()`;
  return ev(js) === 'y';
}

export function shot(name) {
  ab('screenshot', join(OUT, `${name}.png`));
}
