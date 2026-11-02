// S11.6 — canvas-source/source-map.ts: artboard id → { startLine, endLine } (oxc, S1.9's parse).
// An exact golden over a fixture (sections, a family id, a comment, an emoji, self-closing), and
// property goldens over six real canvases of this repo (nested sections included).

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { canvasSourceMap, lineCount } from '../canvas-source/source-map.ts';

const FIXTURE = `import { DCArtboard, DCSection, DesignCanvas } from '@maude/canvas-lib';
// <DCArtboard id="in-a-comment"> is not an artboard
const rows = [1, 2];
export default function Pricing() {
  return (
    <DesignCanvas>
      <DCSection id="plans" title="Plans 😀">
        <DCArtboard id="free" label="Free" width={400} height={300}>
          <main>😀😀</main>
        </DCArtboard>
        <DCSection id="inner">
          <DCArtboard
            id="pro"
            label="Pro"
          >
            <main />
          </DCArtboard>
        </DCSection>
      </DCSection>
      {rows.map((r) => (
        <DCArtboard key={r} id={\`row-\${r}\`} label="Row" />
      ))}
      <DCArtboard id="free" label="Duplicate id: the first wins" />
      <DCArtboard label="no id" />
    </DesignCanvas>
  );
}
`;

describe('canvasSourceMap — exact golden', () => {
  test('sections, a family, a multi-line opening tag, comments and duplicates', () => {
    expect(canvasSourceMap(FIXTURE)).toEqual({
      parsed: true,
      lines: 27,
      artboards: {
        free: { startLine: 8, endLine: 10 },
        pro: { startLine: 12, endLine: 17 },
        'row-*': { startLine: 21, endLine: 21, dynamic: true },
      },
    });
  });

  test('a source that does not parse has no map, and says so', () => {
    expect(canvasSourceMap('export default () => (<div>{x)</div>);\n')).toEqual({
      parsed: false,
      lines: 1,
      artboards: {},
    });
  });

  test('lineCount counts lines as an editor shows them', () => {
    expect([
      lineCount(''),
      lineCount('a'),
      lineCount('a\n'),
      lineCount('a\nb'),
      lineCount('\n\n'),
    ]).toEqual([0, 1, 1, 2, 2]);
  });
});

// ---------------------------------------------------------------------------
// Six real canvases (they change; the properties do not).

const REPO = join(import.meta.dir, '..', '..', '..');
const REAL = [
  '.design/ui/v2/03 AI Chat.tsx',
  '.design/ui/v2/05 Empty States.tsx',
  '.design/ui/v2/06 Advanced.tsx',
  '.design/ui/v2/10 Share and Collaboration.tsx',
  '.design/ui/Studio.tsx',
  '.design/ui/DiffView.tsx',
];

/** Literal artboard ids by a plain scan of the comment-free text (the oracle the parser must meet). */
function scanIds(src: string): string[] {
  // Comments and template literals out (a `<DCArtboard` quoted in a code sample is text).
  const noComments = src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1')
    .replace(/`[^`]*`/g, '``');
  const ids: string[] = [];
  for (const m of noComments.matchAll(
    /<DCArtboard\b[^>]*?\bid=(?:"([^"]+)"|'([^']+)'|\{\s*['"]([^'"]+)['"]\s*\})/g
  )) {
    const id = m[1] ?? m[2] ?? m[3];
    if (id && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

describe('canvasSourceMap — six real canvases', () => {
  for (const rel of REAL) {
    test(rel, () => {
      const src = readFileSync(join(REPO, rel), 'utf8');
      const lines = src.split('\n');
      const map = canvasSourceMap(src);
      expect(map.parsed).toBe(true);
      const literal = Object.keys(map.artboards).filter((id) => !id.includes('*'));
      expect(literal.length).toBeGreaterThan(0);
      expect(literal.sort()).toEqual(scanIds(src).sort());
      const spans = Object.entries(map.artboards)
        .filter(([id]) => !id.includes('*'))
        .map(([id, r]) => ({ id, ...r }))
        .sort((a, b) => a.startLine - b.startLine);
      for (const s of spans) {
        expect(`${s.id}: ${lines[s.startLine - 1]}`).toContain('<DCArtboard');
        const body = lines.slice(s.startLine - 1, s.endLine).join('\n');
        expect(body).toContain(s.id);
        expect(`${s.id}: ${lines[s.endLine - 1]}`).toMatch(/<\/DCArtboard>|\/>/);
      }
      // Artboards never nest, so their spans never overlap.
      for (let i = 1; i < spans.length; i++)
        expect(spans[i]?.startLine).toBeGreaterThan(spans[i - 1]?.endLine - 1);
    });
  }

  test('at least one of them nests artboards inside sections, and those are mapped', () => {
    const nested = REAL.some((rel) => {
      const src = readFileSync(join(REPO, rel), 'utf8');
      const map = canvasSourceMap(src);
      const lines = src.split('\n');
      const open = lines.findIndex((l) => l.includes('<DCSection'));
      return open >= 0 && Object.values(map.artboards).some((r) => r.startLine - 1 > open);
    });
    expect(nested).toBe(true);
  });
});
