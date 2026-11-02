// P8 lanes-red audit — "a v2 project is never view only in its own owner's hands".
//
// Every code path that CREATES a project's `.design/config.json` stamps `formatVersion: 2`, and every
// path that REWRITES one keeps it. The desktop e2e lanes drive projects built by the studio test
// fixtures below; before this pin those fixtures wrote a format-1 config, so the shell (FORMAT_GATE_OPTS)
// opened every lane's project view only and each write silently failed.
//
//   creators (stamp):  scaffoldDesign (Home create-empty, GitHub new/clone, onboarding) ·
//                      apps/desktop/src-tauri lib.rs write_minimal_design (own cargo test) ·
//                      plugins/design/templates/.../config.json.tpl (/design:init, setup-ds)
//   rewriters (keep):  ds/default.ts · ds/rename.ts · generation/prefs.ts (read-modify-write of the parsed file)
//   test fixtures:     _home-fixtures.makeProject · _ds-engine-fixture.makeProject · _ds-switch-fixture
import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setDefaultSystem } from '../ds/default.ts';
import { renameSystem } from '../ds/rename.ts';
import { NEW_PROJECT_FORMAT } from '../format.ts';
import { writeKeyframeEngine, writeTranscriptionProvider } from '../generation/prefs.ts';
import { scaffoldDesign } from '../scaffold-design.ts';
import { cleanup, makeProject as engineProject } from './_ds-engine-fixture.ts';
import { switchProject } from './_ds-switch-fixture.ts';
import { freshIndexDir, makeProject as homeProject } from './_home-fixtures.ts';

const made: string[] = [];
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), 'maude-cfg-audit-'));
  made.push(d);
  return d;
};
afterAll(() => {
  for (const d of made) rmSync(d, { recursive: true, force: true });
});
const cfgIn = (designRoot: string) =>
  JSON.parse(readFileSync(join(designRoot, 'config.json'), 'utf8')) as Record<string, unknown>;

describe('creators stamp formatVersion 2', () => {
  test('scaffoldDesign', () => {
    const dir = tmp();
    expect(scaffoldDesign(dir, 'Fresh').ok).toBe(true);
    expect(cfgIn(join(dir, '.design')).formatVersion).toBe(2);
  });
  test('the design-init template (/design:init, setup-ds)', () => {
    const tpl = readFileSync(
      resolve(
        import.meta.dir,
        '../../../plugins/design/templates/design-system-inspiration/core/config.json.tpl'
      ),
      'utf8'
    );
    expect(/"formatVersion":\s*2\b/.test(tpl)).toBe(true);
  });
  test('the Rust shell scaffold writes it, and its own cargo test pins it', () => {
    const rs = readFileSync(resolve(import.meta.dir, '../../desktop/src-tauri/src/lib.rs'), 'utf8');
    expect(rs).toContain('\\"formatVersion\\": 2');
    expect(rs).toContain('assert_eq!(cfg["formatVersion"], serde_json::json!(2))');
  });
});

describe('rewriters keep formatVersion', () => {
  const seed = () => {
    const dir = tmp();
    const design = join(dir, '.design');
    mkdirSync(design, { recursive: true });
    writeFileSync(
      join(design, 'config.json'),
      `${JSON.stringify(
        {
          name: 'x',
          designRoot: '.design',
          formatVersion: 2,
          canvasGroups: [{ label: 'UI', path: 'ui' }],
          designSystems: [{ name: 'a', path: 'system/a' }],
        },
        null,
        2
      )}\n`
    );
    return dir;
  };
  test('setDefaultSystem', () => {
    const dir = seed();
    setDefaultSystem(join(dir, '.design'), 'a');
    expect(cfgIn(join(dir, '.design')).formatVersion).toBe(2);
  });
  test('renameSystem', () => {
    const dir = seed();
    renameSystem(join(dir, '.design'), 'a', 'Alpha');
    expect(cfgIn(join(dir, '.design')).formatVersion).toBe(2);
  });
  test('generation prefs (transcription, keyframe engine)', async () => {
    const dir = seed();
    await writeTranscriptionProvider(dir, 'whisper');
    await writeKeyframeEngine(dir, 'ffmpeg');
    expect(cfgIn(join(dir, '.design')).formatVersion).toBe(2);
  });
});

describe('the studio test fixtures the desktop e2e lanes drive are v2 projects', () => {
  test('_home-fixtures.makeProject (home, first-canvas)', () => {
    freshIndexDir();
    const p = homeProject('audit', { 'ui/a.tsx': 'A' });
    expect(cfgIn(p.designRoot).formatVersion).toBe(NEW_PROJECT_FORMAT);
  });
  test('_ds-engine-fixture.makeProject (ds-review/-outside/-reach/-edges/-advanced/-library, handoff)', async () => {
    const p = await engineProject();
    expect(cfgIn(p.designRoot).formatVersion).toBe(NEW_PROJECT_FORMAT);
    cleanup();
  });
  test('_ds-switch-fixture.switchProject (ds-switch)', async () => {
    const p = await switchProject();
    expect(cfgIn(p.designRoot).formatVersion).toBe(NEW_PROJECT_FORMAT);
    cleanup();
  });
});
