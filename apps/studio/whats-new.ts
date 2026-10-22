// whats-new.ts — server-side loader for the Maude "What's New" feed.
//
// Single source of truth: `<DEV_SERVER_ROOT>/whats-new.json` (DDR-A). The feed
// describes **Maude's own product** updates — it is resolved from the maude
// package root (via paths.ts, NOT cwd), so the dev-server surfaces the same
// product news whether it runs in this repo or a downstream user's project.
//
// Disk paths MUST come from paths.ts (DDR-045) — never
// `dirname(fileURLToPath(import.meta.url))`, which is the virtual `/$bunfs/root`
// inside a `bun --compile` standalone binary.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEV_SERVER_ROOT } from './paths.ts';

export type WhatsNewKind = 'feature' | 'improvement' | 'usage' | 'fix';

export interface WhatsNewTourStep {
  target: string;
  title: string;
  body: string;
  placement?: 'top' | 'bottom' | 'left' | 'right' | 'auto';
  /** Skip the step when its target is absent (instead of showing it centred). */
  optional?: boolean;
}

export interface WhatsNewEntry {
  id: string;
  version: string | null;
  date: string | null;
  kind: WhatsNewKind;
  title: string;
  summary: string;
  learnMore?: string;
  surface?: string;
  tour?: WhatsNewTourStep[];
  /** false = the tour spotlights chrome that is gone; the panel does not offer "Take tour". Absent = true. */
  replayable?: boolean;
}

export interface WhatsNewFeed {
  /** The installed maude version (key the client compares "seen" against). */
  version: string;
  entries: WhatsNewEntry[];
}

let cache: WhatsNewFeed | null = null;

/**
 * Read the installed maude version.
 *
 * THE ONE resolution path (DDR-045: disk paths come from `paths.ts`). Everything
 * that wants to name the running version — the What's New feed, `/_config`, the
 * status-bar chip — calls this rather than growing a second answer that can
 * disagree with the first.
 *
 * Two sources, in order:
 *
 *   1. the studio's OWN `package.json`. It rides the release line since the
 *      fleet-verification change, and it is the only one of the two that is
 *      staged into the cell image — a cloud tab asking "which version am I on"
 *      gets an answer rather than `dev`.
 *   2. `plugins/design/.claude-plugin/plugin.json`, which ships in BOTH npm
 *      installs and marketplace-cache clones (same rationale as build.ts
 *      `readPluginVersion`). Kept as the fallback so an older layout that lacks
 *      a version-stamped studio manifest still resolves.
 *
 * Falls back to `dev` — a placeholder that is obviously not a release, never a
 * plausible-looking wrong number.
 */
export function resolveMaudeVersion(root: string = DEV_SERVER_ROOT): string {
  const candidates = [
    join(root, 'package.json'),
    join(root, '..', '..', 'plugins', 'design', '.claude-plugin', 'plugin.json'),
  ];
  for (const manifest of candidates) {
    try {
      const parsed = JSON.parse(readFileSync(manifest, 'utf8')) as { version?: unknown };
      // `0.0.0` is the private-workspace placeholder these manifests carried
      // before they joined the release line. Treating it as an answer is how
      // `/health` came to report `0.0.0` for months.
      if (typeof parsed.version === 'string' && parsed.version !== '0.0.0') return parsed.version;
    } catch {
      /* try the next one */
    }
  }
  return 'dev';
}

/**
 * Load `<root>/whats-new.json`. Fails soft to an empty entry list — a missing
 * or malformed feed must never 500 the dev-server (it's a non-critical chrome
 * surface). Caches the default-root result; pass `{ root }` for an uncached
 * read (tests) and `{ fresh: true }` to bypass the cache.
 */
export function loadWhatsNew(opts: { root?: string; fresh?: boolean } = {}): WhatsNewFeed {
  const usingDefaultRoot = opts.root === undefined;
  if (cache && usingDefaultRoot && !opts.fresh) return cache;

  const root = opts.root ?? DEV_SERVER_ROOT;
  const file = join(root, 'whats-new.json');
  let entries: WhatsNewEntry[] = [];
  try {
    if (existsSync(file)) {
      const parsed = JSON.parse(readFileSync(file, 'utf8')) as { entries?: unknown };
      if (Array.isArray(parsed.entries)) entries = parsed.entries as WhatsNewEntry[];
    }
  } catch {
    /* malformed feed → empty, never throw */
  }

  const feed: WhatsNewFeed = { version: resolveMaudeVersion(root), entries };
  if (usingDefaultRoot) cache = feed;
  return feed;
}
