// r4 #4 — the maths behind the Figma-style colour popover (colour-model.js): colours, gradients, the fill's kind, the
// colours a canvas uses. Pure, so no DOM.
import { describe, expect, test } from 'bun:test';
import {
  addStop,
  coloursInSource,
  gradientCss,
  hexDigits,
  hslToRgb,
  hsvToRgb,
  kindOfFill,
  newGradient,
  parseGradient,
  parseHexInput,
  parseRgba,
  removeStop,
  reverseStops,
  rgbaCss,
  rgbToHsl,
  rgbToHsv,
  setStop,
  switchKind,
  widestGap,
} from '../client/v2/inspector/sections/colour-model.js';

describe('colours', () => {
  test('hex round-trips through rgb, hsv and hsl', () => {
    const c = parseHexInput('#1E6BFF');
    expect(c).toEqual({ r: 30, g: 107, b: 255 });
    expect(hexDigits(c as never)).toBe('1E6BFF');
    expect(hsvToRgb(rgbToHsv(c as never))).toEqual(c);
    const back = hslToRgb(rgbToHsl(c as never));
    for (const k of ['r', 'g', 'b'] as const)
      expect(Math.abs(back[k] - (c as never)[k])).toBeLessThanOrEqual(1);
  });
  test('the Hex field takes 3, 6 and 8 digits, with or without #, and refuses the rest', () => {
    expect(parseHexInput('fff')).toEqual({ r: 255, g: 255, b: 255 });
    expect(parseHexInput('#00000080')).toEqual({ r: 0, g: 0, b: 0, a: 0.5 });
    expect(parseHexInput('12345')).toBeNull();
    expect(parseHexInput('red')).toBeNull();
    expect(parseHexInput('')).toBeNull();
  });
  test('alpha is written as rgba() below full opacity and as hex at full', () => {
    expect(rgbaCss({ r: 30, g: 107, b: 255, a: 1 })).toBe('#1e6bff');
    expect(rgbaCss({ r: 30, g: 107, b: 255, a: 0.5 })).toBe('rgba(30, 107, 255, 0.5)');
    expect(parseRgba('rgba(30, 107, 255, 0.5)')).toEqual({ r: 30, g: 107, b: 255, a: 0.5 });
  });
  test('a token resolves through the system, else its own fallback; colour-mix is alpha', () => {
    expect(parseRgba('var(--ink)', { '--ink': '#102030' })).toMatchObject({ r: 16, g: 32, b: 48 });
    expect(parseRgba('var(--missing, #ffffff)')).toMatchObject({ r: 255, g: 255, b: 255, a: 1 });
    expect(parseRgba('color-mix(in srgb, #000000 40%, transparent)')).toMatchObject({ a: 0.4 });
    expect(parseRgba('var(--missing)')).toBeNull();
  });
});

describe('gradients', () => {
  test('linear, radial and conic parse and write back', () => {
    const lin = parseGradient('linear-gradient(90deg, #ff0000 0%, #0000ff 100%)');
    expect(lin).toMatchObject({ type: 'linear', angle: 90 });
    expect(gradientCss(lin as never)).toBe('linear-gradient(90deg, #ff0000 0%, #0000ff 100%)');
    expect(parseGradient('linear-gradient(to right, #fff, #000)')).toMatchObject({ angle: 90 });
    expect(parseGradient('linear-gradient(#fff, #000)')).toMatchObject({ angle: 180 });
    const rad = parseGradient('radial-gradient(circle, #fff 0%, #000 100%)');
    expect(gradientCss(rad as never)).toBe('radial-gradient(circle, #fff 0%, #000 100%)');
    const con = parseGradient('conic-gradient(from 45deg, #f00 0%, #00f 100%)');
    expect(gradientCss(con as never)).toBe('conic-gradient(from 45deg, #f00 0%, #00f 100%)');
  });
  test('stops with no position are spread evenly, token stops survive', () => {
    const g = parseGradient('linear-gradient(180deg, var(--a, #fff), #888, var(--b))');
    expect(g?.stops.map((s) => [s.color, s.pos])).toEqual([
      ['var(--a, #fff)', 0],
      ['#888', 50],
      ['var(--b)', 100],
    ]);
  });
  test('what the picker does not own is null, never half-parsed', () => {
    expect(parseGradient('repeating-linear-gradient(45deg, #fff 0%, #000 10%)')).toBeNull();
    expect(parseGradient('linear-gradient(180deg, #fff 0px, #000 40px)')).toBeNull();
    expect(parseGradient('linear-gradient(#fff 0% 40%, #000)')).toBeNull();
    expect(parseGradient('url(x.png)')).toBeNull();
  });
  test('add, move, recolour, remove and reverse a stop; the output is always a valid gradient in position order', () => {
    let g = newGradient('linear', '#ff0000', '#0000ff');
    const { g: g2, index } = addStop(g, 50, {});
    expect(g2.stops.map((s) => s.pos)).toEqual([0, 50, 100]);
    expect(g2.stops[index].color).toBe('#800080'); // halfway between red and blue
    g = setStop(g2, index, { pos: 80, color: '#00ff00' });
    expect(gradientCss(g)).toBe('linear-gradient(180deg, #ff0000 0%, #00ff00 80%, #0000ff 100%)');
    expect(widestGap(g)).toBe(40);
    expect(removeStop(g, 1).stops.length).toBe(2);
    expect(removeStop(newGradient('linear', '#fff', '#000'), 0).stops.length).toBe(2); // two is the floor
    expect(
      reverseStops(newGradient('linear', '#f00', '#00f')).stops.map((s) => [s.color, s.pos])
    ).toEqual([
      ['#f00', 100],
      ['#00f', 0],
    ]);
    // a gradient written by the model parses again to the same model
    expect(gradientCss(parseGradient(gradientCss(g)) as never)).toBe(gradientCss(g));
  });
});

describe('the fill kind', () => {
  const solid = {
    color: { paint: { token: '--ink', fallback: '#102030' }, opacity: 100 },
    layers: [],
  };
  test('the kind is the top layer, else solid', () => {
    expect(kindOfFill(solid)).toBe('solid');
    expect(kindOfFill({ color: null, layers: [{ kind: 'gradient', css: 'x' }] })).toBe('gradient');
    expect(kindOfFill({ color: null, layers: [{ kind: 'image', url: 'a.png' }] })).toBe('image');
    expect(kindOfFill(null)).toBe('solid');
  });
  test('solid → gradient starts from that colour and drops the solid; gradient → solid keeps the first stop', () => {
    const g = switchKind(solid, 'gradient', {
      vals: { '--ink': '#102030' },
      start: '#d4d4d8',
      end: '#ffffff',
    });
    expect(g.color).toBeNull();
    expect(g.layers).toEqual([
      { kind: 'gradient', css: 'linear-gradient(180deg, #102030 0%, #ffffff 100%)' },
    ]);
    const back = switchKind(g, 'solid', { start: '#d4d4d8', end: '#fff' });
    expect(back.layers).toEqual([]);
    expect(back.color).toEqual({ paint: { css: '#102030' }, opacity: 100 });
  });
  test('switching to the kind the fill already is changes nothing', () => {
    expect(switchKind(solid, 'solid', { start: '#000', end: '#fff' })).toBe(solid);
  });
});

describe('On this page', () => {
  test('the colours a canvas uses, most used first, de-duplicated, colours only', () => {
    const src = `
      <div style={{ background: '#FFF', color: '#111111' }}>
        <b style={{ color: '#111111', border: '1px solid rgba(0, 0, 0, 0.2)' }} />
        <i style={{ background: '#fff' }} />
        <em style={{ color: 'var(--ink)' }} data-x="#nothex" />
      </div>`;
    expect(coloursInSource(src)).toEqual(['#fff', '#111111', 'rgba(0, 0, 0, 0.2)']);
  });
  test('nothing that is not a colour gets through, and the list is capped', () => {
    expect(coloursInSource('rgb(1, 2, 3); drop table')).toEqual(['rgb(1, 2, 3)']);
    const many = Array.from({ length: 40 }, (_, i) => `#${(i + 16).toString(16).repeat(3)}`).join(
      ' '
    );
    expect(coloursInSource(many, 24).length).toBe(24);
    expect(coloursInSource('')).toEqual([]);
  });
});
