// S6.6 / Q13 — "Install the maude command": a symlink at <binDir>/maude to the BUNDLED maude, no
// sudo, never following or overwriting what is already there. A regular file, a directory or a
// symlink pointing elsewhere is refused and left byte-for-byte as it was; a link that is already
// ours is a no-op. When `claude` is present the plugin is added with argv-only spawns.
// Everything lives in temp dirs — never the real ~/.local/bin.

import { describe, expect, test } from 'bun:test';
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { bundledCliPath, createHomeCli } from '../home/cli.ts';

function sandbox() {
  const root = mkdtempSync(join(tmpdir(), 'maude-home-cli-'));
  const app = join(root, 'Maude.app', 'Contents', 'MacOS');
  mkdirSync(app, { recursive: true });
  const bundled = join(app, 'maude');
  writeFileSync(bundled, '#!/bin/sh\necho maude\n');
  chmodSync(bundled, 0o755);
  writeFileSync(join(app, 'maude-server'), 'x');
  const binDir = join(root, 'home', '.local', 'bin');
  return { root, app, bundled, binDir, link: join(binDir, 'maude') };
}

function cli(
  s: ReturnType<typeof sandbox>,
  over: { bundled?: string | null; claude?: string | null } = {}
) {
  const runs: string[][] = [];
  const c = createHomeCli({
    paths: () => ({
      binDir: s.binDir,
      bundled: over.bundled === undefined ? s.bundled : over.bundled,
    }),
    claude: () => (over.claude === undefined ? null : over.claude),
    run: async (argv) => {
      runs.push(argv);
      return 0;
    },
  });
  return { c, runs };
}

const state = (r: { body: unknown }) => (r.body as { state: string }).state;

describe('install', () => {
  test('nothing there → a symlink to the bundled maude (bin dir created)', async () => {
    const s = sandbox();
    const { c } = cli(s);
    expect(state(c.status())).toBe('absent');
    const r = await c.install({});
    expect(r.status).toBe(200);
    expect(state(r)).toBe('installed');
    expect(lstatSync(s.link).isSymbolicLink()).toBe(true);
    expect(readlinkSync(s.link)).toBe(s.bundled);
    expect(state(c.status())).toBe('installed');
  });

  test('a regular file at <binDir>/maude is refused and left untouched', async () => {
    const s = sandbox();
    mkdirSync(s.binDir, { recursive: true });
    writeFileSync(s.link, 'my own maude script\n');
    const before = lstatSync(s.link);
    const { c, runs } = cli(s, { claude: '/usr/bin/claude' });
    expect(state(c.status())).toBe('not-a-link');
    const r = await c.install({});
    expect(r.status).toBe(409);
    expect(state(r)).toBe('not-a-link');
    const after = lstatSync(s.link);
    expect(after.isFile()).toBe(true);
    expect(after.ino).toBe(before.ino);
    expect(readFileSync(s.link, 'utf8')).toBe('my own maude script\n');
    expect(runs).toEqual([]); // a refused install adds no plugin either
  });

  test('a directory at <binDir>/maude is refused', async () => {
    const s = sandbox();
    mkdirSync(s.link, { recursive: true });
    const r = await cli(s).c.install({});
    expect(r.status).toBe(409);
    expect(lstatSync(s.link).isDirectory()).toBe(true);
  });

  test('a symlink pointing elsewhere (live or dangling) is refused and not followed', async () => {
    for (const target of ['/usr/local/bin/maude-npm', join(tmpdir(), 'nope-does-not-exist')]) {
      const s = sandbox();
      mkdirSync(s.binDir, { recursive: true });
      // a live target we could write through if we followed the link
      const victim = join(s.root, 'victim');
      writeFileSync(victim, 'victim\n');
      symlinkSync(target === '/usr/local/bin/maude-npm' ? victim : target, s.link);
      const before = readlinkSync(s.link);
      const { c } = cli(s);
      expect(state(c.status())).toBe('other-link');
      const r = await c.install({});
      expect(r.status).toBe(409);
      expect(readlinkSync(s.link)).toBe(before);
      expect(readFileSync(victim, 'utf8')).toBe('victim\n');
    }
  });

  test('a link that is already ours is a no-op (same inode)', async () => {
    const s = sandbox();
    mkdirSync(s.binDir, { recursive: true });
    symlinkSync(s.bundled, s.link);
    const ino = lstatSync(s.link).ino;
    const r = await cli(s).c.install({});
    expect(r.status).toBe(200);
    expect(state(r)).toBe('installed');
    expect(lstatSync(s.link).ino).toBe(ino);
  });

  test('no bundled maude in this build → unavailable, nothing created', async () => {
    const s = sandbox();
    const { c } = cli(s, { bundled: null });
    expect(state(c.status())).toBe('unavailable');
    const r = await c.install({});
    expect(r.status).toBe(409);
    expect(() => lstatSync(s.link)).toThrow();
  });

  test('only a regular bundled file is installed — never a link or a relative path', async () => {
    const s = sandbox();
    const indirect = join(s.root, 'indirect-maude');
    symlinkSync(s.bundled, indirect);
    for (const bundled of [indirect, 'maude', join(s.root, 'missing')]) {
      const r = await cli(s, { bundled }).c.install({});
      expect([bundled, r.status]).toEqual([bundled, 409]);
      expect(() => lstatSync(s.link)).toThrow();
    }
  });

  test('a bin dir that is a file is refused', async () => {
    const s = sandbox();
    mkdirSync(join(s.binDir, '..'), { recursive: true });
    writeFileSync(s.binDir, 'not a dir');
    const r = await cli(s).c.install({});
    expect(r.status).toBe(409);
    expect(readFileSync(s.binDir, 'utf8')).toBe('not a dir');
  });
});

describe('the plugin step', () => {
  test('claude present → marketplace add + install, each an argv array (no shell)', async () => {
    const s = sandbox();
    const { c, runs } = cli(s, { claude: '/opt/claude/bin/claude' });
    const r = await c.install({});
    expect(r.status).toBe(200);
    await c.settle();
    expect(runs).toEqual([
      ['/opt/claude/bin/claude', 'plugin', 'marketplace', 'add', '1aGh/maude'],
      ['/opt/claude/bin/claude', 'plugin', 'install', 'design@maude'],
      ['/opt/claude/bin/claude', 'plugin', 'install', 'flow@maude'],
    ]);
    const st = c.status().body as { claude: boolean; plugin: { phase: string; ok?: boolean } };
    expect(st.claude).toBe(true);
    expect(st.plugin).toEqual({ phase: 'done', ok: true });
  });

  test('claude absent → no spawn; status says so (the sheet shows the Copy rows)', async () => {
    const s = sandbox();
    const { c, runs } = cli(s);
    await c.install({});
    await c.settle();
    expect(runs).toEqual([]);
    expect((c.status().body as { claude: boolean }).claude).toBe(false);
  });
});

describe('bundledCliPath', () => {
  test('the maude beside a compiled maude-server, and nothing else', () => {
    const s = sandbox();
    expect(bundledCliPath(join(s.app, 'maude-server'))).toBe(s.bundled);
    expect(bundledCliPath(join(s.app, 'maude-server-aarch64-apple-darwin'))).toBe(s.bundled);
    // bun itself (a source / test run) is never "the bundled CLI"
    expect(bundledCliPath(join(s.app, 'bun'))).toBeNull();
    const other = mkdtempSync(join(tmpdir(), 'maude-home-cli-nobin-'));
    expect(bundledCliPath(join(other, 'maude-server'))).toBeNull();
  });
});
