// S8.22 — the one line per arrival (client/v2/assets/import-lines.js, words from 12 · ia-more-ways / ia-edges) and the
// client's routing of Photoshop / HEIC / SVG files to POST /_api/import-asset (asset-upload.ts). Pure; no server.

import { describe, expect, test } from 'bun:test';
import { importAsset, importKindOf, uploadAsset } from '../asset-upload.ts';
import {
  ARRIVAL_LINES,
  addingLine,
  importLine,
  removedClause,
} from '../client/v2/assets/import-lines.js';

describe('S8.22 import lines', () => {
  test('a second copy, a .psd, a HEIC and a cleaned logo each get the canvas line', () => {
    expect(importLine({ ok: true, reused: true }, { name: 'IMG_2231.jpg' })?.text).toBe(
      'IMG_2231.jpg is already in Assets — placed the same one, not a copy.'
    );
    expect(importLine({ ok: true, converted: 'psd' }, { name: 'dres-2027-final.psd' })?.text).toBe(
      'Placed the flat picture from dres-2027-final.psd. Its layers stay in Photoshop.'
    );
    expect(
      importLine({ ok: true, converted: 'heic' }, { name: 'IMG_5012.HEIC', original: true })?.text
    ).toBe(
      'IMG_5012.HEIC came in as a JPG the canvas can show. The original stays under Advanced.'
    );
    expect(importLine({ ok: true, converted: 'heic' }, { name: 'IMG_5012.HEIC' })?.text).toBe(
      'IMG_5012.HEIC came in as a JPG the canvas can show.'
    );
    expect(
      importLine(
        { ok: true, removed: { scripts: 1, links: 2, other: 0 } },
        { name: 'gator_badge_roundel.svg' }
      )?.text
    ).toBe(
      'gator_badge_roundel.svg kept its shapes and colours; two links to other sites and a script were left out.'
    );
    // a plain arrival needs no line
    expect(
      importLine({ ok: true, removed: { scripts: 0, links: 0, other: 0 } }, { name: 'x.svg' })
    ).toBe(null);
    expect(removedClause({ scripts: 0, links: 1, other: 0 })).toBe(
      'one link to another site was left out'
    );
  });

  test('every refusal word reads as one line and never shows a message or a path', () => {
    for (const reason of [
      'no-flat-picture',
      'not-on-mac',
      'too-many-pixels',
      'too-large',
      'timeout',
      'busy',
      'external-reference',
      'forbidden',
      'unsupported',
      'refused',
      'unreadable',
    ]) {
      const line = importLine(
        { ok: false, reason, error: '/private/var/x: EACCES' },
        { name: 'a.psd' }
      );
      expect(line?.tone).toBe('warn');
      expect(line?.text).not.toMatch(/\/private|EACCES|assets\//);
      expect(line?.text.split(/(?<=[.?!])\s/).length).toBeLessThanOrEqual(2);
    }
    expect(importLine({ ok: false, reason: 'no-flat-picture' }, { name: 'a.psd' })?.text).toMatch(
      /PNG or JPG/
    );
  });

  test('the other arrivals keep the canvas words', () => {
    expect(ARRIVAL_LINES.pasted('Story 9:16 · Gameday')).toBe(
      'Pasted into Story 9:16 · Gameday, where the pointer was. Paste it again and the same picture is reused, not copied.'
    );
    expect(ARRIVAL_LINES.offline()).toBe('Kept on this Mac — goes up by itself once it’s online.');
    expect(ARRIVAL_LINES.fromLink()).toBe(
      'Saved a copy from the link — the page can change, your copy won’t.'
    );
    expect(ARRIVAL_LINES.addedBy('Tereza')).toBe('Added by Tereza');
  });
});

// p8-fix-e (F16, 12 · ia-edges A) — "Preparing <name> — keeps working in the background. About 4 min." had no caller:
// a 500 MB clip showed the bare "Adding… 38%". `addingLine` is what the Assets panel's busy line now says.
describe('F16 · A — a huge file says it is preparing, with the time left', () => {
  const MB = 1024 * 1024;
  test('a large file names itself and the minutes left, from the pace so far', () => {
    // 38 % in 2 min 27 s → about 4 min left
    const line = addingLine({
      progress: 0.38,
      name: 'stadion-dron-4K.mov',
      bytes: 512 * MB,
      elapsedMs: 147_000,
    });
    expect(line).toBe(
      'Preparing stadion-dron-4K.mov — keeps working in the background. About 4 min. 38 %'
    );
  });
  test('under a minute left, and before any pace is known', () => {
    expect(
      addingLine({ progress: 0.95, name: 'big.mov', bytes: 300 * MB, elapsedMs: 60_000 })
    ).toBe('Preparing big.mov — keeps working in the background. About a minute. 95 %');
    expect(addingLine({ progress: 0, name: 'big.mov', bytes: 300 * MB, elapsedMs: 0 })).toBe(
      'Preparing big.mov — keeps working in the background. 0 %'
    );
  });
  test('a small file keeps the short line; no progress yet keeps "Adding…"', () => {
    expect(addingLine({ progress: 0.5, name: 'IMG_2231.jpg', bytes: 3 * MB, elapsedMs: 400 })).toBe(
      'Adding… 50%'
    );
    expect(addingLine(null)).toBe('Adding…');
  });
});

describe('S8.22 asset-upload routes converters to /_api/import-asset', () => {
  test('the kind guess comes from the name or type (the server still sniffs)', () => {
    expect(importKindOf('dres-2027-final.PSD', '')).toBe('psd');
    expect(importKindOf('IMG_5012.HEIC', '')).toBe('heic');
    expect(importKindOf('x', 'image/heif')).toBe('heic');
    expect(importKindOf('logo.svg', '')).toBe('svg');
    expect(importKindOf('IMG_2231.jpg', 'image/jpeg')).toBe(null);
  });

  test('a .psd goes to the import route with its kind and encoded name; the answer keeps reused/converted', async () => {
    const seen: Array<{ url: string; headers: Record<string, string> }> = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      seen.push({ url, headers: init.headers as Record<string, string> });
      return Response.json(
        { ok: true, path: 'assets/0a1b2c3d.png', reused: true, converted: 'psd' },
        { status: 201 }
      );
    }) as unknown as typeof fetch;
    const file = new File([new Uint8Array([0x38, 0x42, 0x50, 0x53])], 'dres 2027.psd');
    const r = await uploadAsset(file, { fetchImpl });
    expect(r).toEqual({ path: 'assets/0a1b2c3d.png', reused: true, converted: 'psd' });
    expect(seen[0].url).toBe('/_api/import-asset');
    expect(seen[0].headers['X-Import-Kind']).toBe('psd');
    expect(seen[0].headers['X-Import-Name']).toBe('dres%202027.psd');
  });

  test('a refusal keeps its reason; a photo still goes to /_api/asset', async () => {
    const urls: string[] = [];
    const fetchImpl = (async (url: string) => {
      urls.push(url);
      return url === '/_api/import-asset'
        ? Response.json(
            { ok: false, reason: 'not-on-mac', error: 'PSD and HEIC files come in on a Mac' },
            { status: 415 }
          )
        : Response.json({ path: 'assets/11223344.jpg' }, { status: 201 });
    }) as unknown as typeof fetch;
    expect(await importAsset(new Blob([new Uint8Array(4)]), 'heic', { fetchImpl })).toEqual({
      error: 'PSD and HEIC files come in on a Mac',
      reason: 'not-on-mac',
    });
    expect(
      await uploadAsset(new File([new Uint8Array(4)], 'IMG_2231.jpg', { type: 'image/jpeg' }), {
        fetchImpl,
      })
    ).toEqual({
      path: 'assets/11223344.jpg',
    });
    expect(urls).toEqual(['/_api/import-asset', '/_api/asset']);
  });
});
