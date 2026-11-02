import * as d from './drv.mjs';
d.open('http://127.0.0.1:4431/');
console.log(d.ab('snapshot', '-i').out.split('\n').filter((l) => /button/.test(l) && !/Pin |Actions for|Show the artboards/.test(l)).slice(0, 25).join('\n'));
console.log(d.ev(`JSON.stringify(Object.keys(localStorage).filter(k=>/panel|hide|left|maude/i.test(k)).map(k=>[k,localStorage[k].slice(0,80)]))`));
