import { readFileSync, readdirSync } from 'node:fs';
import * as d from './drv.mjs';
const DESC = `(()=>{const e=document.activeElement;if(!e)return 'none';const nm=(x)=>(x.getAttribute('aria-label')||x.getAttribute('title')||x.placeholder||x.textContent||'').trim().replace(/\\s+/g,' ').slice(0,60);
let s=e.tagName.toLowerCase()+(e.getAttribute('role')?'['+e.getAttribute('role')+']':'')+' "'+nm(e)+'"';
if(e.tagName==='IFRAME'){try{const a=e.contentDocument.activeElement;s+=' > '+a.tagName.toLowerCase()+' "'+nm(a)+'"'}catch{}}
const live=document.querySelector('[data-testid=edit-aria-live]');
return s+(live&&live.textContent?'  | live: '+live.textContent.slice(0,100):'')})()`;
const step = (label, ...keys) => {
  for (const k of keys) {
    if (k.startsWith('type:')) d.ab('keyboard', 'type', k.slice(5));
    else d.press(k);
    d.sleep(450);
  }
  console.log(String(label).padEnd(30), d.ev(DESC));
};
d.ab('set', 'viewport', '1600', '1000');
d.ab('set', 'media', 'reduced-motion');
d.open('http://127.0.0.1:4435/');
d.sleep(1500);
step('0 open');
step('1 Tab Tab Enter', 'Tab', 'Tab', 'Enter');
d.sleep(2500);
console.log('   title:', d.ev('document.title'), '| canvas frame:', d.ev(`!!document.querySelector('iframe')`));
step('2a F', 'f');
for (let i = 0; i < 8 && !/Desktop/.test(String(d.ev(DESC))); i++) step(`2b Tab (to a size tile) #${i + 1}`, 'Tab');
step('2c Enter (pick the size)', 'Enter');
d.sleep(1200);
step('3 Tab (walk objects)', 'Tab');
step('3b Tab', 'Tab');
step('4 T', 't');
step('4b Enter (add text)', 'Enter');
step('5 Enter (type into text)', 'Enter');
step('5b type', 'type:Hello keyboard');
step('5c Enter (commit)', 'Enter');
step('6 Meta+z (undo)', 'Meta+z');
step('7 Shift+Meta+e (Export)', 'Shift+Meta+e');
const tabs = [];
for (let i = 0; i < 14; i++) {
  d.press('Tab');
  d.sleep(200);
  tabs.push(d.ev(DESC));
}
console.log('   export Tab walk:\n     ' + tabs.map((t, i) => `${i + 1}. ${t}`).join('\n     '));
step('7b Escape', 'Escape');
d.shot('kb-end');
// the file on disk
const dir = `${d.W}/kbp/.design`;
const f = readdirSync(`${dir}`).concat(readdirSync(`${dir}/ui`).map((x) => 'ui/' + x)).filter((x) => /\.tsx$/.test(x));
console.log('files:', f);
for (const x of f) {
  const src = readFileSync(`${dir}/${x}`, 'utf8');
  console.log(x, 'has Hello keyboard:', src.includes('Hello keyboard'), '| text nodes:', [...src.matchAll(/<p[^>]*>([^<]*)<\/p>/g)].map((m) => m[1]).slice(0, 5));
}
