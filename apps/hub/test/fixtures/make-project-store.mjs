#!/usr/bin/env node
// Build a project store of a realistic size and compressibility, in WAL like a
// live one, and print how many rows it holds.
//
//   node make-project-store.mjs <file> <megabytes>
//
// Its OWN process on purpose: building a few hundred MB allocates gigabytes of
// short-lived strings, and a test that then measures how long ITS event loop
// freezes during a backup must not be measuring that garbage being collected.

import { randomBytes } from 'node:crypto';
import { statSync } from 'node:fs';
import { createRequire } from 'node:module';

const Database = createRequire(import.meta.url)('better-sqlite3');
const [file, megabytes] = [process.argv[2], Number(process.argv[3] ?? 260)];
const db = new Database(file);
db.pragma('journal_mode = WAL');
db.exec('CREATE TABLE blobs (hash TEXT PRIMARY KEY, body TEXT NOT NULL, size INTEGER NOT NULL)');
const ins = db.prepare('INSERT INTO blobs VALUES (?, ?, ?)');
let rows = 0;
const fill = db.transaction((n) => {
  for (let i = 0; i < n; i++) {
    const b = `export default () => <div data-x="${randomBytes(6000).toString('base64')}">${'<p>seeded by a test</p>'.repeat(900)}</div>;`;
    ins.run(randomBytes(16).toString('hex'), b, b.length);
    rows += 1;
  }
});
while (statSync(file).size < megabytes * 1024 * 1024) fill(2000);
db.pragma('wal_checkpoint(TRUNCATE)');
db.close();
process.stdout.write(String(rows));
