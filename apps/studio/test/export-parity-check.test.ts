// export-parity-check — #150 §4 + #128 §8 (T3.3).
//
// Before an mp4 / webm render starts, the capture page reads the Player's own DOM at a few frames
// and lists what @remotion/web-renderer will not draw the way the Player does — a warning on the
// existing `ExportDegradation` channel that names the element and the artboard, never a block.
// Every row of `PARITY_FEATURES` was measured live (see parity-check.ts); a feature that rendered
// correctly (skew, clip-path, text-shadow, a low-opacity image) is deliberately NOT flagged, and
// the negative-control test below holds that line.
//
// happy-dom has no complete CSS engine, so the style reader is a seam (`getStyle`): a tiny parser of
// the element's own `style` attribute, plus a class → fill rule for the page-stylesheet case.

import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

import { mergeDegraded, parityGap } from '../exporters/degraded.ts';
import {
  describeElement,
  mergeFindings,
  PARITY_FEATURES,
  type ParityFeature,
  sampleFrames,
  scanParity,
} from '../exporters/parity-check.ts';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Reads the element's inline style attribute; a `pg` class colors an svg shape (a page rule). */
function styleOf(el: Element) {
  const props = new Map<string, string>();
  for (const decl of (el.getAttribute('style') ?? '').split(';')) {
    const i = decl.indexOf(':');
    if (i > 0) props.set(decl.slice(0, i).trim().toLowerCase(), decl.slice(i + 1).trim());
  }
  if ((el.getAttribute('class') ?? '').split(/\s+/).includes('pg')) props.set('fill', '#0cf');
  return {
    getPropertyValue: (p: string) => props.get(p) ?? (p === 'display' ? 'block' : ''),
  };
}

function scan(html: string) {
  const root = document.createElement('div');
  root.setAttribute('data-comp-id', 'c1');
  root.innerHTML = html;
  document.body.appendChild(root);
  return scanParity(root, styleOf);
}
const features = (html: string): ParityFeature[] => scan(html).map((f) => f.feature);

beforeAll(() => {
  GlobalRegistrator.register();
});
afterAll(async () => {
  await GlobalRegistrator.unregister();
});
beforeEach(() => {
  document.body.innerHTML = '';
});

describe('scanParity — CSS the web renderer does not draw', () => {
  test('a background-image url() is flagged and the element is named', () => {
    const found = scan('<div class="hero" style="background-image: url(assets/a.png)"></div>');
    expect(found).toEqual([{ feature: 'bg-url', elements: ['div.hero'], count: 1 }]);
  });

  test('radial, conic and repeating gradients are flagged; a linear one is fine', () => {
    for (const bg of [
      'radial-gradient(#fff, #000)',
      'conic-gradient(#fff, #000)',
      'repeating-linear-gradient(90deg, #fff 0 4px, #000 4px 8px)',
    ]) {
      document.body.innerHTML = '';
      expect(features(`<div style="background-image: ${bg}"></div>`), bg).toEqual(['bg-gradient']);
    }
    document.body.innerHTML = '';
    expect(features('<div style="background-image: linear-gradient(#fff, #000)"></div>')).toEqual(
      []
    );
  });

  test('mix-blend-mode, backdrop-filter, inset box-shadow and vertical text', () => {
    expect(features('<div style="mix-blend-mode: difference"></div>')).toEqual(['blend-mode']);
    document.body.innerHTML = '';
    expect(features('<div style="backdrop-filter: blur(8px)"></div>')).toEqual(['backdrop-filter']);
    document.body.innerHTML = '';
    expect(features('<div style="box-shadow: inset 0 0 12px #000"></div>')).toEqual([
      'inset-shadow',
    ]);
    document.body.innerHTML = '';
    expect(features('<p style="writing-mode: vertical-rl">x</p>')).toEqual(['vertical-text']);
  });

  test('what rendered correctly in the live comparison is NOT flagged (negative control)', () => {
    const html = `
      <span style="display: inline-block; transform: skewX(-20deg)">skew</span>
      <div style="transform: rotate(-4deg)"><span style="transform: skewX(-7deg)">nested</span></div>
      <div style="background-image: linear-gradient(#f0f, #00f); clip-path: polygon(0 0, 100% 0, 100% 70%, 0 100%)"></div>
      <div style="clip-path: inset(10px round 16px)"></div>
      <p style="text-shadow: 3px 3px 0 #f06; mix-blend-mode: normal; writing-mode: horizontal-tb">t</p>
      <div style="filter: blur(3px); box-shadow: 0 4px 12px #0004"></div>
      <img src="assets/x.svg" style="opacity: 0.05; position: absolute" />`;
    expect(features(html)).toEqual([]);
  });

  test('hidden elements are skipped; repeated elements add to the count; names stay capped', () => {
    const hidden = '<div style="display: none; background-image: url(a.png)"></div>';
    expect(features(hidden)).toEqual([]);
    document.body.innerHTML = '';
    const many = Array.from(
      { length: 8 },
      (_, i) => `<div id="d${i}" style="mix-blend-mode: multiply"></div>`
    ).join('');
    const [f] = scan(many);
    expect(f.count).toBe(8);
    expect(f.elements).toHaveLength(5);
    expect(f.elements[0]).toBe('div#d0');
  });
});

describe('scanParity — inline <svg> edge cases the standalone image cannot draw', () => {
  const svg = (inner: string, attrs = '') =>
    `<svg xmlns="${SVG_NS}" id="logo" width="60" height="60" ${attrs}>${inner}</svg>`;

  test('a <use> of a shape that lives outside this svg', () => {
    const outside = svg('<use href="#dot"/>');
    expect(features(`<svg><defs><circle id="dot"/></defs></svg>${outside}`)).toEqual([
      'svg-outside-use',
    ]);
    document.body.innerHTML = '';
    expect(features(svg('<defs><circle id="dot"/></defs><use href="#dot"/>'))).toEqual([]);
    document.body.innerHTML = '';
    expect(features(svg('<use href="sprite.svg#dot"/>'))).toEqual(['svg-outside-use']);
  });

  test('an <image> that is not a data: url', () => {
    expect(features(svg('<image href="assets/pic.png" width="60" height="60"/>'))).toEqual([
      'svg-outside-image',
    ]);
    document.body.innerHTML = '';
    expect(features(svg('<image href="data:image/png;base64,AAAA"/>'))).toEqual([]);
  });

  test('a var(--x) anywhere in the svg', () => {
    expect(features(svg('<circle style="fill: var(--c)"/>'))).toEqual(['svg-css-var']);
    document.body.innerHTML = '';
    expect(features(svg('<circle fill="#fc0"/>'))).toEqual([]);
  });

  test('a fill that comes from a page stylesheet class — unless the svg carries its own <style>', () => {
    expect(features(svg('<circle class="pg"/>'))).toEqual(['svg-page-class']);
    document.body.innerHTML = '';
    expect(features(svg('<style>.pg{fill:#0cf}</style><circle class="pg"/>'))).toEqual([]);
    document.body.innerHTML = '';
    // a class the page gives no look to is not a finding, and the class is put back
    const root = document.createElement('div');
    root.innerHTML = svg('<circle class="unstyled"/>');
    document.body.appendChild(root);
    expect(scanParity(root, styleOf)).toEqual([]);
    expect(root.querySelector('circle')?.getAttribute('class')).toBe('unstyled');
  });

  test('the svg is named, and its children are not walked as boxes', () => {
    const [f] = scan(svg('<circle style="mix-blend-mode: multiply" fill="var(--c)"/>'));
    expect(f).toEqual({ feature: 'svg-css-var', elements: ['svg#logo'], count: 1 });
  });
});

describe('describeElement / mergeFindings / sampleFrames', () => {
  test('names are short: tag, id, first class, else a snippet of its own text', () => {
    const el = document.createElement('div');
    el.className = 'tag big';
    expect(describeElement(el)).toBe('div.tag');
    const text = document.createElement('span');
    text.textContent = '  Summer   camp starts now, everyone  ';
    expect(describeElement(text)).toBe('span "Summer camp starts n"'); // 20 characters of its own text
    // nothing to call it by: where it sits
    const host = document.createElement('section');
    host.innerHTML = '<p>one</p><div></div>';
    expect(describeElement(host.children[1])).toBe('section > div:nth-child(2)');
  });

  test('the same element on two sampled frames is one element', () => {
    const a = [{ feature: 'blend-mode' as const, elements: ['div.a'], count: 1 }];
    const b = [
      { feature: 'blend-mode' as const, elements: ['div.a', 'div.b'], count: 2 },
      { feature: 'bg-url' as const, elements: ['div.c'], count: 1 },
    ];
    expect(mergeFindings(a, b)).toEqual([
      { feature: 'blend-mode', elements: ['div.a', 'div.b'], count: 2 },
      { feature: 'bg-url', elements: ['div.c'], count: 1 },
    ]);
  });

  test('a comp is sampled at its start, end and between; a one-frame comp once', () => {
    expect(sampleFrames(101)).toEqual([0, 25, 50, 75, 100]);
    expect(sampleFrames(1)).toEqual([0]);
    expect(sampleFrames(3)).toEqual([0, 1, 2]);
  });
});

describe('parityGap — the scan as an ExportDegradation', () => {
  const scanOf = (findings: unknown[], artboard: unknown = 'reel-1') => ({ artboard, findings });

  test('names the artboard, the feature and the elements; warns, never blocks', () => {
    const d = parityGap(
      scanOf([
        { feature: 'bg-url', elements: ['div.hero', 'div.camo'], count: 4 },
        { feature: 'blend-mode', elements: ['div.badge'], count: 1 },
      ])
    );
    expect(d?.audioDropped).toBeUndefined();
    expect(d?.reason).toContain('Artboard "reel-1"');
    expect(d?.reason).toContain(
      'a background-image url() is not drawn — div.hero, div.camo and 2 more'
    );
    expect(d?.reason).toContain('mix-blend-mode is ignored — div.badge');
    expect(d?.unsupportedFeatures).toEqual([
      'a background-image url() is not drawn — div.hero, div.camo and 2 more',
      'mix-blend-mode is ignored — div.badge',
    ]);
    expect(d?.remedy).toContain('<img>');
  });

  test('the page is untrusted: unknown features, bad shapes and control characters are dropped', () => {
    const d = parityGap(
      scanOf(
        [
          { feature: '__proto__', elements: ['x'], count: 1 },
          { feature: 'constructor', elements: ['x'], count: 1 },
          { feature: 'toString', elements: ['x'], count: 1 },
          null,
          {
            feature: 'bg-url',
            elements: ['div.a\n\u001b[31mEVIL\u0007 ' + 'x'.repeat(300), 42],
            count: 1,
          },
        ],
        'line\none\u0000'
      )
    );
    expect(d?.unsupportedFeatures).toHaveLength(1);
    const text = JSON.stringify(d);
    expect(text).not.toContain('\\n');
    expect(text).not.toContain('\\u001b');
    expect(text).not.toContain('\\u0000');
    expect(d?.reason).toContain('Artboard "line one"');
    expect(d?.unsupportedFeatures?.[0].length).toBeLessThan(160);
  });

  test('nothing usable → no degradation', () => {
    expect(parityGap(undefined)).toBeUndefined();
    expect(parityGap('x')).toBeUndefined();
    expect(parityGap(scanOf([]))).toBeUndefined();
    expect(parityGap(scanOf([{ feature: 'nope', elements: [], count: 1 }]))).toBeUndefined();
  });

  test('every feature has words a person can read', () => {
    for (const [id, row] of Object.entries(PARITY_FEATURES)) {
      expect(row.label.length, id).toBeGreaterThan(10);
      expect(row.hint.length, id).toBeGreaterThan(5);
    }
  });
});

describe('mergeDegraded keeps the parity warning beside another cause', () => {
  test('muted file + unsupported features: both flags, one remedy (the audio one), both reasons', () => {
    const muted = {
      audioDropped: true,
      reason: 'no audio.',
      remedy: 'import Audio from @remotion/media',
    };
    const parity = parityGap({
      artboard: 'a',
      findings: [{ feature: 'bg-url', elements: ['div.x'], count: 1 }],
    });
    const both = mergeDegraded(muted, parity);
    expect(both?.audioDropped).toBe(true);
    expect(both?.unsupportedFeatures).toHaveLength(1);
    expect(both?.remedy).toBe('import Audio from @remotion/media');
    expect(both?.reason).toContain('no audio.');
    expect(both?.reason).toContain('video exporter cannot draw');
  });
});

describe('the capture page bridge — __maudeParityCheck__', () => {
  test('seeks to a few frames, scans the Player DOM at each, ends back on frame 0', async () => {
    mock.module('@remotion/web-renderer', () => ({ renderMediaOnWeb: async () => ({}) }));
    const seeks: number[] = [];
    const g = globalThis as unknown as Record<string, unknown>;
    g.__maude_comps__ = () => [{ id: 'c1', durationInFrames: 41 }];
    const board = document.createElement('div');
    board.setAttribute('data-dc-screen', 'reel-1');
    board.innerHTML =
      '<div data-comp-id="c1"><div id="late" style="mix-blend-mode: multiply"></div></div>';
    document.body.appendChild(board);
    // the real reader is getComputedStyle; the happy-dom one does not know these properties
    const realGcs = window.getComputedStyle;
    window.getComputedStyle = ((el: Element) => styleOf(el)) as typeof window.getComputedStyle;
    g.__maude_seek__ = async (f: number) => {
      seeks.push(f);
    };
    try {
      await import('../exporters/video-render-lib.ts');
      const check = g.__maudeParityCheck__ as (id: string) => Promise<{
        artboard: string | null;
        findings: Array<{ feature: string; elements: string[] }>;
      }>;
      const res = await check('c1');
      expect(res.artboard).toBe('reel-1');
      expect(res.findings).toEqual([{ feature: 'blend-mode', elements: ['div#late'], count: 1 }]);
      expect(seeks).toEqual([0, 10, 20, 30, 40, 0]);
    } finally {
      window.getComputedStyle = realGcs;
    }
  });

  test('a comp that is not mounted, or a seek that throws, costs the warning and nothing else', async () => {
    const g = globalThis as unknown as Record<string, unknown>;
    g.__maude_seek__ = async () => {
      throw new Error('player not ready');
    };
    await import('../exporters/video-render-lib.ts');
    const check = g.__maudeParityCheck__ as (id: string) => Promise<{ findings: unknown[] }>;
    expect((await check('missing')).findings).toEqual([]);
  });
});
