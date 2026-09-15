// Maude Cloud data plane — every request here belongs to exactly one project.
//
// The control plane (apps/cloud) speaks for the platform: billing, identity,
// provisioning. This speaks only for one project at a time, and it is a
// separate Worker so neither deploy can disturb the other (see wrangler.toml
// for the concrete failure that forced the split).
//
// TWO SURFACES, TWO ORIGINS, TWO TRUST LEVELS:
//
//   <project>.cloud.maude.sh       the workspace. Members only. Proxied to the
//                                  project's own container.
//   canvas.cloud.maude.sh/<id>/…   the segregated CANVAS origin (Cloud Phase 25
//                                  A4): the tenant's own built module and the
//                                  runtime it needs, read-only, capability-
//                                  authenticated, and never able to change
//                                  anything. Same container, different origin —
//                                  which is the point (DDR-054).
//
// THE READ-ONLY GALLERY IS GONE (Cloud Phase 25 C5). `view-<project>` served
// published snapshots to anyone with the link; it was deleted because the
// browser door replaced the need for it with something honest — the real
// project, for people who actually have access. A surface that stays
// half-alive is worse than one that never shipped.

import { canvasInnerRequest, canvasOriginTenant, stripCanvasOriginMarker } from './cell-config.mjs';
import { MaudeCell, routeToCell, tenantFromHostname } from './cell-do.mjs';
import { PROJECT_STORE_HOST, projectStoreOutbound } from './project-store.mjs';
import { ProjectStore } from './project-store-do.mjs';

// The container runtime hands intercepted outbound requests to this entrypoint
// (@cloudflare/containers). It MUST be exported, or every container start
// fails applying the interception below.
export { ContainerProxy } from '@cloudflare/containers';
export { MaudeCell, ProjectStore };

/**
 * A SECOND name for the same class, bound to a FRESH Durable Object namespace
 * (Cloud Phase 25, 2026-08-03 incident).
 *
 * A DO that has lost its container cannot be talked out of it: it holds the
 * handle, `startAndWaitForPorts` never returns, and neither redeploying the
 * Worker, rolling the image back, nor DELETING AND RECREATING the container
 * application makes it let go — all three were tried while a customer's
 * project was down, and the container it had already started sat healthy and
 * unreachable through every one of them.
 *
 * Migrating to a new class name is the one lever that gives every tenant a
 * Durable Object with no memory of that handle. It is safe HERE specifically
 * because a cell's DO storage holds nothing that cannot be re-derived: the
 * tenant id (which arrives on every routed request anyway) and a cached copy
 * of the tenant config (re-fetched from the control plane on each start). The
 * project itself lives in R2 and in the container's disk, neither of which a
 * DO migration touches.
 */
export class MaudeCellB extends MaudeCell {}

// Accepted revisions (DDR-241): the hub in the container reaches its durable
// store at `http://project-store.internal/`. Registered on the class the
// instances actually are — the registry is keyed by class NAME, so a handler
// on MaudeCell alone would never match a MaudeCellB container.
MaudeCellB.outboundByHost = { [PROJECT_STORE_HOST]: projectStoreOutbound };

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // THE CANVAS ORIGIN (Cloud Phase 25 A4). One hostname for the whole
    // fleet, the tenant in the FIRST PATH SEGMENT — so the browser treats a
    // rendered canvas as a different origin from the shell that edits it,
    // which is the whole point (DDR-054).
    //
    // This has to be decided BEFORE the hostname is read as a tenant label,
    // because `canvas` is a syntactically valid tenant id: without this branch
    // the request would route to a cell called "canvas" and quietly serve the
    // generic landing page instead of the origin. (`canvas` is also a reserved
    // project id at signup for the same reason — a project allocated that name
    // would take the hostname every project's canvases are served from.)
    const canvasTenant = canvasOriginTenant(url, env.CELL_ZONE);
    if (canvasTenant) {
      if (!canvasTenant.tenant) {
        return new Response('the canvas origin needs a project in the path\n', {
          status: 404,
          headers: { 'content-type': 'text/plain; charset=utf-8' },
        });
      }
      // The cell answers its own canvas routes; the path it sees is the one
      // WITHOUT the tenant prefix, so a cell serving a self-hoster and a cell
      // serving a Cloud tenant handle byte-identical requests.
      //
      // AND THE CELL IS TOLD WHICH ORIGIN THIS IS, rather than left to infer it
      // from the Host header. Cloud Phase 27 shipped that inference and it was
      // wrong: by the time a request has crossed the Durable Object and the
      // container proxy, `Host` is not the name the browser typed, so every
      // canvas request fell through to the SHELL lane and answered "sign in to
      // open this project" — to an iframe that has no cookie and never will,
      // because the whole point of DDR-054 is that this origin is cookieless.
      //
      // The header is STRIPPED on the tenant branch below, so it cannot be
      // forged into existence from outside; and the lane it opens is read-only
      // and capability-gated regardless.
      return routeToCell(
        canvasInnerRequest(request, url, canvasTenant.rest),
        env,
        canvasTenant.tenant
      );
    }

    const tenant = tenantFromHostname(url.hostname, env.CELL_ZONE);
    if (!tenant) {
      // A hostname routed here that is not a project is a provisioning
      // mistake, not a user error — say so rather than serving a 404 that
      // reads like the project was deleted.
      return new Response('this hostname is not a Maude project\n', {
        status: 404,
        headers: { 'content-type': 'text/plain; charset=utf-8' },
      });
    }

    try {
      // Strip the canvas-origin marker on the way IN. Nothing outside this
      // Worker may assert which origin a request arrived on.
      return await routeToCell(stripCanvasOriginMarker(request), env, tenant);
    } catch (err) {
      // A project that cannot start is an operational fact the operator needs
      // and the visitor does not. Cloudflare's bare 1101 says only "the Worker
      // threw", which is true of every possible cause — so the reason goes to
      // the log and the visitor gets a sentence that is honest without being a
      // stack trace.
      console.error(`[cells] ${tenant} failed to serve: ${err?.stack || err}`);
      return new Response(
        'This project could not be started. The operator has been given the reason.\n',
        { status: 503, headers: { 'content-type': 'text/plain; charset=utf-8' } }
      );
    }
  },
};
