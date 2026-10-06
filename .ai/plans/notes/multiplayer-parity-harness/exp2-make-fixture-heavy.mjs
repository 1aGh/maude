// Builds the exp2 "large whiteboard" project: 48 artboards (perf-canvas fixture) + 60 stickies
// interleaved in the gutters/below the grid, written under the CORRECT annotations slug.
import { writeFileSync } from 'node:fs';
import { writePerfCanvas } from '/Users/iagh/git/personal/maude/apps/studio/test/fixtures/perf-canvas.mjs';
const root = process.argv[2];
const designRoot = `${root}/.design`;
writeFileSync(`${designRoot}/config.json`, JSON.stringify({ name: 'e2e-exp2', designRoot: '.design', canvasGroups: [{ label: 'UI', path: 'ui' }] }, null, 2));
const r = writePerfCanvas({ designRoot, boards: Number(process.argv[3]||48), strokes: 0, slug: 'team-structure' });
const nodes = [];
for (let i = 0; i < Number(process.argv[4]||60); i++) {
  const x = (i % 24) * 280;
  const y = Math.ceil(Number(process.argv[3]||48)/8) * 880 + 100 + Math.floor(i / 24) * 280; // band right below the 8x6 board grid
  nodes.push(`<g data-id="st_${i}" data-tool="sticky" data-r="8" data-fs="14" fill="#cfc4ec"><rect x="${x}" y="${y}" width="240" height="240" rx="8" ry="8"/><text data-sticky-body="1" x="${x + 12}" y="${y + 12}" font-size="14" fill="#1a1a1a" dominant-baseline="hanging">Sticky ${i}</text></g>`);
}
writeFileSync(`${designRoot}/ui-team-structure.annotations.svg`, `<svg xmlns="http://www.w3.org/2000/svg" data-mdcc-annotations="1">${nodes.join('')}</svg>`);
console.log(r);
