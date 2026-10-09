// Tauri auto-update feed (Phase 32 / Task 1; release channels V2-2.0).
//
// The desktop app's updater (apps/desktop/src-tauri/tauri.conf.json →
// plugins.updater.endpoints) requests:
//
//   GET https://maude.sh/releases/{{target}}/{{arch}}/{{current_version}}
//
// where `target` ∈ darwin | windows | linux, `arch` ∈ x86_64 | aarch64 | …, and
// `current_version` is the running build's version. This route picks the release
// to offer, finds the matching Tauri updater artifact + its detached signature,
// and returns the JSON the updater expects — or 204 No Content when the caller is
// already current. The artifact is signed in CI with the ed25519 key whose public
// half is pinned in tauri.conf.json, so a tampered feed can't push a rogue build
// (the client verifies the signature before installing).
//
// CHANNELS (V2-2.0). The channel follows the installed version: a stable install
// is offered only stable releases (GitHub's `releases/latest`, which never lists a
// prerelease, plus a version-string check); an install on a release candidate is
// offered the newest rc, then the stable release that supersedes it. The rules are
// pure functions in site/lib/updater-feed.mjs, tested by
// scripts/test/updater-feed.test.mjs — keep the logic there, not here.
//
// Set GITHUB_TOKEN in the Vercel project to lift the 60-req/h unauthenticated
// GitHub API limit; the response is CDN-cached for 5 min so real traffic rarely
// hits the API.

import { gitConfig } from '@/lib/shared';
import { PLATFORM_EXT, pickArtifact, releasesApiPath, selectRelease } from '@/lib/updater-feed.mjs';

const REPO = `${gitConfig.user}/${gitConfig.repo}`;

interface GhAsset {
  name: string;
  browser_download_url: string;
}
interface GhRelease {
  tag_name: string;
  name: string | null;
  body: string | null;
  published_at: string;
  draft: boolean;
  prerelease: boolean;
  assets: GhAsset[];
}
type Picked = { asset: GhAsset; sigAsset: GhAsset } | { missing: 'artifact' | 'signature' };

function ghHeaders(): HeadersInit {
  const h: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'maude-updater-feed',
  };
  if (process.env.GITHUB_TOKEN) h.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  return h;
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ target: string; arch: string; current_version: string }> }
) {
  const { target, arch, current_version } = await params;

  if (!(PLATFORM_EXT as Record<string, string[]>)[target]) {
    // Static message — never reflect the raw `target` param back in the response.
    return Response.json({ error: 'unsupported target' }, { status: 400 });
  }

  let releases: GhRelease[];
  try {
    const res = await fetch(
      `https://api.github.com/repos/${REPO}/${releasesApiPath(current_version)}`,
      {
        headers: ghHeaders(),
        // Let Vercel's data cache hold the API result for 5 min.
        next: { revalidate: 300 },
      }
    );
    if (!res.ok) {
      return Response.json({ error: `github api ${res.status}` }, { status: 502 });
    }
    // `releases/latest` is one object; the rc channel's list is an array.
    const body = (await res.json()) as GhRelease | GhRelease[];
    releases = Array.isArray(body) ? body : [body];
  } catch {
    return Response.json({ error: 'github api unreachable' }, { status: 502 });
  }

  // Already current (or ahead), or nothing newer on this caller's channel.
  const release = selectRelease(releases, current_version) as GhRelease | null;
  if (!release) return new Response(null, { status: 204, headers: cacheHeaders() });
  const version = release.tag_name.replace(/^v/, '');

  const picked = pickArtifact(release, target, arch) as Picked;
  if ('missing' in picked) {
    // Release exists but has no artifact for this platform yet (e.g. Linux not built).
    if (picked.missing === 'artifact') {
      return new Response(null, { status: 204, headers: cacheHeaders() });
    }
    // The detached signature ships as a sibling `<asset>.sig` release asset.
    return Response.json({ error: 'signature asset missing' }, { status: 502 });
  }
  const { asset, sigAsset } = picked;

  let signature: string;
  try {
    const sigRes = await fetch(sigAsset.browser_download_url, {
      headers: { 'User-Agent': 'maude-updater-feed' },
      next: { revalidate: 300 },
    });
    if (!sigRes.ok) return Response.json({ error: 'signature fetch failed' }, { status: 502 });
    signature = (await sigRes.text()).trim();
  } catch {
    return Response.json({ error: 'signature unreachable' }, { status: 502 });
  }

  return Response.json(
    {
      version,
      notes: release.body || release.name || `Maude ${version}`,
      pub_date: release.published_at,
      url: asset.browser_download_url,
      signature,
    },
    { headers: cacheHeaders() }
  );
}

function cacheHeaders(): HeadersInit {
  return { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600' };
}
