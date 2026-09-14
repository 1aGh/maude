// T8 candidate only. Object storage is the commit authority; no product imports this.

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import Ajv2020 from 'ajv/dist/2020.js';
import { getObjectVersion, putObjectConditional } from '../../../../../apps/hub/src/s3.mjs';
import { createContractValidator } from '../../contracts/validate.mjs';
import { decide, INITIAL_HASH } from '../conformance/storage-policy.mjs';

const validator = createContractValidator(Ajv2020);

export { sha } from './hash.mjs';

import { DocumentIndex } from './document-index.mjs';
import { sha } from './hash.mjs';
import { ReceiptIndex } from './snapshot-index.mjs';

const encoded = (value) => Buffer.from(JSON.stringify(value));
const digest = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const positive = (value) => Number.isSafeInteger(value) && value > 0;
function invariant(condition, message) {
  if (!condition) throw new Error(`journal-integrity: ${message}`);
}
function exact(value, fields) {
  return (
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).sort().join(',') === [...fields].sort().join(',')
  );
}

export class ObjectJournal {
  constructor({
    cfg,
    prefix,
    project,
    ownerEpoch = 1,
    maxEntries = 128,
    maxReplayBytes = 8 * 1024 * 1024,
    ioTimeoutMs = 10000,
    checkpoint = async () => {},
    cacheBytes = 8 * 1024 * 1024,
  }) {
    if (
      !/^[a-zA-Z0-9/_-]{1,160}$/.test(prefix) ||
      prefix.includes('//') ||
      typeof project !== 'string' ||
      !project ||
      project.length > 256 ||
      !positive(ownerEpoch) ||
      !positive(maxEntries) ||
      maxEntries > 1024 ||
      !positive(maxReplayBytes) ||
      maxReplayBytes > 64 * 1024 * 1024 ||
      !positive(ioTimeoutMs) ||
      ioTimeoutMs > 10000
    )
      throw new TypeError('invalid-journal-options');
    if (!Number.isSafeInteger(cacheBytes) || cacheBytes < 0 || cacheBytes > 64 * 1024 * 1024)
      throw new TypeError('invalid-cache-bound');
    this.historyKey = randomBytes(32);
    this.cacheLimit = cacheBytes;
    this.cacheSize = 0;
    this.cache = new Map();
    this.cfg = cfg;
    this.project = project;
    this.ownerEpoch = ownerEpoch;
    this.base = `${prefix}/${sha(project)}`;
    this.headKey = `${this.base}/head`;
    this.maxEntries = maxEntries;
    this.maxReplayBytes = maxReplayBytes;
    this.ioTimeoutMs = ioTimeoutMs;
    this.checkpoint = checkpoint;
  }
  initial() {
    return {
      version: 2,
      project: this.project,
      epoch: 1,
      revision: 0,
      manifest: INITIAL_HASH,
      sequence: 0,
      tail: null,
      snapshot: null,
    };
  }
  io() {
    return { signal: AbortSignal.timeout(this.ioTimeoutMs) };
  }
  get(key) {
    return getObjectVersion(this.cfg, key, this.io());
  }
  put(key, bytes, condition) {
    return putObjectConditional(this.cfg, key, bytes, condition, this.io());
  }
  entryKey(hash) {
    invariant(digest(hash), 'invalid entry hash');
    return `${this.base}/entries/${hash}`;
  }
  async initialize() {
    const current = await this.get(this.headKey);
    if (!current) {
      // Unknown initialization ACK is resolved by reading, never by an unconditional retry.
      try {
        await this.put(this.headKey, encoded(this.initial()), { ifNoneMatch: '*' });
      } catch {
        /* read below either proves a complete root or fails */
      }
    }
    return this.read({ materialize: false });
  }
  clearCache() {
    this.cache.clear();
    this.cacheSize = 0;
  }
  remember(key, bytes) {
    if (bytes.length > this.cacheLimit) return;
    const old = this.cache.get(key);
    if (old) this.cacheSize -= old.length;
    this.cache.delete(key);
    while (this.cacheSize + bytes.length > this.cacheLimit) {
      const first = this.cache.keys().next().value;
      this.cacheSize -= this.cache.get(first).length;
      this.cache.delete(first);
    }
    this.cache.set(key, Buffer.from(bytes));
    this.cacheSize += bytes.length;
  }
  immutableKey(kind, hash) {
    invariant(
      ['entries', 'snapshots', 'indexes', 'documents', 'document-indexes'].includes(kind) &&
        digest(hash),
      'invalid immutable reference'
    );
    return `${this.base}/${kind}/${hash}`;
  }
  async readImmutable(kind, hash) {
    const key = this.immutableKey(kind, hash);
    const cached = this.cache.get(key);
    if (cached) {
      this.cache.delete(key);
      this.cache.set(key, cached);
      return Buffer.from(cached);
    }
    const object = await this.get(key);
    invariant(object, 'referenced entry missing');
    invariant(sha(object.body) === hash, 'entry digest mismatch');
    this.remember(key, object.body);
    return object.body;
  }
  async writeImmutable(kind, hash, bytes) {
    invariant(sha(bytes) === hash, 'immutable write hash');
    const key = this.immutableKey(kind, hash);
    try {
      const written = await this.put(key, bytes, { ifNoneMatch: '*' });
      if (written.status !== 'written') {
        const old = await this.get(key);
        invariant(old && old.body.equals(bytes), 'immutable entry collision');
      }
    } catch (error) {
      const old = await this.get(key);
      if (!old || !old.body.equals(bytes)) throw error;
    }
    this.remember(key, bytes);
  }
  validHead(head) {
    return (
      exact(head, Object.keys(this.initial())) &&
      head.version === 2 &&
      head.project === this.project &&
      positive(head.epoch) &&
      Number.isSafeInteger(head.sequence) &&
      head.sequence >= 0 &&
      Number.isSafeInteger(head.revision) &&
      head.revision >= 0 &&
      digest(head.manifest) &&
      (head.tail === null || digest(head.tail)) &&
      (head.snapshot === null || digest(head.snapshot))
    );
  }
  async headRecord() {
    const version = await this.get(this.headKey);
    invariant(version, 'head missing; do not silently initialize an existing project');
    const head = JSON.parse(version.body.toString('utf8'));
    invariant(this.validHead(head), 'invalid head');
    return { head, etag: version.etag };
  }
  validateReceipt(row) {
    const identity = JSON.parse(row.key);
    invariant(
      Array.isArray(identity) &&
        identity.length === 2 &&
        identity.every((s) => typeof s === 'string') &&
        JSON.stringify(identity) === row.key,
      'invalid indexed identity'
    );
    const parsed = validator.validate('result', row.result);
    invariant(
      parsed.ok &&
        parsed.data.projectId === this.project &&
        parsed.data.transactionId === identity[1] &&
        parsed.data.proposalHash === row.hash &&
        (parsed.data.status !== 'accepted' || parsed.data.actorId === identity[0]),
      'invalid indexed receipt'
    );
  }
  async lookup(state, key) {
    return state.results.get(key) || (await state.index.lookup(key));
  }
  async read({ materialize = true, maxMaterializeBytes = 8 * 1024 * 1024 } = {}) {
    invariant(
      Number.isSafeInteger(maxMaterializeBytes) &&
        maxMaterializeBytes >= 0 &&
        maxMaterializeBytes <= 64 * 1024 * 1024,
      'invalid materialization bound'
    );
    const { head, etag } = await this.headRecord();
    let replay = this.initial();
    let snapshot = null;
    let documents = new Map();
    if (head.snapshot) {
      snapshot = JSON.parse(
        (await this.readImmutable('snapshots', head.snapshot)).toString('utf8')
      );
      invariant(
        exact(snapshot, [
          'version',
          'project',
          'base',
          'pages',
          'documentPages',
          'documentCount',
          'resultCount',
        ]) &&
          snapshot.version === 2 &&
          snapshot.project === this.project &&
          this.validHead(snapshot.base) &&
          snapshot.base.snapshot === null &&
          snapshot.base.sequence <= head.sequence &&
          Number.isSafeInteger(snapshot.resultCount) &&
          snapshot.resultCount >= 0 &&
          snapshot.resultCount <= snapshot.base.sequence &&
          Number.isSafeInteger(snapshot.documentCount) &&
          snapshot.documentCount >= 0 &&
          snapshot.documentCount <= 256 * 512,
        'invalid snapshot'
      );
      replay = { ...snapshot.base };
    }
    const index = new ReceiptIndex(this, snapshot?.pages);
    const documentIndex = new DocumentIndex(this, snapshot?.documentPages);
    const base = { ...replay };
    invariant(head.sequence - base.sequence <= this.maxEntries, 'replay entry bound');
    let tail = head.tail;
    let size = 0;
    const entries = [],
      seen = new Set();
    while (tail !== base.tail) {
      invariant(
        tail !== null && !seen.has(tail) && entries.length < this.maxEntries,
        'cycle or replay entry bound'
      );
      seen.add(tail);
      const bytes = await this.readImmutable('entries', tail);
      size += bytes.length;
      invariant(size <= this.maxReplayBytes, 'replay byte bound');
      const entry = JSON.parse(bytes.toString('utf8'));
      invariant(
        exact(entry, ['version', 'project', 'sequence', 'previous', 'kind', 'value']) &&
          entry.version === 1 &&
          entry.project === this.project &&
          positive(entry.sequence) &&
          (entry.previous === null || digest(entry.previous)),
        'invalid entry'
      );
      entries.push({ hash: tail, ...entry });
      tail = entry.previous;
    }
    entries.reverse();
    const results = new Map(),
      actions = [];
    for (const entry of entries) {
      invariant(
        entry.sequence === replay.sequence + 1 && entry.previous === replay.tail,
        'broken chain'
      );
      if (entry.kind === 'epoch') {
        invariant(
          exact(entry.value, ['from', 'to']) &&
            entry.value.from === replay.epoch &&
            entry.value.to === replay.epoch + 1,
          'invalid epoch transition'
        );
        replay = { ...replay, epoch: entry.value.to };
      } else {
        invariant(
          entry.kind === 'proposal' &&
            exact(entry.value, ['actor', 'raw', 'result']) &&
            typeof entry.value.actor === 'string' &&
            entry.value.actor.length > 0 &&
            typeof entry.value.raw === 'string',
          'invalid proposal record'
        );
        const { actor, raw, result } = entry.value;
        const parsed = this.parse(actor, raw);
        invariant(parsed.ok, 'invalid retained proposal');
        const key = JSON.stringify([actor, parsed.data.transactionId]);
        invariant(!results.has(key) && !(await index.lookup(key)), 'duplicate retained identity');
        const { result: expected } = decide(replay, null, {
          project: this.project,
          actor,
          p: parsed.data,
          hash: sha(raw),
        });
        invariant(JSON.stringify(expected) === JSON.stringify(result), 'receipt does not replay');
        results.set(key, { hash: sha(raw), result: JSON.stringify(result), entryHash: entry.hash });
        if (result.status === 'accepted') {
          replay = { ...replay, revision: result.revision, manifest: result.manifestHash };
          actions.push({ actor, raw, result });
          const op = parsed.data.action.operations[0];
          documents.set(JSON.stringify([op.documentId, op.generation]), op.value);
        }
      }
      replay = { ...replay, sequence: entry.sequence, tail: entry.hash };
    }
    replay.snapshot = head.snapshot;
    invariant(JSON.stringify(replay) === JSON.stringify(head), 'head does not replay');
    const documentChanges = documents;
    if (materialize) documents = await documentIndex.materialize(documents, maxMaterializeBytes);
    return {
      head,
      etag,
      entries,
      results,
      actions,
      documents,
      documentChanges,
      documentIndex,
      bytes: size,
      snapshot,
      base,
      index,
    };
  }
  async documentValue(state, key) {
    return state.documentChanges.has(key)
      ? state.documentChanges.get(key)
      : state.documentIndex.value(key);
  }
  async snapshot() {
    const state = await this.read({ materialize: false });
    if (state.head.epoch !== this.ownerEpoch) return { status: 'retryable', code: 'owner-fenced' };
    if (!state.entries.length && state.head.snapshot)
      return { status: 'snapshot', hash: state.head.snapshot, sequence: state.head.sequence };
    const merged = await state.index.merge(state.results);
    const docs = await state.documentIndex.merge(state.documentChanges);
    if (!merged || !docs) return { status: 'retryable', code: 'snapshot-capacity' };
    const bytes = encoded({
      version: 2,
      project: this.project,
      base: { ...state.head, snapshot: null },
      pages: Object.fromEntries(
        Object.entries(merged.pages).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      ),
      documentPages: Object.fromEntries(
        Object.entries(docs.pages).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      ),
      documentCount: (state.snapshot?.documentCount || 0) + docs.added,
      resultCount: (state.snapshot?.resultCount || 0) + state.results.size,
    });
    if (bytes.length > 1024 * 1024) return { status: 'retryable', code: 'snapshot-capacity' };
    await this.checkpoint('before-snapshot');
    for (const item of docs.pending) await this.writeImmutable(item.kind, item.hash, item.bytes);
    for (const page of merged.pending) await this.writeImmutable('indexes', page.hash, page.bytes);
    const hash = sha(bytes);
    await this.writeImmutable('snapshots', hash, bytes);
    await this.checkpoint('after-snapshot');
    let written;
    try {
      written = await this.put(this.headKey, encoded({ ...state.head, snapshot: hash }), {
        ifMatch: state.etag,
      });
    } catch {
      /* Read the authoritative pointer before claiming publication. */
    }
    if (written?.status === 'written') {
      await this.checkpoint('after-snapshot-head');
      return { status: 'snapshot', hash, sequence: state.head.sequence };
    }
    const current = await this.headRecord();
    return current.head.snapshot === hash
      ? { status: 'snapshot', hash, sequence: state.head.sequence }
      : { status: 'retryable', code: 'snapshot-unresolved' };
  }
  historyCursor(next, anchor, sequence) {
    if (!next) return null;
    const payload = Buffer.from(JSON.stringify({ next, anchor, sequence })).toString('base64url');
    const signature = createHmac('sha256', this.historyKey).update(payload).digest('hex');
    return `${payload}.${signature}`;
  }
  async historyPage({ cursor = null, limit = 16 } = {}) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 64)
      throw new TypeError('invalid-history-page');
    let next, anchor, sequence;
    if (cursor !== null) {
      invariant(typeof cursor === 'string' && cursor.length <= 512, 'invalid history cursor');
      const [payload, signature, extra] = cursor.split('.');
      const expected = createHmac('sha256', this.historyKey).update(payload).digest('hex');
      invariant(
        !extra &&
          digest(signature) &&
          timingSafeEqual(Buffer.from(signature), Buffer.from(expected)),
        'invalid or expired history cursor'
      );
      const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
      invariant(
        exact(parsed, ['next', 'anchor', 'sequence']) &&
          digest(parsed.next) &&
          digest(parsed.anchor) &&
          positive(parsed.sequence),
        'invalid history cursor'
      );
      ({ next, anchor, sequence } = parsed);
    } else {
      const { head } = await this.headRecord();
      next = anchor = head.tail;
      sequence = head.sequence;
    }
    const entries = [];
    let bytesRead = 0;
    while (next && entries.length < limit) {
      const bytes = await this.readImmutable('entries', next);
      bytesRead += bytes.length;
      invariant(bytesRead <= this.maxReplayBytes, 'history byte bound');
      const entry = JSON.parse(bytes.toString('utf8'));
      invariant(
        entry.version === 1 &&
          entry.project === this.project &&
          entry.sequence === sequence &&
          (entry.previous === null || digest(entry.previous)),
        'invalid history entry'
      );
      entries.push({ hash: next, ...entry });
      next = entry.previous;
      sequence--;
    }
    return { entries, next: this.historyCursor(next, anchor, sequence) };
  }
  parse(actor, raw) {
    if (typeof actor !== 'string' || !actor || actor.length > 256 || typeof raw !== 'string')
      return { ok: false, code: 'invalid-input' };
    const parsed = validator.validate('proposal', raw);
    if (!parsed.ok) return parsed;
    if (parsed.data.projectId !== this.project) return { ok: false, code: 'forbidden' };
    // A storage experiment must not imply source/dependency/blob acceptance.
    if (
      parsed.data.dependsOn.length ||
      parsed.data.blobs.length ||
      parsed.data.action.operations.length !== 1 ||
      parsed.data.action.operations[0].kind !== 'source.text.assign'
    )
      return { ok: false, code: 'unsupported-fixture' };
    return parsed;
  }
  async result(actor, tx, authorized = true) {
    if (!authorized) return { status: 'forbidden' };
    const state = await this.read({ materialize: false });
    const old = await this.lookup(state, JSON.stringify([actor, tx]));
    return old ? JSON.parse(old.result) : null;
  }
  async append(actor, raw, { authorized = true } = {}) {
    if (!authorized) return { status: 'forbidden' };
    const parsed = this.parse(actor, raw);
    if (!parsed.ok) return { status: 'invalid', code: parsed.code };
    const state = await this.read({ materialize: false });
    const key = JSON.stringify([actor, parsed.data.transactionId]);
    const command = { project: this.project, actor, p: parsed.data, hash: sha(raw) };
    const decision = decide(state.head, await this.lookup(state, key), command);
    if (decision.retained) return decision.result;
    if (state.head.epoch !== this.ownerEpoch) return { status: 'retryable', code: 'owner-fenced' };
    return this.commit(
      state,
      'proposal',
      { actor, raw, result: decision.result },
      decision.result.status === 'accepted'
        ? { revision: decision.result.revision, manifest: decision.result.manifestHash }
        : {},
      async (recovered) => {
        const old = await this.lookup(recovered, key);
        return old ? decide(recovered.head, old, command).result : null;
      },
      decision.result
    );
  }
  async advanceEpoch() {
    const state = await this.read({ materialize: false });
    if (state.head.epoch !== this.ownerEpoch) return { status: 'retryable', code: 'owner-fenced' };
    const value = { from: state.head.epoch, to: state.head.epoch + 1 };
    const result = { status: 'advanced', epoch: value.to };
    return this.commit(
      state,
      'epoch',
      value,
      { epoch: value.to },
      (recovered) => (recovered.head.epoch >= value.to ? result : null),
      result
    );
  }
  async commit(state, kind, value, changes, resolve, result) {
    const entry = {
      version: 1,
      project: this.project,
      sequence: state.head.sequence + 1,
      previous: state.head.tail,
      kind,
      value,
    };
    const bytes = encoded(entry);
    if (
      state.head.sequence - state.base.sequence >= this.maxEntries ||
      bytes.length > 1024 * 1024 ||
      state.bytes + bytes.length > this.maxReplayBytes
    )
      return { status: 'retryable', code: 'capacity' };
    const hash = sha(bytes);
    await this.checkpoint('before-payload');
    await this.writeImmutable('entries', hash, bytes);
    await this.checkpoint('after-payload');
    const next = { ...state.head, ...changes, sequence: entry.sequence, tail: hash };
    let written;
    try {
      written = await this.put(this.headKey, encoded(next), { ifMatch: state.etag });
    } catch {
      /* one authoritative read below resolves the unknown outcome */
    }
    if (written?.status === 'written') {
      await this.checkpoint('after-head');
      await this.checkpoint('before-ack');
      return result;
    }
    // No blind retry. A competing head can include our commit and later work.
    const recovered = await this.read({ materialize: false });
    return (await resolve(recovered, hash)) ?? { status: 'retryable', code: 'head-unresolved' };
  }
}
