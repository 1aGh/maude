import * as d from './drv.mjs';
d.ab('set', 'viewport', '1600', '1000');
d.ab('set', 'media', 'reduced-motion');
d.open('http://127.0.0.1:4431/');
d.clickName(/^Smoke$/);
d.sleep(2500);
d.shot('native-smoke');
console.log(d.ab('snapshot', '-i').out.split('\n').filter((l) => !/treeitem|Pin |Actions for|Show the artboards/.test(l)).slice(0, 60).join('\n'));
