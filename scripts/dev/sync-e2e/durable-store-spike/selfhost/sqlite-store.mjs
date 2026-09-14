// T8 isolated experiment. Not the production adapter or accepted T9 contract.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve, sep } from 'node:path';

function resolveRepo() {
  let current = resolve(process.env.MAUDE_REPO || process.cwd());
  for (;;) {
    if (existsSync(join(current, 'apps/hub/package.json'))) return current;
    const parent = dirname(current);
    if (parent === current || process.env.MAUDE_REPO)
      throw new Error('Set MAUDE_REPO to the Maude checkout with installed hub dependencies');
    current = parent;
  }
}
const require = createRequire(join(resolveRepo(), 'apps/hub/package.json'));
const Database = require('better-sqlite3');
export const dependencyVersion = require('better-sqlite3/package.json').version;
export const MAX_PAYLOAD_BYTES = 2 * 1024 * 1024;
export const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
export class Store {
  constructor(directory, { timeout = 1000 } = {}) {
    mkdirSync(directory, { recursive: true });
    this.db = new Database(join(directory, 'accepted.sqlite'), { timeout });
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = FULL');
    this.db.pragma('foreign_keys = ON');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS projects(project TEXT PRIMARY KEY, epoch INTEGER NOT NULL,
        owner TEXT NOT NULL, head INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS actions(project TEXT NOT NULL, revision INTEGER NOT NULL,
        epoch INTEGER NOT NULL, actor TEXT NOT NULL, txid TEXT NOT NULL, payload_hash TEXT NOT NULL, payload BLOB NOT NULL,
        PRIMARY KEY(project, revision), UNIQUE(project, actor, txid),
        FOREIGN KEY(project) REFERENCES projects(project));
      CREATE TABLE IF NOT EXISTS results(project TEXT NOT NULL, actor TEXT NOT NULL, txid TEXT NOT NULL,
        revision INTEGER NOT NULL, payload_hash TEXT NOT NULL, result TEXT NOT NULL,
        PRIMARY KEY(project, actor, txid), FOREIGN KEY(project, revision) REFERENCES actions(project, revision));
    `);
  }
  transaction(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const value = fn();
      this.db.exec('COMMIT');
      return value;
    } catch (error) {
      if (this.db.inTransaction) this.db.exec('ROLLBACK');
      throw error;
    }
  }
  acquire(project, owner) {
    return this.transaction(() => {
      this.db
        .prepare(`INSERT INTO projects VALUES (?, 0, '', 0) ON CONFLICT DO NOTHING`)
        .run(project);
      this.db
        .prepare('UPDATE projects SET epoch = epoch + 1, owner = ? WHERE project = ?')
        .run(owner, project);
      return this.head(project);
    });
  }
  head(project) {
    return this.db.prepare('SELECT * FROM projects WHERE project = ?').get(project);
  }
  result(project, actor, txid) {
    const row = this.db
      .prepare('SELECT result FROM results WHERE project = ? AND actor = ? AND txid = ?')
      .get(project, actor, txid);
    return row ? JSON.parse(row.result) : null;
  }
  append({ project, actor, owner, epoch, txid, base, payload }, checkpoint = () => {}) {
    if (typeof actor !== 'string' || !actor) throw new Error('missing-authenticated-actor');
    if (!Buffer.isBuffer(payload)) throw new Error('payload-must-be-bytes');
    if (payload.byteLength > MAX_PAYLOAD_BYTES) throw new Error('capacity');
    const action = JSON.parse(payload.toString());
    if (!Array.isArray(action.files) || action.files.length > 1000)
      throw new Error('invalid-probe-action');
    for (const file of action.files) {
      if (
        typeof file.path !== 'string' ||
        !/^[a-zA-Z0-9._/-]+$/.test(file.path) ||
        file.path.startsWith('/') ||
        file.path.split('/').some((p) => !p || p === '.' || p === '..') ||
        typeof file.content !== 'string'
      )
        throw new Error('invalid-probe-file');
    }
    const payloadHash = hash(payload);
    const accepted = this.transaction(() => {
      const current = this.head(project);
      if (!current || current.epoch !== epoch || current.owner !== owner)
        throw new Error('epoch-stale');
      const previous = this.result(project, actor, txid);
      if (previous) {
        if (previous.payloadHash !== payloadHash) throw new Error('transaction-id-reused');
        return previous;
      }
      if (current.head !== base) throw new Error('base-conflict');
      const revision = current.head + 1;
      const result = { project, actor, txid, epoch, revision, payloadHash, status: 'accepted' };
      this.db
        .prepare('INSERT INTO actions VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(project, revision, epoch, actor, txid, payloadHash, payload);
      checkpoint('after-action');
      this.db
        .prepare('INSERT INTO results VALUES (?, ?, ?, ?, ?, ?)')
        .run(project, actor, txid, revision, payloadHash, JSON.stringify(result));
      checkpoint('after-result');
      const changed = this.db
        .prepare(
          'UPDATE projects SET head = ? WHERE project = ? AND epoch = ? AND owner = ? AND head = ?'
        )
        .run(revision, project, epoch, owner, base).changes;
      if (changed !== 1) throw new Error('fence-or-head-conflict');
      checkpoint('before-commit');
      return result;
    });
    checkpoint('after-commit');
    return accepted;
  }
  // Consistent point-in-time ordered read. No checkpoint files are trusted.
  replay(project) {
    return this.transaction(() => {
      const head = this.head(project);
      const records = this.db
        .prepare('SELECT * FROM actions WHERE project = ? ORDER BY revision')
        .all(project);
      if (records.length !== head.head) throw new Error('replay-gap');
      const files = new Map();
      for (let i = 0; i < records.length; i++) {
        const record = records[i];
        if (record.revision !== i + 1 || hash(record.payload) !== record.payload_hash)
          throw new Error('replay-integrity');
        if (!this.result(project, record.actor, record.txid)) throw new Error('missing-result');
        for (const file of JSON.parse(record.payload.toString()).files)
          files.set(file.path, file.content);
      }
      return { head, records, files };
    });
  }
  projectEmpty(project, checkout) {
    const replay = this.replay(project);
    const root = resolve(checkout);
    for (const [path, content] of replay.files) {
      const target = resolve(root, path);
      if (!target.startsWith(root + sep)) throw new Error('projection-escape');
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target + '.partial', content);
      renameSync(target + '.partial', target);
    }
    return replay.head;
  }
  close() {
    this.db.close();
  }
}
