// S1.23 G3 — a trashed artboard is listed by its LABEL, not its id slug. The label the trash action
// records comes from `artboardLabels(source)`; a print artboard (`print={{ w: 210, … }}`) has a nested
// brace in its tag, which the old scanner could not cross, so it fell back to the id ("arch-1-vnejsek-str-4").
import { describe, expect, test } from 'bun:test';

import { artboardLabels } from '../edit-ops/duplicate-at-width.ts';

describe('artboardLabels', () => {
  test('a print artboard (nested braces in its tag) still gives its label', () => {
    const src = `<DesignCanvas>
  <DCArtboard id="arch-1-vnejsek-str-4" label="Arch 1 · vnitřek" width={320} height={420} kind="print" print={{ w: 210, h: 297, bleed: 3, unit: "mm" }}>
    <div />
  </DCArtboard>
</DesignCanvas>`;
    expect(artboardLabels(src).get('arch-1-vnejsek-str-4')).toBe('Arch 1 · vnitřek');
  });

  test('the label may come after a braced prop, or on its own line', () => {
    const src = `<DCArtboard
  id="a"
  print={{ paper: "a6", bleedMm: 3 }}
  style={{ background: fn(() => 1) }}
  label="Přední strana"
>x</DCArtboard>`;
    expect(artboardLabels(src).get('a')).toBe('Přední strana');
  });

  test('a ">" inside a string or a brace does not end the tag', () => {
    const src = `<DCArtboard id="b" note={a > b ? "x>y" : 'z'} label="Big > small" width={1}>x</DCArtboard>`;
    expect(artboardLabels(src).get('b')).toBe('Big > small');
  });

  test('an artboard with no label gives its id; a plain one is unchanged', () => {
    const src = `<DCArtboard id="c" width={1}>x</DCArtboard><DCArtboard id="d" label="Desktop" width={1}>y</DCArtboard>`;
    const m = artboardLabels(src);
    expect(m.get('c')).toBe('c');
    expect(m.get('d')).toBe('Desktop');
  });
});
