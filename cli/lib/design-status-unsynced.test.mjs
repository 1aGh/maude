// #158 — `maude design status` says which files a linked canvas uses that will not reach the
// workspace (text and --json), only for a linked project, and says nothing when there is nothing to say.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { unsyncedViaHelper } from '../commands/design.mjs';
import { runStatus } from './design-link.mjs';

const PKG_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const hasBun = spawnSync('bun', ['--version'], { stdio: 'ignore' }).status === 0;

let dir;
let prevHubs;
let out;
let realWrite;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'status-unsynced-'));
  prevHubs = process.env.HUBS_CONFIG_PATH;
  process.env.HUBS_CONFIG_PATH = join(dir, 'hubs.json');
  out = [];
  realWrite = process.stdout.write;
  process.stdout.write = (s) => {
    out.push(String(s));
    return true;
  };
});
afterEach(() => {
  process.stdout.write = realWrite;
  if (prevHubs === undefined) delete process.env.HUBS_CONFIG_PATH;
  else process.env.HUBS_CONFIG_PATH = prevHubs;
  rmSync(dir, { recursive: true, force: true });
});

const project = (cfg) => {
  mkdirSync(join(dir, '.design'), { recursive: true });
  writeFileSync(join(dir, '.design', 'config.json'), JSON.stringify(cfg));
};
// A loopback port nothing listens on, so the hub probe fails at once.
const LINKED = { linkedHub: { url: 'http://127.0.0.1:1', linkedAt: 1 } };
const REPORT = {
  linked: true,
  syncFiles: true,
  canvases: 1,
  refs: [
    {
      canvas: 'ui/x/foo.tsx',
      file: 'ui/x/_foo/screens.tsx',
      reason: 'underscore-folder',
      via: 'import',
    },
  ],
  lines: [
    "1 file used by 1 canvas won't reach the people you share with.",
    'ui/x/foo.tsx · ui/x/_foo/screens.tsx · It is in _foo, and folders starting with _ stay on this Mac. Rename the folder without the _.',
  ],
};

describe('maude design status — unsynced references', () => {
  test('text: names the canvas, the file and the reason', async () => {
    project(LINKED);
    let asked = null;
    await runStatus({
      args: ['status'],
      cwd: dir,
      unsynced: async (root) => {
        asked = root;
        return REPORT;
      },
    });
    assert.equal(asked, join(dir, '.design'));
    const text = out.join('');
    assert.match(text, /won't reach the people you share with/);
    assert.match(text, /ui\/x\/_foo\/screens\.tsx/);
  });

  test('--json carries the report', async () => {
    project(LINKED);
    await runStatus({ args: ['status', '--json'], cwd: dir, unsynced: async () => REPORT });
    const payload = JSON.parse(out.join(''));
    assert.equal(payload.unsynced.refs[0].reason, 'underscore-folder');
    assert.equal(payload.unsynced.lines, undefined);
  });

  test('a clean project prints nothing about it', async () => {
    project(LINKED);
    await runStatus({
      args: ['status'],
      cwd: dir,
      unsynced: async () => ({ ...REPORT, refs: [], lines: [] }),
    });
    assert.doesNotMatch(out.join(''), /won't reach/);
  });

  test('a helper that cannot run is not an error', async () => {
    project(LINKED);
    await runStatus({ args: ['status'], cwd: dir, unsynced: async () => null });
    assert.match(out.join(''), /linked mode/);
  });

  test('a project that is not linked is never asked', async () => {
    project({});
    let called = false;
    await runStatus({
      args: ['status'],
      cwd: dir,
      unsynced: async () => {
        called = true;
        return REPORT;
      },
    });
    assert.equal(called, false);
    assert.match(out.join(''), /solo mode/);
  });
});

describe('the helper behind it', { skip: !hasBun }, () => {
  test('reads the disk of a real fixture project', () => {
    project(LINKED);
    mkdirSync(join(dir, '.design', 'ui', 'x', '_foo'), { recursive: true });
    writeFileSync(
      join(dir, '.design', 'ui', 'x', 'foo.tsx'),
      "import { DesignCanvas } from '@maude/canvas-lib';\nimport './_foo/screens';\nexport default () => <DesignCanvas />;\n"
    );
    writeFileSync(join(dir, '.design', 'ui', 'x', '_foo', 'screens.tsx'), 'export {};');
    const report = unsyncedViaHelper({ pkgRoot: PKG_ROOT, designRoot: join(dir, '.design') });
    assert.equal(report.linked, true);
    assert.equal(report.refs.length, 1);
    assert.equal(report.refs[0].file, 'ui/x/_foo/screens.tsx');
    assert.match(report.lines[0], /1 file used by 1 canvas/);
  });
});
