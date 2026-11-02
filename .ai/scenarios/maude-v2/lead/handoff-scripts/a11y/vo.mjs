import * as d from './drv.mjs';
const LIVE = `(()=>{const q=(doc)=>{const e=doc.querySelector('[data-testid=edit-aria-live]');return e?JSON.stringify({role:e.getAttribute('role'),live:e.getAttribute('aria-live'),text:e.textContent}):null};
let r=q(document);if(r)return 'top '+r;for(const f of document.querySelectorAll('iframe')){try{r=q(f.contentDocument);if(r)return 'frame '+r}catch{}}return 'none'})()`;
d.ab('set', 'viewport', '1600', '1000');
d.ab('set', 'media', 'reduced-motion');
d.open('http://127.0.0.1:4435/');
d.sleep(2500);
console.log('live region at rest:', d.ev(LIVE));
// focus the canvas: click the iframe body area is a pointer; use the keyboard: Tab until the frame holds focus
for (let i = 0; i < 12; i++) {
  d.press('Tab');
  d.sleep(150);
  if (String(d.ev(`document.activeElement&&document.activeElement.tagName`)) === 'IFRAME') break;
}
console.log('in frame:', d.ev(`document.activeElement.tagName`));
for (const k of ['Tab', 'Tab', 'Tab', 'Shift+Tab']) {
  d.press(k);
  d.sleep(400);
  console.log(k.padEnd(10), d.ev(LIVE));
}
// accessible names in the shell
const snap = d.ab('snapshot', '-i').out.split('\n').filter((l) => !/treeitem|Pin |Actions for|Show the artboards/.test(l)).map((l) => l.trim().replace(/\[ref=e\d+\]/, '').trim());
console.log(snap.slice(0, 45).join('\n'));
