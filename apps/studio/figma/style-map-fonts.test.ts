// #155 §3 (D8) — the Figma font family is mapped onto the DS sans / serif / mono
// stacks through a closed allowlist. It is never written verbatim: the canvas CSP
// is `font-src 'self'`, so the raw family could not load anyway.

import { describe, expect, test } from 'bun:test';
import {
  classifyFamily,
  isDsFontValue,
  MONO_STACK,
  resolveDsFontStack,
  SERIF_STACK,
  SYSTEM_STACK,
} from './codegen-fonts.ts';
import { mapTypeStyle } from './style-map.ts';
import { toArtboard } from './to-artboard.ts';
import { normalizeDocument } from './types.ts';

const FONT_TOKENS = [
  { name: '--font-body', value: "'hanken grotesk', 'inter', system-ui, sans-serif" },
  { name: '--font-display', value: "'fraunces', georgia, serif" },
  { name: '--font-serif', value: "'newsreader', georgia, serif" },
  { name: '--font-mono', value: "'jetbrains mono', ui-monospace, monospace" },
];

describe('#155 §3 — family classification is a closed allowlist', () => {
  test.each([
    ['Inter', 'sans'],
    ['SF Pro Display', 'sans'],
    ['Noto Sans', 'sans'],
    ['Playfair Display', 'serif'],
    ['Times New Roman', 'serif'],
    ['Source Serif Pro', 'serif'],
    ['JetBrains Mono', 'mono'],
    ['SF_Mono:Regular', 'mono'],
    ['Courier New', 'mono'],
    ['Totally Unknown Face', 'sans'],
    ['', 'sans'],
  ])('%s is %s', (family, klass) => {
    expect(classifyFamily(family)).toBe(klass as 'sans');
  });
});

describe('#155 §3 — the DS stack of the same class wins', () => {
  test('a family the DS names is the DS token, not a substitution', () => {
    const r = resolveDsFontStack('Hanken Grotesk:Bold', FONT_TOKENS);
    expect(r.css).toBe('var(--font-body)');
    expect(r.substituted).toBe(false);
  });

  test('an unknown sans lands on the DS body stack and is reported as substituted', () => {
    const r = resolveDsFontStack('Nunito', FONT_TOKENS);
    expect(r.css).toBe('var(--font-body)');
    expect(r.substituted).toBe(true);
    expect(r.requested).toBe('Nunito');
  });

  test('a serif stays a serif and a mono stays a mono', () => {
    expect(resolveDsFontStack('Playfair Display', FONT_TOKENS).css).toBe('var(--font-serif)');
    expect(resolveDsFontStack('Fira Code', FONT_TOKENS).css).toBe('var(--font-mono)');
  });

  test('with no DS stack of the class a fixed stack is used, never the family', () => {
    expect(resolveDsFontStack('Playfair Display', []).css).toBe(SERIF_STACK);
    expect(resolveDsFontStack('Fira Code', []).css).toBe(MONO_STACK);
    expect(resolveDsFontStack('Nunito', []).css).toBe(SYSTEM_STACK);
  });

  test('a hostile family cannot reach the value', () => {
    const r = resolveDsFontStack(`x'; } body { background: url(//evil) } /*`, []);
    expect(r.css).toBe(SYSTEM_STACK);
    expect(isDsFontValue(r.css)).toBe(true);
    expect(isDsFontValue("x'; } body {")).toBe(false);
    expect(isDsFontValue('var(--x); color: red')).toBe(false);
  });
});

describe('#155 §3 — mapTypeStyle carries the mapped family', () => {
  test('a TEXT style gets a fontFamily (it used to be dropped → browser serif)', () => {
    const out = mapTypeStyle(
      { fontFamily: 'Inter', fontSize: 16 },
      { tokens: [], fontTokens: FONT_TOKENS }
    );
    expect(out.declarations.fontFamily).toBe('var(--font-body)');
    expect(out.font?.token).toBe('--font-body');
  });

  test('a style with no family carries none', () => {
    expect(mapTypeStyle({ fontSize: 16 }, { tokens: [] }).declarations.fontFamily).toBeUndefined();
  });
});

describe('#155 §3 — the artboard says which families were substituted, once each', () => {
  function build() {
    const text = (id: string, family: string) => ({
      id,
      name: 'label',
      type: 'TEXT',
      characters: 'Hello',
      absoluteBoundingBox: { x: 0, y: 0, width: 80, height: 20 },
      style: { fontFamily: family, fontSize: 16 },
      fills: [{ type: 'SOLID', visible: true, color: { r: 0, g: 0, b: 0, a: 1 } }],
    });
    const doc = normalizeDocument(
      {
        id: '0:0',
        name: 'Page',
        type: 'CANVAS',
        children: [
          {
            id: '2:1',
            name: 'Frame',
            type: 'FRAME',
            absoluteBoundingBox: { x: 0, y: 0, width: 400, height: 300 },
            fills: [{ type: 'SOLID', visible: true, color: { r: 1, g: 1, b: 1, a: 1 } }],
            children: [text('2:2', 'Nunito'), text('2:3', 'Nunito'), text('2:4', 'Hanken Grotesk')],
          },
        ],
      },
      { fileKey: 'figTESTKEY0123456789', surface: 'design' }
    );
    const frame = doc.root.children?.[0];
    if (!frame) throw new Error('no frame');
    return toArtboard(doc, frame, { tokens: [], fontTokens: FONT_TOKENS });
  }

  test('the family reaches the emitted style as the DS variable', () => {
    const r = build();
    expect(r.tsx).toContain('fontFamily: "var(--font-body)"');
    expect(r.tsx).not.toContain('Nunito');
  });

  test('one font-substituted entry per family with its count; the DS family is silent', () => {
    const r = build();
    const subs = r.report.entries.filter((e) => e.disposition === 'font-substituted');
    expect(subs).toHaveLength(1);
    expect(subs[0].detail).toBe('Nunito x2');
  });
});
