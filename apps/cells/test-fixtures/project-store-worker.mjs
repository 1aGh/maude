// A workerd stand-in for the cell's outbound store route (test only).
//
// The real route is the container runtime handing `project-store.internal`
// to `projectStoreOutbound` with the cell's own `containerId`. Here a plain
// fetch plays the container and `x-tenant` picks which cell it belongs to.
// The cell below forwards exactly as `MaudeCell.projectStore` does (that class
// cannot load without the container runtime); everything after it — the
// handler, the ProjectStore DO and `store-core` on its SQLite — is production.

import { DurableObject } from 'cloudflare:workers';

import { projectStoreOutbound } from '../project-store.mjs';
import { ProjectStore } from '../project-store-do.mjs';

export { ProjectStore };

export class Cell extends DurableObject {
  async remember(tenantId) {
    await this.ctx.storage.put('tenantId', tenantId);
  }
  async projectStore(method, args) {
    const tenantId = await this.ctx.storage.get('tenantId');
    const store = this.env.PROJECT_STORE.get(this.env.PROJECT_STORE.idFromName(tenantId));
    return store.projectStore(method, args);
  }
}

export default {
  async fetch(request, env) {
    const tenant = request.headers.get('x-tenant') ?? 'default';
    const id = env.MAUDE_CELL.idFromName(tenant);
    await env.MAUDE_CELL.get(id).remember(tenant);
    return projectStoreOutbound(request, env, { containerId: id.toString(), className: 'Cell' });
  },
};
