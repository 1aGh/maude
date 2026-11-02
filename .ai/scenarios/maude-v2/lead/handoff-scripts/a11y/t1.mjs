import * as d from './drv.mjs';
d.open('http://127.0.0.1:4431/');
console.log(JSON.stringify(d.clickName(/^Smoke$/)));
d.sleep(3000);
d.shot('smoke-dark');
const s = d.ab('snapshot', '-i').out.split('\n');
console.log(s.filter((l) => !/treeitem|Pin |Actions for|Show the artboards/.test(l)).slice(0, 80).join('\n'));
