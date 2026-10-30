// p8-ci-linux-2 — a listing a route answers has ONE order on every machine.
//
// CI 40990963284 (Ubuntu, ext4): U7's two boots of the same fixture listed `/_api/assets` in
// different orders — newest first with no tie-break, and ext4's coarse clock stamps two files
// written back to back alike, so a tie fell back to readdir order. readdir order is the
// filesystem's own (hash order on ext4 and on APFS, a different hash each), so it differs per
// machine. Each listing below gets equal mtimes and names APFS does not return sorted
// (a.png…e.png come back b, c, a, d, e), and must answer by name among equals.

import { describe, expect, test } from 'bun:test';
import { mkdirSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { listChats } from '../acp/transcript.ts';
import { createApi } from '../api.ts';
import { listGeneratedGroups } from '../asset-generated.ts';
import { type Context, createBus } from '../context.ts';
import { listTrash } from '../sync/trash.ts';
import { makeSandbox } from './_helpers.ts';

const NAMES = ['a', 'b', 'c', 'd', 'e'];
const T = new Date('2026-10-30T02:22:29.000Z');

function ctxFor(root: string, designRoot: string): Context {
  return {
    cfg: {} as Context['cfg'],
    projectLabel: 'order',
    bus: createBus(),
    paths: {
      repoRoot: root,
      designRel: '.design',
      designRoot,
      serverInfoFile: join(designRoot, '_server.json'),
      activeFile: join(designRoot, '_active.json'),
      commentsDir: join(designRoot, '_comments'),
      canvasStateDir: join(designRoot, '_canvas-state'),
      historyDir: join(designRoot, '_history'),
      tokensUrlRel: '',
      systemDirRel: 'system',
    },
  };
}

/** Write `files` (rel → text) under `dir`, every one with the same mtime. */
function plant(dir: string, files: Record<string, string>) {
  mkdirSync(dir, { recursive: true });
  for (const [rel, text] of Object.entries(files)) {
    const abs = join(dir, rel);
    mkdirSync(join(abs, '..'), { recursive: true });
    writeFileSync(abs, text);
    utimesSync(abs, T, T);
  }
}

describe('route listings answer one order, whatever the filesystem lists first', () => {
  test('/_api/assets: newest first, equal mtimes by name', async () => {
    const { root, designRoot } = makeSandbox();
    plant(join(designRoot, 'assets'), Object.fromEntries(NAMES.map((n) => [`${n}.png`, n])));
    const api = createApi(ctxFor(root, designRoot), { onCommentsChanged() {} });
    const r = await api.listAssets();
    expect(r.assets.map((a) => a.name)).toEqual(NAMES.map((n) => `${n}.png`));
  });

  test('the trash: one canvas bundle (all its files share a time) lists by name', () => {
    const { designRoot } = makeSandbox();
    const top = '2026-10-30T02-22-29-000Z__card';
    plant(join(designRoot, '_trash', top), {
      ...Object.fromEntries(NAMES.map((n) => [`${n}.tsx`, n])),
      '_trash-manifest.json': JSON.stringify({
        canvas: 'ui/a.tsx',
        trashed: NAMES.map((n) => `ui/${n}.tsx`),
      }),
    });
    const rels = listTrash(designRoot)
      .map((e) => e.sourceRel)
      .filter(Boolean);
    expect(rels).toEqual(NAMES.map((n) => `ui/${n}.tsx`));
  });

  test('chats written in one clock tick list by id', () => {
    const { designRoot } = makeSandbox();
    const line = (t: string) => `${JSON.stringify({ role: 'user', text: t })}\n`;
    plant(
      join(designRoot, '_chat'),
      Object.fromEntries(NAMES.map((n) => [`c-${n}.jsonl`, line(n)]))
    );
    expect(listChats(designRoot).map((c) => c.id)).toEqual(NAMES.map((n) => `c-${n}`));
  });

  test('a generated run whose records name only themselves: takes and label by name', () => {
    const { designRoot } = makeSandbox();
    const stems = NAMES.map((n) => n.repeat(8));
    const files: Record<string, string> = {};
    for (const s of stems) {
      files[`${s}.png`] = s;
      files[`${s}.gen.json`] = JSON.stringify({
        format: 'maude.gen',
        v: 1,
        prompt: `prompt ${s}`,
        provider: 'fal',
        model: 'flux-pro-1.1',
        at: '2026-10-18T09:12:00Z',
        licence: 'You own the output; provider terms apply.',
        group: 'g_3f9a1c2e7b40',
        takes: [s],
      });
    }
    plant(join(designRoot, 'assets'), files);
    const [g] = listGeneratedGroups(designRoot);
    expect(g?.takes).toEqual(stems.map((s) => `assets/${s}.png`));
    expect(g?.prompt).toBe(`prompt ${stems[0]}`);
  });
});
