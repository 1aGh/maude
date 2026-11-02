// Keyboard-only run of the create flow: real key events (agent-browser press / keyboard type), no pointer.
import * as d from './drv.mjs';
const DESC = `(()=>{const e=document.activeElement;if(!e)return 'none';let f=e;const nm=(x)=>(x.getAttribute('aria-label')||x.getAttribute('title')||x.placeholder||x.textContent||'').trim().replace(/\\s+/g,' ').slice(0,60);
let s=e.tagName.toLowerCase()+(e.getAttribute('role')?'['+e.getAttribute('role')+']':'')+' "'+nm(e)+'"';
if(e.tagName==='IFRAME'){try{const a=e.contentDocument.activeElement;s+=' > '+a.tagName.toLowerCase()+' "'+nm(a)+'"'}catch{}}
const live=document.querySelector('[data-testid=edit-aria-live]');
return s+(live&&live.textContent?'  | live: '+live.textContent.slice(0,90):'')})()`;
const step = (label, ...keys) => {
  for (const k of keys) {
    if (k.startsWith('type:')) d.ab('keyboard', 'type', k.slice(5));
    else d.press(k);
    d.sleep(350);
  }
  console.log(String(label).padEnd(34), d.ev(DESC));
};
d.ab('set', 'viewport', '1600', '1000');
d.ab('set', 'media', 'reduced-motion');
console.log('theme', d.setTheme('http://127.0.0.1:4432', 'dark'));
d.open('http://127.0.0.1:4432/');
d.sleep(1200);
step('0 open');
const trail = [];
for (let i = 0; i < 16; i++) {
  d.press('Tab');
  d.sleep(200);
  trail.push(d.ev(DESC));
}
console.log('Tab x16 from load:\n  ' + trail.map((t, i) => `${i + 1}. ${t}`).join('\n  '));
