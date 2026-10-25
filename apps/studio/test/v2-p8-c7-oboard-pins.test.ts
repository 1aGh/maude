// P8 round 7 (02 / 04 / 05 fidelity): cheap source pins for the CSS / wiring a render test cannot reach.
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const src = (rel: string) => readFileSync(join(import.meta.dir, '..', rel), 'utf8');

describe('05 es-offline-uncached / es-arriving: the card centres on the free canvas', () => {
  test('the viewport hands the free centre to the card, and the card honours it', () => {
    const v = src('client/shell/viewport.jsx');
    expect(v).toContain("'--es-cx': freeCx");
    expect(v.match(/className="st-not-local active"/g)?.length).toBe(2);
    const css = src('client/v2/empty/empty.css');
    expect(css).toMatch(
      /\.st-not-local\s*\{[^}]*padding-left:\s*max\(0px, calc\(2 \* var\(--es-cx, 50%\) - 100%\)\)/s
    );
  });
});

describe('05 es-filter: the kit block stands alone under the chips', () => {
  test('the Layers body draws no tree while the kind filter matches no artboard', () => {
    const p = src('client/inspector/inspector-panel.jsx');
    expect(p).toContain('layersKindNone');
    expect(p).toContain("effTab === 'layers' && layersKindNone ? null");
  });
});
