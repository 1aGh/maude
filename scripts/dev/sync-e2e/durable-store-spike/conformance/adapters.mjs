import { createHash } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createContractValidator } from '../../contracts/validate.mjs';
import { append, DDL, ensure, head, lookup, state } from './storage-policy.mjs';

let repo = process.env.MAUDE_REPO || process.cwd();
while (!existsSync(join(repo, 'apps/hub/package.json'))) {
  const parent = dirname(repo);
  if (parent === repo) throw new Error('Set MAUDE_REPO');
  repo = parent;
}
const require = createRequire(join(repo, 'package.json'));
const hubRequire = createRequire(join(repo, 'apps/hub/package.json'));
export const validator = createContractValidator(require('ajv/dist/2020').default);
export const sha = (raw) => createHash('sha256').update(raw).digest('hex');
function boundary(call) {
  return {
    head: (project) => call({ kind: 'head', project }),
    state: (project) => call({ kind: 'state', project }),
    epoch: (project) => call({ kind: 'epoch', project }),
    result: (project, actor, tx, authorized = true) =>
      authorized
        ? call({ kind: 'result', project, actor, tx })
        : Promise.resolve({ status: 'forbidden' }),
    append: async (project, actor, raw, { fault, authorized = true } = {}) => {
      if (!authorized) return { status: 'forbidden' };
      const valid = validator.validate('proposal', raw);
      if (!valid.ok) return { status: 'invalid', code: valid.code };
      if (valid.data.projectId !== project) return { status: 'forbidden' };
      // Storage-only corpus uses one strict source.text.assign fixture family.
      if (
        valid.data.action.operations.length !== 1 ||
        valid.data.action.operations[0].kind !== 'source.text.assign'
      )
        return { status: 'unsupported' };
      return call({ kind: 'append', project, actor, raw, p: valid.data, hash: sha(raw), fault });
    },
  };
}
export async function sqliteAdapter(directory) {
  mkdirSync(directory, { recursive: true });
  const Database = hubRequire('better-sqlite3');
  const sql = new Database(join(directory, 'accepted.sqlite'));
  sql.pragma('journal_mode=WAL');
  sql.pragma('synchronous=FULL');
  sql.exec(DDL);
  const db = {
    exec: (query, ...args) => {
      const p = sql.prepare(query);
      return p.reader ? p.all(...args) : (p.run(...args), []);
    },
  };
  const call = async (command) => {
    sql.exec('BEGIN IMMEDIATE');
    try {
      const { project, actor, kind } = command;
      ensure(db, project);
      let result;
      if (kind === 'head') result = head(db, project);
      else if (kind === 'state') result = state(db, project);
      else if (kind === 'result') result = lookup(db, project, actor, command.tx);
      else if (kind === 'epoch') {
        db.exec('UPDATE heads SET epoch=epoch+1 WHERE project=?', project);
        result = head(db, project);
      } else result = append(db, command, command.fault);
      sql.exec('COMMIT');
      return result;
    } catch (error) {
      if (sql.inTransaction) sql.exec('ROLLBACK');
      if (error.message === 'injected-rollback')
        return { status: 'retryable', code: error.message };
      throw error;
    }
  };
  return {
    ...boundary(call),
    close: async () => sql.close(),
    versions: {
      sqlite: sql.prepare('SELECT sqlite_version() v').get().v,
      binding: hubRequire('better-sqlite3/package.json').version,
    },
  };
}
export async function cloudAdapter(directory) {
  const entry = process.env.MAUDE_MINIFLARE_ENTRY;
  if (!entry) throw new Error('Set MAUDE_MINIFLARE_ENTRY');
  const { Miniflare, convertV4MiniflareOptions } = require(entry);
  const options = convertV4MiniflareOptions({
    modules: true,
    modulesRoot: fileURLToPath(new URL('.', import.meta.url)),
    scriptPath: fileURLToPath(new URL('./dist/cloud-worker.mjs', import.meta.url)),
    compatibilityDate: '2026-07-01',
    durableObjects: { PROJECTS: { className: 'ProjectStoreProbe', useSQLite: true } },
    host: '127.0.0.1',
    port: 0,
  });
  const mf = new Miniflare({
    ...options,
    resourcePersistencePath: directory,
    telemetry: { enabled: false },
  });
  try {
    await mf.ready;
  } catch (error) {
    await mf.dispose();
    throw error;
  }
  const call = async (command) => {
    const response = await mf.dispatchFetch('http://localhost/command', {
      method: 'POST',
      body: JSON.stringify(command),
    });
    if (!response.ok) throw new Error(await response.text());
    return response.json();
  };
  const dependency = createRequire(entry);
  return {
    ...boundary(call),
    close: () => mf.dispose(),
    versions: {
      miniflare: dependency('../../package.json').version,
      workerd: dependency('workerd/package.json').version,
    },
  };
}
