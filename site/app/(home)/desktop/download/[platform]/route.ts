// Stable per-platform download redirect (Phase 32 / Task 3; V2-7.2 stable-only).
//
//   GET /desktop/download/macos    → 302 to the latest .dmg on the newest STABLE GitHub Release
//   GET /desktop/download/windows  → 302 to the latest .msi
//   GET /desktop/download/linux    → 302 to the latest .deb
//
// Asset filenames carry the version (Maude_0.30.0_x64_en-US.msi), so there's no
// version-less URL to link directly. This resolves the newest matching asset at
// request time and 302s to it; on any failure it falls back to the releases page,
// so the button never dead-ends. CDN-cached 5 min.
//
// STABLE ONLY. This is the front door for every first-time visitor, so a release candidate must
// never become the download — by GitHub's flag OR by its version string (a mis-flagged rc would
// pass a flag check). The pick is site/lib/updater-feed.mjs `pickInstaller`, the same channel rule
// a stable install gets from the updater feed; scripts/test/download-redirect.test.mjs pins it.

import { gitConfig } from '@/lib/shared';
import { pickInstaller } from '@/lib/updater-feed.mjs';

const REPO = `${gitConfig.user}/${gitConfig.repo}`;
const RELEASES_PAGE = `https://github.com/${REPO}/releases/latest`;

interface GhAsset {
  name: string;
  browser_download_url: string;
}

function ghHeaders(): HeadersInit {
  const h: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'maude-download-redirect',
  };
  if (process.env.GITHUB_TOKEN) h.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  return h;
}

export async function GET(_req: Request, { params }: { params: Promise<{ platform: string }> }) {
  const { platform } = await params;

  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases?per_page=30`, {
      headers: ghHeaders(),
      next: { revalidate: 300 },
    });
    if (!res.ok) return Response.redirect(RELEASES_PAGE, 302);
    const releases = (await res.json()) as Array<{
      tag_name: string;
      draft: boolean;
      prerelease: boolean;
      assets: GhAsset[];
    }>;
    const asset = pickInstaller(releases, platform) as GhAsset | null;
    return Response.redirect(asset?.browser_download_url ?? RELEASES_PAGE, 302);
  } catch {
    return Response.redirect(RELEASES_PAGE, 302);
  }
}
