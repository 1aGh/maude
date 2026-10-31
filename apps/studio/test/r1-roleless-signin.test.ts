// r1-roleless-signin (Michal rc.1, finding 1, option A — decision maude/v2-michal-roleless-record-offers-sign-in).
// A project linked through a 1.x `maude design link --token` record that carries no role reads as the
// observer floor (decision v2-S9.9-roleless-record-is-floor): view only, and the floor STAYS. But the
// format callout said "Ask the owner" — to the owner. The record simply does not say who this Mac is,
// so the step is Sign in: the workspace sign-in stores the role, and an owner then converts by itself.
//
// This file: the source of the claim (hubs-config, on a FIXTURE hubs.json — never the real one) and
// the callout model. The rendered callout is r1-roleless-signin-render.test.tsx; the booted `/_config`
// is r1-roleless-signin-boot.test.ts.

import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { OLDER_COPY, olderGateState } from '../client/v2/shell/format-update.js';
import { FORMAT_COPY } from '../format.ts';
import { accessFor, linkRoleSource } from '../sync/hubs-config.ts';

const HUB = 'https://design.example';
let dir: string | null = null;
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = null;
});

/** A throwaway hubs.json holding `hubs`. */
function fixture(hubs: Record<string, unknown>): string {
  dir = mkdtempSync(path.join(tmpdir(), 'r1-roleless-'));
  const p = path.join(dir, 'hubs.json');
  writeFileSync(p, JSON.stringify({ hubs }), { mode: 0o600 });
  return p;
}

describe('where the stored claim came from (hubs-config linkRoleSource)', () => {
  test('a record with a token and no role is `missing` — and still the observer floor', () => {
    const p = fixture({ [HUB]: { token: 'tok', linkedAt: 1 } });
    expect(linkRoleSource(HUB, p)).toBe('missing');
    // the floor stays: no write rights without a role (v2-S9.9-roleless-record-is-floor)
    expect(accessFor(HUB, p)).toMatchObject({ role: 'observer' });
    // a trailing slash is the same hub
    expect(linkRoleSource(`${HUB}/`, p)).toBe('missing');
  });

  test('an empty role is missing too (the same reading as accessFor)', () => {
    const p = fixture({ [HUB]: { token: 'tok', linkedAt: 1, role: '' } });
    expect(linkRoleSource(HUB, p)).toBe('missing');
  });

  test('a role the hub vouched — observer included — is `stored`', () => {
    for (const role of ['observer', 'viewer', 'member', 'owner']) {
      const p = fixture({ [HUB]: { token: 'tok', linkedAt: 1, role } });
      expect({ role, src: linkRoleSource(HUB, p) }).toEqual({ role, src: 'stored' });
      rmSync(dir as string, { recursive: true, force: true });
    }
    const p = fixture({
      [HUB]: { token: 'tok', linkedAt: 1, access: { v: 1, role: 'observer' } },
    });
    expect(linkRoleSource(HUB, p)).toBe('stored');
  });

  test('no record (or another hub only) is `none`', () => {
    const p = fixture({ 'https://other.example': { token: 'tok', linkedAt: 1 } });
    expect(linkRoleSource(HUB, p)).toBe('none');
    expect(linkRoleSource(HUB, path.join(dir as string, 'absent.json'))).toBe('none');
  });
});

const older = {
  name: 'armory',
  designRel: '.design',
  formatVersion: 1,
  formatGate: { projectFormat: 1, supported: 2, source: 'config' },
  readOnlyReason: 'role',
  linkedHub: { url: HUB, linkedAt: 1 },
};

describe('the callout for a record without a role', () => {
  test('roleSource missing → Sign in, never Ask the owner (before and after the dry run)', () => {
    const cfg = { ...older, roleSource: 'missing' };
    for (const plan of [undefined, { error: true }, { refusals: [{ code: 'not-owner' }] }]) {
      const s = olderGateState({ cfg, plan });
      expect(s).toMatchObject({ kind: 'roleless', action: 'sign-in', hub: HUB });
      expect(s?.line).toBe(OLDER_COPY.olderNotSignedIn('design.example'));
      expect(s?.line).not.toContain('Ask the owner');
    }
  });

  test('one line with the no-sign-in case (the copy critic: it IS the not-signed-in state)', () => {
    const roleless = olderGateState({ cfg: { ...older, roleSource: 'missing' } });
    const noSignIn = olderGateState({
      cfg: { ...older, readOnlyReason: 'format' },
      plan: {
        refusals: [{ code: 'no-sign-in' }],
        project: { linked: { hub: HUB, role: 'unknown' } },
      },
    });
    expect(noSignIn).toMatchObject({ kind: 'no-sign-in', action: 'sign-in', hub: HUB });
    expect(noSignIn?.line).toBe(roleless?.line);
  });

  test('a role the hub vouched (observer) still says Ask the owner', () => {
    for (const cfg of [{ ...older, roleSource: 'stored' }, older]) {
      const s = olderGateState({ cfg, plan: undefined });
      expect(s).toEqual({ kind: 'non-owner', line: OLDER_COPY.olderNonOwner, action: null });
    }
  });

  test('the words are FORMAT_COPY’s, and name the hub by its host', () => {
    expect(OLDER_COPY.olderNotSignedIn('design.example')).toBe(
      FORMAT_COPY.olderNotSignedIn('design.example')
    );
    expect(OLDER_COPY.olderNotSignedIn('design.example')).toBe(
      "View only — this Mac isn't signed in to design.example. Sign in, and if you own this project it moves to Maude 2 by itself."
    );
    // no hub to name: the team server
    expect(
      olderGateState({ cfg: { ...older, linkedHub: null, roleSource: 'missing' } })?.line
    ).toBe(OLDER_COPY.olderNotSignedIn(''));
    expect(OLDER_COPY.olderNotSignedIn('')).toContain("isn't signed in to the team server.");
  });
});
