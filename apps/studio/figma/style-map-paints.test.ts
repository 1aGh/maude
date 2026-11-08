// #155 §4 — paints and effects the CSS lane used to drop.
//
// Synthetic nodes only. Each test names the one property of the Figma file that
// used to be lost: paint opacity, stacked fills, non-linear gradients, blur,
// backdrop blur and blend modes.

import { describe, expect, test } from 'bun:test';
import { isValidColorValue, mapNodeStyle } from './style-map.ts';
import { normalizeDocument } from './types.ts';

const box = (x: number, y: number, width: number, height: number) => ({ x, y, width, height });
const TOKENS = [
  { name: '--accent', hex: '#5b4bd6' },
  { name: '--bg-0', hex: '#ffffff' },
];

function nodeOf(partial: Record<string, unknown>) {
  const doc = normalizeDocument(
    {
      id: '0:0',
      name: 'Page',
      type: 'CANVAS',
      children: [
        {
          id: '2:1',
          name: 'n',
          type: 'RECTANGLE',
          absoluteBoundingBox: box(0, 0, 200, 100),
          ...partial,
        },
      ],
    },
    { fileKey: 'figTESTKEY0123456789', surface: 'design' }
  );
  const node = doc.root.children?.[0];
  if (!node) throw new Error('no node');
  return node;
}

const stops = [
  { position: 0, color: { r: 1, g: 0, b: 0, a: 1 } },
  { position: 1, color: { r: 0, g: 0, b: 1, a: 0.5 } },
];
const handles = [
  { x: 0.5, y: 0.5 },
  { x: 1, y: 0.5 },
  { x: 0.5, y: 1 },
];

describe('#155 §4 — paint opacity', () => {
  test('a 10 % white fill is translucent, not solid white', () => {
    const out = mapNodeStyle(
      nodeOf({
        fills: [{ type: 'SOLID', visible: true, opacity: 0.1, color: { r: 1, g: 1, b: 1, a: 1 } }],
      }),
      { tokens: [] }
    );
    expect(out.declarations.background).toBe('rgba(255, 255, 255, 0.1)');
  });

  test('the colour alpha and the paint opacity multiply', () => {
    const out = mapNodeStyle(
      nodeOf({
        fills: [
          { type: 'SOLID', visible: true, opacity: 0.5, color: { r: 0, g: 0, b: 0, a: 0.5 } },
        ],
      }),
      { tokens: [] }
    );
    expect(out.declarations.background).toBe('rgba(0, 0, 0, 0.25)');
  });

  test('a token match keeps the token, mixed down to the alpha', () => {
    const out = mapNodeStyle(
      nodeOf({
        fills: [
          {
            type: 'SOLID',
            visible: true,
            opacity: 0.2,
            color: { r: 0x5b / 255, g: 0x4b / 255, b: 0xd6 / 255, a: 1 },
          },
        ],
      }),
      { tokens: TOKENS }
    );
    expect(out.declarations.background).toBe('color-mix(in srgb, var(--accent) 20%, transparent)');
    expect(isValidColorValue(out.declarations.background)).toBe(true);
  });

  test('a fully opaque paint is unchanged', () => {
    const out = mapNodeStyle(
      nodeOf({ fills: [{ type: 'SOLID', visible: true, color: { r: 1, g: 0, b: 0, a: 1 } }] }),
      { tokens: [] }
    );
    expect(out.declarations.background).toBe('#ff0000');
  });

  test('the colour grammar still refuses an injected colour-mix', () => {
    expect(isValidColorValue('color-mix(in srgb, var(--x) 20%, transparent)')).toBe(true);
    expect(isValidColorValue('color-mix(in srgb, url(//evil) 20%, transparent)')).toBe(false);
    expect(isValidColorValue('color-mix(in srgb, var(--x) 20%, transparent); x')).toBe(false);
  });

  test('a drop shadow keeps its alpha', () => {
    const out = mapNodeStyle(
      nodeOf({
        effects: [
          {
            type: 'DROP_SHADOW',
            visible: true,
            offset: { x: 0, y: 4 },
            radius: 16,
            color: { r: 0, g: 0, b: 0, a: 0.25 },
          },
        ],
      }),
      { tokens: [] }
    );
    expect(out.declarations.boxShadow).toBe('0px 4px 16px 0px rgba(0, 0, 0, 0.25)');
  });
});

describe('#155 §4 — stacked fills', () => {
  test('every visible fill is painted, topmost first, the bottom solid as the colour', () => {
    const out = mapNodeStyle(
      nodeOf({
        fills: [
          { type: 'SOLID', visible: true, color: { r: 1, g: 0, b: 0, a: 1 } },
          { type: 'SOLID', visible: false, color: { r: 0, g: 1, b: 0, a: 1 } },
          { type: 'SOLID', visible: true, opacity: 0.5, color: { r: 0, g: 0, b: 1, a: 1 } },
        ],
      }),
      { tokens: [] }
    );
    expect(out.declarations.backgroundColor).toBe('#ff0000');
    expect(out.declarations.backgroundImage).toBe(
      'linear-gradient(rgba(0, 0, 255, 0.5), rgba(0, 0, 255, 0.5))'
    );
    expect(out.declarations.background).toBeUndefined();
  });

  test('a gradient over a solid keeps both', () => {
    const out = mapNodeStyle(
      nodeOf({
        fills: [
          { type: 'SOLID', visible: true, color: { r: 1, g: 1, b: 1, a: 1 } },
          {
            type: 'GRADIENT_LINEAR',
            visible: true,
            gradientStops: stops,
            gradientHandlePositions: [
              { x: 0, y: 0 },
              { x: 1, y: 0 },
            ],
          },
        ],
      }),
      { tokens: [] }
    );
    expect(out.declarations.backgroundColor).toBe('#ffffff');
    expect(out.declarations.backgroundImage).toMatch(
      /^linear-gradient\(90deg, #ff0000 0%, rgba\(0, 0, 255, 0\.5\) 100%\)$/
    );
  });

  test('a text node keeps one foreground colour: the topmost visible solid', () => {
    const out = mapNodeStyle(
      nodeOf({
        type: 'TEXT',
        fills: [
          { type: 'SOLID', visible: true, color: { r: 1, g: 0, b: 0, a: 1 } },
          { type: 'SOLID', visible: true, color: { r: 0, g: 0, b: 1, a: 1 } },
        ],
      }),
      { tokens: [] }
    );
    expect(out.declarations.background).toBe('#0000ff');
    expect(out.declarations.backgroundImage).toBeUndefined();
  });
});

describe('#155 §4 — radial, angular and diamond gradients', () => {
  test('RADIAL becomes radial-gradient anchored at the first handle', () => {
    const out = mapNodeStyle(
      nodeOf({
        fills: [
          {
            type: 'GRADIENT_RADIAL',
            visible: true,
            gradientStops: stops,
            gradientHandlePositions: handles,
          },
        ],
      }),
      { tokens: [] }
    );
    // centre (50 %, 50 %); radius handles 0.5 of the 200x100 box -> 100px by 50px
    expect(out.declarations.backgroundImage).toBe(
      'radial-gradient(100px 50px at 50% 50%, #ff0000 0%, rgba(0, 0, 255, 0.5) 100%)'
    );
  });

  test('ANGULAR becomes conic-gradient, starting where the first handle points', () => {
    const out = mapNodeStyle(
      nodeOf({
        fills: [
          {
            type: 'GRADIENT_ANGULAR',
            visible: true,
            gradientStops: stops,
            gradientHandlePositions: handles,
          },
        ],
      }),
      { tokens: [] }
    );
    // first handle points right (3 o'clock) = 90deg in CSS conic terms
    expect(out.declarations.backgroundImage).toBe(
      'conic-gradient(from 90deg at 50% 50%, #ff0000 0%, rgba(0, 0, 255, 0.5) 100%)'
    );
  });

  test('DIAMOND is drawn as a radial gradient and says so', () => {
    const out = mapNodeStyle(
      nodeOf({
        fills: [
          {
            type: 'GRADIENT_DIAMOND',
            visible: true,
            gradientStops: stops,
            gradientHandlePositions: handles,
          },
        ],
      }),
      { tokens: [] }
    );
    expect(out.declarations.backgroundImage).toMatch(/^radial-gradient\(/);
    expect(out.approximated).toContain('diamond gradient');
  });

  test('a gradient without handles still draws (box-centred)', () => {
    const out = mapNodeStyle(
      nodeOf({ fills: [{ type: 'GRADIENT_RADIAL', visible: true, gradientStops: stops }] }),
      { tokens: [] }
    );
    expect(out.declarations.backgroundImage).toMatch(/^radial-gradient\(/);
  });

  test('gradient stop alpha survives', () => {
    const out = mapNodeStyle(
      nodeOf({
        fills: [
          {
            type: 'GRADIENT_LINEAR',
            visible: true,
            gradientStops: stops,
            gradientHandlePositions: [
              { x: 0, y: 0 },
              { x: 0, y: 1 },
            ],
          },
        ],
      }),
      { tokens: [] }
    );
    expect(out.declarations.backgroundImage).toContain('rgba(0, 0, 255, 0.5) 100%');
  });
});

describe('#155 §4 — blur, backdrop blur and blend modes', () => {
  test('a layer blur becomes filter: blur (Figma radius is twice the CSS sigma)', () => {
    for (const type of ['LAYER_BLUR', 'FOREGROUND_BLUR']) {
      const out = mapNodeStyle(nodeOf({ effects: [{ type, visible: true, radius: 16 }] }), {
        tokens: [],
      });
      expect(out.declarations.filter).toBe('blur(8px)');
    }
  });

  test('a background blur becomes backdrop-filter, with the WebKit spelling', () => {
    const out = mapNodeStyle(
      nodeOf({ effects: [{ type: 'BACKGROUND_BLUR', visible: true, radius: 40 }] }),
      { tokens: [] }
    );
    expect(out.declarations.backdropFilter).toBe('blur(20px)');
    expect(out.declarations.WebkitBackdropFilter).toBe('blur(20px)');
  });

  test('a hidden blur and an absurd one are dropped', () => {
    const hidden = mapNodeStyle(
      nodeOf({ effects: [{ type: 'LAYER_BLUR', visible: false, radius: 16 }] }),
      { tokens: [] }
    );
    expect(hidden.declarations.filter).toBeUndefined();
    const huge = mapNodeStyle(
      nodeOf({ effects: [{ type: 'LAYER_BLUR', visible: true, radius: 99999 }] }),
      { tokens: [] }
    );
    expect(huge.declarations.filter).toBeUndefined();
    expect(huge.rejected).toContain('filter');
  });

  test('a blur and a shadow coexist', () => {
    const out = mapNodeStyle(
      nodeOf({
        effects: [
          {
            type: 'DROP_SHADOW',
            visible: true,
            offset: { x: 0, y: 2 },
            radius: 4,
            color: { r: 0, g: 0, b: 0, a: 1 },
          },
          { type: 'LAYER_BLUR', visible: true, radius: 8 },
        ],
      }),
      { tokens: [] }
    );
    expect(out.declarations.boxShadow).toBeDefined();
    expect(out.declarations.filter).toBe('blur(4px)');
  });

  test.each([
    ['MULTIPLY', 'multiply'],
    ['SCREEN', 'screen'],
    ['OVERLAY', 'overlay'],
    ['COLOR_DODGE', 'color-dodge'],
    ['SOFT_LIGHT', 'soft-light'],
    ['LUMINOSITY', 'luminosity'],
  ])('blend mode %s becomes mix-blend-mode %s', (figma, css) => {
    const out = mapNodeStyle(nodeOf({ blendMode: figma }), { tokens: [] });
    expect(out.declarations.mixBlendMode).toBe(css);
  });

  test('NORMAL and PASS_THROUGH add nothing; an unknown mode is dropped, not guessed', () => {
    for (const mode of ['NORMAL', 'PASS_THROUGH']) {
      expect(
        mapNodeStyle(nodeOf({ blendMode: mode }), { tokens: [] }).declarations.mixBlendMode
      ).toBeUndefined();
    }
    const odd = mapNodeStyle(nodeOf({ blendMode: 'url(//evil)' }), { tokens: [] });
    expect(odd.declarations.mixBlendMode).toBeUndefined();
  });

  test('a mode CSS lacks is approximated and reported', () => {
    const out = mapNodeStyle(nodeOf({ blendMode: 'LINEAR_BURN' }), { tokens: [] });
    expect(out.declarations.mixBlendMode).toBe('color-burn');
    expect(out.approximated).toContain('blend mode LINEAR_BURN');
  });
});
