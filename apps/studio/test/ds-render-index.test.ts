// S10.4 (V2-1.6 §5.8) — the index payload's account of which revision each canvas can render:
// `dsConverted` / `systemHeads` / `dsRevGaps` (a referenced revision this disk cannot render yet, with the
// person we wait for). The gaps are what `canvasUrl` falls back on, so a wrong "present" renders a 404 and
// a wrong "missing" hides a look that is there.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { newHead, serializeHead } from '../ds/head.ts';
import { dsRenderIndex, revisionRenderable } from '../ds/render-rev.ts';
import { buildRevision, revisionSiblings } from '../ds/revision.ts';

let root: string;
beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'ds-render-index-'));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const SYSTEMS = [
  { name: 'studio-site', path: 'system/studio-site' },
  { name: 'plain', path: 'system/plain' },
];

function writeRevision(
  system: string,
  tokens: string,
  opts: { siblings?: boolean; corrupt?: boolean } = {}
) {
  const dsAbs = path.join(root, 'system', system);
  mkdirSync(path.join(dsAbs, 'revisions'), { recursive: true });
  const rev = buildRevision(system, {
    'colors_and_type.css': tokens,
    'preview/_components.css': `.btn{color:${tokens.length}px}`,
  });
  writeFileSync(
    path.join(dsAbs, 'revisions', `${rev.id}.json`),
    opts.corrupt ? rev.bytes.replace('.btn', '.btx') : rev.bytes
  );
  if (opts.siblings !== false)
    for (const s of revisionSiblings(rev.id, rev.body))
      writeFileSync(path.join(dsAbs, s.path), s.text);
  return rev.id;
}

function writeHeadJson(
  system: string,
  head: string | null,
  log: Array<{ rev: string; by: { kind: string; name?: string } }> = []
) {
  const dsAbs = path.join(root, 'system', system);
  mkdirSync(path.join(dsAbs, 'revisions'), { recursive: true });
  const doc = newHead(system, { head, base: head });
  doc.log = log.map((l) => ({
    rev: l.rev,
    action: 'publish',
    at: '2026-10-09T10:00:00Z',
    by: l.by,
  })) as typeof doc.log;
  writeFileSync(path.join(dsAbs, 'revisions', 'head.json'), serializeHead(doc));
}

describe('dsRenderIndex', () => {
  test('a system without head.json is not converted and adds nothing else', () => {
    writeRevision('plain', 'a{}');
    const out = dsRenderIndex(root, SYSTEMS, {});
    expect(out).toEqual({
      dsConverted: { 'studio-site': false, plain: false },
      systemHeads: {},
      dsRevGaps: {},
    });
  });

  test('a converted system reports its head; a complete revision is no gap', () => {
    const r = writeRevision('studio-site', ':root{--a:1}');
    writeHeadJson('studio-site', r);
    const out = dsRenderIndex(root, SYSTEMS, {});
    expect(out.dsConverted).toEqual({ 'studio-site': true, plain: false });
    expect(out.systemHeads).toEqual({ 'studio-site': r });
    expect(out.dsRevGaps).toEqual({});
  });

  test('a head still being made is null, not a gap', () => {
    writeHeadJson('studio-site', null);
    const out = dsRenderIndex(root, SYSTEMS, {});
    expect(out.systemHeads).toEqual({ 'studio-site': null });
    expect(out.dsRevGaps).toEqual({});
  });

  test('a head whose files have not arrived is a gap, and names the person who made it', () => {
    const r = buildRevision('studio-site', { 'colors_and_type.css': 'x{}' }).id;
    writeHeadJson('studio-site', r, [{ rev: r, by: { kind: 'person', name: 'Jonas' } }]);
    expect(dsRenderIndex(root, SYSTEMS, {}).dsRevGaps).toEqual({ [r]: 'Jonas' });
  });

  test('an ai or agent author is not a Mac to wait for', () => {
    const r = buildRevision('studio-site', { 'colors_and_type.css': 'x{}' }).id;
    writeHeadJson('studio-site', r, [{ rev: r, by: { kind: 'ai', name: 'Claude' } }]);
    expect(dsRenderIndex(root, SYSTEMS, {}).dsRevGaps).toEqual({ [r]: null });
  });

  test('a canvas dsRev that is not here is a gap even when the head is fine', () => {
    const head = writeRevision('studio-site', ':root{--a:1}');
    writeHeadJson('studio-site', head);
    const gone = 'f'.repeat(64);
    const out = dsRenderIndex(root, SYSTEMS, {
      '.design/ui/Landing.tsx': { system: 'studio-site', dsRev: gone },
    });
    expect(out.dsRevGaps).toEqual({ [gone]: null });
  });

  test('a dsRev held in full is no gap', () => {
    const old = writeRevision('studio-site', ':root{--a:1}');
    const head = writeRevision('studio-site', ':root{--a:22}');
    writeHeadJson('studio-site', head);
    const out = dsRenderIndex(root, SYSTEMS, {
      '.design/ui/Landing.tsx': { system: 'studio-site', dsRev: old },
    });
    expect(out.dsRevGaps).toEqual({});
  });

  test('a malformed dsRev is ignored, never looked up on disk', () => {
    const head = writeRevision('studio-site', ':root{--a:1}');
    writeHeadJson('studio-site', head);
    const out = dsRenderIndex(root, SYSTEMS, {
      '.design/ui/Landing.tsx': { system: 'studio-site', dsRev: '../../etc/passwd' },
    });
    expect(out.dsRevGaps).toEqual({});
  });
});

describe('revisionRenderable', () => {
  test('complete → yes; a missing sibling → no; a tampered revision → no (never rendered)', () => {
    const dsAbs = path.join(root, 'system', 'studio-site');
    const ok = writeRevision('studio-site', ':root{--a:1}');
    expect(revisionRenderable(dsAbs, ok)).toBe(true);
    const noSibling = writeRevision('studio-site', ':root{--a:2}', { siblings: false });
    expect(revisionRenderable(dsAbs, noSibling)).toBe(false);
    const bad = writeRevision('studio-site', ':root{--a:3}', { corrupt: true });
    expect(revisionRenderable(dsAbs, bad)).toBe(false);
  });

  test('a verdict follows the file: a revision that arrives later flips from missing to present', () => {
    const dsAbs = path.join(root, 'system', 'studio-site');
    const id = writeRevision('studio-site', ':root{--a:9}', { siblings: false });
    expect(revisionRenderable(dsAbs, id)).toBe(false);
    for (const s of revisionSiblings(
      id,
      buildRevision('studio-site', {
        'colors_and_type.css': ':root{--a:9}',
        'preview/_components.css': `.btn{color:${':root{--a:9}'.length}px}`,
      }).body
    ))
      writeFileSync(path.join(dsAbs, s.path), s.text);
    expect(revisionRenderable(dsAbs, id)).toBe(true);
  });

  // S10.4b — a made system (ds/make.ts) freezes an EMPTY `_components.css`: its 0-byte sibling is there,
  // so the head is renderable and no canvas waits on "…'s Mac" forever. A 0-byte sibling standing in for
  // text the revision does carry is still missing (emptiness never beats content).
  function writeWith(
    system: string,
    files: Record<string, string>,
    siblingText?: (s: string) => string
  ) {
    const dsAbs = path.join(root, 'system', system);
    mkdirSync(path.join(dsAbs, 'revisions'), { recursive: true });
    const rev = buildRevision(system, files);
    writeFileSync(path.join(dsAbs, 'revisions', `${rev.id}.json`), rev.bytes);
    for (const s of revisionSiblings(rev.id, rev.body))
      writeFileSync(path.join(dsAbs, s.path), siblingText ? siblingText(s.text) : s.text);
    return { dsAbs, id: rev.id };
  }

  test('an empty sibling the revision itself has empty is present; a made head is no gap', () => {
    const { dsAbs, id } = writeWith('studio-site', {
      'colors_and_type.css': ':root{--a:1}',
      'preview/_components.css': '',
    });
    expect(revisionRenderable(dsAbs, id)).toBe(true);
    writeHeadJson('studio-site', id, [{ rev: id, by: { kind: 'person', name: 'Jonas' } }]);
    expect(dsRenderIndex(root, SYSTEMS, {}).dsRevGaps).toEqual({});
  });

  test('a 0-byte sibling for text the revision carries is still missing', () => {
    const { dsAbs, id } = writeWith(
      'studio-site',
      { 'colors_and_type.css': ':root{--a:2}', 'preview/_components.css': '.btn{}' },
      () => ''
    );
    expect(revisionRenderable(dsAbs, id)).toBe(false);
  });

  test('the tokens entry follows tokensCssRel: an empty custom tokens file is present', () => {
    const { id } = writeWith('studio-site', {
      'tokens/main.css': '',
      'preview/_components.css': '.b{}',
    });
    // the siblings follow the default key, so write the tokens sibling by hand (empty, as the revision says)
    writeFileSync(path.join(root, 'system', 'studio-site', 'revisions', `${id}.tokens.css`), '');
    writeHeadJson('studio-site', id);
    const custom = [
      {
        name: 'studio-site',
        path: 'system/studio-site',
        tokensCssRel: 'system/studio-site/tokens/main.css',
      },
    ];
    expect(dsRenderIndex(root, custom, {}).dsRevGaps).toEqual({});
    // without the key the empty tokens sibling cannot be vouched for
    expect(
      Object.keys(
        dsRenderIndex(root, [{ name: 'studio-site', path: 'system/studio-site' }], {}).dsRevGaps
      )
    ).toEqual([id]);
  });

  test('a non-id is never touched on disk', () => {
    expect(revisionRenderable(root, '../x')).toBe(false);
  });
});
