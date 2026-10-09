#!/usr/bin/env node
// What kind of release is this run building — stable or a release candidate?
//
// V2-2.0 (T21′). Every release workflow used to fire on `v*.*.*`, which also
// matches `v2.0.0-rc.1`: an rc tag would have rolled the production cell fleet,
// deployed render, published the hub's `:latest` and npm-published to
// `latest`. The tag filters now keep prereleases away from the fleet
// workflows, and the two workflows an rc DOES run (build-binaries,
// build-desktop) branch on the answer this script gives:
//
//   stable  vX.Y.Z        npm dist-tag `latest`, a normal GitHub release
//   rc      vX.Y.Z-rc.N   npm dist-tag `next`, a PRERELEASE GitHub release —
//                         which GitHub never marks Latest, so stable desktops
//                         (whose updater feed reads only stable releases) and
//                         `npm i @1agh/maude` never see it
//
// The grammar is deliberately narrow: `-rc.N` is the only prerelease the
// pipeline knows how to ship, so `-beta.1`, `-rc.0`, build metadata and
// leading zeros are refused here rather than half-handled downstream.
// `scripts/bump-version.sh` enforces the same grammar on the way in.
//
// The version comes from the TAG on a tag push, and the tag must equal
// package.json — a tag on a commit that was never bumped would otherwise
// publish package.json's version under the tag's channel. On any other ref (a
// `workflow_dispatch` dry run on a branch) it comes from package.json alone.
//
// CLI (inside a workflow step):
//   node scripts/release-kind.mjs
// reads GITHUB_REF_TYPE / GITHUB_REF_NAME / ./package.json, prints the plan,
// writes `version kind npm_tag prerelease msi_version` to $GITHUB_OUTPUT and a
// "what this release touches" table to $GITHUB_STEP_SUMMARY. Exit 1 on refusal.

import { appendFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const NUM = '(0|[1-9]\\d*)';
/** `X.Y.Z` or `X.Y.Z-rc.N` (N ≥ 1), no leading zeros, no build metadata. */
export const RELEASE_VERSION_RE = new RegExp(`^${NUM}\\.${NUM}\\.${NUM}(?:-rc\\.([1-9]\\d*))?$`);

/** @returns {{ major:number, minor:number, patch:number, rc:number|null } | null} */
export function parseReleaseVersion(v) {
  const m = RELEASE_VERSION_RE.exec(String(v ?? ''));
  if (!m) return null;
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
    rc: m[4] === undefined ? null : Number(m[4]),
  };
}

/**
 * The MSI ProductVersion for a release candidate.
 *
 * WiX takes `major.minor.patch[.build]`, numbers only, and Tauri's bundler
 * REFUSES a non-numeric prerelease ("optional pre-release identifier in app
 * version must be numeric-only … for msi target"), so `2.0.0-rc.1` cannot
 * build an .msi as-is. The rc number becomes the fourth field. Windows
 * Installer ignores that field when it decides an upgrade, so rc.N → the
 * stable X.Y.Z (= X.Y.Z.0) installs over it — Tauri's template allows
 * same-version upgrades (and downgrades by default).
 */
function msiVersion(p) {
  if (p.rc === null) return '';
  if (p.major > 255 || p.minor > 255 || p.patch > 65535 || p.rc > 65535) {
    throw new Error(
      `${p.major}.${p.minor}.${p.patch}-rc.${p.rc} cannot be an MSI version (major/minor ≤ 255, patch/rc ≤ 65535)`
    );
  }
  return `${p.major}.${p.minor}.${p.patch}.${p.rc}`;
}

/**
 * @param {{ refType?: string, refName?: string, pkgVersion: string }} input
 * @returns {{ version:string, kind:'stable'|'rc', npmTag:'latest'|'next', prerelease:boolean, msiVersion:string, source:'tag'|'package.json' }}
 * @throws {Error} with a message a release operator can act on
 */
export function classifyRelease({ refType, refName, pkgVersion }) {
  const pkg = parseReleaseVersion(pkgVersion);
  if (!pkg) {
    throw new Error(
      `package.json version '${pkgVersion}' is not a release version (X.Y.Z or X.Y.Z-rc.N) — use scripts/bump-version.sh`
    );
  }
  let source = 'package.json';
  if (refType === 'tag') {
    const tag = String(refName ?? '');
    const fromTag = tag.startsWith('v') ? tag.slice(1) : '';
    if (!parseReleaseVersion(fromTag)) {
      throw new Error(
        `tag '${tag}' is not a release tag (vX.Y.Z or vX.Y.Z-rc.N) — nothing is published for it`
      );
    }
    if (fromTag !== pkgVersion) {
      throw new Error(
        `tag '${tag}' does not match package.json (${pkgVersion}) — run scripts/bump-version.sh ${fromTag}, commit, and re-tag`
      );
    }
    source = 'tag';
  }
  const rc = pkg.rc !== null;
  return {
    version: pkgVersion,
    kind: rc ? 'rc' : 'stable',
    npmTag: rc ? 'next' : 'latest',
    prerelease: rc,
    msiVersion: msiVersion(pkg),
    source,
  };
}

/** Human-readable plan — the decisive lines a dry-run log is read for. */
export function describePlan(r) {
  const lines = [
    `release: ${r.version} (${r.kind}) — version from ${r.source}`,
    `  npm:            @1agh/maude + 7 @1agh/maude-<slug> → dist-tag "${r.npmTag}"${r.kind === 'rc' ? ' (never "latest")' : ''}`,
    `  GitHub release: ${r.prerelease ? 'PRERELEASE — never marked Latest' : 'stable — becomes Latest'}`,
    `  desktop feed:   ${r.prerelease ? 'offered only to installs already on an rc (site/lib/updater-feed.mjs)' : 'offered to every install older than it'}`,
  ];
  if (r.msiVersion) lines.push(`  Windows MSI:    ProductVersion ${r.msiVersion}`);
  lines.push(
    r.kind === 'rc'
      ? '  NOT touched:    hub-image (:latest / :vX), cells-deploy (fleet), render-deploy, selfhost-images — their tag filters exclude prereleases'
      : '  also fired:     hub-image → cells-deploy (fleet), render-deploy, selfhost-images'
  );
  return lines.join('\n');
}

function main() {
  const pkgPath = resolve(process.cwd(), 'package.json');
  let r;
  try {
    const pkgVersion = JSON.parse(readFileSync(pkgPath, 'utf8')).version;
    r = classifyRelease({
      refType: process.env.GITHUB_REF_TYPE,
      refName: process.env.GITHUB_REF_NAME,
      pkgVersion,
    });
  } catch (err) {
    console.error(`::error::${err.message}`);
    process.exit(1);
  }
  console.log(describePlan(r));
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      [
        `version=${r.version}`,
        `kind=${r.kind}`,
        `npm_tag=${r.npmTag}`,
        `prerelease=${r.prerelease}`,
        `msi_version=${r.msiVersion}`,
        '',
      ].join('\n')
    );
  }
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `### Release plan\n\n\`\`\`\n${describePlan(r)}\n\`\`\`\n`
    );
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
