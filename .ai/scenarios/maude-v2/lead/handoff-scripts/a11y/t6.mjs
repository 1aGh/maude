import * as d from './drv.mjs';
d.ab('set', 'viewport', '1600', '1000');
d.open('http://127.0.0.1:4431/');
d.sleep(1500);
d.clickName(/project menu/);
d.sleep(400);
d.clickName(/^Diagnostics/);
d.sleep(600);
console.log(d.ab('snapshot', '-i').out.split('\n').filter((l) => /menuitem/.test(l)).join('\n'));
