// Which first size does an iframe's document see? Parent on :P1, child on :P2 (cross-origin, like the canvas origin).
import { createServer } from 'node:http';
import { chromium, webkit } from '/Users/iagh/git/personal/maude/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright/index.mjs';

const child = `<!doctype html><html><head><style>html,body{margin:0;height:100%}#host{position:absolute;inset:0}</style></head>
<body><div id=host></div><script>
const h=document.getElementById('host');
const rep=(tag)=>parent.postMessage({tag,w:h.clientWidth,h:h.clientHeight,iw:innerWidth,ih:innerHeight,vis:document.visibilityState},'*');
rep('sync');
requestAnimationFrame(()=>rep('raf'));
setTimeout(()=>rep('t200'),200);
</script></body></html>`;
const parentHtml = (port, mode) => `<!doctype html><html><head><style>
main{position:relative;width:1000px;height:700px}
main>iframe{position:absolute;inset:0;width:100%;height:100%;border:0;display:none}
main>iframe.active{display:block}
</style></head><body><main id=m></main><script>
window.log=[];addEventListener('message',e=>log.push(e.data));
const f=document.createElement('iframe');
f.src='http://127.0.0.1:${port}/child';
${mode === 'inactive' ? "f.className='';setTimeout(()=>f.className='active',400);" : "f.className='active';"}
document.getElementById('m').appendChild(f);
${mode === 'busy' ? 'const e=performance.now()+300;while(performance.now()<e){}' : ''}
</script></body></html>`;

const srv = (fn) =>
  new Promise((r) => {
    const s = createServer(fn).listen(0, '127.0.0.1', () => r(s));
  });
const c = await srv((q, res) => {
  res.setHeader('content-type', 'text/html');
  res.end(child);
});
const cport = c.address().port;
const p = await srv((q, res) => {
  res.setHeader('content-type', 'text/html');
  res.end(parentHtml(cport, new URL(q.url, 'http://x').searchParams.get('mode')));
});
const pport = p.address().port;
for (const [name, eng] of [
  ['chromium', chromium],
  ['webkit', webkit],
]) {
  const b = await eng.launch();
  for (const mode of ['active', 'inactive', 'busy']) {
    const pg = await b.newPage();
    await pg.goto(`http://127.0.0.1:${pport}/?mode=${mode}`);
    await pg.waitForTimeout(800);
    const log = await pg.evaluate(() => window.log);
    console.log(name, mode, JSON.stringify(log.map((l) => `${l.tag}:${l.w}x${l.h}`)));
    await pg.close();
  }
  await b.close();
}
c.close();
p.close();
