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
  const core = createStoreCore(betterSqliteAdapter(db), { now });
  core.migrate();
  const store = { kind: 'sqlite', file, close: () => db.close() };
  for (const [name, fn] of Object.entries(core)) {
    if (name === 'migrate') continue;
    store[name] = async (...args) => fn(...args);
  }
  return store;
}
