import { expect, test } from 'bun:test';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as Y from 'yjs';
import { applyHtmlToDoc, htmlFromDoc } from '../sync/codec.ts';
import { hashBytes } from '../sync/echo-guard.ts';
import { createDocProjection } from '../sync/projection.ts';

const base = 'export default function Canvas(){return <h1>Base</h1>}';
const u1 = 'export default function Canvas(){return <h1>Original unfinished draft';
const u2 = 'export default function Canvas(){return <h1>Original unfinished draft repaired</h1>}';
const peer = base.replace('<h1>', '<h1 style={{color:"red"}}>');

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'maude-recovery-lifetime-'));
  const historyDir = join(dir, 'history');
  const paths = {
    html: join(dir, 'canvas.tsx'),
    comments: join(dir, 'comments.json'),
    annotations: join(dir, 'annotations.svg'),
  };
  const doc = new Y.Doc();
  writeFileSync(paths.html, base);
  applyHtmlToDoc(doc, base, 'remote');
  let projection = createDocProjection({ slug: 'canvas', doc, paths, historyDir, flushMs: 0 });
  projection.start();
  projection.adoptBase(base);
  return {
    paths,
    doc,
    historyDir,
    get projection() {
      return projection;
    },
    edit(value: string) {
      writeFileSync(paths.html, value);
      return projection.applyFromFs({
        path: paths.html,
        bytes: Buffer.from(value),
        hash: hashBytes(value),
      });
    },
    restartWithRepair() {
      projection.stop();
      writeFileSync(paths.html, u2);
      applyHtmlToDoc(doc, peer, 'remote');
      projection = createDocProjection({ slug: 'canvas', doc, paths, historyDir, flushMs: 0 });
      projection.start();
      projection.hold('html', base, u2);
    },
    close() {
      projection.stop();
      doc.destroy();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

// Recovery may use a bounded JSON envelope; compare decoded source bytes, not
// whether its storage serialization happens to match a TSX file verbatim.
function retainedStrings(dir: string): string[] {
  const strings: string[] = [];
  function collect(value: unknown) {
    if (typeof value === 'string') strings.push(value);
    else if (value && typeof value === 'object')
      for (const child of Object.values(value)) collect(child);
  }
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) strings.push(...retainedStrings(path));
    else {
      const bytes = readFileSync(path, 'utf8');
      strings.push(bytes);
      try {
        collect(JSON.parse(bytes));
      } catch {
        /* opaque source is also retained */
      }
    }
  }
  return strings;
}

test('restart with a repaired candidate retains the original invalid draft and proven base', () => {
  const f = fixture();
  try {
    expect(f.edit(u1)).toBe(false);
    expect(htmlFromDoc(f.doc)).toBe(base);
    expect(retainedStrings(f.historyDir)).toContain(u1);
    f.restartWithRepair();
    expect(readFileSync(f.paths.html, 'utf8')).toBe(u2);
    expect(htmlFromDoc(f.doc)).toBe(peer);
    expect(f.projection.conflictSides()).toMatchObject({
      mine: u2,
      theirs: peer,
      original: u1,
      base,
    });
    expect(retainedStrings(f.historyDir)).toContain(u1);
  } finally {
    f.close();
  }
});

test('resolving with the accepted version keeps original bytes and the next conflict starts a fresh episode', async () => {
  const f = fixture();
  try {
    f.edit(u1);
    f.restartWithRepair();
    expect(f.projection.takeAccepted()).toBe(true);
    await f.projection.flush();
    expect(readFileSync(f.paths.html, 'utf8')).toBe(peer);
    expect(f.projection.conflictSides()).toBeNull();
    expect(retainedStrings(f.historyDir)).toContain(u1);
    const nextDraft = 'export default function Canvas(){return <h1>Next episode';
    f.edit(nextDraft);
    expect(f.projection.conflictSides()).toMatchObject({ original: nextDraft, base: peer });
  } finally {
    f.close();
  }
});

test('a failed accepted materialization does not resolve or replace the original candidate', async () => {
  const f = fixture();
  try {
    f.edit(u1);
    f.restartWithRepair();
    // A real filesystem failure, without mocking the storage boundary.
    rmSync(f.paths.html);
    const { mkdirSync } = await import('node:fs');
    mkdirSync(f.paths.html);
    f.projection.takeAccepted();
    await f.projection.flush();
    expect(f.projection.conflictSides()).toMatchObject({ original: u1, base });
    expect(retainedStrings(f.historyDir)).toContain(u1);
  } finally {
    f.close();
  }
});

test('repeated rejected repairs use bounded storage without evicting the first candidate', () => {
  const f = fixture();
  try {
    f.edit(u1);
    const before = readdirSync(join(f.historyDir, 'sync-recovery')).length;
    for (let i = 0; i < 25; i++) f.edit(`${u1} ${i}`);
    expect(f.projection.conflictSides()).toMatchObject({ original: u1, base });
    expect(readdirSync(join(f.historyDir, 'sync-recovery')).length).toBe(before);
    expect(retainedStrings(f.historyDir)).toContain(u1);
  } finally {
    f.close();
  }
});
