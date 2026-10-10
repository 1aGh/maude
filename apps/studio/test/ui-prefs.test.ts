// ui-prefs.ts — the reader is lossless (V2-1.12 rule, V2-2.7) and the writer is crash-safe.
//
// Every test points MAUDE_UI_PREFS_PATH at its own throwaway file; the preload already keeps the
// process out of the person's real ~/.config/maude, this keeps each test out of the others'.
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { readUiPrefs, UI_PREFS_DEFAULTS, uiPrefsPath, writeUiPrefs } from '../ui-prefs.ts';

let dir: string;
let prev: string | undefined;

beforeEach(() => {
  prev = process.env.MAUDE_UI_PREFS_PATH;
  dir = mkdtempSync(join(tmpdir(), 'ui-prefs-'));
  process.env.MAUDE_UI_PREFS_PATH = join(dir, 'prefs.json');
});
afterEach(() => {
  if (prev === undefined) delete process.env.MAUDE_UI_PREFS_PATH;
  else process.env.MAUDE_UI_PREFS_PATH = prev;
  rmSync(dir, { recursive: true, force: true });
});

const onDisk = () => JSON.parse(readFileSync(uiPrefsPath(), 'utf8'));
const siblings = () => readdirSync(dir).sort();

describe('lossless reader (V2-1.12)', () => {
  test('unknown top-level fields and a numeric version survive a read', () => {
    writeFileSync(
      uiPrefsPath(),
      JSON.stringify({ theme: 'light', version: 2, fold: { a: true }, future: { x: [1, 2] } })
    );
    const p = readUiPrefs();
    expect(p.theme).toBe('light');
    expect(p.version).toBe(2);
    expect(p.fold).toEqual({ a: true });
    expect(p.future).toEqual({ x: [1, 2] });
    // the seven v1 fields are still all present
    expect(p.minimap).toBe(UI_PREFS_DEFAULTS.minimap);
    expect(p.panelSides).toEqual(UI_PREFS_DEFAULTS.panelSides);
  });

  test('a write keeps every field the writer does not own', () => {
    writeFileSync(
      uiPrefsPath(),
      JSON.stringify({ theme: 'dark', version: 2, seen: { tour: true }, pin: { on: true } })
    );
    writeUiPrefs({ minimap: true });
    const d = onDisk();
    expect(d.minimap).toBe(true);
    expect(d.version).toBe(2);
    expect(d.seen).toEqual({ tour: true });
    expect(d.pin).toEqual({ on: true });
  });

  test('a non-numeric or non-positive version is dropped, not carried', () => {
    for (const bad of ['2', 0, -1, 1.5, null, {}]) {
      writeFileSync(uiPrefsPath(), JSON.stringify({ theme: 'dark', version: bad }));
      expect('version' in readUiPrefs()).toBe(false);
    }
  });

  test('prototype keys in the file are never carried', () => {
    writeFileSync(
      uiPrefsPath(),
      '{"theme":"dark","__proto__":{"polluted":1},"constructor":{"x":1},"prototype":{"y":1}}'
    );
    const p = readUiPrefs();
    expect(Object.hasOwn(p, '__proto__')).toBe(false);
    expect(Object.hasOwn(p, 'constructor')).toBe(false);
    expect(Object.hasOwn(p, 'prototype')).toBe(false);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    writeUiPrefs({ zoom: true });
    expect(JSON.stringify(onDisk())).not.toContain('polluted');
  });

  test('a missing file still reads as exactly the defaults (no new keys on a fresh install)', () => {
    expect(readUiPrefs()).toEqual(UI_PREFS_DEFAULTS);
    expect(existsSync(uiPrefsPath())).toBe(false);
  });
});

describe('crash-safe writer', () => {
  test('the write goes through a rename (new inode) and leaves no temp file behind', () => {
    writeUiPrefs({ theme: 'dark' });
    const before = statSync(uiPrefsPath()).ino;
    writeUiPrefs({ theme: 'light' });
    const after = statSync(uiPrefsPath()).ino;
    expect(after).not.toBe(before);
    expect(onDisk().theme).toBe('light');
    expect(siblings()).toEqual(['prefs.json']);
  });

  test('an unparseable prefs.json is backed up, not overwritten with defaults', () => {
    const garbage = '{"theme":"light","minimap":tr';
    writeFileSync(uiPrefsPath(), garbage);
    writeUiPrefs({ zoom: true });
    const backups = siblings().filter((n) => /^prefs\.json\.corrupt-\d+$/.test(n));
    expect(backups.length).toBe(1);
    expect(readFileSync(join(dir, backups[0]), 'utf8')).toBe(garbage);
    expect(onDisk().zoom).toBe(true);
    expect(onDisk().theme).toBe(UI_PREFS_DEFAULTS.theme);
  });

  test('valid JSON that is not an object counts as corrupt too', () => {
    for (const text of ['[1,2]', '"x"', 'null', '42']) {
      for (const n of siblings()) rmSync(join(dir, n), { force: true });
      writeFileSync(uiPrefsPath(), text);
      writeUiPrefs({ zoom: true });
      expect(siblings().filter((n) => n.includes('.corrupt-')).length).toBe(1);
    }
  });

  test('reading never backs anything up, and a healthy file is never backed up', () => {
    writeFileSync(uiPrefsPath(), '{not json');
    expect(readUiPrefs()).toEqual(UI_PREFS_DEFAULTS);
    expect(siblings()).toEqual(['prefs.json']);
    writeUiPrefs({ zoom: true }); // heals the file (one backup)
    writeUiPrefs({ zoom: false }); // healthy now: no second backup
    expect(siblings().filter((n) => n.includes('.corrupt-')).length).toBe(1);
  });

  test('an empty file is not worth a backup', () => {
    writeFileSync(uiPrefsPath(), '  \n');
    writeUiPrefs({ zoom: true });
    expect(siblings()).toEqual(['prefs.json']);
    expect(onDisk().zoom).toBe(true);
  });
});
