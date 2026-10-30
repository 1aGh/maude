// p8-e2e-rolefix — the shell's access word for the open canvas comes from the server's `/_config.access`
// (access-client.js `sessionRole`), never from `cloud.role` alone: a desktop has no `cloud`, and the word
// fell through to "Can comment" for every read-only session, a Can view invitee (share-roles Petra) included.

import { describe, expect, test } from 'bun:test';

import { sessionRole } from '../client/v2/access/access-client.js';
import { capsFor } from '../client/v2/shell/canvas-mode.js';
import { accessStatus } from '../client/v2/shell/save-status.js';

const petra = { access: { role: null, grants: [{ c: 'ui/a.tsx', r: 'observer' }] } };
const word = (cfg: unknown, rel: string | null) =>
  accessStatus({ canEdit: false, role: sessionRole(cfg, rel) })?.word;

describe('the access word on a desktop (share-roles Petra)', () => {
  test('Can view on one canvas reads "Can view" on that canvas, with nothing open too', () => {
    expect(word(petra, 'ui/a.tsx')).toBe('Can view');
    expect(word(petra, null)).toBe('Can view');
    expect(capsFor({ canEdit: false, role: sessionRole(petra, 'ui/a.tsx') })).toEqual({
      edit: false,
      annotate: false,
      comment: false,
    });
  });

  test('a Can comment grant reads "Can comment"; a project role is the floor for every canvas', () => {
    const cmt = { access: { role: null, grants: [{ c: 'ui/a.tsx', r: 'viewer' }] } };
    expect(word(cmt, 'ui/a.tsx')).toBe('Can comment');
    const mixed = { access: { role: 'observer', grants: [{ c: 'ui/a.tsx', r: 'viewer' }] } };
    expect(word(mixed, 'ui/a.tsx')).toBe('Can comment');
    expect(word(mixed, 'ui/b.tsx')).toBe('Can view');
  });

  test('an older server (no access field) keeps the cloud tab’s role', () => {
    expect(sessionRole({ cloud: { role: 'observer' } }, 'ui/a.tsx')).toBe('observer');
    expect(sessionRole({}, 'ui/a.tsx')).toBeUndefined();
  });
});
