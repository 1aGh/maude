// figma/fig-vector.ts — path geometry out of a local `.fig` (DDR-221 A11).
//
// These exist because the DDR SHIPPED A FALSE CLAIM: A9/A10 said a vector
// cluster is a server-side render absent from a local export, and a
// user-visible `asset-unavailable-offline` disposition said so out loud. The
// geometry was in the file the whole time. The tests below pin the command set
// that was measured, so the claim cannot silently regress in either direction.

import { describe, expect, test } from 'bun:test';

import { artToSvg, FigVectorError, MAX_PATH_COMMANDS, pathFromBlob } from './fig-vector.ts';

/** Encode `cmd` + float32 LE pairs, the layout measured on a real export. */
function blob(...items: Array<[number, number[]]>): Uint8Array {
  const out: number[] = [];
  for (const [cmd, coords] of items) {
    out.push(cmd);
    for (const c of coords) {
      const b = new Uint8Array(4);
      new DataView(b.buffer).setFloat32(0, c, true);
      out.push(...b);
    }
  }
  return new Uint8Array(out);
}

describe('path blob decoding', () => {
  test('the measured command set round-trips to SVG', () => {
    const d = pathFromBlob(
      blob(
        [1, [40.56, 0]],
        [2, [50.89, 30.24]],
        [3, [1, 2, 3, 4]],
        [4, [1, 2, 3, 4, 5, 6]],
        [0, []]
      )
    );
    expect(d).toBe('M40.56 0 L50.89 30.24 Q1 2 3 4 C1 2 3 4 5 6 Z');
  });

  test('the real sparkle decodes to a closed 8-point star', () => {
    // Byte-for-byte the 82-byte blob from the export (`Untitled.fig`, node 1:6).
    const pts: Array<[number, number[]]> = [
      [1, [40.56, 0]],
      [2, [50.89, 30.24]],
      [2, [81.13, 40.56]],
      [2, [50.89, 50.89]],
      [2, [40.56, 81.13]],
      [2, [30.24, 50.89]],
      [2, [0, 40.56]],
      [2, [30.24, 30.24]],
      [2, [40.56, 0]],
      [0, []],
    ];
    const d = pathFromBlob(blob(...pts));
    expect(d.startsWith('M40.56 0')).toBe(true);
    expect(d.endsWith('Z')).toBe(true);
    expect(d.split('L')).toHaveLength(9);
  });

  test('an unknown command REFUSES rather than truncating the path', () => {
    // A half-read path renders as confident nonsense — the exact failure the
    // fail-loud posture exists to prevent.
    expect(() => pathFromBlob(blob([1, [0, 0]], [9, []]))).toThrow(/unknown path command 9/);
  });

  test('a command running past the end refuses', () => {
    const b = blob([1, [1, 2]]);
    expect(() => pathFromBlob(b.subarray(0, b.length - 2))).toThrow(/past the end/);
  });

  test('an empty blob refuses instead of emitting an empty path', () => {
    expect(() => pathFromBlob(new Uint8Array(0))).toThrow(FigVectorError);
  });

  test('a command flood is capped', () => {
    const many: Array<[number, number[]]> = Array.from({ length: MAX_PATH_COMMANDS + 10 }, () => [
      2,
      [1, 1],
    ]);
    expect(() => pathFromBlob(blob(...many))).toThrow(/more than/);
  });
});

describe('SVG serialization', () => {
  test('emits only geometry and colour — nothing the DDR-167 lane would strip', () => {
    const svg = artToSvg({
      width: 118,
      height: 118,
      paths: [
        { d: 'M0 0 L1 1 Z', fill: '#5b62e8', fillOpacity: 1, fillRule: 'nonzero', x: 0, y: 0 },
        { d: 'M2 2 Z', fill: '#ffffff', fillOpacity: 0.5, fillRule: 'evenodd', x: 5, y: 6 },
      ],
    });
    expect(svg).toContain('viewBox="0 0 118 118"');
    expect(svg).toContain('fill="#5b62e8"');
    expect(svg).toContain('fill-opacity="0.5"');
    expect(svg).toContain('fill-rule="evenodd"');
    expect(svg).toContain('transform="translate(5 6)"');
    for (const forbidden of ['<script', 'xlink', '<use', 'href', 'onload']) {
      expect(svg).not.toContain(forbidden);
    }
  });

  describe('gradient fills (#155 §10)', () => {
    const linear = {
      kind: 'linear' as const,
      stops: [
        { offset: 0, color: '#e32412', opacity: 1 },
        { offset: 1, color: '#1c1c1c', opacity: 0.5 },
      ],
      // node-local: gradient space -> node space
      matrix: [240, 0, 0, 120, 0, 0] as [number, number, number, number, number, number],
    };

    test('a linear gradient is emitted as a <linearGradient> the path fills with', () => {
      const svg = artToSvg({
        width: 240,
        height: 120,
        paths: [
          {
            d: 'M0 0 L240 0 L240 120 Z',
            fill: null,
            fillOpacity: 1,
            fillRule: 'nonzero',
            x: 0,
            y: 0,
            gradient: linear,
          },
        ],
      });
      expect(svg).toContain('<linearGradient id="g0"');
      expect(svg).toContain('gradientUnits="userSpaceOnUse"');
      expect(svg).toContain('stop-color="#e32412"');
      expect(svg).toContain('stop-color="#1c1c1c"');
      expect(svg).toContain('stop-opacity="0.5"');
      expect(svg).toContain('fill="url(#g0)"');
      expect(svg).toContain('gradientTransform="matrix(');
      expect(svg).not.toContain('Z" fill="none"');
    });

    test('a radial gradient is a <radialGradient>; each path gets its own id', () => {
      const svg = artToSvg({
        width: 10,
        height: 10,
        paths: [
          { d: 'M0 0 Z', fill: '#000000', fillOpacity: 1, fillRule: 'nonzero', x: 0, y: 0 },
          {
            d: 'M1 1 Z',
            fill: null,
            fillOpacity: 1,
            fillRule: 'nonzero',
            x: 0,
            y: 0,
            gradient: { ...linear, kind: 'radial' },
          },
          {
            d: 'M2 2 Z',
            fill: null,
            fillOpacity: 1,
            fillRule: 'nonzero',
            x: 0,
            y: 0,
            gradient: linear,
          },
        ],
      });
      expect(svg).toContain('<radialGradient id="g1"');
      expect(svg).toContain('<linearGradient id="g2"');
      expect(svg).toContain('fill="url(#g1)"');
      expect(svg).toContain('fill="url(#g2)"');
    });
  });

  test('a path with no fill is explicit about it rather than inheriting', () => {
    const svg = artToSvg({
      width: 10,
      height: 10,
      paths: [{ d: 'M0 0 Z', fill: null, fillOpacity: 1, fillRule: 'nonzero', x: 0, y: 0 }],
    });
    expect(svg).toContain('fill="none"');
  });
});
