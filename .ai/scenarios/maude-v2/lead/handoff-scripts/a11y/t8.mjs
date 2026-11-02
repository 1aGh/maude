import * as d from './drv.mjs';
d.open('http://127.0.0.1:4432/');
d.sleep(2500);
d.shot('empty-now');
console.log(d.ab('snapshot', '-i').out.split('\n').filter((l) => !/treeitem|Pin |Actions for|Show the artboards/.test(l)).slice(0, 40).join('\n'));
console.log(d.ev(`JSON.stringify(Object.fromEntries(Object.keys(localStorage).map(k=>[k,localStorage[k].slice(0,60)])))`));
