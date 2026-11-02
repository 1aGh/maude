// S11.17 (C37) — a full disk never loses a change and never applies one twice.
//
// `sync/atomic-write.ts` maps ENOSPC to a typed `DiskFullError`; `sync/write-hold.ts` keeps the bytes of a
// write the disk refused (the in-memory hold, one per file, newest bytes win) and lands each of them ONCE
// when room returns — on the room probe's tick, on the next write that succeeds, or on Retry. The edit
// lane (`POST /_api/edit-op`) reads through the hold, so a second edit made while the disk is full builds
// on the first one instead of on the stale file.

import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { applyEdit, editAttribute } from '../canvas-edit.ts';
import type { EditOp } from '../edit-ops/types.ts';
import { createEditRoutes } from '../routes/edit.ts';
import { asDiskFull, DiskFullError, isDiskFull } from '../sync/atomic-write.ts';
import { createWriteHold, setSourceHoldForTest } from '../sync/write-hold.ts';

const enospc = (path = '/p') =>
  Object.assign(new Error(`ENOSPC: no space left on device, write '${path}'`), {
    code: 'ENOSPC',
    errno: -28,
  });

/** A disk that is full until `room = true`; it records every write that landed. */
function fakeDisk() {
  const disk = {
    room: false,
    files: new Map<string, string>(),
    landed: [] as Array<[string, string]>,
    calls: 0,
    write: async (key: string, bytes: string | Uint8Array) => {
      disk.calls++;
      if (!disk.room) throw enospc(key);
      const text = typeof bytes === 'string' ? bytes : new TextDecoder().decode(bytes);
      disk.files.set(key, text);
      disk.landed.push([key, text]);
    },
  };
  return disk;
}

describe('DiskFullError', () => {
  test('ENOSPC (and a quota) is a full disk; anything else is not', () => {
    expect(isDiskFull(enospc())).toBe(true);
    expect(isDiskFull(Object.assign(new Error('quota'), { code: 'EDQUOT' }))).toBe(true);
    expect(isDiskFull(Object.assign(new Error('no'), { code: 'EACCES' }))).toBe(false);
    expect(isDiskFull(null)).toBe(false);
    const typed = asDiskFull(enospc('/a/b.tsx'), '/a/b.tsx');
    expect(typed).toBeInstanceOf(DiskFullError);
    expect((typed as DiskFullError).code).toBe('ENOSPC');
    expect((typed as DiskFullError).path).toBe('/a/b.tsx');
    // already typed, or not a full disk: handed back as it is
    expect(asDiskFull(typed, '/x')).toBe(typed);
    const other = new Error('boom');
    expect(asDiskFull(other, '/x')).toBe(other);
  });
});

describe('the write hold', () => {
  test('a full disk holds the bytes; the hold survives a second ENOSPC; one write on recovery', async () => {
    const disk = fakeDisk();
    const landed: string[] = [];
    const hold = createWriteHold({ write: disk.write, now: () => 1000 });
    const r = await hold.put('/p/ui/A.tsx', 'v1', { onLanded: () => landed.push('A') });
    expect(r.held).toBe(true);
    expect(hold.read('/p/ui/A.tsx')).toBe('v1');
    expect(hold.status()).toEqual({ full: true, held: 1, since: 1000 });

    // still full: Retry keeps the first hold, same bytes, nothing landed
    expect(await hold.retry()).toEqual({ landed: 0, held: 1 });
    expect(hold.read('/p/ui/A.tsx')).toBe('v1');
    expect(disk.landed).toEqual([]);

    disk.room = true;
    expect(await hold.retry()).toEqual({ landed: 1, held: 0 });
    expect(disk.landed).toEqual([['/p/ui/A.tsx', 'v1']]);
    expect(landed).toEqual(['A']);
    expect(hold.status()).toEqual({ full: false, held: 0, since: null });
    // a second Retry has nothing to apply: never twice
    expect(await hold.retry()).toEqual({ landed: 0, held: 0 });
    expect(disk.landed.length).toBe(1);
    hold.close();
  });

  test('a newer write to a held file replaces the bytes; only the newest lands, once', async () => {
    const disk = fakeDisk();
    const hold = createWriteHold({ write: disk.write, now: () => 5 });
    await hold.put('/p/A.tsx', 'v1');
    await hold.put('/p/A.tsx', 'v2');
    expect(hold.status().held).toBe(1);
    expect(hold.read('/p/A.tsx')).toBe('v2');
    disk.room = true;
    await hold.retry();
    expect(disk.landed).toEqual([['/p/A.tsx', 'v2']]);
    hold.close();
  });

  test('the next write that lands drains the hold; a landed write of the held file drops the old bytes', async () => {
    const disk = fakeDisk();
    const hold = createWriteHold({ write: disk.write });
    await hold.put('/p/A.tsx', 'a1');
    await hold.put('/p/B.tsx', 'b1');
    disk.room = true;
    // B is written directly and lands: its held b1 must never land after it; A's hold drains behind it
    expect((await hold.put('/p/B.tsx', 'b2')).held).toBe(false);
    expect(disk.landed).toEqual([
      ['/p/B.tsx', 'b2'],
      ['/p/A.tsx', 'a1'],
    ]);
    expect(disk.files.get('/p/B.tsx')).toBe('b2');
    expect(hold.status().held).toBe(0);
    hold.close();
  });

  test('two Retries at once apply a held write once', async () => {
    const disk = fakeDisk();
    const hold = createWriteHold({ write: disk.write });
    await hold.put('/p/A.tsx', 'v1');
    disk.room = true;
    const [a, b] = await Promise.all([hold.retry(), hold.retry()]);
    expect(a.landed + b.landed).toBe(1);
    expect(disk.landed).toEqual([['/p/A.tsx', 'v1']]);
    hold.close();
  });

  test('another failure is not a full disk: it is thrown, nothing is held', async () => {
    const hold = createWriteHold({
      write: async () => {
        throw Object.assign(new Error('denied'), { code: 'EACCES' });
      },
    });
    await expect(hold.put('/p/A.tsx', 'v1')).rejects.toThrow('denied');
    expect(hold.status().held).toBe(0);
    hold.close();
  });

  test('the room probe: no room → nothing is tried; room → the hold lands on the tick', async () => {
    const disk = fakeDisk();
    let tick: (() => void) | null = null;
    let room = false;
    const hold = createWriteHold({
      write: disk.write,
      hasRoom: () => room,
      timers: {
        set: (fn: () => void) => {
          tick = fn;
          return 1;
        },
        clear: () => {
          tick = null;
        },
      },
    });
    await hold.put('/p/A.tsx', 'v1');
    expect(tick).not.toBeNull();
    const before = disk.calls;
    await (tick as unknown as () => Promise<void>)();
    expect(disk.calls).toBe(before); // no room: the write is not even tried
    room = true;
    disk.room = true;
    await (tick as unknown as () => Promise<void>)();
    expect(disk.landed).toEqual([['/p/A.tsx', 'v1']]);
    expect(tick).toBeNull(); // nothing held: the probe stops
    hold.close();
  });

  test('subscribers hear full → recovered', async () => {
    const disk = fakeDisk();
    const hold = createWriteHold({ write: disk.write, now: () => 7 });
    const seen: boolean[] = [];
    const off = hold.subscribe((s) => seen.push(s.full));
    await hold.put('/p/A.tsx', 'v1');
    disk.room = true;
    await hold.retry();
    off();
    expect(seen).toEqual([true, false]);
    hold.close();
  });
});

// ── the edit lane ───────────────────────────────────────────────────────────────────────────────────

const SRC = `import { DCArtboard, DesignCanvas } from '@maude/canvas-lib';
export default function Home() {
  return (
    <DesignCanvas>
      <DCArtboard id="desktop" label="Desktop" width={800} height={500}>
        <footer data-cd-id="footer">Footer</footer>
        <header data-cd-id="header">Header</header>
      </DCArtboard>
    </DesignCanvas>
  );
}
`;
const paint = (element: string, color: string): EditOp => ({
  id: `test.paint-${element}`,
  apply: (src, r) => ({
    source: applyEdit(r.file, src, element, 'style.color', `'${color}'`).source,
  }),
});

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});
const post = (body: unknown) =>
  new Request('http://localhost/_api/edit-op', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

describe('POST /_api/edit-op on a full disk', () => {
  test('both edits are kept, the file is untouched until room returns, then ONE write with both', async () => {
    const root = mkdtempSync(join(tmpdir(), 'maude-disk-full-'));
    dirs.push(root);
    const designRoot = join(root, '.design');
    mkdirSync(join(designRoot, 'ui'), { recursive: true });
    const file = join(designRoot, 'ui', 'Home.tsx');
    writeFileSync(file, SRC);

    let room = false;
    const writes: string[] = [];
    const hold = createWriteHold({
      write: async (key, bytes) => {
        if (!room) throw enospc(key);
        writes.push(key);
        writeFileSync(key, bytes);
      },
    });
    const events: Array<[string, unknown]> = [];
    const [spec] = createEditRoutes({
      designRoot,
      designRel: '.design',
      repoRoot: root,
      emit: (e, p) => events.push([e, p]),
      ops: [paint('footer', 'red'), paint('header', 'blue')],
      hold,
    });
    const edit = (op: string, element: string) =>
      spec.handle(
        post({ file: '.design/ui/Home.tsx', op, targets: [{ artboard: 'desktop', element }] }),
        {}
      );

    const r1 = await edit('test.paint-footer', 'footer');
    expect(r1.status).toBe(200);
    const r2 = await edit('test.paint-header', 'header');
    expect(r2.status).toBe(200);
    // nothing reached the disk, and nothing claims it did
    expect(readFileSync(file, 'utf8')).toBe(SRC);
    expect(events.filter(([e]) => e === 'source-written')).toEqual([]);
    expect(hold.status()).toMatchObject({ full: true, held: 1 });

    room = true;
    expect(await hold.retry()).toEqual({ landed: 1, held: 0 });
    const disk = readFileSync(file, 'utf8');
    // the second edit was made on top of the first (it read the held bytes, not the stale file)
    expect(disk).toContain("color: 'red'");
    expect(disk).toContain("color: 'blue'");
    expect(writes).toEqual([file]);
    // announced once, when it landed — the local home records it then
    const written = events.filter(([e]) => e === 'source-written');
    expect(written).toHaveLength(1);
    expect(written[0]?.[1]).toMatchObject({ rel: 'ui/Home.tsx', content: disk });
    hold.close();
  });
});

describe('the inspector lane (canvas-edit.ts) on a full disk', () => {
  test('two attribute edits wait in the studio hold, then land as one write with both', async () => {
    const root = mkdtempSync(join(tmpdir(), 'maude-disk-full-ce-'));
    dirs.push(root);
    const file = join(root, 'Home.tsx');
    writeFileSync(file, SRC);
    let room = false;
    const writes: string[] = [];
    const hold = createWriteHold({
      write: async (key, bytes) => {
        if (!room) throw enospc(key);
        writes.push(key);
        writeFileSync(key, bytes);
      },
    });
    setSourceHoldForTest(hold);
    try {
      await editAttribute(file, 'footer', 'style.color', "'red'");
      await editAttribute(file, 'header', 'style.color', "'blue'");
      expect(readFileSync(file, 'utf8')).toBe(SRC);
      expect(hold.status()).toMatchObject({ full: true, held: 1 });
      room = true;
      expect(await hold.retry()).toEqual({ landed: 1, held: 0 });
      const disk = readFileSync(file, 'utf8');
      expect(disk).toContain("color: 'red'");
      expect(disk).toContain("color: 'blue'");
      expect(writes).toEqual([file]);
    } finally {
      setSourceHoldForTest(null);
    }
  });
});
