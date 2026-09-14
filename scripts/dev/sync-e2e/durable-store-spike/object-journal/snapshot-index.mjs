// Immutable, bounded receipt pages for the T8 storage experiment.
import { sha } from './hash.mjs';

export const bucketFor = (key) => sha(key).slice(0, 2);
const digest = (s) => typeof s === 'string' && /^[a-f0-9]{64}$/.test(s);
function check(condition, message) {
  if (!condition) throw new Error(`snapshot-integrity: ${message}`);
}
export class ReceiptIndex {
  constructor(journal, pages = {}) {
    check(
      pages &&
        typeof pages === 'object' &&
        !Array.isArray(pages) &&
        Object.keys(pages).length <= 256 &&
        Object.entries(pages).every(([key, value]) => /^[a-f0-9]{2}$/.test(key) && digest(value)),
      'invalid page index'
    );
    this.journal = journal;
    this.pages = pages;
    this.loaded = new Map();
  }
  async page(bucket) {
    if (this.loaded.has(bucket)) return this.loaded.get(bucket);
    const hash = this.pages[bucket];
    const rows = new Map();
    if (hash) {
      const page = JSON.parse((await this.journal.readImmutable('indexes', hash)).toString('utf8'));
      check(
        page.version === 1 &&
          page.project === this.journal.project &&
          page.bucket === bucket &&
          Object.keys(page).sort().join(',') === 'bucket,project,rows,version' &&
          Array.isArray(page.rows) &&
          page.rows.length <= 1024,
        'invalid receipt page'
      );
      let previous = null;
      for (const row of page.rows) {
        check(
          row &&
            typeof row.key === 'string' &&
            bucketFor(row.key) === bucket &&
            (previous === null || previous < row.key) &&
            Object.keys(row).sort().join(',') === 'entryHash,hash,key,result' &&
            digest(row.hash) &&
            digest(row.entryHash) &&
            typeof row.result === 'string',
          'invalid receipt row'
        );
        this.journal.validateReceipt(row);
        rows.set(row.key, { hash: row.hash, result: row.result, entryHash: row.entryHash });
        previous = row.key;
      }
    }
    this.loaded.set(bucket, rows);
    return rows;
  }
  async lookup(key) {
    return (await this.page(bucketFor(key))).get(key);
  }
  async merge(suffix) {
    const pages = { ...this.pages };
    const changed = new Map();
    for (const [key, value] of suffix) {
      const bucket = bucketFor(key);
      if (!changed.has(bucket)) changed.set(bucket, new Map(await this.page(bucket)));
      const rows = changed.get(bucket);
      check(!rows.has(key), 'duplicate indexed identity');
      rows.set(key, value);
    }
    // Build all changed pages before publishing any pointer. Capacity never drops old receipts.
    const pending = [];
    for (const [bucket, rows] of changed) {
      if (rows.size > 1024) return null;
      const bytes = Buffer.from(
        JSON.stringify({
          version: 1,
          project: this.journal.project,
          bucket,
          rows: [...rows]
            .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
            .map(([key, row]) => ({ key, ...row })),
        })
      );
      if (bytes.length > 1024 * 1024) return null;
      const hash = sha(bytes);
      pages[bucket] = hash;
      pending.push({ hash, bytes });
    }
    return { pages, pending };
  }
}
