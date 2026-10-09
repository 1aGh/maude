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

/**
 * The platform artifact + its detached signature asset.
 * @returns {{ asset: object, sigAsset: object } | { missing: 'artifact' | 'signature' }}
 */
export function pickArtifact(release, target, arch) {
  const exts = PLATFORM_EXT[target] ?? [];
  const tokens = ARCH_TOKENS[arch] ?? [arch];
  const assets = release?.assets ?? [];
  const candidates = assets.filter((a) => exts.some((e) => a.name.endsWith(e)));
  const asset =
    candidates.find((a) => tokens.some((t) => a.name.toLowerCase().includes(t.toLowerCase()))) ??
    candidates[0];
  if (!asset) return { missing: 'artifact' };
  const sigAsset = assets.find((a) => a.name === `${asset.name}.sig`);
  if (!sigAsset) return { missing: 'signature' };
  return { asset, sigAsset };
}
