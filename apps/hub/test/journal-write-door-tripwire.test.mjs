// The write-door tripwire — Sync v2 Increment 1 (DDR-226 §2, the Bill of
// Lading graft).
//
// The journal's whole value rests on one property: **every accepted write to
// the checkout appends a row.** A write site that lands bytes without one is
// invisible to peers, invisible to the doručenka, and — because "no row" is a
// meaningful statement in this protocol — actively misleading rather than
// merely incomplete.
//
// That property cannot be tested by exercising the doors, because the failure
// mode is a door nobody thought to exercise. So it is tested STRUCTURALLY: any
// `rename(` in a hub source file that lands a checkout file must sit in a
// module that also carries a journal hook (its own `recordWrite`, or an
// arg-carrying `onWritten` the server binds to `noteCheckoutWrite`).
//
// When this test fires on a NEW write site, the fix is to hook it — never to
// add it to the allowlist without reading the module first.

import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');

/**
 * Modules whose `rename` is NOT a checkout file-plane write, with the reason.
 * Every entry here is a deliberate, reviewed exemption.
 */
const NOT_A_FILE_PLANE_WRITE = new Map([
  // Restores a whole generation into DATA_DIR (SQLite + a git bundle), not
  // designRoot files. The journal it restores is one of those databases.
  ['backup.mjs', 'restores databases into dataDir, not checkout files'],
  ['repo-checkpoint.mjs', 'git bundle / clone plumbing, not per-file writes'],
  ['rehydrate.mjs', 'the restore CLI — it REPLAYS the journal rather than appending'],
  ['seed-repo.mjs', 'the first-boot clone; walk-import indexes the result'],
  // Operator/credential state under DATA_DIR — never a designRoot path.
  ['admin-auth.mjs', 'admin credential file in dataDir'],
  ['bootstrap.mjs', 'the boot bootstrap token file in dataDir'],
  ['settings.mjs', 'the hub settings JSON in dataDir'],
  // Plane A. The doc→file projection writes canvas bodies, sibling css, meta
  // and annotations — every one of them `canvas-owned`, which the classifier
  // refuses from the file plane by construction (DDR-226 §1: the planes are
  // disjoint at classification, so a row here could not exist even if this
  // module asked for one).
  ['workspace-agent.mjs', 'projects plane-A canvas lanes, which the classifier excludes'],
  // Cell materializer: `<designRoot>/_cache/blobs/<sha>` is runtime state
  // (DDR-115) — content-addressed, disposable, outside the file plane. Its
  // rows are the journal's already; a blob arriving or leaving says nothing.
  ['materializer.mjs', 'content-addressed cache, outside the file plane, never journaled'],
  // The design root's own `config.json` classifies `never` (file-membership):
  // the file plane refuses to carry it in either direction, so a journal row
  // for it could not exist. The owner sets it through its own door instead.
  ['project-config-door.mjs', "writes config.json, which the file plane classifies 'never'"],
]);

/** Every hub source file, flat (the tree has no nested source dirs today). */
function hubSources() {
  return readdirSync(SRC, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.mjs'))
    .map((e) => e.name);
}

describe('every checkout write door is journal-hooked', () => {
  it('a rename( that lands a checkout file sits beside a journal hook', () => {
    const offenders = [];
    for (const name of hubSources()) {
      if (NOT_A_FILE_PLANE_WRITE.has(name)) continue;
      const src = readFileSync(join(SRC, name), 'utf8');
      if (!/\brenameSync\s*\(|\brename\s*\(/.test(src)) continue;
      const hooked =
        /recordWrite\s*\(/.test(src) || // appends itself
        /onWritten\?\.\(\s*\{/.test(src); // arg-carrying hook the server binds
      if (!hooked) {
        offenders.push(name);
      }
    }
    assert.deepEqual(
      offenders,
      [],
      `these modules rename a file into place without a journal hook: ${offenders.join(', ')}. ` +
        'Hook the write (arg-carrying `onWritten({ path })` or a direct `recordWrite`), ' +
        'or add a reviewed exemption to NOT_A_FILE_PLANE_WRITE with the reason.'
    );
  });

  it('the arg-carrying hooks really carry a path', () => {
    // A hook that fires payload-free tells the journal nothing, which is the
    // pre-Sync-v2 shape. Since Increment 5 `assets.mjs` no longer writes at
    // all (its PUTs delegate to the file door in server.mjs), so the hooks to
    // pin live at the ONE door and the hydrate lanes.
    const door = readFileSync(join(SRC, 'file-door.mjs'), 'utf8');
    const lane = readFileSync(join(SRC, 'asset-lane.mjs'), 'utf8');
    const calls = [
      ...(door.match(/onWritten\?\.\([^)]*\)/g) ?? []),
      ...(lane.match(/onWritten\?\.\([^)]*\)/g) ?? []),
    ];
    assert.ok(calls.length >= 3, 'expected the door + both hydrate lanes to fire onWritten');
    for (const call of calls) {
      assert.match(call, /path/, `payload-free onWritten hook: ${call}`);
    }
    // And the legacy asset routes stay write-free — a PUT branch reappearing
    // in assets.mjs would be a SECOND write path beside the door.
    const assets = readFileSync(join(SRC, 'assets.mjs'), 'utf8');
    assert.ok(
      !/onWritten\?\.\(/.test(assets) && !/renameSync\(/.test(assets),
      'assets.mjs grew a write path again — writes belong to the file door'
    );
  });

  it('EVERY write door the server wires goes through the one notifier', () => {
    // The assertion is the INTENT, not a count. Counting broke the moment the
    // Sync v2 file door landed and made it three — and a test that has to be
    // edited every time a door is added teaches people to edit it without
    // reading it. What must hold is that no door gets its own bespoke handler:
    // the journal append and the bucket mirror live in `noteCheckoutWrite`, and
    // a door that bypasses it is a door whose writes peers never learn about.
    const server = readFileSync(join(SRC, 'server.mjs'), 'utf8');
    const bindings = server.match(/onWritten:\s*([A-Za-z_.]+)/g) ?? [];
    assert.ok(
      bindings.length >= 3,
      `expected every write door to bind onWritten, saw ${bindings.length}`
    );
    for (const b of bindings) {
      assert.match(b, /noteCheckoutWrite/, `a write door bypasses the notifier: ${b}`);
    }
  });
});
