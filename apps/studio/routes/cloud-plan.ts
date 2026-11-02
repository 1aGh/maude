// The account's plan — S9.20b (decision v2-lead-plan-words-via-home-route). `GET /_api/cloud/plan`
// answers `{ ok, plan: { state, daysLeft, name } | null }`, read from the control plane's
// `GET /api/home` `account.plan` with THIS Mac's device token (cloud/endpoints.ts `plan()`). Settings
// › Account draws "Free trial · N days left" from it (through `/_api/cloud/status`, which carries the
// same `plan`); the desktop never computes trial days itself and nothing here talks to Stripe.
//
// MAIN ORIGIN ONLY (`origin: 'main'` — never in CANVAS_SAFE_API nor routes/canvas-origin.ts): it
// spends the device token, which the untrusted canvas origin (DDR-054) must never reach.
// `guardTableRoute` adds the CSRF (`sameOriginRead`) and DNS-rebind (`isTrustedRequestHost`) gates.
// A cell never serves it (apps/hub/src/studio-manifest.mjs: REFUSED) — a cell has no device token.

import type { CloudEndpointResult } from '../cloud/endpoints.ts';
import type { RouteSpec } from './table.ts';

export interface CloudPlanDeps {
  /** the cloud lane (cloud/endpoints.ts) — the one holder of the device token */
  cloud: { plan(): Promise<CloudEndpointResult> };
}

export function createCloudPlanRoutes(deps: CloudPlanDeps): RouteSpec[] {
  return [
    {
      method: 'GET',
      path: '/_api/cloud/plan',
      origin: 'main',
      readOnly: 'allowed',
      async handle() {
        const r = await deps.cloud.plan();
        return Response.json(r.json, {
          status: r.status,
          headers: { 'Cache-Control': 'no-store' },
        });
      },
    },
  ];
}
