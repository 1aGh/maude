// A stand-in Ghostscript for `test/pdf-text-outline.test.ts` (B4, fix-bulk 2026-11-10).
//
// It does what a reported Ghostscript run did to a bleed document: the page's MediaBox is
// re-based to a 0,0 origin (-9.92 -> 0, same size) and the TrimBox / BleedBox are dropped. The
// glyphs are left alone; the test is about the boxes. Invoked via `MAUDE_GHOSTSCRIPT="bun <this>"`
// with gs's own argv shape: `--version`, or `-o <out> ...flags <in>`.

import { readFileSync, writeFileSync } from 'node:fs';
import { PDFDocument, PDFName } from 'pdf-lib';

const argv = process.argv.slice(2);
if (argv.includes('--version')) {
  console.log('10.00.0-fake');
  process.exit(0);
}
const outAt = argv.indexOf('-o');
const outPath = argv[outAt + 1];
const inPath = argv[argv.length - 1];
if (outAt < 0 || !outPath || !inPath) process.exit(2);

const doc = await PDFDocument.load(readFileSync(inPath));
for (const page of doc.getPages()) {
  const media = page.getMediaBox();
  page.setMediaBox(0, 0, media.width, media.height);
  page.node.delete(PDFName.of('TrimBox'));
  page.node.delete(PDFName.of('BleedBox'));
}
writeFileSync(outPath, await doc.save());
