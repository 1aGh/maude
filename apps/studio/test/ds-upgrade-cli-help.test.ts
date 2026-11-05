// `maude design ds-upgrade <ds> --help` prints the usage (it answered "unknown flag --help"), and a
// wrong stage name says where the stamp is found.
import { describe, expect, test } from 'bun:test';
import { runDsUpgrade, USAGE } from '../ds/upgrade-cli.ts';
import { DsUpgradeError, stateDirOf } from '../ds/upgrade-stage.ts';

describe('ds-upgrade --help', () => {
  for (const argv of [
    ['studio', '--help'],
    ['--help'],
    ['-h'],
    ['studio', '--prove', '1', '--help'],
  ])
    test(`${argv.join(' ')} prints the usage, exit 0`, () => {
      const r = runDsUpgrade(argv, { CLAUDE_PROJECT_DIR: '/nonexistent' });
      expect(r.code).toBe(0);
      expect(r.stdout).toBe(USAGE);
      expect(r.stdout).toContain('--prove <stamp>');
      expect(r.later).toBeUndefined();
    });

  test('an unknown flag points at --help', () => {
    const r = runDsUpgrade(['studio', '--nope'], { CLAUDE_PROJECT_DIR: '/nonexistent' });
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain('unknown flag --nope');
    expect(r.stderr).toContain('--help');
  });

  test('a stage that is not a stamp says where the stamp is', () => {
    let err: unknown = null;
    try {
      stateDirOf('/x/.design', 'studio', 'stage-one');
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(DsUpgradeError);
    const msg = (err as Error).message;
    expect(msg).toContain('--stage');
    expect(msg).toContain('--status');
    expect(msg).toContain('_state/ds-upgrade/');
  });
});
