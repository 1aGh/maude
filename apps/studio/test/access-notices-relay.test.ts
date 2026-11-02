// S9.21b — the hub's access notices on their way to the shell (sync/access-notices.ts, V2-1.7 §5.6).
//
// Every canvas doc socket hears its own copy, so the relay passes each notice on ONCE; what it passes
// is rebuilt from a fixed vocabulary (no free text rides through); a `raised` re-exchanges the
// credential before the shell hears it. The ws frame classes keep a request off canvas-only sockets.

import { describe, expect, test } from 'bun:test';

import { frameFor, WS_FRAME_CLASSES } from '../access/filters.ts';
import { cleanName, createAccessRelay, parseAccessNotice } from '../sync/access-notices.ts';

const j = (v: unknown) => JSON.stringify(v);

describe('parseAccessNotice', () => {
  test('an access change keeps only epoch / change / a known reason', () => {
    expect(
      parseAccessNotice(
        j({
          type: 'maude.access',
          epoch: 7,
          change: 'ended',
          reason: 'link-off',
          note: '<b>hi</b>',
        })
      )
    ).toEqual({ type: 'maude.access', epoch: 7, change: 'ended', reason: 'link-off' });
    expect(
      parseAccessNotice(j({ type: 'maude.access', epoch: 7, change: 'ended', reason: 'because' }))
    ).toEqual({ type: 'maude.access', epoch: 7, change: 'ended' });
    expect(parseAccessNotice(j({ type: 'maude.access', epoch: 7, change: 'promoted' }))).toBeNull();
    expect(parseAccessNotice(j({ type: 'maude.access', change: 'raised' }))).toBeNull();
  });

  test('a request keeps a cleaned name and a canvas path, nothing else', () => {
    const f = parseAccessNotice(
      j({
        type: 'maude.access-request',
        id: 'rq_1',
        from: { name: 'Petra‮\u0007 Nováková'.padEnd(200, 'x'), email: 'p@x.cz' },
        canvas: 'ui/Combine-kampan.tsx',
        at: 5,
        note: 'please',
      })
    );
    expect(f).toMatchObject({
      type: 'maude.access-request',
      id: 'rq_1',
      canvas: 'ui/Combine-kampan.tsx',
      at: 5,
    });
    expect(Object.keys(f as object).sort()).toEqual(['at', 'canvas', 'from', 'id', 'type']);
    const name = (f as { from: { name: string } }).from.name;
    expect(name.startsWith('Petra Nováková')).toBe(true);
    expect(name.length).toBeLessThanOrEqual(80);
    expect(Object.keys((f as { from: object }).from)).toEqual(['name']);
  });

  test('a canvas that is not a designRoot-relative canvas path is dropped; a bad id drops the frame', () => {
    for (const canvas of ['/etc/passwd', '../x.tsx', 'ui/x.png', 'a\\b.tsx', 'ui/‮x.tsx'])
      expect(
        parseAccessNotice(j({ type: 'maude.access-request', id: 'r', from: {}, canvas }))
      ).not.toHaveProperty('canvas');
    expect(parseAccessNotice(j({ type: 'maude.access-request', id: 'a b', from: {} }))).toBeNull();
    expect(parseAccessNotice('not json')).toBeNull();
    expect(parseAccessNotice(j({ type: 'maude.mode', mode: 'legacy' }))).toBeNull();
  });

  test('cleanName', () => {
    expect(cleanName('  Jonas \n\t Lind ')).toBe('Jonas Lind');
    expect(cleanName(42)).toBe('');
  });
});

describe('createAccessRelay', () => {
  test('one notice heard on three doc sockets reaches the shell once', () => {
    const out: unknown[] = [];
    const hear = createAccessRelay({ onFrame: (f) => out.push(f) });
    const req = j({ type: 'maude.access-request', id: 'rq_1', from: { name: 'Petra' }, at: 1 });
    hear(req);
    hear(req);
    hear(req);
    const end = j({ type: 'maude.access', epoch: 9, change: 'ended', reason: 'removed' });
    hear(end);
    hear(end);
    expect(out).toHaveLength(2);
  });

  test('raised re-exchanges the credential before the shell hears it — and is told even when that fails', async () => {
    const order: string[] = [];
    const hear = createAccessRelay({
      onFrame: () => order.push('shell'),
      onRaised: async () => {
        order.push('renew');
        throw new Error('offline');
      },
    });
    hear(j({ type: 'maude.access', epoch: 3, change: 'raised' }));
    expect(order).toEqual([]);
    await new Promise((r) => setTimeout(r, 5));
    expect(order).toEqual(['renew', 'shell']);
  });
});

describe('ws frame classes', () => {
  const canvasOnly = (rel: string) => rel === 'ui/A.tsx';
  test('an access change reaches a canvas-only shell; a request never does', () => {
    expect(WS_FRAME_CLASSES.access).toBe('none');
    expect(WS_FRAME_CLASSES['access-request']).toBe('project');
    expect(frameFor({ type: 'access', change: 'ended' }, canvasOnly, '.design')).toEqual({
      type: 'access',
      change: 'ended',
    });
    expect(
      frameFor({ type: 'access-request', id: 'r', canvas: 'ui/A.tsx' }, canvasOnly, '.design')
    ).toBeNull();
  });
});
