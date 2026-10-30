// V2-1.12 P2 — `writeChatMeta` merges into the RAW stored object.
//
// Before: it read the filtered `{title, archived}` view and wrote that view
// back, so a rename or an archive erased every other key — v2's `canvas` link
// (V2-1.12 §5.3, the migrator's `chats.canvas` step) included.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { readChatMeta, writeChatMeta } from '../acp/transcript.ts';

let root: string;
beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'chat-meta-'));
  mkdirSync(path.join(root, '_chat'), { recursive: true });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const file = () => path.join(root, '_chat', 'c-1.meta.json');
const disk = () => JSON.parse(readFileSync(file(), 'utf8')) as Record<string, unknown>;

describe('chat meta keeps keys it does not know (P2)', () => {
  test('archive and rename keep `canvas` and any future key', () => {
    writeFileSync(
      file(),
      JSON.stringify({ title: 'Reel covers', canvas: 'ui/reel.tsx', future: { a: 1 } })
    );
    writeChatMeta(root, 'c-1', { archived: true });
    expect(disk()).toEqual({
      title: 'Reel covers',
      canvas: 'ui/reel.tsx',
      future: { a: 1 },
      archived: true,
    });
    writeChatMeta(root, 'c-1', { title: 'Covers v2' });
    expect(disk()).toMatchObject({ title: 'Covers v2', canvas: 'ui/reel.tsx', archived: true });
  });

  test('clearing a field removes only that field', () => {
    writeFileSync(file(), JSON.stringify({ title: 'T', archived: true, canvas: 'ui/a.tsx' }));
    writeChatMeta(root, 'c-1', { title: null, archived: false });
    expect(disk()).toEqual({ canvas: 'ui/a.tsx' });
  });

  test('the returned / read view is still just {title, archived}', () => {
    writeFileSync(file(), JSON.stringify({ title: 'T', canvas: 'ui/a.tsx' }));
    expect(writeChatMeta(root, 'c-1', { archived: true })).toEqual({ title: 'T', archived: true });
    expect(readChatMeta(root, 'c-1')).toEqual({ title: 'T', archived: true });
  });

  test('a missing or broken sidecar starts from empty', () => {
    expect(writeChatMeta(root, 'c-2', { title: 'New' })).toEqual({ title: 'New' });
    writeFileSync(path.join(root, '_chat', 'c-3.meta.json'), '[1,2');
    writeChatMeta(root, 'c-3', { archived: true });
    expect(JSON.parse(readFileSync(path.join(root, '_chat', 'c-3.meta.json'), 'utf8'))).toEqual({
      archived: true,
    });
  });
});
