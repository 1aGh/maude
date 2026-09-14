import { DurableObject } from 'cloudflare:workers';
import { append, DDL, ensure, head, lookup, state } from './storage-policy.mjs';
export class ProjectStoreProbe extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.db = { exec: (sql, ...args) => ctx.storage.sql.exec(sql, ...args).toArray() };
    this.db.exec(DDL);
  }
  async executeCommand(command) {
    const result = this.ctx.storage.transactionSync(() => {
      const { project, actor, kind } = command;
      ensure(this.db, project);
      if (kind === 'head') return head(this.db, project);
      if (kind === 'state') return state(this.db, project);
      if (kind === 'result') return lookup(this.db, project, actor, command.tx);
      if (kind === 'epoch') {
        this.db.exec('UPDATE heads SET epoch=epoch+1 WHERE project=?', project);
        return head(this.db, project);
      }
      return append(this.db, command, command.fault);
    });
    await this.ctx.storage.sync();
    return result;
  }
}
export default {
  async fetch(request, env) {
    const command = await request.json();
    if (command.kind === 'append') {
      // Hash original validated bytes in the runtime as well as in the corpus.
      const bytes = new TextEncoder().encode(command.raw);
      command.hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (b) =>
        b.toString(16).padStart(2, '0')
      ).join('');
      command.p = JSON.parse(command.raw);
    }
    try {
      return Response.json(await env.PROJECTS.getByName(command.project).executeCommand(command));
    } catch (error) {
      if (error.message.includes('injected-rollback'))
        return Response.json({ status: 'retryable', code: 'injected-rollback' });
      throw error;
    }
  },
};
