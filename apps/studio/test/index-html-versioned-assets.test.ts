// The studio page asks for its bundle and stylesheet by a VERSIONED URL.
//
// Behind Cloudflare a fixed `/_client/client.bundle.js` is cached for four
// hours whatever the origin says, so a cloud user kept running the previous
// release's client against the new server (2026-10-02, after v1.6.5).

import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';

import { serveIndexHtml } from '../http.ts';
import { DIST_DIR } from '../paths.ts';

describe('serveIndexHtml', () => {
  test('bundle and stylesheet URLs carry the built file version', async () => {
    const res = await serveIndexHtml();
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-cache');
    const html = await res.text();
    for (const name of ['client.bundle.js', 'styles.css']) {
      const f = Bun.file(join(DIST_DIR, name));
      const v = `${f.size.toString(16)}-${Math.trunc(f.lastModified).toString(16)}`;
      expect(html).toContain(`/_client/${name}?v=${v}`);
    }
    expect(html).not.toContain('"/_client/client.bundle.js"');
  });
});
