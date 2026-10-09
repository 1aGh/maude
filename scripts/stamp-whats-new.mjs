#!/usr/bin/env node
// Stamp pending What's New entries with the release version + date.
//
// `/flow:done` appends entries with `version: null` (pending — DDR-C). At
// release time, scripts/bump-version.sh calls this to resolve every pending
// entry to the version being shipped, mirroring how changesets accumulate then
// `changeset version` consumes them. No-ops cleanly when the feed is absent or
// has nothing pending.
//
// Usage: node scripts/stamp-whats-new.mjs <version>   (e.g. 0.29.0)

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const version = process.argv[2];
if (!version || !/^\d+\.\d+\.\d+/.test(version)) {
  console.error('usage: stamp-whats-new.mjs <version>   (e.g. 0.29.0)');
  process.exit(2);
}

// A release candidate never consumes pending entries (V2-2.0): rc testers see
// them as "next", and the stable release — what most users install — is the
// one that should carry them. scripts/bump-version.sh skips the call for an rc;
// this is the same rule for anyone running the stamper by hand.
if (/^\d+\.\d+\.\d+-/.test(version)) {
  console.log(`[whats-new] ${version} is a prerelease — pending entries stay pending`);
  process.exit(0);
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const feedPath = resolve(__dirname, '../apps/studio/whats-new.json');
if (!existsSync(feedPath)) {
  console.log('[whats-new] no feed at apps/studio/whats-new.json — skipping stamp');
  process.exit(0);
}

const date = new Date().toISOString().slice(0, 10);
const feed = JSON.parse(readFileSync(feedPath, 'utf8'));
let stamped = 0;
for (const e of feed.entries ?? []) {
  if (e && e.version == null) {
    e.version = version;
    if (e.date == null) e.date = date;
    stamped += 1;
  }
}

if (stamped === 0) {
  console.log('[whats-new] no pending entries to stamp');
  process.exit(0);
}

writeFileSync(feedPath, `${JSON.stringify(feed, null, 2)}\n`);
console.log(
  `[whats-new] stamped ${stamped} pending entr${stamped === 1 ? 'y' : 'ies'} → v${version} (${date})`
);
