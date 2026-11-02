import { cpSync, readFileSync, rmSync } from 'node:fs';
import { annotate } from './ann.mjs';
import { studioSite } from './fx5.mjs';
const src = await studioSite();
const p = src + '-probe';
rmSync(p, { recursive: true, force: true });
cpSync(src, p, { recursive: true });
const r = annotate(p, 'ui/Homepage.tsx', [
  { op: 'create', type: 'sticky', ref: '@a', text: 'Tighter, please', to: 'ab:desktop' },
  { op: 'create', type: 'sticky', ref: '@b', text: 'Is this the right CTA?', in: 'desktop' },
]);
console.log(r.stdout.slice(0, 1500), r.stderr.slice(0, 800));
console.log(readFileSync(p + '/.design/ui-homepage.annotations.json', 'utf8').slice(0, 1500));
