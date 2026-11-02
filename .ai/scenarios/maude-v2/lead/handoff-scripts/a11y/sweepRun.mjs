// node sweepRun.mjs <dark|light> [filter]
import * as d from './drv.mjs';
import { sweep } from './sweep.mjs';

const theme = process.argv[2];
const filter = new RegExp(process.argv[3] ?? '.');
const BASE = 'http://127.0.0.1:4431';
d.ab('set', 'viewport', '1600', '1000');
d.ab('set', 'media', 'reduced-motion');
console.log('theme', d.setTheme(BASE, theme));

const openBusy = () => {
  d.open(BASE);
  const shown = d.ev(`[...document.querySelectorAll('[role=tab]')].some(e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0})`);
  if (shown !== true) (d.clickName(/^Open Canvases$/), d.sleep(600));
  d.ab('fill', '[aria-label="Search canvases"]', 'Busy');
  d.sleep(500);
  d.clickName(/^Busy$/);
  d.sleep(3000);
  d.ab('fill', '[aria-label="Search canvases"]', '');
  d.sleep(300);
  d.press('Meta+0');
  d.sleep(900);
};
const key = (k) => (d.press(k), d.sleep(500));
const states = {
  base: () => openBusy(),
  'inspector-dark-ab': () => {
    openBusy();
    const l = d.ab('snapshot', '-i').out.split('\n').find((x) => /button "Artboard DARK/.test(x));
    const m = l?.match(/ref=(e\d+)/);
    if (m) d.ab('click', `@${m[1]}`);
    d.sleep(900);
  },
  'inspector-photo-ab': () => {
    openBusy();
    const l = d.ab('snapshot', '-i').out.split('\n').find((x) => /button "Artboard PHOTO/.test(x));
    const m = l?.match(/ref=(e\d+)/);
    if (m) d.ab('click', `@${m[1]}`);
    d.sleep(900);
  },
  'project-menu-file': () => (openBusy(), d.clickName(/project menu/), d.sleep(300), d.clickName(/^File/), d.sleep(500)),
  'toolbar-more': () => {
    openBusy();
    const l = d.ab('snapshot', '-i').out.split('\n').find((x) => /button "More"/.test(x));
    const m = l?.match(/ref=(e\d+)/);
    if (m) d.ab('click', `@${m[1]}`);
    d.sleep(500);
  },
  'present-options': () => (openBusy(), d.clickName(/^Present options$/), d.sleep(500)),
  share: () => (openBusy(), d.clickName(/^Share$/), d.sleep(900)),
  export: () => (openBusy(), key('Meta+Shift+e'), d.sleep(600)),
  palette: () => (openBusy(), key('Meta+k'), d.sleep(600)),
  'comments-panel': () => (openBusy(), key('Meta+Shift+m'), d.sleep(900)),
  'assets-tab': () => (openBusy(), d.clickName(/^Assets$/), d.sleep(900)),
  'layers-tab': () => (openBusy(), d.clickName(/^Layers$/), d.sleep(700)),
  'tool-shape': () => {
    openBusy();
    const l = d.ab('snapshot', '-i').out.split('\n').find((x) => /button "Shape/.test(x));
    const m = l?.match(/ref=(e\d+)/);
    if (m) d.ab('click', `@${m[1]}`);
    d.sleep(600);
  },
  'ai-chat': () => (openBusy(), d.clickName(/^Ask AI/), d.sleep(1500)),
  'ai-chat-typed': () => (openBusy(), d.clickName(/^Ask AI/), d.sleep(1300), d.ab('keyboard', 'type', 'make it calmer'), d.sleep(400)),
};
for (const [name, fn] of Object.entries(states)) {
  if (!filter.test(name)) continue;
  fn();
  d.shot(`${theme}-busy-${name}`);
  const bad = sweep(`${theme}-${name}`);
  void bad;
}
