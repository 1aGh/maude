import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const require = createRequire('/Users/iagh/git/personal/maude/apps/studio/package.json');
const { PDFDocument, PDFName } = require('pdf-lib');
const doc = await PDFDocument.load(readFileSync(process.argv[2]));
const p = doc.getPage(0);
const r = (b) => ({ x: b.x, y: b.y, w: b.width, h: b.height });
const has = (k) => p.node.get(PDFName.of(k)) !== undefined;
console.log(JSON.stringify({ pages: doc.getPageCount(), hasBleedBox: has('BleedBox'), hasTrimBox: has('TrimBox'), media: r(p.getMediaBox()), bleed: r(p.getBleedBox()), trim: r(p.getTrimBox()), trimMm: { w: +(p.getTrimBox().width*25.4/72).toFixed(2), h: +(p.getTrimBox().height*25.4/72).toFixed(2) }, bleedMm: { w: +(p.getBleedBox().width*25.4/72).toFixed(2), h: +(p.getBleedBox().height*25.4/72).toFixed(2) } }, null, 1));
