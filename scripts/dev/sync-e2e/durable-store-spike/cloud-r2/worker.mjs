// Isolated T8 DO/R2 experiment. No production routing, source/effect kernel or renderer.
import { DurableObject } from 'cloudflare:workers';
import { decide, INITIAL_HASH } from '../conformance/storage-policy.mjs';
import { validator } from './validator.mjs';

const encode = (value) => new TextEncoder().encode(value);
const sha = async (bytes) =>
  [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
function check(value, reason) {
  if (!value) throw new Error(reason);
}
const DDL = `
CREATE TABLE IF NOT EXISTS head(id INTEGER PRIMARY KEY CHECK(id=1),project TEXT NOT NULL,epoch INTEGER NOT NULL,revision INTEGER NOT NULL,manifest TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS results(actor TEXT,tx TEXT,hash TEXT,result TEXT,PRIMARY KEY(actor,tx));
CREATE TABLE IF NOT EXISTS actions(revision INTEGER PRIMARY KEY,actor TEXT,tx TEXT,proposalHash TEXT,bodyHash TEXT,result TEXT);
CREATE TABLE IF NOT EXISTS documents(id TEXT PRIMARY KEY,hash TEXT,size INTEGER,revision INTEGER);
CREATE INDEX IF NOT EXISTS document_hash ON documents(hash);
CREATE TABLE IF NOT EXISTS payloads(kind TEXT,hash TEXT,body BLOB,size INTEGER,PRIMARY KEY(kind,hash));
CREATE TABLE IF NOT EXISTS archived(kind TEXT,hash TEXT,size INTEGER,PRIMARY KEY(kind,hash));
CREATE TABLE IF NOT EXISTS payload_usage(id INTEGER PRIMARY KEY CHECK(id=1),bytes INTEGER NOT NULL);
INSERT OR IGNORE INTO payload_usage VALUES(1,0);
CREATE TABLE IF NOT EXISTS members(actor TEXT PRIMARY KEY,allowed INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS snapshots(id INTEGER PRIMARY KEY CHECK(id=1),hash TEXT,revision INTEGER,epoch INTEGER);
CREATE TABLE IF NOT EXISTS control(id INTEGER PRIMARY KEY CHECK(id=1),draining INTEGER NOT NULL);
INSERT OR IGNORE INTO control VALUES(1,0);
INSERT OR IGNORE INTO members VALUES ('actor',1),('peer',1);
`;
export class R2ProjectProbe extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(DDL);
  }
  current(project) {
    this.sql.exec('INSERT OR IGNORE INTO head VALUES(1,?,1,0,?)', project, INITIAL_HASH);
    const value = this.sql.exec('SELECT project,epoch,revision,manifest FROM head').one();
    check(value.project === project, 'project-routing-mismatch');
    return value;
  }
  allowed(actor) {
    return (
      this.sql.exec('SELECT allowed FROM members WHERE actor=?', actor).toArray()[0]?.allowed === 1
    );
  }
  old(actor, tx) {
    return this.sql
      .exec('SELECT hash,result FROM results WHERE actor=? AND tx=?', actor, tx)
      .toArray()[0];
  }
  draining() {
    return this.sql.exec('SELECT draining FROM control WHERE id=1').one().draining === 1;
  }
  async checkpoint(stage, command) {
    if (command.pause === stage && this.env.CHECKPOINT)
      await this.env.CHECKPOINT.fetch('http://checkpoint/' + stage, {
        method: 'POST',
        body: JSON.stringify({ project: command.project, tx: command.p?.transactionId }),
      });
  }
  key(project, kind, hash) {
    check(/^[a-f0-9]{64}$/.test(hash), 'invalid-reference');
    return `${this.env.PROBE_PREFIX}/${project}/${kind}/${hash}`;
  }
  async readBytes(project, kind, hash) {
    const object = await this.env.PAYLOADS.get(this.key(project, kind, hash));
    check(object && object.size <= 1048576, 'missing-or-oversized-object');
    const bytes = new Uint8Array(await object.arrayBuffer());
    check((await sha(bytes)) === hash, 'object-digest-mismatch');
    return bytes;
  }
  async immutable(project, kind, bytes) {
    check(bytes.length <= 1048576, 'object-capacity');
    const hash = await sha(bytes);
    const key = this.key(project, kind, hash);
    try {
      const object = await this.env.PAYLOADS.put(key, bytes, {
        onlyIf: new Headers({ 'If-None-Match': '*' }),
        sha256: hash,
      });
      if (object) return hash;
    } catch {
      /* Resolve a possibly successful write using its exact content address. */
    }
    await this.readBytes(project, kind, hash);
    return hash;
  }
  async inlineBytes(kind, hash) {
    const row = this.sql
      .exec('SELECT body,size FROM payloads WHERE kind=? AND hash=?', kind, hash)
      .toArray()[0];
    check(row, 'missing-inline-payload');
    const bytes = new Uint8Array(row.body);
    check(bytes.length === row.size && (await sha(bytes)) === hash, 'inline-digest-mismatch');
    return bytes;
  }
  async payloadBytes(project, kind, hash) {
    const live = this.sql
      .exec('SELECT 1 FROM payloads WHERE kind=? AND hash=?', kind, hash)
      .toArray()[0];
    if (live) return this.inlineBytes(kind, hash);
    const archived = this.sql
      .exec('SELECT size FROM archived WHERE kind=? AND hash=?', kind, hash)
      .toArray()[0];
    check(archived, 'missing-payload-reference');
    const bytes = await this.readBytes(project, kind, hash);
    check(bytes.length === archived.size, 'archive-length-mismatch');
    return bytes;
  }
  async archive(command) {
    const base = this.current(command.project);
    if (base.epoch !== command.ownerEpoch) return { status: 'retryable', code: 'owner-fenced' };
    // Capture a bounded immutable batch before any await. Current documents stay inline.
    const candidates = this.sql
      .exec(`SELECT p.kind,p.hash,p.size FROM payloads p
      WHERE NOT EXISTS(SELECT 1 FROM archived a WHERE a.kind=p.kind AND a.hash=p.hash)
         OR (p.kind='documents' AND NOT EXISTS(SELECT 1 FROM documents d WHERE d.hash=p.hash))
      ORDER BY p.kind,p.hash LIMIT 16`)
      .toArray();
    const batch = [];
    let bytes = 0;
    for (const row of candidates) {
      if (bytes + row.size > 1048576) break;
      const body = this.sql
        .exec('SELECT body FROM payloads WHERE kind=? AND hash=?', row.kind, row.hash)
        .one().body;
      batch.push({ ...row, body });
      bytes += row.size;
    }
    await this.checkpoint('archive-before-r2', command);
    for (const row of batch) {
      const body = new Uint8Array(row.body);
      check(body.length === row.size && (await sha(body)) === row.hash, 'inline-digest-mismatch');
      check(
        (await this.immutable(command.project, row.kind, body)) === row.hash,
        'archive-hash-mismatch'
      );
      const verified = await this.readBytes(command.project, row.kind, row.hash);
      check(verified.length === row.size, 'archive-length-mismatch');
    }
    await this.checkpoint('archive-after-r2', command);
    const result = this.ctx.storage.transactionSync(() => {
      if (this.draining()) return { status: 'retryable', code: 'draining' };
      if (!this.allowed(command.actor)) return { status: 'forbidden' };
      if (this.current(command.project).epoch !== command.ownerEpoch)
        return { status: 'retryable', code: 'owner-fenced' };
      let removed = 0;
      for (const row of batch) {
        this.sql.exec('INSERT OR IGNORE INTO archived VALUES(?,?,?)', row.kind, row.hash, row.size);
        const current =
          row.kind === 'documents' &&
          this.sql.exec('SELECT 1 FROM documents WHERE hash=? LIMIT 1', row.hash).toArray()[0];
        if (!current) {
          const live = this.sql
            .exec('SELECT size FROM payloads WHERE kind=? AND hash=?', row.kind, row.hash)
            .toArray()[0];
          if (live) {
            this.sql.exec('DELETE FROM payloads WHERE kind=? AND hash=?', row.kind, row.hash);
            removed += live.size;
          }
        }
      }
      this.sql.exec('UPDATE payload_usage SET bytes=bytes-? WHERE id=1', removed);
      if (command.fault === 'archive-after-prune') throw new Error('injected-rollback');
      return { status: 'archived', selected: batch.length, bytes, removed };
    });
    await this.ctx.storage.sync();
    await this.checkpoint('archive-after-commit', command);
    return result;
  }
  async history(command) {
    check(Number.isSafeInteger(command.revision) && command.revision > 0, 'invalid-revision');
    const action = this.sql
      .exec('SELECT * FROM actions WHERE revision=?', command.revision)
      .toArray()[0];
    if (!action) return null;
    const proposal = await this.payloadBytes(command.project, 'proposals', action.proposalHash);
    const body = await this.payloadBytes(command.project, 'documents', action.bodyHash);
    if (!this.allowed(command.actor)) return { status: 'forbidden' };
    return {
      ...action,
      proposal: new TextDecoder().decode(proposal),
      value: JSON.parse(new TextDecoder().decode(body)),
    };
  }
  commit(command, refs) {
    return this.ctx.storage.transactionSync(() => {
      if (this.draining()) return { status: 'retryable', code: 'draining' };
      const { project, actor, p, hash, ownerEpoch } = command;
      const current = this.current(project);
      if (!this.allowed(actor)) return { status: 'forbidden' };
      const choice = decide(current, this.old(actor, p.transactionId), command);
      if (choice.retained) return choice.result;
      if (current.epoch !== ownerEpoch) return { status: 'retryable', code: 'owner-fenced' };
      const result = choice.result;
      if (result.status === 'accepted') {
        if (!refs) return { status: 'retryable', code: 'payload-unresolved' };
        const pending = [];
        for (const [kind, digest, bytes] of [
          ['documents', refs.bodyHash, refs.body],
          ['proposals', hash, encode(command.raw)],
        ]) {
          const old = this.sql
            .exec('SELECT body,size FROM payloads WHERE kind=? AND hash=?', kind, digest)
            .toArray()[0];
          if (old) {
            const stored = new Uint8Array(old.body);
            check(
              stored.length === bytes.length &&
                stored.every((value, index) => value === bytes[index]),
              'inline-collision'
            );
          } else pending.push({ kind, digest, bytes });
        }
        const added = pending.reduce((sum, item) => sum + item.bytes.length, 0);
        const used = this.sql.exec('SELECT bytes FROM payload_usage WHERE id=1').one().bytes;
        const limit = Number(this.env.INLINE_LIMIT_BYTES || 33554432);
        check(
          Number.isSafeInteger(limit) && limit > 0 && limit <= 67108864,
          'invalid-inline-limit'
        );
        if (used + added > limit) return { status: 'retryable', code: 'inline-capacity' };
        for (const item of pending)
          this.sql.exec(
            'INSERT INTO payloads VALUES(?,?,?,?)',
            item.kind,
            item.digest,
            item.bytes.buffer,
            item.bytes.length
          );
        this.sql.exec('UPDATE payload_usage SET bytes=bytes+? WHERE id=1', added);
        if (command.fault === 'after-payload') throw new Error('injected-rollback');
        this.sql.exec(
          'INSERT INTO actions VALUES (?,?,?,?,?,?)',
          result.revision,
          actor,
          p.transactionId,
          hash,
          refs.bodyHash,
          JSON.stringify(result)
        );
        if (command.fault === 'after-action') throw new Error('injected-rollback');
        this.sql.exec(
          'UPDATE head SET revision=?,manifest=? WHERE id=1',
          result.revision,
          result.manifestHash
        );
        const op = p.action.operations[0];
        this.sql.exec(
          'INSERT INTO documents VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET hash=excluded.hash,size=excluded.size,revision=excluded.revision',
          JSON.stringify([op.documentId, op.generation]),
          refs.bodyHash,
          refs.size,
          result.revision
        );
        if (command.fault === 'after-head') throw new Error('injected-rollback');
      }
      this.sql.exec(
        'INSERT INTO results VALUES(?,?,?,?)',
        actor,
        p.transactionId,
        hash,
        JSON.stringify(result)
      );
      if (command.fault === 'after-result') throw new Error('injected-rollback');
      return result;
    });
  }
  async append(command) {
    const current = this.current(command.project);
    if (!this.allowed(command.actor)) return { status: 'forbidden' };
    const choice = decide(current, this.old(command.actor, command.p.transactionId), command);
    if (choice.retained) return choice.result;
    if (current.epoch !== command.ownerEpoch) return { status: 'retryable', code: 'owner-fenced' };
    let refs = null;
    if (choice.result.status === 'accepted') {
      await this.checkpoint('before-prepare', command);
      const body = encode(JSON.stringify(command.p.action.operations[0].value));
      const bodyHash = await sha(body);
      await this.checkpoint('before-commit', command);
      refs = { bodyHash, size: body.length, body };
    }
    const result = this.commit(command, refs);
    await this.ctx.storage.sync();
    await this.checkpoint('after-commit', command);
    return result;
  }
  async snapshot(command) {
    const base = this.current(command.project);
    if (base.epoch !== command.ownerEpoch) return { status: 'retryable', code: 'owner-fenced' };
    const count = this.sql.exec('SELECT COUNT(*) n FROM documents').one().n;
    if (count > 4096) return { status: 'retryable', code: 'snapshot-capacity' };
    // Capture all bounded metadata synchronously; no cursor crosses an await.
    const documents = this.sql.exec('SELECT * FROM documents ORDER BY id').toArray();
    await this.checkpoint('snapshot-before-r2', command);
    for (const ref of documents) {
      const body = await this.payloadBytes(command.project, 'documents', ref.hash);
      check(body.length === ref.size, 'inline-length-mismatch');
      await this.immutable(command.project, 'documents', body);
    }
    const pages = [];
    for (let index = 0; index < documents.length; index += 64) {
      pages.push(
        await this.immutable(
          command.project,
          'snapshot-pages',
          encode(
            JSON.stringify({
              version: 1,
              project: command.project,
              rows: documents.slice(index, index + 64),
            })
          )
        )
      );
    }
    const root = { version: 1, ...base, count, pages };
    const hash = await this.immutable(command.project, 'snapshots', encode(JSON.stringify(root)));
    await this.checkpoint('snapshot-after-r2', command);
    const result = this.ctx.storage.transactionSync(() => {
      if (this.draining()) return { status: 'retryable', code: 'draining' };
      if (!this.allowed(command.actor)) return { status: 'forbidden' };
      const current = this.current(command.project);
      if (current.epoch !== command.ownerEpoch)
        return { status: 'retryable', code: 'owner-fenced' };
      // The immutable capture is valid even when newer edits have arrived.
      // Retained actions bridge its revision to head; never roll the pointer backwards.
      const previous = this.sql.exec('SELECT revision FROM snapshots WHERE id=1').toArray()[0];
      if (previous && previous.revision > base.revision)
        return { status: 'retryable', code: 'snapshot-superseded' };
      this.sql.exec(
        'INSERT INTO snapshots VALUES(1,?,?,?) ON CONFLICT(id) DO UPDATE SET hash=excluded.hash,revision=excluded.revision,epoch=excluded.epoch',
        hash,
        base.revision,
        base.epoch
      );
      return { status: 'snapshot', hash, revision: base.revision, epoch: base.epoch };
    });
    await this.ctx.storage.sync();
    await this.checkpoint('snapshot-after-commit', command);
    return result;
  }
  async snapshotRead(command) {
    const selected = this.sql
      .exec('SELECT hash,revision,epoch FROM snapshots WHERE id=1')
      .toArray()[0];
    if (!selected) return null;
    if (command.hash && command.hash !== selected.hash)
      return { status: 'retryable', code: 'snapshot-changed' };
    const root = JSON.parse(
      new TextDecoder().decode(await this.readBytes(command.project, 'snapshots', selected.hash))
    );
    check(
      root.version === 1 &&
        root.project === command.project &&
        root.revision === selected.revision &&
        root.epoch === selected.epoch &&
        Number.isSafeInteger(root.count) &&
        root.count >= 0 &&
        root.count <= 4096 &&
        Array.isArray(root.pages) &&
        root.pages.length <= 64 &&
        root.pages.every((p) => /^[a-f0-9]{64}$/.test(p)),
      'snapshot-integrity'
    );
    if (!this.allowed(command.actor)) return { status: 'forbidden' };
    if (command.page === undefined) return { ...selected, root };
    check(
      Number.isInteger(command.page) && command.page >= 0 && command.page < root.pages.length,
      'invalid-snapshot-page'
    );
    const page = JSON.parse(
      new TextDecoder().decode(
        await this.readBytes(command.project, 'snapshot-pages', root.pages[command.page])
      )
    );
    check(
      page.version === 1 &&
        page.project === command.project &&
        Array.isArray(page.rows) &&
        page.rows.length <= 64,
      'snapshot-integrity'
    );
    const rows = [];
    for (const ref of page.rows) {
      check(
        typeof ref.id === 'string' &&
          /^[a-f0-9]{64}$/.test(ref.hash) &&
          Number.isSafeInteger(ref.size) &&
          ref.size >= 0 &&
          ref.size <= 1048576 &&
          Number.isSafeInteger(ref.revision) &&
          ref.revision > 0 &&
          ref.revision <= root.revision,
        'snapshot-integrity'
      );
      rows.push(ref);
    }
    if (!this.allowed(command.actor)) return { status: 'forbidden' };
    if (command.document !== undefined) {
      const ref = rows.find((row) => row.id === command.document);
      if (!ref) return null;
      const bytes = await this.readBytes(command.project, 'documents', ref.hash);
      check(bytes.length === ref.size, 'object-length-mismatch');
      if (!this.allowed(command.actor)) return { status: 'forbidden' };
      return {
        snapshotHash: selected.hash,
        snapshotRevision: root.revision,
        ...ref,
        value: JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)),
      };
    }
    return { hash: selected.hash, revision: root.revision, rows };
  }
  async execute(command) {
    const { project, kind, actor = 'actor' } = command;
    if (kind === 'cleanup') {
      check(
        this.env.PROBE_DISPOSABLE_ONLY === 'true' &&
          /^maude-sync-conformance\/[a-f0-9-]{36}$/.test(this.env.PROBE_PREFIX),
        'cleanup-disabled'
      );
      this.sql.exec('UPDATE control SET draining=1 WHERE id=1');
      await this.ctx.storage.sync();
      const prefix = `${this.env.PROBE_PREFIX}/${project}/`;
      const found = await this.env.PAYLOADS.list({ prefix, limit: 512 });
      check(
        !found.truncated && found.objects.every((object) => object.key.startsWith(prefix)),
        'cleanup-bound'
      );
      const keys = found.objects.map((object) => object.key);
      if (keys.length) await this.env.PAYLOADS.delete(keys);
      const remaining = await this.env.PAYLOADS.list({ prefix, limit: 1 });
      check(!remaining.objects.length && !remaining.truncated, 'cleanup-incomplete');
      this.ctx.storage.transactionSync(() => {
        this.sql.exec(
          'DELETE FROM head; DELETE FROM results; DELETE FROM actions; DELETE FROM documents; DELETE FROM snapshots; DELETE FROM members; DELETE FROM payloads; DELETE FROM archived; UPDATE payload_usage SET bytes=0 WHERE id=1;'
        );
      });
      await this.ctx.storage.sync();
      return { status: 'cleaned', objects: keys.length, remaining: 0 };
    }
    if (this.draining()) return { status: 'retryable', code: 'draining' };
    const current = this.current(project);
    if (kind === 'member') {
      this.sql.exec(
        'INSERT INTO members VALUES(?,?) ON CONFLICT(actor) DO UPDATE SET allowed=excluded.allowed',
        actor,
        command.allowed ? 1 : 0
      );
      await this.ctx.storage.sync();
      return { status: 'updated' };
    }
    if (!this.allowed(actor)) return { status: 'forbidden' };
    if (kind === 'head') return current;
    if (kind === 'archive') return this.archive(command);
    if (kind === 'history') return this.history(command);
    if (kind === 'snapshot') return this.snapshot(command);
    if (kind === 'snapshot-read') return this.snapshotRead(command);
    if (kind === 'epoch') {
      this.sql.exec('UPDATE head SET epoch=epoch+1 WHERE id=1');
      await this.ctx.storage.sync();
      return this.current(project);
    }
    if (kind === 'result') {
      const row = this.old(actor, command.tx);
      return row ? JSON.parse(row.result) : null;
    }
    if (kind === 'inventory')
      return {
        head: current,
        payloads: this.sql
          .exec('SELECT (SELECT COUNT(*) FROM payloads) count,bytes FROM payload_usage WHERE id=1')
          .one(),
        documents: this.sql
          .exec('SELECT * FROM documents WHERE id>? ORDER BY id LIMIT 32', command.after || '')
          .toArray(),
        counts: this.sql
          .exec(
            'SELECT (SELECT COUNT(*) FROM actions) actions,(SELECT COUNT(*) FROM results) results,(SELECT COUNT(*) FROM documents) documents'
          )
          .one(),
      };
    if (kind === 'document') {
      const ref = this.sql
        .exec('SELECT * FROM documents WHERE id=?', command.document)
        .toArray()[0];
      if (!ref) return null;
      const bytes = await this.inlineBytes('documents', ref.hash);
      check(bytes.length === ref.size, 'object-length-mismatch');
      if (!this.allowed(actor)) return { status: 'forbidden' };
      return { ...ref, value: JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) };
    }
    if (kind === 'append') return this.append(command);
    throw new Error('unknown-command');
  }
}

export default {
  async fetch(request, env) {
    if (!env.PROBE_TOKEN || request.headers.get('authorization') !== `Bearer ${env.PROBE_TOKEN}`)
      return new Response('Forbidden', { status: 403 });
    if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
    const chunks = [];
    let size = 0;
    for await (const chunk of request.body || []) {
      size += chunk.byteLength;
      if (size > 262144) return new Response('Too large', { status: 413 });
      chunks.push(chunk);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    try {
      const command = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
      if (
        command.kind !== 'cleanup' &&
        env.PROBE_EXPIRES_AT &&
        Date.now() >= Number(env.PROBE_EXPIRES_AT)
      )
        return new Response('Diagnostic expired', { status: 410 });
      if (command.kind === 'validate') {
        const result = validator.validate(command.schema, command.raw);
        return Response.json(result.ok ? { ok: true } : { ok: false, code: result.code });
      }
      check(/^[a-zA-Z0-9_-]{1,64}$/.test(command.project), 'invalid-project');
      check(typeof command.actor === 'string' && command.actor.length <= 256, 'invalid-actor');
      if (command.kind === 'append') {
        const parsed = validator.validate('proposal', command.raw);
        if (!parsed.ok) return Response.json({ status: 'invalid', code: parsed.code });
        if (parsed.data.projectId !== command.project)
          return Response.json({ status: 'forbidden' });
        if (
          parsed.data.dependsOn.length ||
          parsed.data.blobs.length ||
          parsed.data.action.operations.length !== 1 ||
          parsed.data.action.operations[0].kind !== 'source.text.assign'
        )
          return Response.json({ status: 'unsupported-fixture' });
        check(
          Number.isSafeInteger(command.ownerEpoch) && command.ownerEpoch > 0,
          'invalid-owner-epoch'
        );
        command.p = parsed.data;
        command.hash = await sha(parsed.bytes);
      }
      const started = performance.now();
      const result = await env.PROJECTS.getByName(command.project).execute(command);
      return Response.json(result, {
        headers: { 'server-timing': `coordinator;dur=${(performance.now() - started).toFixed(3)}` },
      });
    } catch (error) {
      const code = [
        'injected-rollback',
        'missing-or-oversized-object',
        'object-digest-mismatch',
      ].includes(error.message)
        ? error.message
        : 'probe-error';
      return Response.json({ status: 'retryable', code });
    }
  },
};
