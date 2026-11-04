// 2.0.2 — a desktop never forks its own canvas because the project already has the same file
// (Brno Alligators, 2026-11-03): the cloud cell's 2.0 conversion made a document for every `.tsx`
// of its checkout, the owner's Mac then replayed its queued creates for the SAME files, and the
// S6.13b rename (`create-collision.ts`) moved ten of them to "<name> 2" — ten duplicate canvases.
//
//   • the project's document at that path holds this Mac's bytes (the create's, or the disk's
//     now) → the create is withdrawn, nothing moves: this Mac's canvas IS that document;
//   • it holds something else → renamed, as before (two different canvases, both kept);
//   • a `_` file is a module (decision maude/v2-p8-lead-underscore-file-is-a-module), imported by
//     its name — never renamed: its create is withdrawn and the file stays where it is.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { Paths } from '../context.ts';
import { createCollisionRenamer } from '../sync/create-collision.ts';
import type { Operation, ProposalResult } from '../sync/transaction-client.ts';

const src = (t: string) => `export default function Canvas() {\n  return <h1>${t}</h1>;\n}\n`;
const sha = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');

let root: string;
let paths: Paths;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'create-same-'));
  const designRoot = path.join(root, '.design');
  mkdirSync(path.join(designRoot, 'ui', 'combine'), { recursive: true });
  paths = {
    repoRoot: root,
    designRel: '.design',
    designRoot,
    serverInfoFile: path.join(designRoot, '_server.json'),
    activeFile: path.join(designRoot, '_active.json'),
    commentsDir: path.join(designRoot, '_comments'),
    canvasStateDir: path.join(designRoot, '_canvas-state'),
    historyDir: path.join(designRoot, '_history'),
    tokensUrlRel: '',
    systemDirRel: 'system',
  };
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const docOf = (rel: string) =>
  rel
    .replace(/\.tsx$/, '')
    .replace(/[/ ]/g, '-')
    .toLowerCase();

/** The renamer against a project that holds `project` (rel → html) and this Mac's `disk`. */
function setup(project: Record<string, string>, disk: Record<string, string>) {
  for (const [rel, html] of Object.entries(disk)) {
    mkdirSync(path.dirname(path.join(paths.designRoot, rel)), { recursive: true });
    writeFileSync(path.join(paths.designRoot, rel), html);
  }
  const renamed: string[] = [];
  const renamer = createCollisionRenamer({
    paths,
    docNameFor: (slug) => slug,
    liveDocs: async () =>
      Object.entries(project).map(([rel, html]) => ({
        doc: docOf(rel),
        path: rel,
        lanes: { html: { hash: sha(html), effect: 'e_x' } },
      })),
    onRenaming: () => () => {},
    onRenamed: (r) => renamed.push(r.toRel),
    log: { log() {}, warn() {} },
  });
  return { renamer, renamed };
}

const create = (rel: string, html: string): Operation => ({
  op: 'doc.create',
  doc: docOf(rel),
  path: rel,
  lanes: { html },
});
const refused = (rel: string): ProposalResult => ({
  protocol: 1,
  status: 'rejected',
  code: 'path-conflict',
  transactionId: 'tx_a',
  doc: docOf(rel),
});

describe('a refused create of the same file is not a collision', () => {
  test('the project holds what the create carries → withdrawn, no " 2", nothing moves', async () => {
    const rel = 'ui/combine/Combine-admin.tsx';
    const { renamer, renamed } = setup({ [rel]: src('admin') }, { [rel]: src('admin') });
    const answer = await renamer.onCreateConflict(
      [create(rel, src('admin'))],
      refused(rel),
      'tx_a'
    );
    expect(answer?.renames ?? []).toEqual([]);
    expect(answer?.withdrawn).toEqual([{ doc: docOf(rel), why: 'same' }]);
    expect(renamed).toEqual([]);
    expect(readFileSync(path.join(paths.designRoot, rel), 'utf8')).toBe(src('admin'));
    expect(existsSync(path.join(paths.designRoot, 'ui/combine/Combine-admin 2.tsx'))).toBe(false);
    answer?.settled({ protocol: 1, status: 'accepted', transactionId: 'tx_a' });
  });

  test("the project holds this Mac's file as it is NOW (edited after the create) → withdrawn", async () => {
    const rel = 'ui/Poster.tsx';
    const { renamer, renamed } = setup({ [rel]: src('v2') }, { [rel]: src('v2') });
    const answer = await renamer.onCreateConflict([create(rel, src('v1'))], refused(rel), 'tx_a');
    expect(answer?.withdrawn).toEqual([{ doc: docOf(rel), why: 'same' }]);
    expect(renamed).toEqual([]);
  });

  test('the project holds something else → renamed, as before', async () => {
    const rel = 'ui/Poster.tsx';
    const { renamer, renamed } = setup({ [rel]: src('theirs') }, { [rel]: src('mine') });
    const answer = await renamer.onCreateConflict([create(rel, src('mine'))], refused(rel), 'tx_a');
    expect(answer?.renames.map((r) => r.toPath)).toEqual(['ui/Poster 2.tsx']);
    expect(answer?.withdrawn ?? []).toEqual([]);
    expect(renamed).toEqual(['ui/Poster 2.tsx']);
    expect(readFileSync(path.join(paths.designRoot, 'ui/Poster 2.tsx'), 'utf8')).toBe(src('mine'));
  });

  test('every create of a batch the project already has is answered in one go', async () => {
    const a = 'ui/combine/A.tsx';
    const b = 'ui/combine/B.tsx';
    const c = 'ui/combine/C.tsx';
    const { renamer } = setup(
      { [a]: src('a'), [b]: src('b') },
      { [a]: src('a'), [b]: src('b'), [c]: src('c') }
    );
    const answer = await renamer.onCreateConflict(
      [create(a, src('a')), create(b, src('b')), create(c, src('c'))],
      refused(a),
      'tx_a'
    );
    expect(answer?.withdrawn?.map((w) => w.doc).sort()).toEqual([docOf(a), docOf(b)]);
    expect(answer?.renames ?? []).toEqual([]);
  });
});

describe('a `_` file is a module: never renamed', () => {
  test('different content → withdrawn, the file stays under its own name', async () => {
    const rel = 'ui/combine/_combine-admin-public.tsx';
    const { renamer, renamed } = setup({ [rel]: src('cloud') }, { [rel]: src('mac') });
    const answer = await renamer.onCreateConflict([create(rel, src('mac'))], refused(rel), 'tx_a');
    expect(answer?.renames ?? []).toEqual([]);
    expect(answer?.withdrawn).toEqual([{ doc: docOf(rel), why: 'module' }]);
    expect(renamed).toEqual([]);
    expect(readFileSync(path.join(paths.designRoot, rel), 'utf8')).toBe(src('mac'));
    expect(existsSync(path.join(paths.designRoot, 'ui/combine/_combine-admin-public 2.tsx'))).toBe(
      false
    );
  });

  test('same content → withdrawn as the same file', async () => {
    const rel = 'ui/combine/_combine-admin-public.tsx';
    const { renamer } = setup({ [rel]: src('x') }, { [rel]: src('x') });
    const answer = await renamer.onCreateConflict([create(rel, src('x'))], refused(rel), 'tx_a');
    expect(answer?.withdrawn).toEqual([{ doc: docOf(rel), why: 'same' }]);
  });
});
