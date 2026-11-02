// Self-host durable home for the accepted-revision store (DDR-241 §2).
//
// better-sqlite3 in the hub's persistent data directory. WAL + synchronous=FULL
// is the part that makes an acknowledgement mean something: FULL fsyncs the WAL
// on every commit, so a commit that returned survives a process kill and a
// power loss of the host's page cache. (NORMAL would only survive the former.)

import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

import Database from 'better-sqlite3';

import { createStoreCore } from './store-core.mjs';

export function projectStorePath(dataDir) {
  return join(dataDir, 'project-store.sqlite');
}

/** The synchronous `{exec, transaction}` interface over a better-sqlite3 handle. */
export function betterSqliteAdapter(db) {
  const cache = new Map();
  const statement = (query) => {
    let s = cache.get(query);
    if (!s) {
      s = db.prepare(query);
      cache.set(query, s);
    }
    return s;
  };
  return {
    exec(query, ...params) {
      const s = statement(query);
      return s.reader ? s.all(...params) : (s.run(...params), []);
    },
    transaction(fn) {
      return db.transaction(fn)();
    },
  };
}

/**
 * Open the store. The returned object has the store-core API with every method
 * returning a Promise, so a caller cannot tell it from the remote (cloud) store.
 */
export function openSqliteProjectStore(dataDir, { now } = {}) {
  const file = projectStorePath(dataDir);
  mkdirSync(dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = FULL');
  db.pragma('foreign_keys = ON');
  // Ballot secrecy (S4-S9-votes-comments.md §2.6): a deleted ballot must not
  // stay readable in the page's free space. secure_delete zeroes it in the
  // database file; the WAL still holds the frames that wrote it, so a vote's
  // end (explicit, or lazy inside any later call) also truncates the WAL once
  // its transaction has committed. Best effort: a reader holding the WAL open
  // makes the checkpoint a partial one, and the next end retries.
  db.pragma('secure_delete = ON');
  let purge = false;
  const core = createStoreCore(betterSqliteAdapter(db), {
    now,
    onBallotsDeleted: () => {
      purge = true;
    },
  });
  core.migrate();
  const purgeWal = () => {
    if (!purge || db.inTransaction) return;
    purge = false;
    try {
      db.pragma('wal_checkpoint(TRUNCATE)');
    } catch {
      /* a later end retries */
    }
  };
  const store = { kind: 'sqlite', file, close: () => db.close() };
  for (const [name, fn] of Object.entries(core)) {
    if (name === 'migrate') continue;
    store[name] = async (...args) => {
      try {
        return fn(...args);
      } finally {
        purgeWal();
      }
    };
  }
  return store;
}
