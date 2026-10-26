import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
const root = process.argv[2];
const ui = join(root, '.design/ui');
rmSync(ui, { recursive: true, force: true });
mkdirSync(ui, { recursive: true });
const slug = (s) =>
  s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
const KINDS = { print: ['print', 320, 420], digital: ['digital', 360, 480] };
function canvas(rel, title, abs) {
  const name = rel.split('/').pop();
  const parts = abs
    .map(([l, k], i) => {
      const [kind, w, h] = KINDS[k] || KINDS.digital;
      const id = slug(l) + '-' + i;
      const printProp = kind === 'print' ? ' print={{ w: 210, h: 297, bleed: 3, unit: "mm" }}' : '';
      return `        <DCArtboard id="${id}" label=${JSON.stringify(l)} width={${w}} height={${h}} kind="${kind}"${printProp}>
          <div style={{ width: '100%', height: '100%', background: '#10331f', color: '#e8ffe8', display: 'grid', placeItems: 'center', fontSize: 22, fontWeight: 700, padding: 16, textAlign: 'center' }}>${l.replace(/[{}<>]/g, '')}</div>
        </DCArtboard>`;
    })
    .join('\n');
  const src = `import { DCArtboard, DCSection, DesignCanvas } from '@maude/canvas-lib';

export default function ${name.replace(/[^A-Za-z0-9]/g, '_').replace(/^(\d)/, '_$1')}() {
  return (
    <DesignCanvas>
      <DCSection id="main" title=${JSON.stringify(title || name)}>
${parts}
      </DCSection>
    </DesignCanvas>
  );
}
`;
  const dir = join(ui, rel.split('/').slice(0, -1).join('/'));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(ui, rel + '.tsx'), src);
  writeFileSync(
    join(ui, rel + '.meta.json'),
    JSON.stringify(
      {
        title: name,
        platform: 'web',
        designSystem: 'maude',
        kind: 'canvas',
        status: 'draft',
        sections: [{ id: 'main', title: title || name }],
        artboards: [],
      },
      null,
      2
    )
  );
}
const KAMPAN = [
  ['Release plan · Combine 2026 (4 týdny)', 'digital'],
  ['FB event cover · FB Event · 1.91:1', 'digital'],
  ['FB event cover · varianta B, datum vpředu', 'digital'],
  ['FB event cover · varianta C, žlutá', 'digital'],
  ['FB event cover · kontrola safe zóny (nenahrávat)', 'digital'],
  ['Oznámení události · Instagram · IG Post · 4:5', 'digital'],
  ['Carousel cover · sedm disciplín · IG Post · 4:5', 'digital'],
  ['Slide 01 · 40 YARD DASH · IG Post · 4:5', 'digital'],
  ['Slide 02 · BENCH PRESS · IG Post · 4:5', 'digital'],
  ['Slide 03 · VERTICAL JUMP · IG Post · 4:5', 'digital'],
  ['Slide 04 · BROAD JUMP · IG Post · 4:5', 'digital'],
  ['Slide 05 · 3-CONE DRILL · IG Post · 4:5', 'digital'],
  ['Slide 06 · 20-YARD SHUTTLE · IG Post · 4:5', 'digital'],
  ['Slide 07 · POSITION DRILLS · IG Post · 4:5', 'digital'],
  ['Přehled všech sedmi · IG Post · 4:5', 'digital'],
  ['Pozvánka na combine · IG Post · 4:5', 'digital'],
  ['Obálka videosérie · pozvánka od hosta · IG Story · 9:16', 'digital'],
  ['Pozvánka · story · IG Story · 9:16', 'digital'],
  ['Zítra se měří · countdown story · IG Story · 9:16', 'digital'],
  ['Arch 1 · vnějšek (str. 4 + str. 1) · A4 landscape, spadávka 3 mm', 'print'],
  ['Arch 2 · vnitřek (str. 2 + str. 3) · A4 landscape, spadávka 3 mm', 'print'],
];
canvas('2026/combine/Combine-kampan', 'Combine kampaň', KAMPAN);
canvas('2026/combine/Combine-letak-registrace', 'Leták registrace', [
  ['Leták · přední', 'print'],
  ['Leták · zadní', 'print'],
]);
for (const n of ['Combine-test', 'Combine-video-AI', 'Combine-web', 'Combine-plan'])
  canvas(`2026/combine/${n}`, n, [[n + ' · A', 'digital']]);
canvas('2026/dresy/Uniformy-2027', 'Uniformy 2027', [
  ['Domácí dres · přední', 'print'],
  ['Venkovní dres · přední', 'print'],
  ['Helma z boku', 'print'],
  ['Kalhoty doma', 'print'],
  ['Kalhoty venku', 'print'],
  ['Domácí dres 2027 · přední', 'print'],
  ['Venkovní dres 2027 · přední', 'print'],
  ['Domácí dres · zadní', 'print'],
  ['Venkovní dres · zadní', 'print'],
  ['Helma zepředu', 'print'],
  ['Rukavice', 'print'],
  ['Ponožky', 'print'],
]);
canvas('2026/social/Super-Bowl-Watch-Party', 'Super Bowl', [['Pozvánka', 'digital']]);
canvas('2026/social/Super-Bowl-Watch-Party — kopie', 'Super Bowl kopie', [['Pozvánka', 'digital']]);
canvas('website/club-web/responsive', 'responsive', [
  ['Mobil · domů', 'digital'],
  ['Desktop · domů', 'digital'],
  ['Tablet · domů', 'digital'],
  ['Mobil · program', 'digital'],
  ['Desktop · program', 'digital'],
  ['Mobil · kontakt', 'digital'],
]);
canvas('website/website', 'website', [
  ['Mobil · nábor 2027', 'digital'],
  ['Desktop · nábor', 'digital'],
]);
canvas('print/LetakA6', 'LetakA6', [
  ['A · přední FLAG', 'print'],
  ['B · zadní FLAG', 'print'],
  ['C · přední TACKLE', 'print'],
  ['D · zadní TACKLE', 'print'],
]);
canvas('legacy/letak-nabor-2022-old', 'old', [['Leták', 'print']]);
canvas('legacy/uniformy-2026-stare', 'old', [['Dres', 'print']]);
for (const n of ['ahoj', 'ahoj2', 'Test2']) canvas(n, n, [[n, 'digital']]);
for (let i = 1; i <= 76; i++)
  canvas(`archive/Draft-${String(i).padStart(2, '0')}`, 'Draft', [[`Draft ${i}`, 'digital']]);
mkdirSync(join(ui, '2027'), { recursive: true });
console.log('done');
