// S8.7 — the Print PDF reaches the engine: the spec's `print` becomes `pdfPrint` (bleed, crop and
// registration marks) and `text` (outlines), "Add the back" makes page 2 of the same PDF, and the
// cloud lane no longer drops the text mode. Pure: no server, no browser.

import { describe, expect, test } from 'bun:test';
import { renderRemotely } from '../exporters/remote.ts';
import {
  engineOptionsFor,
  resolveScope,
  resolveSpecV2,
  type SpecCanvas,
} from '../exporters/scope.ts';
import { type ExportSpecV2, validateSpecV2 } from '../exporters/spec-v2.ts';

const ok = (raw: unknown): ExportSpecV2 => {
  const r = validateSpecV2(raw);
  if (!r.ok) throw new Error(JSON.stringify(r));
  return r.spec;
};
const AB = (id: string, label: string, kind = 'print', w = 484, h = 640) => ({
  id,
  label,
  kind,
  w,
  h,
});
const LETAK: SpecCanvas[] = [
  {
    rel: 'ui/letak.tsx',
    artboards: [
      AB('a-flag', 'A · přední (FLAG)'),
      AB('b-flag', 'B · zadní (FLAG)'),
      AB('a-tackle', 'A · přední (TACKLE)'),
      AB('b-tackle', 'B · zadní (TACKLE)'),
    ],
  },
];
const ctx = { designRel: '.design', canvases: LETAK, activeCanvas: 'ui/letak.tsx' };
const resolve = (raw: unknown) => {
  const r = resolveSpecV2(ok(raw), ctx);
  if (!r.ok) throw new Error(JSON.stringify(r));
  return r;
};

describe('print options reach the engine', () => {
  test('validation accepts registration and text, and refuses a text mode that is not one', () => {
    const good = validateSpecV2({
      v: 2,
      scope: 'selection',
      format: 'pdf',
      selection: { artboards: ['a-flag'] },
      options: { print: { bleed: true, marks: 'crop', registration: true, text: 'outline' } },
    });
    expect(good.ok).toBe(true);
    const bad = validateSpecV2({
      v: 2,
      scope: 'selection',
      format: 'pdf',
      selection: { artboards: ['a-flag'] },
      options: { print: { text: 'shapes' } },
    });
    expect(bad).toMatchObject({ ok: false, error: { field: 'options.print.text' } });
  });

  test('bleed, crop marks, registration marks and outlines become pdfPrint + text', () => {
    expect(
      engineOptionsFor('pdf', {
        print: { bleed: true, marks: 'crop', registration: true, text: 'outline' },
      })
    ).toEqual({
      pdfPrint: { includeBleed: true, marks: { crop: true, registration: true } },
      text: 'outline',
    });
    // Bleed off is a choice (the strip is cut away), not "unset"; no marks is an empty set
    expect(engineOptionsFor('pdf', { print: { bleed: false, marks: 'none' } })).toEqual({
      pdfPrint: { includeBleed: false, marks: {} },
    });
    // keep is today's behaviour and is not sent; a plain PDF and a PNG carry no print geometry
    expect(engineOptionsFor('pdf', { print: { text: 'keep' } }).text).toBeUndefined();
    expect(engineOptionsFor('pdf', {}).pdfPrint).toBeUndefined();
    expect(engineOptionsFor('png', { print: { bleed: true } }).pdfPrint).toBeUndefined();
  });

  test('a Print PDF unit carries pdfPrint into the options the adapter reads', () => {
    const r = resolve({
      v: 2,
      scope: 'selection',
      format: 'pdf',
      selection: { artboards: ['a-flag'] },
      options: { print: { bleed: true, marks: 'crop' } },
    });
    expect(r.units[0]?.options.pdfPrint).toEqual({ includeBleed: true, marks: { crop: true } });
  });
});

describe('Add the back → page 2 of the same PDF', () => {
  const spec = (back: boolean, artboards = ['a-flag']) => ({
    v: 2,
    scope: 'selection',
    format: 'pdf',
    selection: { artboards },
    options: { print: { bleed: true, marks: 'crop', back } },
  });

  test('the front’s own back rides as the second target; the unit is still the front’s file', async () => {
    const r = resolve(spec(true));
    expect(r.units).toHaveLength(1);
    const u = r.units[0];
    expect(u?.artboards.map((b) => b.id)).toEqual(['a-flag']);
    expect(u?.back?.id).toBe('b-flag');
    expect(u?.options.artboardIds).toEqual(['a-flag', 'b-flag']);
    const targets = await resolveScope({
      scope: u?.scope ?? 'artboard',
      activeJson: { active: null, selected: null },
      designRoot: '/abs/proj/.design',
      options: u?.options,
    });
    expect(targets.map((t) => (t.kind === 'element' ? t.cssPath : t.kind))).toEqual([
      '[data-dc-screen="a-flag"]',
      '[data-dc-screen="b-flag"]',
    ]);
  });

  test('the TACKLE front gets the TACKLE back, never the other one', () => {
    expect(resolve(spec(true, ['a-tackle'])).units[0]?.back?.id).toBe('b-tackle');
  });

  test('without the box there is no back; a back the person selected too stays its own file', () => {
    const off = resolve(spec(false)).units[0];
    expect(off?.back).toBeUndefined();
    expect(off?.options.artboardIds).toBeUndefined();
    const both = resolve(spec(true, ['a-flag', 'b-flag']));
    expect(both.units.map((u) => [u.artboards[0]?.id, u.back?.id ?? null])).toEqual([
      ['a-flag', null],
      ['b-flag', null],
    ]);
  });

  test('only a PDF takes a back: a PNG of the same front is one picture', () => {
    const png = resolve({ ...spec(true), format: 'png' });
    expect(png.units[0]?.back).toBeUndefined();
  });

  test('a member-supplied artboardIds list is bounded and must start with the unit’s own artboard', async () => {
    const t = await resolveScope({
      scope: 'artboard',
      activeJson: { active: null, selected: null },
      designRoot: '/abs/proj/.design',
      options: {
        canvasFile: '.design/ui/letak.tsx',
        artboardId: 'a-flag',
        artboardIds: ['x', 'y', 'z', 'w', 'v', 'u', 't'],
      },
    });
    expect(t).toHaveLength(1);
    const long = await resolveScope({
      scope: 'artboard',
      activeJson: { active: null, selected: null },
      designRoot: '/abs/proj/.design',
      options: {
        canvasFile: '.design/ui/letak.tsx',
        artboardId: 'a',
        artboardIds: ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
      },
    });
    expect(long).toHaveLength(4);
  });
});

describe('the cloud lane keeps the text mode', () => {
  test('options.text crosses to the render service (it used to be dropped silently)', async () => {
    const real = globalThis.fetch;
    let sent: { options?: Record<string, unknown> } = {};
    globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
      sent = JSON.parse(String(init?.body));
      return new Response(new Uint8Array([1]), {
        status: 200,
        headers: { 'content-type': 'application/pdf' },
      });
    }) as unknown as typeof fetch;
    try {
      await renderRemotely({
        format: 'pdf' as never,
        targets: [],
        options: { text: 'outline', pdfPrint: { marks: { crop: true } }, evil: 1 },
        canvas: { origin: 'https://canvas.example' } as never,
        service: { url: 'https://render.example', secret: 's' } as never,
      }).catch(() => {});
      expect(sent.options?.text).toBe('outline');
      expect(sent.options?.pdfPrint).toEqual({ marks: { crop: true } });
      expect(sent.options?.evil).toBeUndefined();
    } finally {
      globalThis.fetch = real;
    }
  });
});
