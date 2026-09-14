// T8 storage experiment only: not a production endpoint or acceptance kernel.
import { DurableObject } from 'cloudflare:workers';

export class ProjectStoreProbe extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS head (id INTEGER PRIMARY KEY CHECK(id=1), epoch INTEGER, revision INTEGER, body TEXT);
      INSERT OR IGNORE INTO head VALUES (1,1,0,'BASE');
      CREATE TABLE IF NOT EXISTS results (actor TEXT, tx TEXT, hash TEXT, result TEXT, PRIMARY KEY(actor,tx));
      CREATE TABLE IF NOT EXISTS actions (revision INTEGER PRIMARY KEY, body TEXT, result TEXT);
    `);
  }
  state() {
    return {
      head: this.sql.exec('SELECT epoch,revision,body FROM head').one(),
      actions: this.sql.exec('SELECT * FROM actions ORDER BY revision').toArray(),
      results: this.sql.exec('SELECT * FROM results ORDER BY actor,tx').toArray(),
    };
  }
  async advanceEpoch() {
    this.sql.exec('UPDATE head SET epoch=epoch+1 WHERE id=1');
    await this.ctx.storage.sync();
    return this.state().head;
  }
  async append(p, fault) {
    let result;
    try {
      result = this.ctx.storage.transactionSync(() => {
        const head = this.sql.exec('SELECT epoch,revision,body FROM head').one();
        if (p.epoch !== head.epoch) return { status: 'rejected', code: 'epoch-stale' };
        const old = this.sql
          .exec('SELECT hash,result FROM results WHERE actor=? AND tx=?', p.actor, p.id)
          .toArray()[0];
        if (old)
          return old.hash === p.hash
            ? JSON.parse(old.result)
            : { status: 'rejected', code: 'transaction-id-reused' };
        if (p.base !== head.revision) return { status: 'rejected', code: 'base-conflict' };
        const accepted = {
          status: 'accepted',
          revision: head.revision + 1,
          parentRevision: head.revision,
          hash: p.hash,
        };
        const serialized = JSON.stringify(accepted);
        this.sql.exec('INSERT INTO actions VALUES (?,?,?)', accepted.revision, p.body, serialized);
        if (fault === 'after-action') throw new Error('injected-storage-failure');
        this.sql.exec('UPDATE head SET revision=?,body=? WHERE id=1', accepted.revision, p.body);
        if (fault === 'after-head') throw new Error('injected-storage-failure');
        this.sql.exec('INSERT INTO results VALUES (?,?,?,?)', p.actor, p.id, p.hash, serialized);
        if (fault === 'after-result') throw new Error('injected-storage-failure');
        return accepted;
      });
    } catch (error) {
      if (error.message !== 'injected-storage-failure') throw error;
      return { status: 'retryable', code: 'injected-storage-failure' };
    }
    await this.ctx.storage.sync();
    // Report the durable boundary to the harness, then withhold the ACK so the
    // actual workerd process can be killed at a known unknown-outcome point.
    if (fault === 'lost-ack') {
      await this.env.CHECKPOINT.fetch('http://checkpoint/committed');
      await new Promise(() => {});
    }
    return result;
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const project = url.searchParams.get('project') || 'test';
    const store = env.PROJECTS.getByName(project);
    if (url.pathname === '/state') return Response.json(await store.state());
    if (url.pathname === '/epoch') return Response.json(await store.advanceEpoch());
    if (url.pathname !== '/append' || request.method !== 'POST')
      return new Response('Not found', { status: 404 });
    const raw = await request.text();
    if (new TextEncoder().encode(raw).length > 65536)
      return new Response('Too large', { status: 413 });
    const p = JSON.parse(raw);
    if (
      typeof p.body !== 'string' ||
      typeof p.id !== 'string' ||
      typeof p.actor !== 'string' ||
      !Number.isSafeInteger(p.base) ||
      !Number.isSafeInteger(p.epoch)
    )
      return new Response('Invalid', { status: 400 });
    const hash = Array.from(
      new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw))),
      (x) => x.toString(16).padStart(2, '0')
    ).join('');
    return Response.json(await store.append({ ...p, hash }, url.searchParams.get('fault')));
  },
};
