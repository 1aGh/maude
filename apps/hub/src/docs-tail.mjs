// The legacy documents' write-behind — followup-multiplayer-hardening G3b.
//
// A cell's disk goes with its container, and every wake restores the newest
// backup generation (backup.mjs). The generation's `hub.db` is up to one
// interval old, so in LEGACY mode — where the shared documents themselves are
// the project — a hard kill lost everything written since it (F3 S17 on the
// cloud cell: documents written 5 s and 70 s before a restart were gone). A
// graceful stop is already covered by the final generation (36e48e90); this is
// the crash half.
//
// Every document the hub STORES (Hocuspocus' debounced onStoreDocument, after
// the SQLite extension wrote hub.db) is also written to object storage as its
// full Y state, and a deletion as a marker. A wake replays what the restored
// generation does not hold: Y states MERGE (a CRDT update applied twice is
// applied once), so the order of a state and the generation never matters —
// only markers are ordered, by the sequence below.
//
// KEYS: `docs/<seq>/<encoded name>.ystate` and `…/<encoded name>.gone`. `seq` is
// a counter the hub bumps when a backup generation STARTS; once the generation
// is written, every sequence below it is covered by it and is removed. So the
// tail holds roughly one interval of writes, and rotation never has to read an
// object to decide (the file target's listing carries no timestamps).
//
// In ACCEPTED mode nothing is written: the project store (a Durable Object in a
// cell) is durable before it acknowledges, and the documents are its replicas.
import * as Y from 'yjs';

import { clearTombstone, recordTombstone } from './tombstones.mjs';

export const DOCS_TAIL_PREFIX = 'docs/';
const CTL_DOC = 'maude.files';

const keyFor = (seq, name, kind) =>
  `${DOCS_TAIL_PREFIX}${String(seq).padStart(10, '0')}/${encodeURIComponent(name)}.${kind}`;

/** `docs/0000000007/ws%2F…%2Fui-a.ystate` → { seq: 7, name, kind } */
export function parseDocsTailKey(key) {
  const m = /^docs\/(\d{10})\/([^/]+)\.(ystate|gone)$/.exec(key);
  if (!m) return null;
  let name;
  try {
    name = decodeURIComponent(m[2]);
  } catch {
    return null;
  }
  return { seq: Number(m[1]), name, kind: m[3] };
}

/**
 * @param {object} o
 * @param {import('./backup.mjs').BackupTarget|null} o.target  prefixed (per tenant)
 * @param {() => boolean} [o.writing]  false in accepted mode — nothing is written
 */
export function createDocsTail({ target, writing = () => true, log = console, concurrency = 4 }) {
  if (!target) {
    return {
      enabled: false,
      ready: async () => {},
      store() {},
      remove() {},
      beginGeneration: () => null,
      async endGeneration() {},
      async flush() {},
      failures: () => 0,
    };
  }
  let seq = 1;
  let failures = 0;
  // Continue after the highest sequence a previous process left, before the
  // first write: an older sequence would order a marker behind a later state.
  const ready = (async () => {
    try {
      const keys = (await target.list(DOCS_TAIL_PREFIX)).map((o) => parseDocsTailKey(o.key));
      seq = keys.reduce((m, k) => (k && k.seq > m ? k.seq : m), 0) + 1;
    } catch (err) {
      log.error?.(
        `[docs-tail] could not read the tail (${err.message}) — writing from a new sequence`
      );
      seq = Math.floor(Date.now() / 1000);
    }
  })();
  const latest = new Map(); // name → { kind, bytes } waiting to be written
  let active = 0;
  const idle = [];

  async function put(name, job) {
    await ready;
    const key = keyFor(seq, name, job.kind);
    try {
      await target.put(key, job.bytes);
      // A state supersedes an older marker of the same sequence, and vice versa.
      const other = keyFor(seq, name, job.kind === 'ystate' ? 'gone' : 'ystate');
      await target.remove(other).catch(() => {});
      if (failures > 0)
        log.log?.(`[docs-tail] write-behind recovered after ${failures} failure(s)`);
      failures = 0;
    } catch (err) {
      failures += 1;
      log.error?.(
        `[docs-tail] write-behind FAILED for a document (${failures} consecutive): ${err.message}. ` +
          'Until it lands, a crash of this hub returns that document to the last backup generation.'
      );
    }
  }
  function pump() {
    while (active < concurrency && latest.size) {
      const [name, job] = latest.entries().next().value;
      latest.delete(name);
      active += 1;
      void put(name, job).finally(() => {
        active -= 1;
        if (!latest.size && active === 0) for (const r of idle.splice(0)) r();
        pump();
      });
    }
  }
  const enqueue = (name, job) => {
    if (name === CTL_DOC || !writing()) return;
    latest.set(name, job);
    pump();
  };

  return {
    enabled: true,
    ready: () => ready,
    /** onStoreDocument: the document's full state. */
    store(name, document) {
      enqueue(name, { kind: 'ystate', bytes: Buffer.from(Y.encodeStateAsUpdate(document)) });
    },
    /** A deleted document: a marker, so a wake does not bring it back. */
    remove(name) {
      enqueue(name, { kind: 'gone', bytes: Buffer.from(JSON.stringify({ at: Date.now() })) });
    },
    /** A backup generation is about to snapshot hub.db: new writes go to a new sequence. */
    async beginGeneration() {
      await ready;
      const covered = seq;
      seq += 1;
      return covered;
    },
    /** The generation is written: every sequence up to `covered` is inside it. */
    async endGeneration(covered) {
      if (covered === null || covered === undefined) return;
      try {
        for (const o of await target.list(DOCS_TAIL_PREFIX)) {
          const k = parseDocsTailKey(o.key);
          if (k && k.seq <= covered) await target.remove(o.key);
        }
      } catch (err) {
        log.error?.(
          `[docs-tail] rotation failed (${err.message}) — the next wake replays a longer tail`
        );
      }
    },
    /** Wait for every queued write (SIGTERM, tests). */
    async flush() {
      if (!latest.size && active === 0) return;
      await new Promise((r) => idle.push(r));
    },
    failures: () => failures,
  };
}

/**
 * Replay the tail into a just-restored `hub.db` (rehydrate, before the hub
 * starts). `db` is a better-sqlite3 handle on hub.db. Returns counts.
 */
export async function replayDocsTail({ target, db, dataDir, log = console }) {
  if (!target) return { state: 'empty' };
  let objects;
  try {
    objects = await target.list(DOCS_TAIL_PREFIX);
  } catch (err) {
    log.error?.(
      `[docs-tail] tail unreadable at wake (${err.message}) — documents stay at the generation`
    );
    return { state: 'unreadable', reason: err.message };
  }
  const events = objects
    .map((o) => ({ key: o.key, ...parseDocsTailKey(o.key) }))
    .filter((e) => e.name)
    .sort((a, b) => a.seq - b.seq || a.key.localeCompare(b.key));
  if (!events.length) return { state: 'empty' };
  db.exec(
    'CREATE TABLE IF NOT EXISTS "documents" ("name" varchar(255) NOT NULL, "data" blob NOT NULL, UNIQUE(name))'
  );
  const read = db.prepare('SELECT data FROM "documents" WHERE name = ?');
  const write = db.prepare(
    'INSERT INTO "documents" (name, data) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET data = excluded.data'
  );
  const drop = db.prepare('DELETE FROM "documents" WHERE name = ?');
  let merged = 0;
  let deleted = 0;
  let failed = 0;
  for (const e of events) {
    try {
      if (e.kind === 'gone') {
        drop.run(e.name);
        recordTombstone(dataDir, e.name);
        deleted += 1;
        continue;
      }
      const body = await target.get(e.key);
      if (!body) continue;
      const row = read.get(e.name);
      const next = row?.data
        ? Y.mergeUpdates([new Uint8Array(row.data), new Uint8Array(body)])
        : new Uint8Array(body);
      write.run(e.name, Buffer.from(next));
      clearTombstone(dataDir, e.name);
      merged += 1;
    } catch (err) {
      failed += 1;
      log.error?.(`[docs-tail] could not replay ${e.key}: ${err.message}`);
    }
  }
  log.log?.(
    `[docs-tail] replayed ${merged} document state(s), ${deleted} deletion(s) over the restored generation`
  );
  return { state: 'replayed', merged, deleted, failed };
}
