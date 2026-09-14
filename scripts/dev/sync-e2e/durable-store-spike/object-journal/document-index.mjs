// T8: immutable document pages keep source bytes outside the metadata snapshot.
import { sha } from './hash.mjs';
import { bucketFor } from './snapshot-index.mjs';

const digest = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const encoded = (value) => Buffer.from(JSON.stringify(value));
function check(condition, reason) {
  if (!condition) throw new Error(`document-integrity: ${reason}`);
}
function validKey(key) {
  if (typeof key !== 'string' || key.length > 512) return false;
  try {
    const value = JSON.parse(key);
    return (
      Array.isArray(value) &&
      value.length === 2 &&
      typeof value[0] === 'string' &&
      value[0].length > 0 &&
      Number.isSafeInteger(value[1]) &&
      value[1] > 0 &&
      JSON.stringify(value) === key
    );
  } catch {
    return false;
  }
}
export class DocumentIndex {
  constructor(journal, pages = {}) {
    check(
      pages &&
        typeof pages === 'object' &&
        !Array.isArray(pages) &&
        Object.keys(pages).length <= 256 &&
        Object.entries(pages).every(([k, v]) => /^[a-f0-9]{2}$/.test(k) && digest(v)),
      'invalid page directory'
    );
    this.journal = journal;
    this.pages = pages;
  }
  async page(bucket) {
    check(/^[a-f0-9]{2}$/.test(bucket), 'invalid bucket');
    const hash = this.pages[bucket];
    if (!hash) return new Map();
    const data = JSON.parse(
      (await this.journal.readImmutable('document-indexes', hash)).toString('utf8')
    );
    check(
      data.version === 1 &&
        data.project === this.journal.project &&
        data.bucket === bucket &&
        Object.keys(data).sort().join(',') === 'bucket,project,rows,version' &&
        Array.isArray(data.rows) &&
        data.rows.length <= 512,
      'invalid page'
    );
    let previous = null;
    const rows = new Map();
    for (const row of data.rows) {
      check(
        row &&
          Object.keys(row).sort().join(',') === 'bytes,hash,key' &&
          validKey(row.key) &&
          bucketFor(row.key) === bucket &&
          (previous === null || previous < row.key) &&
          digest(row.hash) &&
          Number.isSafeInteger(row.bytes) &&
          row.bytes >= 0 &&
          row.bytes <= 1024 * 1024,
        'invalid document reference'
      );
      rows.set(row.key, { hash: row.hash, bytes: row.bytes });
      previous = row.key;
    }
    return rows;
  }
  async value(key) {
    check(validKey(key), 'invalid document key');
    const ref = (await this.page(bucketFor(key))).get(key);
    if (!ref) return null;
    return this.decode(ref);
  }
  async decode(ref) {
    const bytes = await this.journal.readImmutable('documents', ref.hash);
    check(bytes.length === ref.bytes, 'document length mismatch');
    const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    check(typeof value === 'string', 'document body is not a string');
    return value;
  }
  async materialize(overrides, maxBytes) {
    const result = new Map(overrides);
    let used = [...result.values()].reduce((sum, text) => sum + Buffer.byteLength(text), 0);
    check(used <= maxBytes, 'materialization capacity');
    for (const bucket of Object.keys(this.pages).sort()) {
      for (const [key, ref] of await this.page(bucket)) {
        if (result.has(key)) continue;
        used += ref.bytes;
        check(used <= maxBytes, 'materialization capacity');
        result.set(key, await this.decode(ref));
      }
    }
    return result;
  }
  async merge(changes) {
    const pages = { ...this.pages },
      changed = new Map(),
      blobs = new Map();
    let added = 0;
    for (const [key, value] of changes) {
      check(validKey(key) && typeof value === 'string', 'invalid document change');
      const bucket = bucketFor(key);
      if (!changed.has(bucket)) changed.set(bucket, await this.page(bucket));
      const rows = changed.get(bucket);
      // JSON string encoding preserves every code unit accepted by the proposal contract,
      // including escaped lone surrogates; raw UTF-8 would replace those with U+FFFD.
      const bytes = encoded(value);
      if (bytes.length > 1024 * 1024) return null;
      const hash = sha(bytes);
      if (!rows.has(key)) added++;
      if (rows.get(key)?.hash !== hash) blobs.set(hash, bytes);
      rows.set(key, { hash, bytes: bytes.length });
    }
    const pending = [];
    for (const [bucket, rows] of changed) {
      if (rows.size > 512) return null;
      const bytes = encoded({
        version: 1,
        project: this.journal.project,
        bucket,
        rows: [...rows]
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([key, ref]) => ({ key, ...ref })),
      });
      if (bytes.length > 1024 * 1024) return null;
      const hash = sha(bytes);
      pages[bucket] = hash;
      pending.push({ kind: 'document-indexes', hash, bytes });
    }
    return {
      pages,
      added,
      pending: [
        ...[...blobs].map(([hash, bytes]) => ({ kind: 'documents', hash, bytes })),
        ...pending,
      ],
    };
  }
}
