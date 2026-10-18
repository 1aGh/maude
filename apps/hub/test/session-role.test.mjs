// The session carries a ROLE, not a bit — Cloud Phase 27.
//
// WHAT THIS EXISTS FOR. A browser session used to store `read_only`, a one-bit
// projection of a three-value role, computed once at mint. That cost two
// things, and the first one shipped:
//
//   The project's owner was VIEW ONLY, and stayed VIEW ONLY. The bit was
//   computed by a translation that has since been fixed, but a bit already on
//   a token is not re-computed by fixing the function that produced it. The
//   cookie lives twelve hours, `/data` is a volume that survives every deploy,
//   and the studio had no sign-out — so the fix could not reach the person it
//   was for. He reported the same screen after three deploys.
//
//   `owner` and `member` were the same session. Both are write-capable, so
//   both projected to `read_only = 0`, and the cell rebuilt every writer as
//   `member`. No browser session could hold `invite`, `delete` or `mirror`,
//   and nothing said so.
//
// Storing the role restores the property the matrix was built for: ONE table
// decides what a role means and everyone re-derives from it. The tests below
// pin the round-trip, the rotation rule, and — the load-bearing one — that a
// session with no stored role is REFUSED rather than guessed at.

import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { can, isReadOnlyRole } from '../src/role-matrix.mjs';
import { addToken, rotateToken, verifyToken } from '../src/tokens.mjs';

const SERVER_SRC = readFileSync(
  fileURLToPath(new URL('../src/server.mjs', import.meta.url)),
  'utf8'
);
const BROWSER_AUTH_SRC = readFileSync(
  fileURLToPath(new URL('../src/browser-auth.mjs', import.meta.url)),
  'utf8'
);

const dirs = [];
function freshDir() {
  const d = mkdtempSync(join(tmpdir(), 'maude-session-role-'));
  dirs.push(d);
  return d;
}
after(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

describe('the role survives the token store', () => {
  for (const role of ['owner', 'member', 'viewer']) {
    it(`a ${role} session verifies as ${role}`, () => {
      const dir = freshDir();
      const minted = addToken(dir, {
        label: `studio-${role}`,
        owner: `${role}@example.com`,
        role,
        readOnly: isReadOnlyRole(role),
      });
      assert.equal(minted.role, role);
      const seen = verifyToken(dir, minted.value);
      assert.equal(seen.role, role);
      // …and the capability the cell will hand the studio is the matrix's,
      // re-derived, not the bit that happened to be stored beside it.
      assert.equal(isReadOnlyRole(seen.role), role === 'viewer');
    });
  }

  it('owner and member are DIFFERENT sessions, which is the point', () => {
    const dir = freshDir();
    const owner = verifyToken(
      dir,
      addToken(dir, { label: 'studio-o', owner: 'o@example.com', role: 'owner' }).value
    );
    const member = verifyToken(
      dir,
      addToken(dir, { label: 'studio-m', owner: 'm@example.com', role: 'member' }).value
    );
    // Both write-capable — indistinguishable under the old boolean.
    assert.equal(isReadOnlyRole(owner.role), false);
    assert.equal(isReadOnlyRole(member.role), false);
    // …and distinguishable now, where it matters.
    assert.equal(can(owner.role, 'invite'), true);
    assert.equal(can(member.role, 'invite'), false);
  });

  it('rotation replaces the secret and never the role', () => {
    const dir = freshDir();
    addToken(dir, { label: 'studio-v', owner: 'v@example.com', role: 'viewer', readOnly: true });
    const rotated = rotateToken(dir, 'studio-v');
    assert.equal(rotated.role, 'viewer');
    assert.equal(verifyToken(dir, rotated.value).role, 'viewer');
  });

  it('a machine token has no project role, and that is not an error', () => {
    // Peer tokens, the env secret, anything minted outside a browser door.
    const dir = freshDir();
    const minted = addToken(dir, { label: 'peer-1', owner: 'p@example.com' });
    assert.equal(minted.role, undefined);
    assert.equal(verifyToken(dir, minted.value).role, undefined);
  });
});

describe('a session with no role is refused, not guessed at', () => {
  it('browserSession returns null rather than inventing a role', () => {
    // The two ways to guess are both wrong. `member` from `read_only = 0` is a
    // silent escalation; `viewer` from `read_only = 1` is the bug this whole
    // change exists to end, because the bit may have been computed wrong.
    const fn = SERVER_SRC.slice(
      SERVER_SRC.indexOf('function browserSession('),
      SERVER_SRC.indexOf('\nfunction ', SERVER_SRC.indexOf('function browserSession(') + 10)
    );
    assert.ok(fn.length > 0, 'browserSession not found — this gate would pass vacuously');
    assert.match(fn, /ROLES\.includes\(match\.role\)/);
    assert.match(fn, /if \(!role\) return null;/);
    // The old fallback, in either direction, must be gone.
    assert.doesNotMatch(fn, /match\.readOnly \? 'viewer' : 'member'/);
  });

  it('the refusal lands on the sign-in door, not on a dead end', () => {
    // `doorVerdict` turns a null session into a redirect for a navigation, so
    // the stale cookie self-heals on the next page load instead of needing a
    // human to clear it. Pinning the wiring, since the null above is only
    // useful if this is what receives it.
    assert.match(SERVER_SRC, /session: browserSession\(dataDir, secret, request\)/);
    assert.match(SERVER_SRC, /verdict\?\.kind === 'sign-in'/);
  });
});

describe('the door stores what it vouched for', () => {
  it('EVERY door mints with the translated project role, never the account role', () => {
    // Count-agnostic on purpose: there are now three doors (password,
    // platform, OIDC), and the invariant is per-mint, not "exactly two". A new
    // door that forgets the translation is the vantage incident again — an
    // `admin` that reads as an unknown role and lands read-only.
    const mints = [...BROWSER_AUTH_SRC.matchAll(/addToken\(dataDir, \{[\s\S]*?\}\);/g)].map(
      (m) => m[0]
    );
    assert.ok(mints.length >= 2, 'expected at least the self-hosted and platform doors');
    // Two legal shapes. A self-hosted door translates the account role itself;
    // the platform door (S9.2) asks the one mint door, whose claim is translated
    // by `claimOf` → `legacyClaim` → `projectRoleForAccount`.
    const viaDoor = mints.filter((m) => /\.\.\.peerSessionFields\(door,/.test(m));
    for (const mint of mints) {
      if (viaDoor.includes(mint)) continue;
      assert.match(mint, /role: projectRole,/);
      assert.match(mint, /readOnly: isReadOnlyRole\(projectRole\),/);
    }
    assert.equal(
      [...BROWSER_AUTH_SRC.matchAll(/const door = peerTokenDoor\(claimOf\(/g)].length,
      viaDoor.length,
      'every door-backed mint must decide through peerTokenDoor(claimOf(…))'
    );
    // Each other mint is preceded by a translation — `projectRoleForAccount(...)`,
    // never a raw account role passed through. One translation per door.
    assert.equal(
      [...BROWSER_AUTH_SRC.matchAll(/const projectRole = projectRoleForAccount\(/g)].length,
      mints.length - viaDoor.length,
      'every mint site must translate the account role first'
    );
  });
});
