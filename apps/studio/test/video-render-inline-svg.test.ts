// video-render-inline-svg — issue #150 §1: an inline <svg> that carries its own
// box (position / left / top …) is exported to MP4 as an empty frame.
//
// Cause (settled by a live repro, not the CSP): @remotion/web-renderer's
// `turnSvgIntoDrawable` serializes the live <svg> — INLINE `style` attribute
// included — into a standalone `data:image/svg+xml` document and draws that
// image. In that document the <svg> is the root, so an inline
// `position:absolute; left:300px; top:80px` shifts the artwork 300 × 80 px OUT of
// the image's own viewport and the drawn bitmap is blank. The capture page's CSP
// already allows `img-src data: blob:`, the image loads fine, and nothing is
// logged — hence "silently dropped".
//
// The fix lives in the capture shim (`exporters/svg-inline.ts`, installed by
// `video-render-lib.ts` around the render): while the renderer serializes the
// svg, its positional inline style is neutralized, then restored.

import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

import { remedyFor } from '../exporters/degraded.ts';
import { installSvgSerializeGuard, SVG_POSITIONAL_PROPS } from '../exporters/svg-inline.ts';

const SVG_NS = 'http://www.w3.org/2000/svg';

function makeSvg(style: string): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg') as SVGSVGElement;
  svg.setAttribute('width', '200');
  svg.setAttribute('height', '200');
  svg.setAttribute('style', style);
  const rect = document.createElementNS(SVG_NS, 'rect');
  rect.setAttribute('width', '200');
  rect.setAttribute('height', '200');
  rect.setAttribute('fill', '#fc0');
  svg.appendChild(rect);
  document.body.appendChild(svg);
  return svg;
}

beforeAll(() => {
  GlobalRegistrator.register();
});

afterAll(async () => {
  await GlobalRegistrator.unregister();
});

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('installSvgSerializeGuard', () => {
  test('serializing an absolutely positioned <svg> drops its own position / offsets', () => {
    const svg = makeSvg('position: absolute; left: 300px; top: 80px;');
    const restore = installSvgSerializeGuard();
    try {
      const out = new XMLSerializer().serializeToString(svg);
      expect(out).not.toMatch(/position:\s*absolute/);
      expect(out).not.toMatch(/left:\s*300px/);
      expect(out).not.toMatch(/top:\s*80px/);
      // the artwork itself is untouched
      expect(out).toContain('fill="#fc0"');
      expect(out).toContain('width="200"');
    } finally {
      restore();
    }
  });

  test('the live element keeps its inline style afterwards', () => {
    const svg = makeSvg('position: absolute; left: 300px; top: 80px; opacity: 0.5;');
    const restore = installSvgSerializeGuard();
    try {
      new XMLSerializer().serializeToString(svg);
    } finally {
      restore();
    }
    expect(svg.style.position).toBe('absolute');
    expect(svg.style.left).toBe('300px');
    expect(svg.style.top).toBe('80px');
    expect(svg.style.opacity).toBe('0.5');
  });

  test('non-positional style (opacity, fill) still reaches the serialized svg', () => {
    const svg = makeSvg('position: relative; right: 12px; opacity: 0.5;');
    const restore = installSvgSerializeGuard();
    try {
      const out = new XMLSerializer().serializeToString(svg);
      expect(out).toContain('opacity');
      expect(out).not.toMatch(/right:\s*12px/);
    } finally {
      restore();
    }
  });

  test('anything that is not an <svg> root serializes exactly as before', () => {
    const div = document.createElement('div');
    div.setAttribute('style', 'position: absolute; left: 4px;');
    document.body.appendChild(div);
    const before = new XMLSerializer().serializeToString(div);
    const restore = installSvgSerializeGuard();
    try {
      expect(new XMLSerializer().serializeToString(div)).toBe(before);
    } finally {
      restore();
    }
  });

  test('restore() puts the original serializer back', () => {
    const original = XMLSerializer.prototype.serializeToString;
    const restore = installSvgSerializeGuard();
    expect(XMLSerializer.prototype.serializeToString).not.toBe(original);
    restore();
    expect(XMLSerializer.prototype.serializeToString).toBe(original);
  });

  test('the neutralized set covers position and every offset longhand', () => {
    for (const p of ['position', 'top', 'right', 'bottom', 'left', 'inset']) {
      expect(SVG_POSITIONAL_PROPS).toContain(p);
    }
  });
});

describe('renderVideo wires the guard around renderMediaOnWeb', () => {
  test('the renderer sees a neutralized svg, and the serializer is restored after', async () => {
    let seen = '';
    const originalSerialize = XMLSerializer.prototype.serializeToString;
    mock.module('@remotion/web-renderer', () => ({
      renderMediaOnWeb: async () => {
        // what turnSvgIntoDrawable does, on the live element, mid-render
        const svg = document.querySelector('svg') as SVGSVGElement;
        seen = new XMLSerializer().serializeToString(svg);
        return { getBlob: async () => new Blob([new Uint8Array([1, 2, 3])]) };
      },
    }));
    makeSvg('position: absolute; left: 300px; top: 80px;');
    await import('../exporters/video-render-lib.ts');
    const g = globalThis as unknown as {
      __maudeRenderVideo__: (o: Record<string, unknown>) => Promise<{ bytes: number }>;
    };
    const res = await g.__maudeRenderVideo__({
      component: () => null,
      width: 640,
      height: 360,
      fps: 30,
      durationInFrames: 1,
      container: 'mp4',
      muted: true,
    });
    expect(res.bytes).toBe(3);
    expect(seen).toContain('<rect');
    expect(seen).not.toMatch(/position:\s*absolute/);
    expect(seen).not.toMatch(/left:\s*300px/);
    expect(XMLSerializer.prototype.serializeToString).toBe(originalSerialize);
  });
});

describe('remedyFor — an <svg> the renderer could not turn into an image', () => {
  test("names the failure in the author's terms", () => {
    const remedy = remedyFor('Failed to convert SVG to image');
    expect(remedy).toBeDefined();
    expect(remedy).toMatch(/svg/i);
  });

  test('an unrelated reason still has no invented remedy', () => {
    expect(remedyFor('Maximum call stack size exceeded')).toBeUndefined();
  });
});
