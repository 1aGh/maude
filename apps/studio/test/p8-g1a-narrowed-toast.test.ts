// P8 G1a — 11 pn-cant-open, S1.20: a narrowing says who did it and what you are now:
// "Tereza changed you to Can view. Your changes were saved first."
//
// The chain, each link pure: the hub's notice (routes-v2/notices.mjs) carries `by: { name }` and
// `role` on a narrowing only → the studio's relay rebuilds it from a fixed vocabulary
// (sync/access-notices.ts) → the shell's frame (access-client.js) → the toast (access-host.jsx).
// Additive and v1-compatible: an older hub sends neither field and the window says nothing new; an
// older studio rebuilds the frame from the keys it knows and drops both.
import { describe, expect, test } from 'bun:test';

import { createAccessNotices } from '../../hub/src/routes-v2/notices.mjs';
import { shellAccessFrame } from '../client/v2/access/access-client.js';
import { accessHostStep } from '../client/v2/access/access-host.jsx';
import { parseAccessNotice } from '../sync/access-notices.ts';

function hubSays(change: string, extra: Record<string, unknown> = {}) {
  const heard: string[] = [];
  const conn = {
    context: { user: { email: 'petra@x.test' } },
    sendStateless: (p: string) => heard.push(p),
  };
  const notices = createAccessNotices({
    connections: () => [conn],
    endSessions: () => 0,
    setTimer: () => 0,
  });
  notices.accessChanged({ email: 'petra@x.test', change, ...extra });
  return heard[0] as string;
}

/** hub payload → studio relay → the frame ws.ts hands the shell → the host step's toast */
function toastOf(payload: string) {
  const f = parseAccessNotice(payload);
  if (!f || f.type !== 'maude.access') return null;
  const frame = {
    type: 'access',
    change: f.change,
    ...(f.reason ? { reason: f.reason } : {}),
    ...(f.by ? { by: f.by } : {}),
    ...(f.role ? { role: f.role } : {}),
  };
  return accessHostStep({}, frame, {}).toast;
}

describe('a narrowing names who and the role now', () => {
  test('the board’s words, first name only', () => {
    const p = hubSays('narrowed', { by: 'Tereza Nováková', role: 'observer' });
    expect(JSON.parse(p)).toMatchObject({
      change: 'narrowed',
      by: { name: 'Tereza Nováková' },
      role: 'observer',
    });
    expect(toastOf(p)?.title).toBe(
      'Tereza changed you to Can view. Your changes were saved first.'
    );
  });

  test('Can comment reads its own word', () => {
    const p = hubSays('narrowed', { by: 'Olga', role: 'viewer' });
    expect(toastOf(p)?.title).toBe(
      'Olga changed you to Can comment. Your changes were saved first.'
    );
  });

  test('no name → "Someone"; no role → no toast (an older hub)', () => {
    expect(toastOf(hubSays('narrowed', { role: 'observer' }))?.title).toBe(
      'Someone changed you to Can view. Your changes were saved first.'
    );
    expect(toastOf(hubSays('narrowed'))).toBeNull();
    expect(
      toastOf(JSON.stringify({ type: 'maude.access', epoch: 9, change: 'narrowed' }))
    ).toBeNull();
  });

  test('never an address, never control characters, never an unknown role', () => {
    const p = hubSays('narrowed', { by: 'Eve‮\u0000 Evil', role: 'admin' });
    const msg = JSON.parse(p);
    expect(msg.by.name).toBe('Eve Evil');
    expect(msg.role).toBeUndefined();
    // the studio holds the line even when a hub (or a planted peer) sends junk
    const f = parseAccessNotice(
      JSON.stringify({
        type: 'maude.access',
        epoch: 3,
        change: 'narrowed',
        by: { name: `Mallory⁦${'x'.repeat(200)}` },
        role: 'root',
      })
    );
    expect(f && 'by' in f ? f.by?.name.length : 0).toBeLessThanOrEqual(80);
    expect(f && 'role' in f ? f.role : undefined).toBeUndefined();
  });

  test('only a narrowing carries them — a raise or an ending says nothing about who', () => {
    for (const change of ['raised', 'ended']) {
      const msg = JSON.parse(hubSays(change, { by: 'Tereza', role: 'observer' }));
      expect(msg.by).toBeUndefined();
      expect(msg.role).toBeUndefined();
    }
    expect(
      shellAccessFrame({ type: 'access', change: 'raised', by: { name: 'T' }, role: 'observer' })
    ).toEqual({
      kind: 'raised',
    });
  });
});
