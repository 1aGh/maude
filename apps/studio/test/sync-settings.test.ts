// feature-before-first-external-users Task 2 — the sync-settings module: the
// three user-facing toggles stop meaning "edit linkedHub.* JSON by hand".

import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { isFirstAnchorMode, readSyncSettings, writeSyncSettings } from '../sync/settings.ts';

function makeRepo(config?: unknown): string {
  const root = mkdtempSync(join(tmpdir(), 'maude-sync-settings-'));
  mkdirSync(join(root, '.design'), { recursive: true });
  if (config !== undefined) {
    writeFileSync(
      join(root, '.design', 'config.json'),
      typeof config === 'string' ? config : `${JSON.stringify(config, null, 2)}\n`
    );
  }
  return root;
}

const LINKED = {
  name: 'p',
  linkedHub: { url: 'https://hub.example.com', linkedAt: 123, syncTsx: false },
};

describe('sync settings — read', () => {
  test('absent keys read as the runtime defaults (ON, ON, ask)', () => {
    const root = makeRepo(LINKED);
    expect(readSyncSettings(root)).toEqual({
      syncFiles: true,
      propagateDeletes: true,
      resolveFirstAnchor: 'ask',
      ignoreFolders: [],
    });
  });

  test('no linked hub → null (the panel must not render dead controls)', () => {
    expect(readSyncSettings(makeRepo({ name: 'p' }))).toBeNull();
    expect(readSyncSettings(makeRepo())).toBeNull();
  });

  test('explicit values read through', () => {
    const root = makeRepo({
      name: 'p',
      linkedHub: {
        url: 'https://hub.example.com',
        linkedAt: 1,
        syncFiles: false,
        propagateDeletes: false,
        resolveFirstAnchor: 'keep-local',
      },
    });
    expect(readSyncSettings(root)).toEqual({
      syncFiles: false,
      propagateDeletes: false,
      resolveFirstAnchor: 'keep-local',
      ignoreFolders: [],
    });
  });
});

describe('sync settings — write', () => {
  test('false is written explicitly; true REMOVES the key (default = absent)', async () => {
    const root = makeRepo(LINKED);
    await writeSyncSettings(root, { syncFiles: false, propagateDeletes: false });
    let hub = JSON.parse(readFileSync(join(root, '.design', 'config.json'), 'utf8')).linkedHub;
    expect(hub.syncFiles).toBe(false);
    expect(hub.propagateDeletes).toBe(false);
    await writeSyncSettings(root, { syncFiles: true, propagateDeletes: true });
    hub = JSON.parse(readFileSync(join(root, '.design', 'config.json'), 'utf8')).linkedHub;
    expect('syncFiles' in hub).toBe(false);
    expect('propagateDeletes' in hub).toBe(false);
  });

  test("resolveFirstAnchor 'ask' removes the key — absence IS the ask state", async () => {
    const root = makeRepo(LINKED);
    await writeSyncSettings(root, { resolveFirstAnchor: 'keep-cloud' });
    let hub = JSON.parse(readFileSync(join(root, '.design', 'config.json'), 'utf8')).linkedHub;
    expect(hub.resolveFirstAnchor).toBe('keep-cloud');
    await writeSyncSettings(root, { resolveFirstAnchor: 'ask' });
    hub = JSON.parse(readFileSync(join(root, '.design', 'config.json'), 'utf8')).linkedHub;
    expect('resolveFirstAnchor' in hub).toBe(false);
  });

  test('every other config field survives a write verbatim', async () => {
    const root = makeRepo({
      ...LINKED,
      themeDefault: 'dark',
      canvasGroups: [{ label: 'UI', path: 'ui' }],
    });
    await writeSyncSettings(root, { propagateDeletes: false });
    const cfg = JSON.parse(readFileSync(join(root, '.design', 'config.json'), 'utf8'));
    expect(cfg.themeDefault).toBe('dark');
    expect(cfg.canvasGroups).toEqual([{ label: 'UI', path: 'ui' }]);
    expect(cfg.linkedHub.syncTsx).toBe(false); // untouched sibling key
    expect(cfg.linkedHub.url).toBe('https://hub.example.com');
  });

  test('no linked hub → throws (never invents a linkedHub block)', async () => {
    const root = makeRepo({ name: 'p' });
    await expect(writeSyncSettings(root, { syncFiles: false })).rejects.toThrow(/no linked hub/);
  });

  test('corrupt config → refuses to overwrite (fail closed)', async () => {
    const root = makeRepo('{ this is not json');
    await expect(writeSyncSettings(root, { syncFiles: false })).rejects.toThrow(/not valid JSON/);
    expect(readFileSync(join(root, '.design', 'config.json'), 'utf8')).toBe('{ this is not json');
  });

  test('invalid resolveFirstAnchor value → throws', async () => {
    const root = makeRepo(LINKED);
    await expect(
      // @ts-expect-error — deliberately wrong value
      writeSyncSettings(root, { resolveFirstAnchor: 'keep-both' })
    ).rejects.toThrow(/invalid resolveFirstAnchor/);
  });
});

describe('sync settings — vocabulary', () => {
  test('isFirstAnchorMode accepts exactly the three modes', () => {
    expect(isFirstAnchorMode('ask')).toBe(true);
    expect(isFirstAnchorMode('keep-local')).toBe(true);
    expect(isFirstAnchorMode('keep-cloud')).toBe(true);
    expect(isFirstAnchorMode('keep-both')).toBe(false);
    expect(isFirstAnchorMode(true)).toBe(false);
    expect(isFirstAnchorMode(undefined)).toBe(false);
  });

  test('the schema knows every runtime linkedHub key (the drift this task found)', () => {
    // config.schema.json had additionalProperties:false with only 4 of the 9
    // runtime keys — a user who followed a breaker remediation string
    // ("set linkedHub.propagateDeletes=false") failed config lint for it.
    const schema = JSON.parse(
      readFileSync(join(import.meta.dir, '..', 'config.schema.json'), 'utf8')
    );
    const props = Object.keys(schema.properties.linkedHub.properties);
    for (const key of [
      'url',
      'linkedAt',
      'adopt',
      'syncTsx',
      'workspaceId',
      'syncFiles',
      'propagateDeletes',
      'resolveFirstAnchor',
      'fileEvents',
    ]) {
      expect(props).toContain(key);
    }
  });
});

describe('sync settings — folders the project does not sync (issue #207)', () => {
  test('one folder in, then out again; an empty list leaves no key behind', async () => {
    const root = makeRepo(LINKED);
    const a = await writeSyncSettings(root, { addIgnoreFolder: 'ideas/renders/' });
    expect(a.ignoreFolders).toEqual(['ideas/renders']);
    await writeSyncSettings(root, { addIgnoreFolder: 'ideas/renders' });
    const cfg = JSON.parse(readFileSync(join(root, '.design', 'config.json'), 'utf8'));
    expect(cfg.linkedHub.ignoreFolders).toEqual(['ideas/renders']);
    const b = await writeSyncSettings(root, { removeIgnoreFolder: 'ideas/renders' });
    expect(b.ignoreFolders).toEqual([]);
    const after = JSON.parse(readFileSync(join(root, '.design', 'config.json'), 'utf8'));
    expect('ignoreFolders' in after.linkedHub).toBe(false);
  });

  test('a folder outside the design root is refused, not written', async () => {
    const root = makeRepo(LINKED);
    await expect(writeSyncSettings(root, { addIgnoreFolder: '../elsewhere' })).rejects.toThrow();
    expect(readSyncSettings(root)?.ignoreFolders).toEqual([]);
  });
});
