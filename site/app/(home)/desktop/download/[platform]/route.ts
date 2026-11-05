// Stable per-platform download redirect (Phase 32 / Task 3; V2-7.2 stable-only).
//
//   GET /desktop/download/macos    → 302 to the .dmg of the newest STABLE GitHub Release
//   GET /desktop/download/windows  → 302 to its .msi
//   GET /desktop/download/linux    → 302 to its .deb
//
// Asset filenames carry the version (Maude_0.30.0_x64_en-US.msi), so there's no
// version-less URL to link directly. This resolves the asset at request time and
// 302s to it; on any failure it falls back to the releases page, so the button
// never dead-ends.
//
// STABLE ONLY. This is the front door for every first-time visitor, so a release candidate must
// never become the download — by GitHub's flag OR by its version string (a mis-flagged rc would
// pass a flag check). The decision is site/lib/updater-feed.mjs `downloadRedirect`, the same
// channel rule a stable install gets from the updater feed; scripts/test/download-redirect.test.mjs
// pins it.
//
// NEVER AN OLDER VERSION (2.0.2). Right after 2.0.1 this sent visitors to 1.10.0: the list was
// read through Next's data cache (`next: { revalidate }`), which is stale-while-revalidate and
// answered the first request after a quiet spell from a list fetched before 2.0.0 existed. The
// list is now read uncached and the REDIRECT carries the cache — bounded, never served stale, and
// short whenever the newest release's installer is not uploaded yet (see `downloadRedirect`).

import { withEdgeCache } from '@/lib/edge-cache';
import { gitConfig } from '@/lib/shared';
import { DOWNLOAD_CACHE_PENDING, downloadRedirect } from '@/lib/updater-feed.mjs';

const REPO = `${gitConfig.user}/${gitConfig.repo}`;
const RELEASES_PAGE = `https://github.com/${REPO}/releases/latest`;

function ghHeaders(): HeadersInit {
  const h: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'maude-download-redirect',
  };
  if (process.env.GITHUB_TOKEN) h.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  return h;
}

/** A 302 whose cache lifetime we choose (`Response.redirect` hands back immutable headers). */
function redirect(location: string, cacheControl: string): Response {
  return new Response(null, {
    status: 302,
    headers: { Location: location, 'Cache-Control': cacheControl },
  });
}

type Ctx = { params: Promise<{ platform: string }> };

// `withEdgeCache`: on Workers nothing in front of the route honours the redirect's
// Cache-Control, so the Workers Cache API does (a pass-through elsewhere).
export function GET(req: Request, ctx: Ctx) {
  return withEdgeCache(req, () => resolve(ctx));
}

async function resolve({ params }: Ctx) {
  const { platform } = await params;

  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases?per_page=30`, {
      headers: ghHeaders(),
      cache: 'no-store',
    });
    if (!res.ok) return redirect(RELEASES_PAGE, DOWNLOAD_CACHE_PENDING);
    const { location, cacheControl } = downloadRedirect(await res.json(), platform, REPO);
    return redirect(location, cacheControl);
  } catch {
    return redirect(RELEASES_PAGE, DOWNLOAD_CACHE_PENDING);
  }
}
