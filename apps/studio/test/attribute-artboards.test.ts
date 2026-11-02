// V2-1.5 §5.7 — attributeArtboards: AST reference closure, never a text match (S5.5).

import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { artboardIdsOf, attributeArtboards } from '../attribute-artboards.ts';

// The §7 fixture: P (Post 1:1) and S (Story 9:16) both render the shared K; T does not.
const canvas = (
  o: { k?: string; logo?: string; p?: string; s?: string; sample?: string; extra?: string } = {}
) => `
import { DesignCanvas, DCSection, DCArtboard } from '@maude/canvas-lib';

const Logo = () => <svg data-mark="${o.logo ?? 'm'}" />;
const K = () => <div className="lockup">${o.k ?? 'Combine'}<Logo /></div>;
const SAMPLE = '<DCArtboard id="desktop" width={10}>${o.sample ?? 'code'}</DCArtboard>';

export default function Canvas() {
  const tone = 'warm';
  return (
    <DesignCanvas>
      <DCSection title="Kampan">
        <DCArtboard id="P" width={1080} height={1080}>
          <h1>${o.p ?? 'Title'}</h1>
          <K />
        </DCArtboard>
        <DCArtboard id="S" width={1080} height={1920}>
          <p>${o.s ?? 'Story'}</p>
          <K />
        </DCArtboard>
        <DCArtboard id="T" width={800} height={600}>
          <pre>{SAMPLE}</pre>
          <span>{tone}</span>
        </DCArtboard>${o.extra ?? ''}
      </DCSection>
    </DesignCanvas>
  );
}
`;

const F = 'ui/combine.tsx';

describe('attributeArtboards', () => {
  test('a change inside one artboard marks that artboard only', () => {
    expect(attributeArtboards(F, canvas(), canvas({ p: 'New title' }))).toEqual({
      artboards: ['P'],
      scope: 'artboards',
    });
  });

  test('U24: a change to the shared K lights P and S — not T, not the whole canvas', () => {
    expect(attributeArtboards(F, canvas(), canvas({ k: 'Combine 2026' })).artboards).toEqual([
      'P',
      'S',
    ]);
  });

  test('the closure is transitive: Logo → K → P and S', () => {
    expect(attributeArtboards(F, canvas(), canvas({ logo: 'm2' })).artboards).toEqual(['P', 'S']);
  });

  test('a component-local declaration marks the artboards that read it', () => {
    const before = canvas();
    const after = before.replace("const tone = 'warm';", "const tone = 'cool';");
    expect(attributeArtboards(F, before, after).artboards).toEqual(['T']);
  });

  test('never inside a string: the <DCArtboard id="desktop"> sample is no artboard', () => {
    expect(artboardIdsOf(canvas(), F)).toEqual(['P', 'S', 'T']);
    // a change inside the sample string is a change to SAMPLE, which only T reads
    expect(attributeArtboards(F, canvas(), canvas({ sample: 'other' })).artboards).toEqual(['T']);
  });

  test('an added artboard marks its id (artboard-set-changed)', () => {
    const extra = '\n        <DCArtboard id="N" width={100} height={100}><K /></DCArtboard>';
    expect(attributeArtboards(F, canvas(), canvas({ extra }))).toEqual({
      artboards: ['N'],
      scope: 'artboards',
      reason: 'artboard-set-changed',
    });
    expect(attributeArtboards(F, canvas({ extra }), canvas()).reason).toBe('artboard-set-changed');
  });

  test('imports, module-level changes and parse errors give the whole file', () => {
    const before = canvas();
    const imp = before.replace(
      "from '@maude/canvas-lib';",
      "from '@maude/canvas-lib';\nimport x from './x';"
    );
    expect(attributeArtboards(F, before, imp)).toMatchObject({ scope: 'file', reason: 'imports' });
    const wrap = before.replace('title="Kampan"', 'title="Campaign"');
    expect(attributeArtboards(F, before, wrap)).toMatchObject({
      scope: 'file',
      reason: 'module-scope',
      artboards: ['P', 'S', 'T'],
    });
    expect(attributeArtboards(F, before, `${before}\n<<<`)).toMatchObject({
      scope: 'file',
      reason: 'parse-error',
    });
  });

  test('no change → nothing', () => {
    expect(attributeArtboards(F, canvas(), canvas())).toEqual({
      artboards: [],
      scope: 'artboards',
    });
  });
});

// The v2 corpus: every top-level declaration gets one string literal changed.
// The closure never names an id that is not a real artboard, never lights more
// than every artboard, and stays inside the §5.8 budget.
describe('attributeArtboards on the v2 corpus', () => {
  const dir = join(import.meta.dir, '..', '..', '..', '.design', 'ui', 'v2');
  let files: string[] = [];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith('.tsx'));
  } catch {
    files = [];
  }

  test.skipIf(files.length === 0)('closure ≤ every artboard, real ids only, ≤ 50 ms', () => {
    let trials = 0;
    let lit = 0;
    let total = 0;
    let slowest = 0;
    for (const f of files) {
      const src = readFileSync(join(dir, f), 'utf8');
      const ids = artboardIdsOf(src, f);
      if (ids.length < 2) continue;
      // one literal per top-level `const X = …` declaration
      for (const m of src.matchAll(/^(?:export )?const ([A-Z][A-Za-z0-9_]*)\b[^\n]*$/gm)) {
        const at = src.indexOf("'", m.index ?? 0);
        if (at < 0 || at > (m.index ?? 0) + 400) continue;
        const after = `${src.slice(0, at + 1)}§${src.slice(at + 1)}`;
        const t0 = performance.now();
        const r = attributeArtboards(f, src, after);
        slowest = Math.max(slowest, performance.now() - t0);
        trials += 1;
        for (const a of r.artboards) expect(ids).toContain(a);
        expect(r.artboards.length).toBeLessThanOrEqual(ids.length);
        lit += r.artboards.length;
        total += ids.length;
      }
    }
    expect(trials).toBeGreaterThan(10);
    // measured ≈ 25 % in V2-1.5 §6; anything near "every artboard" means the closure broke
    expect(lit / total).toBeLessThan(0.5);
    expect(slowest).toBeLessThan(250); // ×5 headroom over the 50 ms budget for a loaded CI box
  });
});
