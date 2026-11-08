// The routes the data-plane Worker forwards to the render container (worker.mjs). Kept apart from
// worker.mjs so a test can read it: worker.mjs imports `cloudflare:workers` through the containers
// library, which only the Workers runtime resolves.

const ROUTES = new Set([
  'GET /_health',
  'POST /render',
  // #128 T3.7 — follow and stop a render by the id its cell chose (service.ts)
  'GET /_render/status',
  'POST /_render/cancel',
]);

/** @param {string} method @param {string} pathname */
export function isRenderServiceRoute(method, pathname) {
  return ROUTES.has(`${method} ${pathname}`);
}
