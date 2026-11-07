// The desktop updater feed's decisions, as pure functions (V2-2.0, T21′).
//
// `site/app/releases/[target]/[arch]/[current_version]/route.ts` is the edge
// route every installed Maude asks "is there an update?" (DDR-126). It used to
// read GitHub's `releases/latest` and compare versions with the prerelease part
// cut off. Both halves were wrong the moment a release candidate exists:
//
//   - an install ON an rc (2.0.0-rc.1) was never offered rc.2 — `latest` never
//     lists a prerelease — and was never promoted to the stable 2.0.0 either,
//     because "2.0.0" vs "2.0.0-rc.1" compared EQUAL with the suffix dropped;
//   - nothing but GitHub's flag kept an rc away from stable installs.
//
// The channel now follows the installed version, which needs no setting and no
// second endpoint (the rc build's tauri.conf.json carries the same URL):
//
//   stable install  → the newest STABLE release newer than it. A prerelease is
//                     never offered — by GitHub's flag OR by its version string,
//                     so a mis-flagged rc release still cannot reach a stable
//                     user.
//   rc install      → the newest release of either kind newer than it, by full
//                     semver precedence: rc.2 over rc.1, then 2.0.0 over every
//                     2.0.0-rc.N — at which point the install is stable again.
//
// Plain ESM with JSDoc so `node --test` can import it without a TS toolchain
// (scripts/test/updater-feed.test.mjs); the route imports it as-is.

const SEMVER =
  /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

/**
 * @param {string} v
 * @returns {{ major:number, minor:number, patch:number, pre:string[] } | null}
 */
export function parseSemver(v) {
  const m = SEMVER.exec(String(v ?? ''));
  if (!m) return null;
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
    pre: m[4] ? m[4].split('.') : [],
  };
}

export const isPrerelease = (v) => (parseSemver(v)?.pre.length ?? 0) > 0;

/** Semver §11 precedence. >0 when a is newer. An unparseable side sorts lowest. */
export function compareSemver(a, b) {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (!pa || !pb) return (pa ? 1 : 0) - (pb ? 1 : 0);
  for (const k of ['major', 'minor', 'patch']) {
    if (pa[k] !== pb[k]) return pa[k] - pb[k];
  }
  // A version WITHOUT a prerelease outranks the same version with one.
  if (!pa.pre.length || !pb.pre.length) return pb.pre.length - pa.pre.length;
  const n = Math.max(pa.pre.length, pb.pre.length);
  for (let i = 0; i < n; i++) {
    const x = pa.pre[i];
    const y = pb.pre[i];
    if (x === undefined) return -1; // fewer fields → lower
    if (y === undefined) return 1;
    const xn = /^\d+$/.test(x);
    const yn = /^\d+$/.test(y);
    if (xn && yn) {
      if (Number(x) !== Number(y)) return Number(x) - Number(y);
    } else if (xn !== yn) {
      return xn ? -1 : 1; // numeric identifiers rank below alphanumeric ones
    } else if (x !== y) {
      return x < y ? -1 : 1;
    }
  }
  return 0;
}

/**
 * The GitHub API path to read for this caller. A stable install reads
 * `releases/latest` (GitHub never returns a prerelease or a draft there); an
 * rc install reads the recent list, because the release it should get may be
 * a prerelease.
 */
export function releasesApiPath(currentVersion) {
  return isPrerelease(currentVersion) ? 'releases?per_page=30' : 'releases/latest';
}

/**
 * The release to offer, or null for "you are current" (204).
 *
 * @param {Array<{ tag_name?: string, draft?: boolean, prerelease?: boolean }>} releases
 * @param {string} currentVersion the caller's `{{current_version}}`
 */
export function selectRelease(releases, currentVersion) {
  const rcChannel = isPrerelease(currentVersion);
  // An unparseable current version is treated as "older than everything" —
  // the behaviour the feed always had for it.
  const current = parseSemver(currentVersion) ? currentVersion : '0.0.0';
  let best = null;
  let bestVersion = null;
  for (const r of releases ?? []) {
    if (!r || r.draft) continue;
    const v = String(r.tag_name ?? '').replace(/^v/, '');
    if (!parseSemver(v)) continue;
    if (!rcChannel && (r.prerelease || isPrerelease(v))) continue;
    if (compareSemver(v, current) <= 0) continue;
    if (!best || compareSemver(v, bestVersion) > 0) {
      best = r;
      bestVersion = v;
    }
  }
  return best;
}

// Tauri updater artifact extension per platform (createUpdaterArtifacts:true):
//   macOS   → <productName>.app.tar.gz
//   Windows → <productName>_<ver>_<arch>_<lang>.msi   (also .nsis .exe)
//   Linux   → <productName>_<ver>_<arch>.AppImage
export const PLATFORM_EXT = {
  darwin: ['.app.tar.gz'],
  windows: ['.msi', '.nsis.zip', '.exe'],
  linux: ['.AppImage.tar.gz', '.AppImage'],
};

// arch tokens that may appear in an asset filename (so a multi-arch release picks
// the right one). Maps the Tauri `arch` param to the tokens we accept.
const ARCH_TOKENS = {
  x86_64: ['x86_64', 'x64', 'amd64'],
  aarch64: ['aarch64', 'arm64'],
  i686: ['i686', 'x86', 'ia32'],
  armv7: ['armv7', 'armhf'],
};

// The same release also carries the npm CLI's standalone binaries (`maude-darwin-arm64`,
// `maude-win32-x64.exe`, …, from build-binaries.yml). They are never an updater artifact —
// the Tauri bundles are named after productName `Maude_…` / `Maude.app…` — but the Windows
// one ends in `.exe` and names `x64`, and it sorts first: in 2.0.8 the feed picked it and
// answered every Windows install 502 "signature asset missing".
const isCliBinary = (name) => name.startsWith('maude-');

/**
 * The platform artifact + its detached signature asset.
 *
 * Extensions are tried in PLATFORM_EXT order (Windows: the .msi, then the NSIS installer),
 * and within one extension the asset that names this arch comes first, then the rest (a
 * universal macOS bundle names none). The first SIGNED candidate wins; `missing: 'signature'`
 * only when there are candidates and none has its `<asset>.sig`.
 *
 * @returns {{ asset: object, sigAsset: object } | { missing: 'artifact' | 'signature' }}
 */
export function pickArtifact(release, target, arch) {
  const exts = PLATFORM_EXT[target] ?? [];
  const tokens = (ARCH_TOKENS[arch] ?? [arch]).map((t) => String(t).toLowerCase());
  const assets = release?.assets ?? [];
  const namesArch = (a) => tokens.some((t) => a.name.toLowerCase().includes(t));
  let unsigned = false;
  for (const ext of exts) {
    const ofExt = assets.filter((a) => a.name.endsWith(ext) && !isCliBinary(a.name));
    const ordered = [...ofExt.filter(namesArch), ...ofExt.filter((a) => !namesArch(a))];
    for (const asset of ordered) {
      const sigAsset = assets.find((a) => a.name === `${asset.name}.sig`);
      if (sigAsset) return { asset, sigAsset };
      unsigned = true;
    }
  }
  return { missing: unsigned ? 'signature' : 'artifact' };
}

// The user-facing installer per platform (the marketing "Download for Mac" button, V2-7.2) — NOT
// the updater artifact above: no .app.tar.gz / .sig here.
export const INSTALLER_EXT = {
  macos: ['.dmg'],
  windows: ['.msi'],
  // Linux ships a .deb (the AppImage target was dropped — the Bun-static sidecar breaks
  // linuxdeploy). `.AppImage` stays as a fallback match in case a release brings it back.
  linux: ['.deb', '.AppImage'],
};

/**
 * The installer asset a first-time visitor downloads, or null (the caller then sends them to the
 * releases page). Always the newest STABLE release — the same rule a stable install gets from the
 * updater feed, so a release candidate (flagged or not) can never become the front-door download.
 *
 * @param {Array<{ tag_name?: string, draft?: boolean, prerelease?: boolean, assets?: Array<{ name: string }> }>} releases
 * @param {string} platform macos | windows | linux
 */
export function pickInstaller(releases, platform) {
  const exts = INSTALLER_EXT[platform];
  if (!exts) return null;
  const release = selectRelease(releases, '0.0.0');
  return release?.assets?.find((a) => exts.some((e) => a.name.endsWith(e))) ?? null;
}

// Where /desktop/download/<platform> sends a visitor, and for how long the CDN may keep that answer
// (2.0.2). Two rules, both learnt from the 2.0.1 release, when the button sent visitors to 1.10.0
// three hours after 2.0.0 had shipped with its installers:
//
//   - ONLY the newest stable release's installer is ever the download. When that release has no
//     installer for the platform yet (the desktop build uploads it ~15 min after the release is
//     published), the visitor gets that release's page — never an older release's installer.
//   - The answer is cached for a BOUNDED time and never served stale. The 1.10.0 redirect was
//     Next's data cache: `fetch(…, { next: { revalidate: 300 } })` is stale-while-revalidate, so the
//     first request after a quiet spell is answered from the last list fetched, however old. The
//     route now reads the list uncached and these headers cache the redirect itself, at the CDN —
//     5 minutes for an installer, 30 seconds for anything that is not one (an upload in progress,
//     GitHub refusing the API call), so "not there yet" is never kept as if it were final.
export const DOWNLOAD_CACHE_FINAL = 'public, max-age=0, s-maxage=300';
export const DOWNLOAD_CACHE_PENDING = 'public, max-age=0, s-maxage=30';

/**
 * @param {unknown} releases the GitHub releases list (anything else is treated as unreadable)
 * @param {string} platform macos | windows | linux
 * @param {string} repo `owner/name`
 * @returns {{ location: string, cacheControl: string }}
 */
export function downloadRedirect(releases, platform, repo) {
  const releasesPage = `https://github.com/${repo}/releases/latest`;
  const pending = (location) => ({ location, cacheControl: DOWNLOAD_CACHE_PENDING });
  if (!INSTALLER_EXT[platform] || !Array.isArray(releases)) return pending(releasesPage);
  const release = selectRelease(releases, '0.0.0');
  if (!release) return pending(releasesPage);
  const asset = pickInstaller([release], platform);
  if (asset?.browser_download_url) {
    return { location: asset.browser_download_url, cacheControl: DOWNLOAD_CACHE_FINAL };
  }
  return pending(
    `https://github.com/${repo}/releases/tag/${encodeURIComponent(String(release.tag_name))}`
  );
}
