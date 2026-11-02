import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { HARNESS, REPO } from './lib.mjs';
import { BASE } from './fx.mjs';

const CACHE = join(REPO, '.scr/c9-g3/fx-cache');

/** The e2e fixture + the Alligators assets / trailer canvases from this repo's own .design + the Matchday mixed-kind canvas. APFS clones (cp -c) so it is cheap. */
/** round 7c (09 ex-print-warn): LetakA6 — a QR code 2 mm inside the cut + a headline face whose licence forbids embedding. */
function addLetak(d) {
  cpSync(join(HARNESS, 'LetakA6.tsx'), join(d, '.design/ui/LetakA6.tsx'));
  writeFileSync(join(d, '.design/ui/LetakA6.meta.json'), JSON.stringify({ designSystem: 'Alligators' }, null, 2));
  mkdirSync(join(d, '.design/assets/fonts'), { recursive: true });
  // a minimal sfnt with one OS/2 table whose fsType is 2 (restricted licence embedding): fontFileReport says "won't embed"
  const os2 = Buffer.alloc(78);
  os2.writeUInt16BE(2, 8);
  const head = Buffer.alloc(28);
  head.writeUInt32BE(0x00010000, 0);
  head.writeUInt16BE(1, 4);
  head.write('OS/2', 12, 'latin1');
  head.writeUInt32BE(28, 20);
  head.writeUInt32BE(78, 24);
  writeFileSync(join(d, '.design/assets/fonts/avenir-next-condensed-heavy.otf'), Buffer.concat([head, os2]));
  writeFileSync(join(d, '.design/ui/LetakA6.css'), '@font-face { font-family: "Avenir Next Condensed Heavy"; src: url("../assets/fonts/avenir-next-condensed-heavy.otf") format("opentype"); }\n');
}

export async function alli() {
  const d = join(CACHE, 'alli');
  if (existsSync(join(d, '.design/ui/Matchday.tsx'))) { addLetak(d); return d; }
  rmSync(d, { recursive: true, force: true });
  mkdirSync(CACHE, { recursive: true });
  execFileSync('cp', ['-Rc', BASE, d]);
  const src = join(REPO, '.design');
  mkdirSync(join(d, '.design/assets'), { recursive: true });
  execFileSync('/bin/sh', ['-c', `cp -Rc "${src}/assets/." "${d}/.design/assets/"`]);
  for (const f of ['Alligators Recruiting Trailer.tsx', 'Alligators Recruiting Trailer.meta.json', 'Alligators Cinematic Cut.tsx', 'Alligators Cinematic Cut.meta.json'])
    if (existsSync(join(src, 'ui', f))) cpSync(join(src, 'ui', f), join(d, '.design/ui', f));
  cpSync(join(src, 'alligators-reel.edl.json'), join(d, '.design/alligators-reel.edl.json'));
  cpSync(join(HARNESS, 'Matchday.tsx'), join(d, '.design/ui/Matchday.tsx'));
  writeFileSync(join(d, '.design/ui/Matchday.meta.json'), JSON.stringify({ designSystem: 'Alligators' }, null, 2));
  // c7b: three canvases that hold shared parts, not artboards (09 ex-batch: "left out, by name")
  for (const n of ['_broadcast', '_social', '_video'])
    (mkdirSync(join(d, '.design/ui', n), { recursive: true }), writeFileSync(join(d, '.design/ui', n, 'parts.tsx'), 'import { DesignCanvas } from "@maude/canvas-lib";\nexport default function Parts() {\n  return <DesignCanvas />;\n}\n'));
  addLetak(d);
  return d;
}
