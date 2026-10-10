// The test preload keeps every test (and every server it spawns, which inherits process.env) out
// of the person's real ~/.config/maude — a fail-first test once rewrote the real prefs.json.
import { describe, expect, test } from 'bun:test';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { uiPrefsPath } from '../ui-prefs.ts';

const REAL = join(homedir(), '.config');

describe('test config isolation', () => {
  test('the prefs file a test process resolves is never the real one', () => {
    expect(uiPrefsPath().startsWith(REAL)).toBe(false);
  });
  test('the cloud credentials file is never the real one', () => {
    expect(process.env.MAUDE_CLOUD_CONFIG).toBeDefined();
    expect((process.env.MAUDE_CLOUD_CONFIG as string).startsWith(REAL)).toBe(false);
  });
  test('XDG config writers resolve under a throwaway dir', () => {
    expect(process.env.XDG_CONFIG_HOME).toBeDefined();
    expect((process.env.XDG_CONFIG_HOME as string).startsWith(REAL)).toBe(false);
  });
});
