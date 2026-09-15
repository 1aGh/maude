// The Durable Object that holds a project's accepted revisions — DDR-241 §2, T10.
//
// A class of its OWN, keyed by tenant id, and deliberately not the cell's
// container class. The cell class has been migrated to a fresh namespace before
// (MaudeCell → MaudeCellB, 2026-08-03) because a DO that lost its container
// could not be recovered any other way — which was safe only because that DO
// held nothing that could not be re-derived. The accepted store is the
// opposite: it is the project's durable truth. Keeping it here means the
// container class can be migrated, rebuilt or rolled back without touching a
// single accepted revision.

import { DurableObject } from 'cloudflare:workers';

import { createProjectStoreHost } from './project-store.mjs';

export class ProjectStore extends DurableObject {
  #host = null;

  /** RPC: one store method. Called only by this tenant's cell (see MaudeCell). */
  projectStore(method, args) {
    this.#host ??= createProjectStoreHost(this.ctx.storage);
    return this.#host(method, args);
  }
}
