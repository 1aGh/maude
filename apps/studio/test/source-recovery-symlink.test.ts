// #168 T5.4 S1 (B) — a recovery write never follows a symlink out of the design root. The
// recovery slots live under `<designRoot>/_history/<slug>/sync-recovery/`; a link planted at any
// of those folders (a cloned repo can carry one) would otherwise land the bytes wherever it
// points. The write fails closed instead — the projection reports it as `snapshotFailed`.
import { afterAll, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  preserveRecoveryCandidate,
  readRecoveryBody,
  resolveRecoveryCandidate,
  saveRecoveryBody,
} from '../sync/source-recovery.ts';

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function sandbox() {
  const root = mkdtempSync(path.join(tmpdir(), 'maude-recovery-link-'));
  dirs.push(root);
  const designRoot = path.join(root, '.design');
  const outside = path.join(root, 'outside');
  mkdirSync(designRoot, { recursive: true });
  mkdirSync(outside, { recursive: true });
  return { root, designRoot, outside, historyDir: path.join(designRoot, '_history', 'ui-a') };
}

const FILE = 'ui/a.tsx';
const BODY = 'export default () => <p>a</p>;\n';
const writes = (historyDir: string) => [
  () => saveRecoveryBody(historyDir, FILE, 'local', BODY),
  () => preserveRecoveryCandidate(historyDir, FILE, BODY, null),
];

describe('recovery writes stay inside the design root', () => {
  test('a plain history folder is written (and read back)', () => {
    const s = sandbox();
    saveRecoveryBody(s.historyDir, FILE, 'local', BODY);
    preserveRecoveryCandidate(s.historyDir, FILE, BODY, null);
    resolveRecoveryCandidate(s.historyDir, FILE);
    expect(readRecoveryBody(s.historyDir, FILE, 'local')).toBe(BODY);
  });

  test('a link at _history/<slug> is refused; nothing lands where it points', () => {
    const s = sandbox();
    mkdirSync(path.join(s.designRoot, '_history'), { recursive: true });
    symlinkSync(s.outside, s.historyDir);
    for (const w of writes(s.historyDir)) expect(w).toThrow(/symlink|outside/i);
    expect(readdirSync(s.outside)).toEqual([]);
  });

  test('a link at _history itself is refused', () => {
    const s = sandbox();
    symlinkSync(s.outside, path.join(s.designRoot, '_history'));
    for (const w of writes(s.historyDir)) expect(w).toThrow(/symlink|outside/i);
    expect(readdirSync(s.outside)).toEqual([]);
  });

  test('a link at sync-recovery is refused', () => {
    const s = sandbox();
    mkdirSync(s.historyDir, { recursive: true });
    symlinkSync(s.outside, path.join(s.historyDir, 'sync-recovery'));
    for (const w of writes(s.historyDir)) expect(w).toThrow(/symlink|outside/i);
    expect(readdirSync(s.outside)).toEqual([]);
  });

  test('a link to a folder INSIDE the design root is refused too (no segment is a link)', () => {
    const s = sandbox();
    const inside = path.join(s.designRoot, 'ui');
    mkdirSync(inside, { recursive: true });
    mkdirSync(path.join(s.designRoot, '_history'), { recursive: true });
    symlinkSync(inside, s.historyDir);
    for (const w of writes(s.historyDir)) expect(w).toThrow(/symlink|outside/i);
    expect(existsSync(path.join(inside, 'sync-recovery'))).toBe(false);
  });

  test('a design root reached through a link (a shared design folder) still works', () => {
    const s = sandbox();
    const real = path.join(s.root, 'shared-design');
    mkdirSync(real, { recursive: true });
    const linked = path.join(s.root, 'repo', '.design');
    mkdirSync(path.dirname(linked), { recursive: true });
    symlinkSync(real, linked);
    const historyDir = path.join(linked, '_history', 'ui-a');
    saveRecoveryBody(historyDir, FILE, 'local', BODY);
    expect(readRecoveryBody(historyDir, FILE, 'local')).toBe(BODY);
    expect(existsSync(path.join(real, '_history', 'ui-a', 'sync-recovery', 'local.tsx'))).toBe(
      true
    );
  });
});
