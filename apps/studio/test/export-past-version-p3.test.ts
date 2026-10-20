// S8.1b — a past version and Display P3 (contract S8-export-spec.md §5.1, §5.3, §5.6; S8-slices Q6).
//
// Unit level, no browser:
//   · `at:{sha}` reaches the capture as `?sha=` on the shell URL — the server's own history store
//     builds that version (serveHistoricalCanvas); only a validated sha travels, never a source;
//   · `at` and P3 run on this Mac only: a workspace lane (render service / browser capture) refuses
//     them with the field, and so does a format the capture cannot honour — never a silent "now" or
//     a silent sRGB file;
//   · the render-service dispatch refuses both as a second line (its option allowlist would drop them);
//   · the browser lane of the sheet never takes them;
//   · a P3 export is accepted only when the written file carries a Display P3 ICC profile.

import { describe, expect, test } from 'bun:test';
import { deflateSync } from 'node:zlib';

import { resolveAccess } from '../access/scope.ts';
import { browserLaneRequest } from '../client/v2/export/use-export-spec.js';
import { canvasShellUrl } from '../exporters/index.ts';
import { assertDisplayP3, iccProfileOf, isDisplayP3Icc } from '../exporters/png.ts';
import { renderRemotely } from '../exporters/remote.ts';
import type { SpecCanvas } from '../exporters/scope.ts';
import { type ExportRouteDeps, planExportV2 } from '../routes/export.ts';

const SHA = '0123abc4567def89';
const CTX = {
  designRoot: '/abs/proj/.design',
  repoRoot: '/abs/proj',
  serverOrigin: 'http://localhost:4399',
  tokensCssRel: 'system/tokens.css',
};

const CANVASES: SpecCanvas[] = [
  {
    rel: 'ui/a.tsx',
    artboards: [
      { id: 'hero', label: 'hero', kind: 'digital', w: 1080, h: 1350 },
      { id: 'poster', label: 'poster', kind: 'print', w: 559, h: 794 },
    ],
  },
];
const OWNER = resolveAccess({ v: 1, role: 'owner' });
function deps(lane: 'local' | 'remote' | 'none' = 'local'): ExportRouteDeps {
  return {
    designRel: '.design',
    projectName: () => 'Alligators',
    canvases: () => CANVASES,
    activeCanvas: () => 'ui/a.tsx',
    access: () => OWNER,
    history: () => [],
    renderLane: () => lane,
    retry: async () => ({ ok: false, reason: 'missing' }) as never,
  };
}

async function refusal(p: ReturnType<typeof planExportV2>) {
  expect(p.ok).toBe(false);
  if (p.ok) return null;
  expect(p.response.status).toBe(400);
  return (await p.response.json()) as { error: string; field: string; message: string };
}

describe('the shell URL of a past version', () => {
  test('`at` adds `sha=` and nothing else; without it the URL is the v1 URL byte for byte', () => {
    const now = canvasShellUrl(CTX, '.design/ui/a.tsx');
    expect(now).toBe(
      'http://localhost:4399/_canvas-shell.html?canvas=ui%2Fa.tsx&tokens=system%2Ftokens.css&hide-chrome=1'
    );
    const then = new URL(canvasShellUrl(CTX, '.design/ui/a.tsx', { at: SHA }));
    expect(then.origin).toBe('http://localhost:4399'); // the main origin — it 307s to the capture origin
    expect(then.searchParams.get('sha')).toBe(SHA);
    then.searchParams.delete('sha');
    expect(then.toString()).toBe(now);
  });

  test('only a hex sha travels — a ref name, a path or an option is refused before any capture', () => {
    for (const bad of [
      'HEAD',
      'main',
      '../x',
      'abc',
      `${SHA}:ui/a.tsx`,
      '--output=/tmp/x',
      'r12',
    ]) {
      expect(() => canvasShellUrl(CTX, '.design/ui/a.tsx', { at: bad })).toThrow(/past version/);
    }
  });
});

describe('planExportV2 — a past version', () => {
  test('on this Mac every unit carries the sha to its capture', () => {
    const p = planExportV2({ v: 2, scope: 'canvas', format: 'png', at: { sha: SHA } }, deps());
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.group.units.length).toBeGreaterThan(0);
    for (const u of p.group.units) expect(u.options.atSha).toBe(SHA);
    expect(p.group.spec.at).toEqual({ sha: SHA }); // Export again replays the same version
  });

  test('a JPG of a past version is the same path', () => {
    const p = planExportV2(
      {
        v: 2,
        scope: 'selection',
        selection: { artboards: ['hero'] },
        format: 'jpg',
        at: { sha: SHA },
      },
      deps()
    );
    expect(p.ok).toBe(true);
    if (p.ok) expect(p.first.options.atSha).toBe(SHA);
  });

  test('a workspace lane refuses it with the field — it would render today’s canvas', async () => {
    for (const lane of ['remote', 'none'] as const) {
      const r = await refusal(
        planExportV2({ v: 2, scope: 'canvas', format: 'png', at: { sha: SHA } }, deps(lane))
      );
      expect(r).toMatchObject({ error: 'not-available', field: 'at' });
    }
  });

  test('a format whose capture cannot take a version is refused, not exported as now', async () => {
    const r = await refusal(
      planExportV2({ v: 2, scope: 'canvas', format: 'pdf', at: { sha: SHA } }, deps())
    );
    expect(r).toMatchObject({ error: 'not-available', field: 'at' });
  });

  test('a v1 body cannot smuggle a version in through the options bag', () => {
    // the v1 options bag is free-form; a planted `atSha` must still be a hex sha at the URL
    expect(() => canvasShellUrl(CTX, '.design/ui/a.tsx', { at: 'HEAD~1' })).toThrow();
  });
});

describe('planExportV2 — Display P3', () => {
  const P3 = { colorProfile: 'display-p3' } as const;

  test('PNG and JPG on this Mac carry the profile to the capture', () => {
    for (const format of ['png', 'jpg'] as const) {
      const p = planExportV2({ v: 2, scope: 'canvas', format, options: P3 }, deps());
      expect(p.ok).toBe(true);
      if (p.ok) for (const u of p.group.units) expect(u.options.colorProfile).toBe('display-p3');
    }
  });

  test('P3 asked for the cloud still runs on this Mac (Q6) — nothing refuses a local job', () => {
    const p = planExportV2(
      { v: 2, scope: 'canvas', format: 'png', options: { ...P3, lane: 'cloud' } },
      deps()
    );
    expect(p.ok).toBe(true);
  });

  test('a workspace lane refuses P3 — the render service and the browser capture write sRGB', async () => {
    for (const lane of ['remote', 'none'] as const) {
      const r = await refusal(
        planExportV2({ v: 2, scope: 'canvas', format: 'png', options: P3 }, deps(lane))
      );
      expect(r).toMatchObject({ error: 'not-available', field: 'options.colorProfile' });
    }
  });

  test('P3 on a format that would ignore it is refused, per kind too', async () => {
    const r1 = await refusal(
      planExportV2({ v: 2, scope: 'canvas', format: 'pdf', options: P3 }, deps())
    );
    expect(r1).toMatchObject({ field: 'options.colorProfile' });
    const r2 = await refusal(
      planExportV2(
        {
          v: 2,
          scope: 'canvas',
          format: 'png',
          options: P3,
          byKind: { print: { format: 'pdf' } },
        },
        deps()
      )
    );
    expect(r2).toMatchObject({ field: 'options.colorProfile' });
  });
});

describe('the render-service dispatch — second line', () => {
  const args = (options: Record<string, unknown>) => ({
    format: 'png' as const,
    targets: [],
    options,
    canvas: { origin: 'https://canvas.example' },
    service: { url: 'https://render.example', secret: 's' },
  });

  test('P3 and a past version never reach the service (it would drop them and write sRGB / now)', async () => {
    const real = globalThis.fetch;
    let called = 0;
    globalThis.fetch = (async () => {
      called += 1;
      return new Response('x');
    }) as unknown as typeof fetch;
    try {
      await expect(renderRemotely(args({ colorProfile: 'display-p3' }))).rejects.toThrow(/P3/);
      await expect(renderRemotely(args({ atSha: SHA }))).rejects.toThrow(/past version/);
      expect(called).toBe(0);
    } finally {
      globalThis.fetch = real;
    }
  });
});

describe('the browser lane of the sheet', () => {
  const ctx = { exportLane: 'remote', artboards: ['hero'], activePath: '.design/ui/a.tsx' };
  test('one artboard as PNG still goes to the browser lane…', () => {
    expect(browserLaneRequest({ format: 'png', scope: 'selection', adv: {} }, ctx)).not.toBeNull();
  });
  test('…but never with P3 or a past version (the jobs lane refuses them with a line)', () => {
    expect(
      browserLaneRequest(
        { format: 'png', scope: 'selection', adv: { colorProfile: 'display-p3' } },
        ctx
      )
    ).toBeNull();
    expect(
      browserLaneRequest({ format: 'png', scope: 'selection', adv: {}, at: { sha: SHA } }, ctx)
    ).toBeNull();
  });
});

// ── the ICC check ───────────────────────────────────────────────────────────────────────────────
const P3_D50 = [
  [0.515106, 0.24118, -0.001053],
  [0.291962, 0.69223, 0.041885],
  [0.15715, 0.066589, 0.784378],
];
const SRGB_D50 = [
  [0.436066, 0.222488, 0.013916],
  [0.385147, 0.716873, 0.097076],
  [0.143066, 0.060608, 0.714096],
];

/** A minimal matrix ICC profile: header + rXYZ/gXYZ/bXYZ (what the check reads). */
function icc(colorants: number[][]): Uint8Array {
  const tags = ['rXYZ', 'gXYZ', 'bXYZ'];
  const size = 128 + 4 + tags.length * 12 + tags.length * 20;
  const b = Buffer.alloc(size);
  b.writeUInt32BE(size, 0);
  b.write('mntrRGB XYZ ', 12, 'latin1');
  b.write('acsp', 36, 'latin1');
  b.writeUInt32BE(tags.length, 128);
  tags.forEach((sig, i) => {
    const off = 128 + 4 + tags.length * 12 + i * 20;
    b.write(sig, 132 + i * 12, 'latin1');
    b.writeUInt32BE(off, 136 + i * 12);
    b.writeUInt32BE(20, 140 + i * 12);
    b.write('XYZ ', off, 'latin1');
    for (let k = 0; k < 3; k++)
      b.writeInt32BE(Math.round(colorants[i][k] * 65536), off + 8 + 4 * k);
  });
  return new Uint8Array(b);
}

function crc32(buf: Buffer): number {
  let c = ~0;
  for (const byte of buf) {
    c ^= byte;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(profile?: Uint8Array): Uint8Array {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0);
  ihdr.writeUInt32BE(1, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  const parts = [
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
  ];
  if (profile)
    parts.push(
      chunk('iCCP', Buffer.concat([Buffer.from('p3\0\0', 'latin1'), deflateSync(profile)]))
    );
  parts.push(
    chunk('IDAT', deflateSync(Buffer.from([0, 255, 0, 0]))),
    chunk('IEND', Buffer.alloc(0))
  );
  return new Uint8Array(Buffer.concat(parts));
}
function jpeg(profile?: Uint8Array): Uint8Array {
  const parts = [Buffer.from([0xff, 0xd8])];
  const app0 = Buffer.from('JFIF\0\x01\x01\0\0\x01\0\x01\0\0', 'latin1');
  parts.push(Buffer.from([0xff, 0xe0, 0, app0.length + 2]), app0);
  if (profile) {
    const body = Buffer.concat([
      Buffer.from('ICC_PROFILE\0\x01\x01', 'latin1'),
      Buffer.from(profile),
    ]);
    const len = Buffer.alloc(2);
    len.writeUInt16BE(body.length + 2);
    parts.push(Buffer.from([0xff, 0xe2]), len, body);
  }
  parts.push(Buffer.from([0xff, 0xda, 0, 2, 0xff, 0xd9]));
  return new Uint8Array(Buffer.concat(parts));
}

describe('a P3 file must carry a Display P3 ICC profile', () => {
  test('the profile is read back out of a PNG and a JPG', () => {
    const p = icc(P3_D50);
    expect(iccProfileOf(png(p), 'png')).toEqual(p);
    expect(iccProfileOf(jpeg(p), 'jpeg')).toEqual(p);
    expect(iccProfileOf(png(), 'png')).toBeNull();
    expect(iccProfileOf(jpeg(), 'jpeg')).toBeNull();
  });

  test('Display P3 colorants pass; sRGB colorants do not', () => {
    expect(isDisplayP3Icc(icc(P3_D50))).toBe(true);
    expect(isDisplayP3Icc(icc(SRGB_D50))).toBe(false);
    expect(isDisplayP3Icc(new Uint8Array(40))).toBe(false);
  });

  test('an untagged or sRGB-tagged file is refused — never handed over as P3', () => {
    expect(() => assertDisplayP3(png(icc(P3_D50)), 'png', 'a.png')).not.toThrow();
    expect(() => assertDisplayP3(jpeg(icc(P3_D50)), 'jpeg', 'a.jpg')).not.toThrow();
    expect(() => assertDisplayP3(png(), 'png', 'a.png')).toThrow(/Display P3/);
    expect(() => assertDisplayP3(png(icc(SRGB_D50)), 'png', 'a.png')).toThrow(/Display P3/);
    expect(() => assertDisplayP3(jpeg(), 'jpeg', 'a.jpg')).toThrow(/Display P3/);
  });
});
