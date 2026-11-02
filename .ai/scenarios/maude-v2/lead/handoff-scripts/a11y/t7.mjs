import * as d from './drv.mjs';
const r = d.ev(`(()=>{let n=0,t=0;for(const el of document.querySelectorAll('body *')){t++;let own='';for(const x of el.childNodes)if(x.nodeType===3)own+=x.nodeValue;if(own.trim())n++}return JSON.stringify({t,n,w:innerWidth,h:innerHeight,title:document.title})})()`);
console.log(r);
