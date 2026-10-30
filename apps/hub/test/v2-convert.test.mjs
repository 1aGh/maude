// The cloud's v1 → v2 conversion — the pure half (src/v2-convert.mjs): the version gate, the
// per-project order (backup → format flip → save-mode switch), failure isolation, the unflip,
// and the report line. The boot wiring is pinned in v2-convert-boot.test.mjs.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  CELL_SELF,
  conversionGate,
  convertAll,
  convertProject,
  createV2Conversion,
  formatReportLine,
  parseReportLine,
  parseStableVersion,
} from '../src/v2-convert.mjs';

const CELL = { MAUDE_TENANT_ID: 'acme' };
/** A self-hosted workspace hub (`maude hub workspace-up`): workspace mode, no tenant. */
const SELF_HOSTED = { HUB_WORKSPACE_MODE: '1' };
const quiet = { log() {}, error() {} };

/** A coordinator double: the store state + a call log. */
function fakeCoordinator(state, { failMode = null, failRefresh = false, health = {} } = {}) {
  const calls = [];
  const s = { mode: 'legacy', epoch: 0, formatVersion: 1, revision: 0, ...state };
  return {
    calls,
    state: s,
    async refresh() {
      calls.push('refresh');
      if (failRefresh) throw new Error('store unreachable');
      return { ...s };
    },
    health() {
      return { durable: true, browserPaired: true, ...health };
    },
    async setFormat({ formatVersion, expectEpoch, by }) {
      calls.push(`setFormat:${formatVersion}@${expectEpoch}:${by}`);
      if (expectEpoch !== undefined && expectEpoch !== s.epoch)
        throw Object.assign(new Error('stale'), { code: 'epoch-stale' });
      s.formatVersion = formatVersion;
      s.epoch += 1;
      return { formatVersion, epoch: s.epoch };
    },
    async setMode({ mode, expectEpoch }) {
      calls.push(`setMode:${mode}@${expectEpoch}`);
      if (failMode) throw Object.assign(new Error('nope'), { code: failMode });
      if (expectEpoch !== s.epoch) throw Object.assign(new Error('stale'), { code: 'epoch-stale' });
      s.mode = mode;
      s.epoch += 1;
      return { mode, epoch: s.epoch };
    },
  };
}

function backupInto(calls, where = 'v2-convert/backups/20261029T000000Z') {
  return async () => {
    calls.push('backup');
    return where;
  };
}

describe('the version gate — only a stable ≥ 2.0.0 image converts', () => {
  test('a stable 2.x image in a cell runs', () => {
    assert.deepEqual(conversionGate({ hubVersion: '2.0.0', releaseVersion: '2.0.0', env: CELL }), {
      run: true,
    });
    assert.equal(
      conversionGate({ hubVersion: '2.3.1', releaseVersion: '2.3.1', env: CELL }).run,
      true
    );
  });
  test('an rc never converts — on either layer', () => {
    for (const [hub, rel] of [
      ['2.0.0-rc.1', '2.0.0-rc.1'],
      ['2.0.0', '2.0.0-rc.2'],
      ['2.0.0-rc.1', '2.0.0'],
    ]) {
      assert.deepEqual(conversionGate({ hubVersion: hub, releaseVersion: rel, env: CELL }), {
        run: false,
        reason: 'prerelease',
      });
    }
  });
  test('a 1.x image never converts', () => {
    assert.deepEqual(
      conversionGate({ hubVersion: '1.10.0', releaseVersion: '1.10.0', env: CELL }),
      {
        run: false,
        reason: 'v1',
      }
    );
    assert.equal(
      conversionGate({ hubVersion: '2.0.0', releaseVersion: '1.10.0', env: CELL }).reason,
      'v1'
    );
  });
  test('an unreadable version, or a hub with no project (not a cell, not workspace mode), never converts', () => {
    assert.equal(
      conversionGate({ hubVersion: '0.0.0x', releaseVersion: '2.0.0', env: CELL }).reason,
      'unknown-version'
    );
    assert.equal(
      conversionGate({ hubVersion: undefined, releaseVersion: '2.0.0', env: CELL }).reason,
      'unknown-version'
    );
    assert.equal(
      conversionGate({ hubVersion: '2.0.0', releaseVersion: '2.0.0', env: {} }).reason,
      'not-a-project-hub'
    );
    assert.equal(
      conversionGate({
        hubVersion: '2.0.0',
        releaseVersion: '2.0.0',
        env: { MAUDE_TENANT_ID: '../x' },
      }).reason,
      'not-a-project-hub'
    );
    assert.equal(
      conversionGate({
        hubVersion: '2.0.0',
        releaseVersion: '2.0.0',
        env: { ...SELF_HOSTED, MAUDE_TENANT_ID: '../x' },
      }).reason,
      'invalid-tenant',
      'a workspace hub that names a tenant it cannot be is not a self-hosted hub either'
    );
  });
  test('a self-hosted workspace hub is gated exactly like a cell (p8-selfhost-convert)', () => {
    for (const env of [SELF_HOSTED, { MAUDE_WORKSPACE_MODE: '1' }]) {
      assert.deepEqual(conversionGate({ hubVersion: '2.0.0', releaseVersion: '2.0.0', env }), {
        run: true,
      });
      assert.equal(
        conversionGate({ hubVersion: '2.0.0-rc.1', releaseVersion: '2.0.0-rc.1', env }).reason,
        'prerelease'
      );
      assert.equal(
        conversionGate({ hubVersion: '1.10.0', releaseVersion: '1.10.0', env }).reason,
        'v1'
      );
    }
    // The flag can also come from the hub itself (server.mjs passes its own workspaceMode).
    assert.equal(
      conversionGate({ hubVersion: '2.0.0', releaseVersion: '2.0.0', env: {}, workspaceMode: true })
        .run,
      true
    );
    assert.equal(
      conversionGate({
        hubVersion: '2.0.0',
        releaseVersion: '2.0.0',
        env: { HUB_WORKSPACE_MODE: '0' },
      }).reason,
      'not-a-project-hub'
    );
  });
  test('the kill switch CELL_V2_CONVERT=0 stops a cell and a self-hosted hub alike', () => {
    for (const env of [CELL, SELF_HOSTED]) {
      assert.deepEqual(
        conversionGate({
          hubVersion: '2.0.0',
          releaseVersion: '2.0.0',
          env: { ...env, CELL_V2_CONVERT: '0' },
        }),
        { run: false, reason: 'disabled', switchValue: '0' }
      );
      for (const on of [undefined, '', '1']) {
        const e = { ...env };
        if (on !== undefined) e.CELL_V2_CONVERT = on;
        assert.equal(
          conversionGate({ hubVersion: '2.0.0', releaseVersion: '2.0.0', env: e }).run,
          true,
          `CELL_V2_CONVERT=${on} converts`
        );
      }
      // A switch typed wrong fails closed: only unset or 1 converts.
      const wrong = conversionGate({
        hubVersion: '2.0.0',
        releaseVersion: '2.0.0',
        env: { ...env, CELL_V2_CONVERT: 'false' },
      });
      assert.equal(wrong.reason, 'disabled');
      assert.equal(wrong.switchValue, 'false');
    }
    // A hub that would never convert anyway does not grow a report because of the switch.
    assert.equal(
      conversionGate({
        hubVersion: '2.0.0',
        releaseVersion: '2.0.0',
        env: { CELL_V2_CONVERT: '0' },
      }).reason,
      'not-a-project-hub'
    );
  });
  test('parseStableVersion refuses everything but X.Y.Z', () => {
    assert.deepEqual(parseStableVersion('2.0.0'), { major: 2, minor: 0, patch: 0 });
    for (const v of ['2.0.0-rc.1', '2.0', 'v2.0.0', '2.0.0+build', '', null])
      assert.equal(parseStableVersion(v), null, String(v));
  });
});

describe('one project — backup first, then the flip, then the switch', () => {
  test('format 1 in legacy mode: backup → format 2 → accepted revisions, as cell:self', async () => {
    const c = fakeCoordinator({ epoch: 3 });
    const out = await convertProject({ coordinator: c, backup: backupInto(c.calls) });
    assert.equal(out.outcome, 'converted');
    assert.equal(out.backup, 'v2-convert/backups/20261029T000000Z');
    assert.deepEqual(c.calls, [
      'refresh',
      'backup',
      `setFormat:2@3:${CELL_SELF}`,
      'refresh',
      'setMode:transactions@4',
    ]);
    assert.equal(c.state.formatVersion, 2);
    assert.equal(c.state.mode, 'transactions');
  });
  test('format 1 already in accepted revisions: only the flip', async () => {
    const c = fakeCoordinator({ mode: 'transactions', epoch: 1 });
    const out = await convertProject({ coordinator: c, backup: backupInto(c.calls) });
    assert.equal(out.outcome, 'converted');
    assert.deepEqual(c.calls, ['refresh', 'backup', `setFormat:2@1:${CELL_SELF}`]);
  });
  test('format 2 still saving the old way: only the switch', async () => {
    const c = fakeCoordinator({ formatVersion: 2, epoch: 2 });
    const out = await convertProject({ coordinator: c, backup: backupInto(c.calls) });
    assert.equal(out.outcome, 'converted');
    assert.deepEqual(c.calls, ['refresh', 'backup', 'refresh', 'setMode:transactions@2']);
  });
  test('already format 2 in accepted revisions: skipped — no backup, no write', async () => {
    const c = fakeCoordinator({ formatVersion: 2, mode: 'transactions', epoch: 5 });
    const out = await convertProject({ coordinator: c, backup: backupInto(c.calls) });
    assert.deepEqual(out, { outcome: 'skipped', reason: 'already-v2' });
    assert.deepEqual(c.calls, ['refresh']);
  });
  test('a backup that fails converts nothing', async () => {
    const c = fakeCoordinator({});
    const out = await convertProject({
      coordinator: c,
      backup: async () => {
        throw new Error('bucket said no');
      },
    });
    assert.equal(out.outcome, 'failed');
    assert.match(out.reason, /^backup: bucket said no/);
    assert.deepEqual(c.calls, ['refresh']);
    assert.equal(c.state.formatVersion, 1);
  });
  test('a switch the hub would refuse is refused before anything is written', async () => {
    for (const [health, reason] of [
      [{ durable: false }, 'store-not-durable'],
      [{ browserPaired: false }, 'browser-not-paired'],
    ]) {
      const c = fakeCoordinator({}, { health });
      const out = await convertProject({ coordinator: c, backup: backupInto(c.calls) });
      assert.deepEqual(out, { outcome: 'failed', reason });
      assert.deepEqual(c.calls, ['refresh']);
    }
  });
  test('a switch that fails after the flip puts the format back', async () => {
    const c = fakeCoordinator({ epoch: 0 }, { failMode: 'store-down' });
    const out = await convertProject({ coordinator: c, backup: backupInto(c.calls) });
    assert.equal(out.outcome, 'failed');
    assert.equal(out.reason, 'store-down');
    assert.equal(c.state.formatVersion, 1, 'left readable as it was');
    assert.equal(c.state.mode, 'legacy');
    assert.deepEqual(c.calls.slice(-2), ['refresh', `setFormat:1@1:${CELL_SELF}`]);
  });
  test('an unreadable store fails that project and writes nothing', async () => {
    const c = fakeCoordinator({}, { failRefresh: true });
    const out = await convertProject({ coordinator: c, backup: backupInto(c.calls) });
    assert.equal(out.outcome, 'failed');
    assert.match(out.reason, /^store-unreadable/);
    assert.deepEqual(c.calls, ['refresh']);
  });
});

describe('every project — one failure never stops another', () => {
  test('a failing project and a good one: failed=1 converted=1, in one report line', async () => {
    const bad = fakeCoordinator({}, { failRefresh: true });
    const good = fakeCoordinator({});
    const done = fakeCoordinator({ formatVersion: 2, mode: 'transactions' });
    const lines = [];
    const log = { log: (l) => lines.push(l), error: (l) => lines.push(l) };
    const out = await convertAll(
      [
        { id: 'bad', coordinator: bad, backup: backupInto(bad.calls) },
        { id: 'good', coordinator: good, backup: backupInto(good.calls) },
        { id: 'done', coordinator: done, backup: backupInto(done.calls) },
      ],
      { log }
    );
    assert.equal(out.converted, 1);
    assert.equal(out.failed, 1);
    assert.equal(out.skipped, 1);
    assert.equal(good.state.formatVersion, 2);
    assert.equal(good.state.mode, 'transactions');
    assert.equal(lines.at(-1), '[v2-convert] converted=1 skipped=1 failed=1');
    assert.ok(lines.some((l) => /bad: FAILED \(store-unreadable/.test(l)));
  });
  test('a project that throws outside convertProject is still only that project', async () => {
    const good = fakeCoordinator({});
    const out = await convertAll(
      [
        {
          id: 'boom',
          // A project whose very description throws — before convertProject can catch anything.
          get coordinator() {
            throw new Error('no coordinator');
          },
          backup: backupInto([]),
        },
        { id: 'good', coordinator: good, backup: backupInto(good.calls) },
      ],
      { log: quiet }
    );
    assert.deepEqual([out.converted, out.skipped, out.failed], [1, 0, 1]);
  });
});

describe('the report line', () => {
  test('formats and parses back, also inside a prefixed log line', () => {
    const line = formatReportLine({ converted: 3, skipped: 0, failed: 2 });
    assert.equal(line, '[v2-convert] converted=3 skipped=0 failed=2');
    assert.deepEqual(parseReportLine(line), { converted: 3, skipped: 0, failed: 2 });
    assert.deepEqual(parseReportLine(`2026-10-29T10:00:00Z [cell] ${line}`), {
      converted: 3,
      skipped: 0,
      failed: 2,
    });
    assert.deepEqual(
      parseReportLine('[v2-convert] fleet converted=4 skipped=9 failed=1 cells=3 unreported=0'),
      { converted: 4, skipped: 9, failed: 1 }
    );
    assert.equal(parseReportLine('[v2-convert] good: converted to format 2'), null);
    assert.equal(parseReportLine('[v2-convert] converted=1 skipped=x failed=0'), null);
  });
});

describe('the hub handle', () => {
  test('gated: never runs, and /health says why', async () => {
    const h = createV2Conversion({
      gate: { run: false, reason: 'prerelease' },
      projects: () => {
        throw new Error('must not be asked');
      },
      log: quiet,
    });
    assert.equal(await h.run(), null);
    assert.deepEqual(h.health(), { state: 'gated', reason: 'prerelease' });
  });
  test('disabled by the kill switch: never runs, one log line, and /health says disabled', async () => {
    const lines = [];
    const h = createV2Conversion({
      gate: { run: false, reason: 'disabled', switchValue: '0' },
      projects: () => {
        throw new Error('must not be asked');
      },
      log: { log: (l) => lines.push(l), error: (l) => lines.push(l) },
    });
    assert.deepEqual(h.health(), { state: 'disabled', by: 'CELL_V2_CONVERT=0' });
    assert.equal(await h.run(), null);
    await h.run();
    assert.deepEqual(lines, ['[v2-convert] disabled by CELL_V2_CONVERT=0']);
    assert.equal(parseReportLine(lines[0]), null, 'not a count line the deploy would sum');
    assert.deepEqual(h.health(), { state: 'disabled', by: 'CELL_V2_CONVERT=0' });
  });
  test('a switch value that is not a plain token is never echoed into the log', async () => {
    const lines = [];
    const h = createV2Conversion({
      gate: { run: false, reason: 'disabled', switchValue: 'x\n[v2-convert] converted=9' },
      projects: () => [],
      log: { log: (l) => lines.push(l), error: (l) => lines.push(l) },
    });
    await h.run();
    assert.deepEqual(lines, ['[v2-convert] disabled by CELL_V2_CONVERT=(invalid)']);
    assert.equal(h.health().by, 'CELL_V2_CONVERT=(invalid)');
  });
  test('not a project hub: nothing on /health at all', () => {
    const h = createV2Conversion({
      gate: { run: false, reason: 'not-a-project-hub' },
      projects: () => [],
    });
    assert.equal(h.health(), null);
  });
  test('runs once per process, and /health carries the counts', async () => {
    const c = fakeCoordinator({});
    let asked = 0;
    const h = createV2Conversion({
      gate: { run: true },
      projects: () => {
        asked += 1;
        return [{ id: 'p', coordinator: c, backup: backupInto(c.calls) }];
      },
      log: quiet,
      now: () => new Date('2026-10-29T00:00:00Z'),
    });
    assert.deepEqual(h.health(), { state: 'pending' });
    await Promise.all([h.run(), h.run()]);
    await h.run();
    assert.equal(asked, 1);
    assert.deepEqual(h.health(), {
      state: 'done',
      converted: 1,
      skipped: 0,
      failed: 0,
      at: '2026-10-29T00:00:00.000Z',
    });
  });
});
