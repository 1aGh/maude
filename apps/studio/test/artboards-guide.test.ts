// S12.10 — the AI's artboards reference (plugins/design/skills/design/_guide-28-artboards.md) is held
// to the ONE preset catalogue the picker, the `artboard.insert-preset` op and the inspector read
// (kinds/presets.ts). A preset added, renamed or resized there is a red test until the guide says it.

import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { KIND_WORD, PRESET_GROUPS, PRESETS } from '../kinds/presets.ts';

const GUIDE = readFileSync(
  join(
    import.meta.dir,
    '..',
    '..',
    '..',
    'plugins',
    'design',
    'skills',
    'design',
    '_guide-28-artboards.md'
  ),
  'utf8'
);
const rowOf = (id: string) => GUIDE.split('\n').find((l) => l.includes(`\`${id}\``)) ?? '';

test('every catalogue preset has a row in the artboards guide with its id and its size', () => {
  for (const p of PRESETS) {
    const row = rowOf(p.id);
    expect(row, `${p.id} has a row`).not.toBe('');
    expect(row, `${p.id} name`).toContain(p.name);
    expect(row, `${p.id} width`).toContain(`width={${p.widthPx}}`);
    expect(row, `${p.id} height`).toContain(`height={${p.heightPx}}`);
  }
});

test('the guide names the picker groups and the one designer word per kind', () => {
  for (const g of PRESET_GROUPS) expect(GUIDE).toContain(g.title);
  expect(GUIDE).toContain(KIND_WORD.digital);
  expect(GUIDE).toContain(KIND_WORD.web);
  expect(GUIDE).toContain('Custom size');
});

test('a preset row writes the kind the catalogue says', () => {
  for (const p of PRESETS) {
    const row = rowOf(p.id);
    expect(row, `${p.id} kind`).toContain(`kind="${p.kind}"`);
    if (p.kind === 'digital') expect(row, `${p.id} fixed`).toContain('fixed');
    if (p.kind === 'web') expect(row, `${p.id} hugs`).not.toContain('fixed');
    if (p.print) expect(row, `${p.id} paper`).toContain(`"paper":"${p.print.paper}"`);
    if (p.fps) expect(row, `${p.id} fps`).toContain(`fps={${p.fps}}`);
  }
});
