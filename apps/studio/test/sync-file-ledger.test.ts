// The desktop file ledger — Sync v2 Increment 3 (DDR-226 §3).
//
// The properties worth proving are all about SURVIVING A CRASH and about the
// ledger never claiming more than it knows:
//
//   • bytes land before the ancestor moves, and the ordering is enforced by the
//     API rather than remembered by callers;
//   • a crash between the two leaves the ancestor LAGGING (recoverable noise)
//     and never LEADING (the eraser class) — proven by killing a real process
//     between the two writes;
//   • a ledger from another hub, a corrupt one, or a missing one all degrade to
//     "re-anchor safely", never to "act on someone else's ancestors";
//   • the stat cache is an observation, not a claim of reconciliation.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createFileLedger, hubIdFor } from '../sync/file-ledger.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const HUB = 'https://hub.example.test';
const A = 'a'.repeat(64);
const B = 'b'.repeat(64);

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'file-ledger-'));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const make = (over: Partial<Parameters<typeof createFileLedger>[0]> = {}) =>
  createFileLedger({ designRoot: root, hubUrl: HUB, flushMs: 0, ...over });

describe('where it lives', () => {
  test('under `_state/`, which is already IGNORED in every DDR-115 list', () => {
    const l = make();
    const rel = l.file().slice(root.length + 1);
    // No new `_*` path anybody has to remember to add to four ignore lists.
    expect(rel.startsWith('_state/file-ledger/')).toBe(true);
  });

  test('one file per hub, stable across runs', () => {
    expect(hubIdFor(HUB)).toBe(hubIdFor(HUB));
    expect(hubIdFor(HUB)).not.toBe(hubIdFor('https://other.example.test'));
    expect(hubIdFor(HUB)).toMatch(/^[a-z0-9.-]+-[0-9a-f]{8}$/i);
  });
});

describe('the write-ordering invariant', () => {
  test('the ancestor moves only after the bytes land', async () => {
    const l = make();
    const order: string[] = [];
    await l.adoptAfter('a/x.png', A, () => {
      order.push('bytes');
      expect(l.ancestorOf('a/x.png')).toBeNull();
    });
    order.push('ancestor');
    expect(order).toEqual(['bytes', 'ancestor']);
    expect(l.ancestorOf('a/x.png')).toBe(A);
  });

  test('a failed landing leaves the ancestor ALONE and says why', async () => {
    const l = make();
    await l.adoptAfter('a/x.png', A, () => {
      throw new Error('disk full');
    });
    // The ancestor never moved — so the next pass still sees local work.
    expect(l.ancestorOf('a/x.png')).toBeNull();
    expect(l.row('a/x.png')?.state).toBe('stuck');
    expect(l.row('a/x.png')?.reason).toContain('disk full');
  });

  test('adopting clears a previous failure rather than leaving a stale reason', async () => {
    const l = make();
    await l.adoptAfter('a/x.png', A, () => {
      throw new Error('transient');
    });
    await l.adoptAfter('a/x.png', A, () => {});
    expect(l.row('a/x.png')?.state).not.toBe('stuck');
    expect(l.row('a/x.png')?.reason).toBeUndefined();
  });

  test('there is NO exported way to move an ancestor without landing something', () => {
    // The ordering is structural, not a convention: the only mutator that
    // touches `syncedHash` takes the byte-landing as its argument.
    const l = make();
    const surface = Object.keys(l);
    expect(surface).toContain('adoptAfter');
    for (const forbidden of ['setAncestor', 'adopt', 'recordAncestor', 'markSynced']) {
      expect(surface).not.toContain(forbidden);
    }
  });
});

describe('the stat cache is an observation, not a claim', () => {
  test('a cached hash is returned only while size AND mtime still match', () => {
    const l = make();
    l.noteLocal('a/x.png', A, 10, 1000);
    expect(l.cachedHash('a/x.png', 10, 1000)).toBe(A);
    expect(l.cachedHash('a/x.png', 11, 1000)).toBeNull();
    expect(l.cachedHash('a/x.png', 10, 1001)).toBeNull();
    expect(l.cachedHash('a/other.png', 10, 1000)).toBeNull();
  });

  test('observing local bytes NEVER moves the ancestor', () => {
    // This is the separation that keeps the cache from handing back an
    // ancestor for bytes that have since changed.
    const l = make();
    l.noteLocal('a/x.png', B, 10, 1000);
    expect(l.ancestorOf('a/x.png')).toBeNull();
    expect(l.row('a/x.png')?.state).toBe('local-only');
  });

  test('after a real adopt the observation and the ancestor agree', async () => {
    const l = make();
    l.noteLocal('a/x.png', B, 10, 1000);
    await l.adoptAfter('a/x.png', B, () => {}, { size: 10, mtimeMs: 2000 });
    expect(l.ancestorOf('a/x.png')).toBe(B);
    expect(l.cachedHash('a/x.png', 10, 2000)).toBe(B);
  });
});

describe('the epoch, and what a degraded one means', () => {
  test('a fresh ledger is never degraded — it anchors on whatever the hub says', () => {
    const l = make();
    expect(l.isDegraded('epoch-1')).toBe(false);
    l.setPosition('epoch-1', 12);
    expect(l.isDegraded('epoch-1')).toBe(false);
    expect(l.isDegraded('epoch-2')).toBe(true);
  });

  test('re-anchoring KEEPS the ancestors and drops only the cursor', async () => {
    // Throwing ancestors away would turn every path into a first-anchor
    // conflict for no gain: they still record what this machine reconciled,
    // which is true whatever the hub's log did.
    const l = make();
    await l.adoptAfter('a/x.png', A, () => {});
    l.setPosition('epoch-1', 40);
    l.reanchor('epoch-2');
    expect(l.ancestorOf('a/x.png')).toBe(A);
    expect(l.cursor()).toBe(0);
    expect(l.epoch()).toBe('epoch-2');
  });
});

describe('the outbox — self-echo detection', () => {
  test('remembers what is in flight and forgets it on completion', () => {
    const l = make();
    expect(l.outboxHas(A)).toBe(false);
    l.outboxAdd(A);
    expect(l.outboxHas(A)).toBe(true);
    l.outboxDone(A);
    expect(l.outboxHas(A)).toBe(false);
  });
});

describe('persistence degrades safely, never dangerously', () => {
  test('a ledger round-trips', async () => {
    const l = make();
    await l.adoptAfter('a/x.png', A, () => {}, { remoteSeq: 7 });
    l.setPosition('epoch-1', 7);
    l.flush();

    const again = make();
    expect(again.ancestorOf('a/x.png')).toBe(A);
    expect(again.cursor()).toBe(7);
    expect(again.epoch()).toBe('epoch-1');
    expect(again.row('a/x.png')?.remoteSeq).toBe(7);
  });

  test('a ledger recorded against ANOTHER hub is ignored wholesale', async () => {
    const l = make();
    await l.adoptAfter('a/x.png', A, () => {});
    l.setPosition('epoch-1', 7);
    l.flush();

    // Same file, different hub: the seqs belong to another log and the
    // ancestors to another project. Acting on them would be worse than
    // starting over.
    const other = createFileLedger({
      designRoot: root,
      hubUrl: HUB,
      flushMs: 0,
    });
    expect(other.ancestorOf('a/x.png')).toBe(A); // same hub → kept

    const elsewhere = createFileLedger({
      designRoot: root,
      hubUrl: 'https://elsewhere.test',
      flushMs: 0,
    });
    expect(elsewhere.ancestorOf('a/x.png')).toBeNull();
    expect(elsewhere.cursor()).toBe(0);
  });

  test('a CORRUPT ledger reads as absent — a safe re-anchor, not half-parsed ancestors', () => {
    const l = make();
    l.flush();
    writeFileSync(l.file(), '{ this is not json');
    const again = make();
    expect(again.cursor()).toBe(0);
    expect(Object.keys(again.rows())).toEqual([]);
  });

  test('a planted `__proto__` row cannot pollute', () => {
    const l = make();
    l.flush();
    writeFileSync(
      l.file(),
      JSON.stringify({
        version: 1,
        hubUrl: HUB,
        epoch: null,
        cursor: 0,
        updatedAt: 0,
        rows: { __proto__: { syncedHash: 'x' }, 'a/ok.png': { syncedHash: A } },
      })
    );
    const again = make();
    expect(again.ancestorOf('a/ok.png')).toBe(A);
    expect(({} as Record<string, unknown>).syncedHash).toBeUndefined();
  });

  test('an unpersistable ledger warns and keeps working', () => {
    const warns: string[] = [];
    // A path that cannot be a directory: `_state` is a FILE here.
    const blocked = mkdtempSync(join(tmpdir(), 'file-ledger-blocked-'));
    writeFileSync(join(blocked, '_state'), 'not a directory');
    const l = createFileLedger({
      designRoot: blocked,
      hubUrl: HUB,
      flushMs: 0,
      log: { warn: (m: string) => warns.push(m) },
    });
    l.setState('a/x.png', 'local-only');
    l.flush();
    expect(warns.length).toBeGreaterThan(0);
    // …and the in-memory state is intact, so sync keeps running.
    expect(l.row('a/x.png')?.state).toBe('local-only');
    rmSync(blocked, { recursive: true, force: true });
  });
});

/* ------------------------------------------------------------------------- */

describe('CRASH: killed between the bytes and the ancestor', () => {
  // The real thing, in a real process. A harness script lands bytes through
  // `adoptAfter` and then hard-exits before the ledger can persist — which is
  // exactly the window a SIGKILL, a power cut or a container migration opens.
  //
  // The outcome that must hold: the file is on disk and the ancestor does NOT
  // name it. That is the ancestor LAGGING, and it degrades to "this looks like
  // a local change" — a conflict copy at worst. The forbidden outcome is the
  // reverse: an ancestor naming bytes that never landed, which would let the
  // next pass overwrite real local work as though it were already reconciled.
  test('the ancestor lags; it never leads', () => {
    const scratch = mkdtempSync(join(tmpdir(), 'ledger-crash-'));
    try {
      const script = join(scratch, 'crash.ts');
      writeFileSync(
        script,
        `
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createFileLedger } from ${JSON.stringify(join(HERE, '..', 'sync', 'file-ledger.ts'))};

const root = process.argv[2];
const ledger = createFileLedger({ designRoot: root, hubUrl: ${JSON.stringify(HUB)}, flushMs: 60_000 });
mkdirSync(join(root, 'assets'), { recursive: true });
await ledger.adoptAfter('assets/x.png', ${JSON.stringify(A)}, () => {
  writeFileSync(join(root, 'assets/x.png'), 'REAL BYTES');
});
// The bytes are down and the ancestor has moved IN MEMORY. The debounce has
// not fired, so nothing is on disk yet — now die, the way a container does.
process.kill(process.pid, 'SIGKILL');
`
      );
      try {
        execFileSync('bun', [script, scratch], { stdio: 'ignore' });
      } catch {
        /* SIGKILL is the point */
      }

      // The bytes made it…
      expect(existsSync(join(scratch, 'assets/x.png'))).toBe(true);
      expect(readFileSync(join(scratch, 'assets/x.png'), 'utf8')).toBe('REAL BYTES');

      // …and the ancestor did not, so the next boot re-reads this as local
      // work rather than as something already reconciled.
      const after = createFileLedger({ designRoot: scratch, hubUrl: HUB, flushMs: 0 });
      expect(after.ancestorOf('assets/x.png')).toBeNull();
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });

  test('and re-running converges — the lag costs a pass, not a file', async () => {
    // Same shape, survivable: with the ancestor absent the next pass simply
    // adopts what is on disk once it agrees with the hub again.
    const l = make();
    mkdirSync(join(root, 'assets'), { recursive: true });
    writeFileSync(join(root, 'assets/x.png'), 'REAL BYTES');
    expect(l.ancestorOf('assets/x.png')).toBeNull();
    await l.adoptAfter('assets/x.png', A, () => {});
    expect(l.ancestorOf('assets/x.png')).toBe(A);
  });
});

describe('B13 (post-1.0 burn-down) — the park memo dies with the conflict it memoised', () => {
  test('adoptAfter clears parkedRemote alongside conflictCopy', async () => {
    const l = make();
    l.setState('ui/hero.tsx', 'conflict', {
      reason: 'epoch degraded',
      conflictCopy: '_trash/ui/hero.tsx-conflict-1',
      parkedRemote: B,
    });
    expect(l.row('ui/hero.tsx')?.parkedRemote).toBe(B);

    // The row converges (a later pass lands agreed bytes).
    await l.adoptAfter('ui/hero.tsx', A, () => {});

    const row = l.row('ui/hero.tsx');
    expect(row?.conflictCopy).toBeUndefined();
    // Without this, hash B was memoised FOREVER: re-diverging to B a week
    // later skipped the park while the ledger still claimed a copy existed.
    expect(row?.parkedRemote).toBeUndefined();
  });
});

describe('a flush that changes nothing writes nothing (2026-10-05)', () => {
  // Every plane pass ends `setPosition` + `flush`, and the ledger sits under
  // the design root the watcher reports on. Restamping `updatedAt` on an
  // unchanged ledger raised the `fs:any` that scheduled the next pass — a
  // journal read every ~2 s on an idle project, and a cell that never slept.
  test('an idle pass leaves the file byte-identical', () => {
    let clock = 1_000;
    const l = make({ now: () => clock });
    l.setPosition('ep-1', 5);
    l.flush();
    const first = readFileSync(l.file(), 'utf8');
    for (let i = 0; i < 5; i += 1) {
      clock += 2_000;
      l.setPosition('ep-1', 5);
      l.flush();
    }
    expect(readFileSync(l.file(), 'utf8')).toBe(first);
  });

  test('real news still persists, and a deleted file is rewritten', () => {
    let clock = 1_000;
    const l = make({ now: () => clock });
    l.setPosition('ep-1', 5);
    l.flush();
    clock += 1_000;
    l.setPosition('ep-1', 6);
    l.flush();
    expect(JSON.parse(readFileSync(l.file(), 'utf8')).cursor).toBe(6);
    l.noteRemote('a/x.png', A, 6);
    l.flush();
    expect(JSON.parse(readFileSync(l.file(), 'utf8')).rows['a/x.png'].remoteHash).toBe(A);
    rmSync(l.file());
    l.flush();
    expect(existsSync(l.file())).toBe(true);
  });
});
