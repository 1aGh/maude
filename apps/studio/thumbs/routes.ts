// thumbs/routes.ts — the picture routes' bodies (V2-2.17, contract V2-1.17 §5.3, R4–R6).
//
//   GET  /_api/thumb/<key>     image/jpeg, nosniff, immutable — only for a key this project's
//                              snapshot (a cover) or a caller's thumb() request references
//   POST /_api/thumbs/want     {keys[]} → raises those keys to `visible`; answers nothing about
//                              any key (L14: no route answers "is key X cached")
//
// MAIN ORIGIN ONLY (R4): http.ts runs `sameOriginRead`/`sameOriginWrite` + `isTrustedRequestHost`
// before these, and neither route is in CANVAS_SAFE_API or the canvas server's routes map — the
// canvas and capture origins answer 403 at their door. Missing and forbidden are the SAME 404
// (status, headers and body), so a probe cannot tell "not cached" from "not yours" (R6).

import { KEY_RE } from './keys.ts';
import type { ThumbService } from './service.ts';
import { checkJpeg } from './validate.ts';

const NOT_FOUND_BODY = 'Not found';
export function thumbNotFound(): Response {
  return new Response(NOT_FOUND_BODY, {
    status: 404,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

export function thumbResponse(svc: ThumbService | null, key: string | undefined): Response {
  if (!svc || typeof key !== 'string' || !KEY_RE.test(key) || !svc.serves(key))
    return thumbNotFound();
  const bytes = svc.read(key);
  // a file someone else dropped into the machine cache is still only served as a real JPEG
  if (!bytes || !checkJpeg(bytes, 2048).ok) return thumbNotFound();
  return new Response(bytes as Uint8Array<ArrayBuffer>, {
    status: 200,
    headers: {
      'Content-Type': 'image/jpeg',
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, max-age=31536000, immutable',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'Cross-Origin-Resource-Policy': 'same-origin',
    },
  });
}

export async function wantResponse(svc: ThumbService | null, req: Request): Promise<Response> {
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return new Response('bad json', { status: 400 });
  }
  const keys = (body as { keys?: unknown })?.keys;
  if (!Array.isArray(keys) || keys.length > 500) return new Response('bad keys', { status: 400 });
  svc?.want(keys.filter((k): k is string => typeof k === 'string' && KEY_RE.test(k)));
  return Response.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
}
