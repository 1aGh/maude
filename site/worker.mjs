// Worker entry: the OpenNext worker, plus byte-range support for the site's videos.
//
// WHY. Workers static assets answer a `Range` request with `200` and the whole file,
// no `Content-Range`, no `Accept-Ranges`
// (https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/).
// Safari will not play a <video> without 206, and the intro film is a 14 MB mp4. Vercel
// served ranges, so this keeps that behaviour. `assets.run_worker_first` in
// wrangler.jsonc sends only `/*.mp4` through here; everything else is untouched and
// goes straight to OpenNext (or to the asset layer first, as before).
import openNext from './.open-next/worker.js';
import { parseRange, slice } from './lib/byte-range.mjs';

// Re-exported because the OpenNext worker exports them. Nothing binds them while the
// incremental cache is the static-assets one (open-next.config.ts), but wrangler
// expects the entry module to carry whatever its adapter shipped.
export { BucketCachePurge, DOQueueHandler, DOShardedTagCache } from './.open-next/worker.js';

async function serveVideo(request, env) {
  const plain = new Request(request.url, { method: 'GET', headers: stripRange(request.headers) });
  const asset = await env.ASSETS.fetch(plain);
  const headers = new Headers(asset.headers);
  headers.set('Accept-Ranges', 'bytes');

  const range = request.headers.get('range');
  if (!asset.ok || !range || request.method !== 'GET') {
    return new Response(request.method === 'HEAD' ? null : asset.body, {
      status: asset.status,
      headers,
    });
  }

  // The asset layer states the size when it can. The local runtime streams without a
  // Content-Length, and then the file is read whole (a 14 MB mp4 fits a Worker easily).
  let size = Number(asset.headers.get('content-length')) || 0;
  let bytes = null;
  if (size <= 0) {
    bytes = new Uint8Array(await asset.arrayBuffer());
    size = bytes.byteLength;
  }
  const r = size > 0 ? parseRange(range, size) : null;
  if (r === null) {
    return new Response(bytes ?? asset.body, { status: asset.status, headers });
  }
  if (r === 'unsatisfiable') {
    if (!bytes) await asset.body?.cancel();
    headers.set('Content-Range', `bytes */${size}`);
    headers.delete('content-length');
    return new Response(null, { status: 416, headers });
  }

  const length = r.end - r.start + 1;
  headers.set('Content-Range', `bytes ${r.start}-${r.end}/${size}`);
  headers.set('Content-Length', String(length));
  const body = bytes ? bytes.subarray(r.start, r.end + 1) : slice(asset.body, r.start, length);
  return new Response(body, { status: 206, headers });
}

function stripRange(headers) {
  const h = new Headers(headers);
  h.delete('range');
  h.delete('if-range');
  return h;
}

export default {
  async fetch(request, env, ctx) {
    if (
      (request.method === 'GET' || request.method === 'HEAD') &&
      /\.mp4$/i.test(new URL(request.url).pathname)
    ) {
      return serveVideo(request, env);
    }
    return openNext.fetch(request, env, ctx);
  },
};
