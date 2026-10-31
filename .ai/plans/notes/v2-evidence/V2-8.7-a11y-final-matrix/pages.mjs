// node pages.mjs <dark|light> <strip|home|desktop>   (AB_SESSION/AB_INIT set by the caller for strip)
import { readFileSync } from 'node:fs';
import * as d from './drv.mjs';
const [, , theme, which] = process.argv;
d.ab('set', 'viewport', which === 'strip' ? '1200' : '1600', which === 'strip' ? '700' : '1000');
d.ab('set', 'media', theme, 'reduced-motion');
const run = (name, fn) => {
  fn();
  d.shot(`${theme}-${name}`);
  d.scan(name, theme);
};
if (which === 'strip') {
  const B = 'http://127.0.0.1:4441/strip.html';
  run('strip-default', () => (d.open(B), d.sleep(600)));
  run('strip-last-active', () => (d.open(`${B}?active=p-9`), d.sleep(600)));
  run('strip-overview', () => (d.open(`${B}?overview=1`), d.sleep(700)));
  run('strip-overview-typed', () => (d.open(`${B}?overview=1`), d.sleep(500), d.ab('keyboard', 'type', 'pri'), d.sleep(400)));
  for (const p of ['index.html', 'root-missing.html']) run(`desktop-${p}`, () => (d.open(`http://127.0.0.1:4441/${p}`), d.sleep(600)));
}
if (which === 'home') {
  const secret = readFileSync(`${d.W}/home-secret.txt`, 'utf8').trim();
  const B = 'http://127.0.0.1:4440/';
  const load = () => {
    d.open(B);
    d.ev(`sessionStorage.setItem('maude-home-page-secret','${secret}'); 1`);
    d.ab('reload');
    d.sleep(1800);
  };
  run('home-default', load);
  run('home-search', () => (load(), d.clickName(/search/i), d.sleep(400)));
  run('home-ask-typed', () => (load(), d.ab('keyboard', 'type', 'a pricing page'), d.sleep(500)));
  console.log(d.ab('snapshot', '-i').out.split('\n').slice(0, 40).join('\n'));
}
