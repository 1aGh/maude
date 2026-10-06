const DP=4798; const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
import { spawn } from 'node:child_process';
const d = spawn('safaridriver',['-p',String(DP)],{stdio:'ignore'}); await sleep(1500);
const wd=async(m,p,b)=>{const r=await fetch(`http://localhost:${DP}${p}`,{method:m,headers:{'Content-Type':'application/json'},body:b===undefined?undefined:JSON.stringify(b)});return (await r.json()).value;};
const {sessionId}=await wd('POST','/session',{capabilities:{alwaysMatch:{browserName:'safari'}}});
const base=`/session/${sessionId}`;
await wd('POST',`${base}/window/rect`,{x:0,y:0,width:1600,height:1000});
await wd('POST',`${base}/url`,{url:'about:blank'});
if (process.argv[2]==='activate') { (await import('node:child_process')).execSync(`osascript -e 'tell application "Safari" to activate'`); await sleep(800); }
const v = await wd('POST',`${base}/execute/async`,{script:`const done=arguments[0]; let n=0; const t0=performance.now(); const f=()=>{n++; if(performance.now()-t0<2000) requestAnimationFrame(f); else done(JSON.stringify({n, vis: document.visibilityState, focus: document.hasFocus()}));}; requestAnimationFrame(f);`,args:[]});
console.log(v);
await wd('DELETE',base); d.kill();
