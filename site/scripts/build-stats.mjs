#!/usr/bin/env node
// Compute project stats consumed by the landing page + docs page-meta footer.
// Reads version from package.json, asset counts from plugins/<p>/{commands,skills,agents},
// publishedDate from the matching `v*` tag's date (or today when package.json is
// ahead of the latest tag — see the publishedDate note below), contributor count
// from `git shortlog -sne`, and per-page last-updated dates from `git log -1`.
//
// Output: site/lib/stats.json (gitignored — regenerated every build).
// Run as prebuild step — see site/package.json `prebuild`.

import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '../..');
const out = resolve(__dirname, '../lib/stats.json');
const docsRoot = resolve(__dirname, '../content/docs');

const sh = (cmd, fallback = '') => {
  try {
    return execSync(cmd, {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return fallback;
  }
};

async function countFiles(dir, { extensions, excludeUnderscore = false } = {}) {
  const full = resolve(repoRoot, dir);
  if (!existsSync(full)) return 0;
  const entries = await readdir(full, { withFileTypes: true });
  return entries.filter((e) => {
    if (!e.isFile()) return false;
    if (excludeUnderscore && e.name.startsWith('_')) return false;
    if (extensions && !extensions.some((ext) => e.name.endsWith(ext))) return false;
    return true;
  }).length;
}

async function countDirs(dir) {
  const full = resolve(repoRoot, dir);
  if (!existsSync(full)) return 0;
  const entries = await readdir(full, { withFileTypes: true });
  return entries.filter((e) => e.isDirectory()).length;
}

// Walk content/docs/**/*.mdx -> map of fumadocs `page.path` -> ISO date.
// fumadocs `page.path` is the relative path from content/docs/ to the .mdx file
// (e.g. "design/bootstrap.mdx", "recipes/nextjs.mdx", "index.mdx").
async function buildPageUpdatedMap() {
  const map = {};
  async function walk(dir) {
    const full = resolve(docsRoot, dir);
    if (!existsSync(full)) return;
    const entries = await readdir(full, { withFileTypes: true });
    for (const entry of entries) {
      const rel = dir ? join(dir, entry.name) : entry.name;
      if (entry.isDirectory()) {
        await walk(rel);
      } else if (entry.name.endsWith('.mdx')) {
        // Quote with `'` and escape any literal `'` in the path (rare but
        // possible) so shell expansion is exact.
        const file = resolve(docsRoot, rel);
        const quoted = `'${file.replace(/'/g, `'\\''`)}'`;
        const date = sh(`git log -1 --format=%cs -- ${quoted}`);
        if (date) map[rel] = date;
      }
    }
  }
  await walk('');
  return map;
}

const pkg = JSON.parse(await readFile(resolve(repoRoot, 'package.json'), 'utf8'));

// publishedDate must satisfy two constraints at once:
//   1. STABLE across feature PRs — it may only change when a release is cut, else
//      every PR that regenerates stats.json drifts the value and reds the gate.
//   2. IDENTICAL whether stats.json is generated before or after the release tag
//      exists. The release commit bakes stats.json during pre-push smoke (BEFORE
//      the tag is created); CI then regenerates it with the new tag present.
//
// Deriving purely from the latest tag's date breaks (2): pre-push captures the
// PREVIOUS tag's date while CI captures the new one — a guaranteed drift on every
// release commit (the recurring `stats.json publishedDate` red).
//
// Resolution: when package.json is already tagged (version === latest v* tag), use
// that tag's date — stable, and what every feature PR sees. When package.json is
// AHEAD of the latest tag (an as-yet-untagged release commit), use today — exactly
// what CI computes once the same-day tag lands. Feature PRs never move package.json
// ahead of the tag, so they stay pinned to the release tag's date.
//
// BOTH branches must read the same clock, or the two agree only by luck.
// `%(creatordate:short)` renders in the TAGGER's timezone while the fallback is
// UTC, so a release tagged between 22:00 and 24:00 UTC from CEST (+0200) baked
// UTC-today into the release commit and CI recomputed tagger-tomorrow — a red
// `main` on v0.60.3, from a commit whose stats.json was correct. Force UTC on the
// tag side (`format-local` honors TZ) so the two branches can't disagree.
const latestTagLine = sh(
  "TZ=UTC git for-each-ref --sort=-creatordate --count=1 --format='%(refname:short) %(creatordate:format-local:%Y-%m-%d)' refs/tags/v*"
);
const [latestTag = '', latestTagDate = ''] = latestTagLine.split(/\s+/);
const publishedDate =
  latestTag && latestTag.replace(/^v/, '') === pkg.version
    ? latestTagDate
    : new Date().toISOString().slice(0, 10);

// `git shortlog -sne` honors .mailmap (collapses identities). We then drop bot
// accounts (dependabot, renovate, etc.) so the count reflects humans.
// Reads HEAD instead of `main` so the script works on feature branches too.
//
// NOT EVERY BOT SPELLS ITSELF `[bot]`. `maude-fixbot` does not, and because
// this output is COMMITTED and diffed by a CI gate, that omission turned into a
// recurring red `main`: the fixbot regenerates stats on its own branch, where it
// IS an author, and writes `contributors: 2`; the squash-merge onto main is
// authored by a human, so CI recomputes `1` and the drift check fails. It cost a
// release pre-flight to diagnose, twice — the other session's attempted fix was
// another regenerate, which just flipped it back.
//
// Matched on the identity line, so a human whose commit message happens to
// mention a bot is unaffected.
const BOT_IDENTITIES = /\[bot\]|(?:^|[\s<])maude-fixbot\b/i;
const contributorsRaw = sh('git shortlog -sne HEAD');
const contributors = contributorsRaw
  ? contributorsRaw
      .split('\n')
      .filter(Boolean)
      .filter((line) => !BOT_IDENTITIES.test(line)).length
  : 0;

// Release count + first-release month for the Home proof strip. Same stability rule as
// publishedDate: the release commit is baked BEFORE its tag exists and CI regenerates AFTER, so
// package.json's own version always counts once (tagged or not), and nothing newer than it counts.
// Pre-release tags (v2.0.0-rc.1) are not releases. With no tags at all (a checkout without git
// history) the previous file's values stay, rather than a proof strip reading "0 releases".
const stableTags = sh("git tag -l 'v*'")
  .split('\n')
  .filter((t) => /^v\d+\.\d+\.\d+$/.test(t));
const semver = (v) => v.replace(/^v/, '').split('.').map(Number);
const notNewerThan = (a, b) => {
  const [x, y] = [semver(a), semver(b)];
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i];
  return true;
};
const previous = existsSync(out) ? JSON.parse(await readFile(out, 'utf8')) : {};
const releases =
  stableTags.length > 0
    ? new Set([...stableTags.filter((t) => notNewerThan(t, `v${pkg.version}`)), `v${pkg.version}`])
        .size
    : (previous.releases ?? 0);
const firstReleaseDate =
  sh(
    "TZ=UTC git for-each-ref --sort=creatordate --count=1 --format='%(creatordate:format-local:%Y-%m-%d)' 'refs/tags/v[0-9]*'"
  ) ||
  previous.firstReleaseDate ||
  '';

const stats = {
  // Regenerated every build — do NOT edit by hand. See site/scripts/build-stats.mjs.
  version: `v${pkg.version}`,
  nodeRange: pkg.engines?.node ?? '>=20',
  publishedDate,
  releases,
  firstReleaseDate,
  contributors,
  plugins: {
    design: {
      commands: await countFiles('plugins/design/commands', {
        extensions: ['.md'],
        excludeUnderscore: true,
      }),
      skills: await countDirs('plugins/design/skills'),
      agents: await countFiles('plugins/design/agents', { extensions: ['.md'] }),
    },
    flow: {
      commands: await countFiles('plugins/flow/commands', {
        extensions: ['.md'],
        excludeUnderscore: true,
      }),
      skills: await countDirs('plugins/flow/skills'),
      agents: await countFiles('plugins/flow/agents', { extensions: ['.md'] }),
    },
    maude: {
      subcommands: await countFiles('cli/commands', { extensions: ['.mjs'] }),
    },
  },
  pageUpdated: await buildPageUpdatedMap(),
};

if (Object.keys(stats.pageUpdated).length === 0) {
  console.warn(
    '[stats] WARN buildPageUpdatedMap produced 0 entries — docs `Last updated` lines will render as `--`'
  );
}

await writeFile(out, `${JSON.stringify(stats, null, 2)}\n`);

const designP = stats.plugins.design;
const flowP = stats.plugins.flow;
console.log(
  `[stats] wrote ${out}\n` +
    `        version=${stats.version} · published=${stats.publishedDate} · contributors=${stats.contributors}\n` +
    `        design: ${designP.commands}c / ${designP.skills}s / ${designP.agents}a · ` +
    `flow: ${flowP.commands}c / ${flowP.skills}s / ${flowP.agents}a · ` +
    `maude: ${stats.plugins.maude.subcommands}sub\n` +
    `        page-updated entries: ${Object.keys(stats.pageUpdated).length}`
);
