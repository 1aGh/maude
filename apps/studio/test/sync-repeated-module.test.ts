import { describe, expect, test } from 'bun:test';

import { collapseRepeatedModule, collapseRepeatedText } from '../sync/repeated-module.ts';

const mod = `import { DesignCanvas } from '@maude/canvas-lib';\n\nexport default function Leaflet() {\n  return <DesignCanvas><h1>Registrace</h1></DesignCanvas>;\n}\n`;

describe('collapseRepeatedModule', () => {
  test('a module written 2× and 4× collapses to one copy', () => {
    expect(collapseRepeatedModule(mod + mod)).toEqual({ unit: mod, times: 2, partialTail: false });
    expect(collapseRepeatedModule(mod.repeat(4))).toEqual({
      unit: mod,
      times: 4,
      partialTail: false,
    });
  });

  test('a whole copy followed by a cut-short copy collapses (the colors-accent case)', () => {
    const cut = mod + mod.slice(0, 90);
    expect(collapseRepeatedModule(cut)).toEqual({ unit: mod, times: 2, partialTail: true });
  });

  test('a single module, a real edit in one copy, or a non-module is left alone', () => {
    expect(collapseRepeatedModule(mod)).toBeNull();
    const edited = mod + mod.replace('Registrace', 'Registrace 2026');
    expect(collapseRepeatedModule(edited)).toBeNull();
    const notAModule = 'const a = 1;\n'.repeat(10);
    expect(collapseRepeatedModule(notAModule)).toBeNull();
  });

  test('two different default-exporting modules are not a repeat', () => {
    const other = mod.replace('Leaflet', 'Poster');
    expect(collapseRepeatedModule(mod + other)).toBeNull();
  });
});

describe('collapseRepeatedText', () => {
  const css = '.leaflet { color: #0a1f44; padding: 24px; }\n';
  test('an exact k-fold stylesheet collapses; a normal one does not', () => {
    expect(collapseRepeatedText(css + css)).toEqual({ unit: css, times: 2 });
    expect(collapseRepeatedText(css.repeat(4))).toEqual({ unit: css, times: 4 });
    expect(collapseRepeatedText(css)).toBeNull();
  });
});
