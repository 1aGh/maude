// gate-b-c4 — the per-frame capability's pure parts (access/frame.ts + client/frame-cap.js): the
// shell and the server mint the same bytes, a capability verifies only under its own key, and a
// frame NARROWS the opener's access (an intersection — never a raise).

import { describe, expect, test } from 'bun:test';

import {
  frameKeyFor,
  framelessAllowed,
  frameRefusal,
  frameTokenOf,
  mintFrameCap,
  narrowToFrame,
  newFrameSecret,
  verifyFrameCap,
} from '../access/frame.ts';
import { resolveAccess } from '../access/scope.ts';
import { frameCapFor, hmacSha256, sha256 } from '../client/frame-cap.js';

const secret = newFrameSecret();
const keyO = frameKeyFor(secret, 'owner@example.com');
const keyE = frameKeyFor(secret, 'editor@example.com');

describe('mint / verify', () => {
  test('the client mints the bytes the server mints', () => {
    for (const rel of ['ui/a.tsx', 'ui/Docs Site.tsx', 'system/ds/preview/x.tsx', 'ui/žluť.tsx'])
      expect(frameCapFor(keyO.toString('base64url'), rel)).toBe(mintFrameCap(keyO, [rel]));
  });
  test('sha256 / hmac match node:crypto', async () => {
    const { createHash, createHmac } = await import('node:crypto');
    for (const n of [0, 1, 55, 56, 63, 64, 65, 200]) {
      const m = new Uint8Array(n).map((_, i) => (i * 31) & 255);
      expect(Buffer.from(sha256(m)).toString('hex')).toBe(
        createHash('sha256').update(m).digest('hex')
      );
      const k = new Uint8Array(n % 90).map((_, i) => (i * 7) & 255);
      expect(Buffer.from(hmacSha256(k, m)).toString('hex')).toBe(
        createHmac('sha256', k).update(m).digest('hex')
      );
    }
  });
  test('verifies only under its own key, and only unmodified', () => {
    const t = mintFrameCap(keyO, ['ui/a.tsx']) as string;
    expect(verifyFrameCap(keyO, t)).toEqual(['ui/a.tsx']);
    expect(verifyFrameCap(keyE, t)).toBeNull();
    const body = Buffer.from('ui/b.tsx').toString('base64url');
    expect(verifyFrameCap(keyO, `${body}.${t.split('.')[1]}`)).toBeNull();
    expect(verifyFrameCap(keyO, `${t}x`)).toBeNull();
    expect(verifyFrameCap(keyO, '')).toBeNull();
    expect(verifyFrameCap(keyO, null)).toBeNull();
  });
  test('refuses to name a traversal or a newline', () => {
    expect(mintFrameCap(keyO, ['../x.tsx'])).toBeNull();
    expect(mintFrameCap(keyO, ['ui/a.tsx\nui/b.tsx'])).toBeNull();
    expect(mintFrameCap(keyO, [])).toBeNull();
    expect(frameCapFor(keyO.toString('base64url'), 'ui/a\n.tsx')).toBeNull();
  });
  test('rides as ?fc=, else in the Referer', () => {
    const own = new Request('http://c/x?fc=AAA', { headers: { referer: 'http://c/y?fc=BBB' } });
    expect(frameTokenOf(own)).toBe('AAA');
    const ref = new Request('http://c/x', { headers: { referer: 'http://c/y?fc=BBB' } });
    expect(frameTokenOf(ref)).toBe('BBB');
    expect(frameTokenOf(new Request('http://c/x'))).toBeNull();
  });
});

describe('narrowToFrame', () => {
  test('an owner opening A holds A as a member, and nothing else', () => {
    const n = narrowToFrame(resolveAccess({ v: 1, role: 'owner' }), ['ui/a.tsx']);
    expect(n.role).toBeNull();
    expect(n.canvasOnly).toBe(true);
    expect(n.can('edit', 'ui/a.tsx')).toBe(true);
    expect(n.can('read', 'ui/b.tsx')).toBe(false);
    expect(n.seesCanvas('ui/b.tsx')).toBe(false);
    expect(n.can('delete', 'ui/a.tsx')).toBe(false);
  });
  test('a viewer stays a viewer on A', () => {
    const n = narrowToFrame(resolveAccess({ v: 1, role: 'viewer' }), ['ui/a.tsx']);
    expect(n.can('read', 'ui/a.tsx')).toBe(true);
    expect(n.can('edit', 'ui/a.tsx')).toBe(false);
  });
  test('a capability for a canvas the opener cannot see holds nothing', () => {
    const aOnly = resolveAccess({ v: 1, role: null, grants: [{ c: 'ui/a.tsx', r: 'member' }] });
    const n = narrowToFrame(aOnly, ['ui/b.tsx']);
    expect(n.grants).toEqual([]);
    expect(frameRefusal('/.design/ui/b.tsx', n)?.status).toBe(403);
  });
  test('frame-less reaches only the runtime, the shell, its chrome and /_health', () => {
    for (const p of [
      '/_health',
      '/_canvas-shell.html',
      '/_canvas-runtime/react.js',
      '/_client/x.css',
    ])
      expect({ p, ok: framelessAllowed(p) }).toEqual({ p, ok: true });
    for (const p of [
      '/.design/ui/a.tsx',
      '/_api/annotations',
      '/_comments',
      '/_ws/collab/x',
      '/_canvas-runtime/%2e%2e/.design/ui/b.tsx',
      '/_client/..%2f.design/ui/b.tsx',
    ])
      expect({ p, ok: framelessAllowed(p) }).toEqual({ p, ok: false });
  });
});
