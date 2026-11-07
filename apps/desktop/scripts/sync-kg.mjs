#!/usr/bin/env node
// Stage the kgai engine (`kg` binary + its native `libkuzu`) AND the kgai Claude
// Code plugin tree into the Tauri bundle, so the packaged `.app` can record
// decisions into the knowledge graph with ZERO install — including autonomous
// capture inside the ACP chat panel (feature-kgai-ecosystem-integration Phase 8).
//
// WHY a build-time fetch and not a vendored copy: this mirrors sync-sidecar /
// sync-agent-browser — third-party binaries are fetched at build time from a
// PINNED upstream release, never committed. The pin lives in
// `config.knowledgeGraph.engineVersion` (KGAI_VERSION below is the build-side
// mirror); advancing it is deliberate + harness-verified (`maude kg
// check-upstream`), never floating — an auto-tracking `latest` would let an
// upstream change silently alter behavior in a signed build (DDR-054/056
// supply-chain reasoning; the Phase-8 bundling DDR owns the policy).
//
// kgai is MIT-licensed (kgaidev/kgai); its LICENSE is staged alongside the tree.
//
// Layout produced:
//   apps/desktop/.kg-staging/kg-<target-triple>      ← the engine, per-triple
//   apps/desktop/.kg-staging/kg                      ← the one the app resolves
//     (on macOS universal the CI lipos the two per-triple files into this name)
//   apps/desktop/.kg-staging/plugins/                ← the kgai Claude Code plugin
//   → stage-resources.mjs copies all of it into src-tauri/resources/{kgai,plugins/kgai}
//   src-tauri/resources/kgai/libkuzu.<ext>           ← native lib (macOS: kg's `@loader_path` rpath,
//                                                       added below; Linux: KGAI_LIB→LD_LIBRARY_PATH)
//   src-tauri/resources/plugins/kgai/                ← the Claude Code plugin (Stop-hook autocapture)
//
// Opt out with MAUDE_SKIP_KG_SYNC=1 (the build then ships without kgai; every
// `maude kg` verb degrades to the documented inactive no-op — no crash).

import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ensureLoaderPathRpath } from './kg-rpath.mjs';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const BIN_DIR = resolve(SCRIPT_DIR, '..', 'src-tauri', 'binaries');
// Fetch target. NOT `src-tauri/resources/` directly: `stage-resources.mjs` owns
// that tree and starts by `rmSync`-ing it, and it runs AFTER us in
// `beforeBuildCommand` — so anything we wrote there was deleted before
// tauri-build looked for it ("resource path `resources/kgai` doesn't exist",
// v0.48.0's desktop legs). Single responsibility: we fetch into a staging dir,
// stage-resources copies it in.
const STAGE_DIR = resolve(SCRIPT_DIR, '..', '.kg-staging');

/** PINNED kgai release — mirror of config.knowledgeGraph.engineVersion. */
const KGAI_VERSION = 'v1.4.0';
const KGAI_REPO = 'kgaidev/kgai';

// api.github.com allows 60 requests/hour to UNAUTHENTICATED callers, counted per
// source IP — and GitHub's hosted runners share IPs across every customer's jobs.
// One macOS leg spends ~30 of those (two arches × a recursive plugin-tree walk),
// so the quota is a coin flip: the same code that staged kgai fine on the v0.49.1
// tag run answered `release metadata fetch failed: 403` half an hour later. A
// token — any token, even one scoped to an unrelated repo — raises the ceiling to
// 5000/hour and makes this deterministic. Absent one we still try unauthenticated
// (a local `pnpm dev:desktop` has no token and usually has quota to spare).
const GH_TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '';

/** Headers for api.github.com. Only api.github.com — never the CDN hosts below. */
function apiHeaders() {
  const h = { 'user-agent': 'maude-sync-kg', accept: 'application/vnd.github+json' };
  if (GH_TOKEN) h.authorization = `Bearer ${GH_TOKEN}`;
  return h;
}

/** Turn a bare status into something that says what to do about it. */
function apiError(what, status) {
  const hint =
    status === 403 || status === 429
      ? GH_TOKEN
        ? ' (rate-limited even WITH a token — wait, or re-run later)'
        : ' — api.github.com rate limit; set GITHUB_TOKEN for the 5000/h ceiling'
      : '';
  return new Error(`${what}: HTTP ${status}${hint}`);
}

if (process.env.MAUDE_SKIP_KG_SYNC === '1') {
  console.log('[sync-kg] MAUDE_SKIP_KG_SYNC=1 — skipping (bundle ships without kgai).');
  process.exit(0);
}

function detectSlug() {
  const p = process.platform;
  const a = process.arch;
  if (p === 'darwin') return a === 'arm64' ? 'darwin-arm64' : 'darwin-x64';
  if (p === 'win32') return 'win32-x64';
  if (p === 'linux') return a === 'arm64' ? 'linux-arm64' : 'linux-x64';
  return null;
}

// Maude slug → Rust/Tauri target triple (DDR-106 table, mirrors sync-sidecar).
const TRIPLE = {
  'darwin-arm64': 'aarch64-apple-darwin',
  'darwin-x64': 'x86_64-apple-darwin',
  'linux-x64': 'x86_64-unknown-linux-gnu',
  'linux-arm64': 'aarch64-unknown-linux-gnu',
  'win32-x64': 'x86_64-pc-windows-msvc',
};

// Maude slug → kgai release asset names. kgai publishes darwin + linux only
// (v1.4.0); Windows has no prebuilt → the build ships without kgai there.
const ASSETS = {
  'darwin-arm64': { kg: 'kg-darwin-arm64', lib: 'libkuzu-darwin-universal.dylib', libExt: 'dylib' },
  'darwin-x64': { kg: 'kg-darwin-x86_64', lib: 'libkuzu-darwin-universal.dylib', libExt: 'dylib' },
  'linux-x64': { kg: 'kg-linux-x86_64', lib: 'libkuzu-linux-x86_64.so', libExt: 'so' },
  'linux-arm64': { kg: 'kg-linux-aarch64', lib: 'libkuzu-linux-aarch64.so', libExt: 'so' },
};

const slug = process.env.MAUDE_SIDECAR_SLUG || detectSlug();
if (!slug || !TRIPLE[slug]) {
  console.error(`[sync-kg] unsupported platform slug: ${slug}`);
  process.exit(1);
}
if (!ASSETS[slug]) {
  // Still create the resource dir + stamp: `tauri.conf.json` maps it
  // unconditionally, and an absent dir fails the bundle. The app simply finds no
  // engine and `maude kg` reports inactive — the documented degradation.
  mkdirSync(STAGE_DIR, { recursive: true });
  writeFileSync(
    join(STAGE_DIR, 'VERSION'),
    `${KGAI_VERSION}\nrepo: ${KGAI_REPO}\nlicense: MIT\nslug: ${slug}\nengine: NOT BUNDLED (kgai publishes no ${slug} prebuild)\n`
  );
  console.log(
    `[sync-kg] kgai publishes no prebuilt for ${slug} — bundle ships without the engine.`
  );
  process.exit(0);
}

const triple = TRIPLE[slug];
const asset = ASSETS[slug];
const relBase = `https://github.com/${KGAI_REPO}/releases/download/${KGAI_VERSION}`;

/** Release asset sizes, so a truncated download is caught rather than shipped. */
async function assetSizes() {
  const res = await fetch(
    `https://api.github.com/repos/${KGAI_REPO}/releases/tags/${KGAI_VERSION}`,
    { headers: apiHeaders() }
  );
  if (!res.ok) throw apiError('release metadata fetch failed', res.status);
  const rel = await res.json();
  const map = {};
  for (const a of rel.assets ?? []) map[a.name] = a.size;
  return map;
}

/**
 * Download in ranged chunks with a per-chunk size check.
 *
 * GOTCHA (measured 2026-07-22): GitHub's release CDN truncates large assets
 * (libkuzu is ~34 MB) on a flaky link — a plain `curl -L` silently produced a
 * short file that then failed `codesign` with "main executable failed strict
 * validation" and SIGKILLed at runtime. Chunked ranged GETs stay under the drop
 * threshold, and the final size assert makes a short download a BUILD failure
 * instead of a broken signed bundle.
 */
async function download(url, dest, expectedSize) {
  const CHUNK = 4 * 1024 * 1024;
  const parts = [];
  for (let start = 0; start < expectedSize; start += CHUNK) {
    const end = Math.min(start + CHUNK - 1, expectedSize - 1);
    let ok = false;
    for (let attempt = 1; attempt <= 8 && !ok; attempt++) {
      try {
        const res = await fetch(url, { headers: { Range: `bytes=${start}-${end}` } });
        if (!res.ok && res.status !== 206) throw new Error(`HTTP ${res.status}`);
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length !== end - start + 1) throw new Error(`short chunk ${buf.length}`);
        parts.push(buf);
        ok = true;
      } catch (e) {
        if (attempt === 8) throw new Error(`chunk ${start}-${end} failed: ${e.message}`);
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
  }
  const all = Buffer.concat(parts);
  if (all.length !== expectedSize) {
    throw new Error(`size mismatch for ${dest}: got ${all.length}, want ${expectedSize}`);
  }
  writeFileSync(dest, all);
}

/** Fetch the pinned kgai plugin tree (hooks/skills/commands + manifest + LICENSE). */
async function fetchPluginTree(outDir) {
  const WANT = ['.claude-plugin', 'hooks', 'skills', 'commands'];
  const base = `https://api.github.com/repos/${KGAI_REPO}/contents`;
  const walk = async (path, dest) => {
    const res = await fetch(`${base}/${path}?ref=${KGAI_VERSION}`, { headers: apiHeaders() });
    if (!res.ok) throw apiError(`contents ${path}`, res.status);
    const items = await res.json();
    mkdirSync(dest, { recursive: true });
    for (const it of items) {
      if (it.type === 'dir') {
        await walk(`${path}/${it.name}`, join(dest, it.name));
      } else if (it.type === 'file' && it.download_url) {
        const f = await fetch(it.download_url, { headers: { 'user-agent': 'maude-sync-kg' } });
        if (!f.ok) throw new Error(`download ${it.path}: HTTP ${f.status}`);
        const buf = Buffer.from(await f.arrayBuffer());
        writeFileSync(join(dest, it.name), buf);
        if (it.name.endsWith('.sh')) chmodSync(join(dest, it.name), 0o755);
      }
    }
  };
  // The plugin tree is arch-independent, but a universal macOS build runs this
  // script once PER ARCH — so an unguarded walk pays the recursive contents-API
  // cost twice for a byte-identical result. Halving it matters when the quota is
  // what breaks the build (see the rate-limit note on GH_TOKEN).
  const pinFile = join(outDir, '.kgai-pin');
  if (existsSync(pinFile) && readFileSync(pinFile, 'utf8').trim() === KGAI_VERSION) {
    console.log(`[sync-kg] plugin tree already staged at ${KGAI_VERSION} — skipping refetch`);
    return;
  }
  rmSync(outDir, { recursive: true, force: true });
  for (const top of WANT) await walk(top, join(outDir, top));

  // NEUTRALIZE kgai's SessionStart hook. Upstream it runs `scripts/install.sh`
  // (fetches/builds the engine, needs Go + network, 180 s timeout) — dead weight
  // here: the binary is PRE-STAGED as a signed sidecar, and the DDR-177 target
  // user has no toolchain. We deliberately do not stage `scripts/`, so leaving
  // the entry would fail loudly at every session start. Keep ONLY the `Stop`
  // hook — that's the autonomous-capture nudge this bundling exists for.
  const hooksPath = join(outDir, 'hooks', 'hooks.json');
  if (existsSync(hooksPath)) {
    const parsed = JSON.parse(readFileSync(hooksPath, 'utf8'));
    const stop = parsed?.hooks?.Stop;
    if (!stop)
      throw new Error('kgai hooks.json has no Stop hook — autonomous capture would be inert');
    writeFileSync(hooksPath, `${JSON.stringify({ hooks: { Stop: stop } }, null, 2)}\n`);
    console.log(
      '[sync-kg] neutralized kgai SessionStart install hook (binary is pre-staged); kept Stop capture'
    );
  }
  // LICENSE — kgai is MIT; ship the license text with the vendored tree.
  const lic = await fetch(
    `https://raw.githubusercontent.com/${KGAI_REPO}/${KGAI_VERSION}/LICENSE`,
    {
      headers: { 'user-agent': 'maude-sync-kg' },
    }
  );
  if (lic.ok) writeFileSync(join(outDir, 'LICENSE'), Buffer.from(await lic.arrayBuffer()));
  // Written LAST — a half-fetched tree must not look complete to the next run.
  writeFileSync(pinFile, `${KGAI_VERSION}\n`);
}

async function main() {
  const sizes = await assetSizes();
  const kgSize = sizes[asset.kg];
  const libSize = sizes[asset.lib];
  if (!kgSize || !libSize) {
    throw new Error(`release ${KGAI_VERSION} is missing ${asset.kg} / ${asset.lib}`);
  }

  mkdirSync(BIN_DIR, { recursive: true });
  mkdirSync(STAGE_DIR, { recursive: true });

  const exe = slug.startsWith('win32') ? '.exe' : '';
  // NOT an `externalBin` sidecar: that list is static, so every platform in the
  // desktop matrix would be REQUIRED to supply a `kg-<triple>` — and kgai
  // publishes no Windows build, which would fail the Windows leg outright.
  // Shipping it as a resource makes the engine per-platform OPTIONAL, which is
  // exactly the capability-gated contract (`maude kg` degrades to inactive).
  // Cost: Tauri does not sign it for us — the macOS CI codesigns it explicitly
  // (hardened runtime) before `tauri build`, as DDR-190 anticipated.
  const kgDest = join(STAGE_DIR, `kg-${triple}${exe}`);
  const libDest = join(STAGE_DIR, `libkuzu.${asset.libExt}`);

  console.log(
    `[sync-kg] ${KGAI_VERSION} ${slug} → ${asset.kg} (${kgSize} B), ${asset.lib} (${libSize} B)`
  );
  await download(`${relBase}/${asset.kg}`, kgDest, kgSize);
  await download(`${relBase}/${asset.lib}`, libDest, libSize);
  if (!exe) chmodSync(kgDest, 0o755);
  // macOS: upstream's rpaths are kgai's CI path + `@loader_path/../lib`, but libkuzu ships NEXT
  // to kg (`Resources/kgai/`), and the hardened runtime strips DYLD_LIBRARY_PATH — so without
  // `@loader_path` every bundled `kg` call dies in dyld (#128 §10). Patched here, per triple and
  // before the CI lipo + codesign: a load-command edit invalidates a signature. Throws on failure.
  if (slug.startsWith('darwin')) {
    const r = ensureLoaderPathRpath(kgDest);
    console.log(`[sync-kg] rpath @loader_path ${r === 'added' ? 'added to' : 'already on'} kg`);
  }
  // Host-native build: also publish the plain `kg` the resolver looks for. A
  // cross-arch staging run (MAUDE_SIDECAR_SLUG set for a universal build) skips
  // this — CI lipos the per-triple files into `kg` itself.
  if (!process.env.MAUDE_KG_NO_ALIAS) {
    copyFileSync(kgDest, join(STAGE_DIR, `kg${exe}`));
    if (!exe) chmodSync(join(STAGE_DIR, `kg${exe}`), 0o755);
  }

  console.log(`[sync-kg] plugin tree → ${join(STAGE_DIR, 'plugins')}`);
  await fetchPluginTree(join(STAGE_DIR, 'plugins'));

  // Stamp the pin so the bundle-completeness gate + support can see what shipped.
  writeFileSync(
    join(STAGE_DIR, 'VERSION'),
    `${KGAI_VERSION}\nrepo: ${KGAI_REPO}\nlicense: MIT\nslug: ${slug}\n`
  );

  for (const [label, p] of [
    ['kg', kgDest],
    ['libkuzu', libDest],
  ]) {
    console.log(`[sync-kg] ✓ ${label}: ${p} (${statSync(p).size} B)`);
  }
  if (!existsSync(join(STAGE_DIR, 'plugins', 'hooks'))) {
    throw new Error('kgai plugin tree staged without hooks/ — autonomous capture would be inert');
  }
}

main().catch((e) => {
  console.error(`[sync-kg] ${e.message}`);
  console.error('[sync-kg] set MAUDE_SKIP_KG_SYNC=1 to build without kgai.');
  process.exit(1);
});
