// p8-fix-a F2 — the role-denial toast on a tool key. A cloud canvas-only session whose grant is Can edit sees
// the frame read-only (it is framed by a follow capability), so N / M / A / S / E are refused — but the person
// CAN edit, in the desktop app. The toast must say that, and must not offer "Ask to edit" (they already can).

import { describe, expect, test } from 'bun:test';

import { WORDS } from '../client/v2/access/access-client.js';
import { appOnlyFor, showRoleDenial } from '../client/v2/shell/role-denial.js';

const A = '.design/ui/a.tsx';
const canvasOnly = (r: string, cloud = true) => ({
  designRel: '.design',
  canvasOrigin: 'http://canvas.test',
  readOnly: true,
  readOnlyReason: 'role',
  formatGate: null,
  access: { role: null, grants: [{ c: 'ui/a.tsx', r }] },
  ...(cloud ? { cloud: { role: null } } : {}),
});

type Said = { text: string; action?: { label: string } };
function say(req: object, deps: object): Said[] {
  const said: Said[] = [];
  showRoleDenial(req, {
    toast: (text: string, _ok: boolean, action?: { label: string }) => said.push({ text, action }),
    run: () => {},
    ...deps,
  });
  return said;
}

describe('appOnlyFor', () => {
  test('true only for a cloud canvas-only session whose grant is Can edit or up', () => {
    expect(appOnlyFor(canvasOnly('member'), A)).toBe(true);
    expect(appOnlyFor(canvasOnly('viewer'), A)).toBe(false);
    expect(appOnlyFor(canvasOnly('member', false), A)).toBe(false);
    expect(appOnlyFor(canvasOnly('member'), null)).toBe(false);
    expect(appOnlyFor(undefined, A)).toBe(false);
  });
});

describe('the role-denial toast knows the person can edit in the app', () => {
  test('appOnly: says to edit in the desktop app and offers no Ask to edit', () => {
    const said = say({ tool: 'sticky' }, { appOnly: true });
    expect(said).toHaveLength(1);
    expect(said[0]?.text).toBe(WORDS.appOnlyLine);
    expect(said[0]?.text).not.toContain('need Can edit');
    expect(said[0]?.action).toBeUndefined();
  });

  test('appOnly also holds for a panel key (E / S)', () => {
    const said = say({ panel: 'stickers' }, { appOnly: true });
    expect(said[0]?.text).toBe(WORDS.appOnlyLine);
    expect(said[0]?.action).toBeUndefined();
  });

  test('not appOnly: unchanged, the tool line with Ask to edit', () => {
    const said = say({ tool: 'sticky' }, { appOnly: false });
    expect(said[0]?.text).toBe('Stickies need Can edit.');
    expect(said[0]?.action?.label).toBe('Ask to edit');
    expect(say({ tool: 'sticky' }, {})[0]?.action?.label).toBe('Ask to edit');
  });
});
