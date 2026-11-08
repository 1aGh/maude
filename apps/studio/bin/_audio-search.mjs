#!/usr/bin/env bun
// _audio-search.mjs — internal shim behind `maude design audio-search` (DDR-062).
// Reuse-before-you-pay for AUDIO (Task 2.5): before generating a new music/SFX/VO
// track, search the project's OWN generated audio (intent sidecars) AND — when
// ElevenLabs is configured — the user's re-downloadable History (free, already
// paid), and prefer an existing suitable track over spending credits.
//
// The search + reuse run SERVER-SIDE (the key is resolved by the sidecar, never
// handed to this CLI), so this verb is a pure fetch to the running dev server's
// privileged /_api/generate/audio-search + /_api/generate/audio-reuse routes —
// exactly like generate.sh. No client-side inference.
//
// Usage:
//   audio-search.mjs --query "<text>" [--root <repo>] [--reuse <historyId>] [--json]
//
// Default: print ranked candidates (local assets + ElevenLabs history).
// --reuse <historyId>: re-download that history item into assets/<sha8>.mp3 (NO
//   credit) and print the localized path (for $(...) capture).
//
// Stdout (last line, --reuse): the localized `/assets/<sha8>.mp3` path.
// Exit: 0 ok / 1 server problem / 2 bad args / 3 search/reuse failed.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { studioHeadersFor } from '../../../cli/lib/studio-locate.mjs';

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--query' || a === '-q') out.query = next();
    else if (a === '--root') out.root = next();
    else if (a === '--reuse') out.reuse = next();
    else if (a === '--json') out.json = true;
    else if (a === '--help' || a === '-h') out.help = true;
    else if (!out.query && !a.startsWith('-')) out.query = a; // bare positional query
  }
  return out;
}

function resolvePort(repo) {
  const serverPath = join(repo, '.design', '_server.json');
  if (!existsSync(serverPath)) {
    process.stderr.write(
      'audio-search: no _server.json (start the dev server first: maude design server-up)\n'
    );
    process.exit(1);
  }
  try {
    const port = JSON.parse(readFileSync(serverPath, 'utf8'))?.port;
    if (port) return port;
  } catch {
    /* fall through */
  }
  process.stderr.write(`audio-search: could not read a port from ${serverPath}\n`);
  process.exit(1);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || (!args.query && !args.reuse)) {
    process.stderr.write(
      'usage: maude design audio-search --query "<text>" [--root <repo>] [--reuse <historyId>] [--json]\n' +
        '  Searches your own generated audio + ElevenLabs history; prefers reuse over paying again.\n'
    );
    process.exit(args.help ? 0 : 2);
  }
  const repo = args.root || process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const port = resolvePort(repo);
  const base = `http://127.0.0.1:${port}/_api/generate`;
  // sec-loopback-bearer §7.6 — the studio's API key (the app's attested server, or a terminal one's)
  const keyed = await studioHeadersFor(repo, port);

  if (args.reuse) {
    try {
      const res = await fetch(`${base}/audio-reuse`, {
        method: 'POST',
        headers: { ...keyed, 'content-type': 'application/json' },
        body: JSON.stringify({ id: args.reuse }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        process.stderr.write(`audio-search: reuse rejected: ${json?.error ?? res.status}\n`);
        process.exit(3);
      }
      process.stderr.write('audio-search: re-downloaded from history (no credit spent).\n');
      process.stdout.write(`/${String(json.asset).replace(/^\//, '')}\n`);
      return;
    } catch (err) {
      process.stderr.write(
        `audio-search: could not reach the dev server: ${err?.message ?? err}\n`
      );
      process.exit(1);
    }
  }

  let data;
  try {
    const res = await fetch(`${base}/audio-search?q=${encodeURIComponent(args.query)}`, {
      headers: keyed,
    });
    data = await res.json();
    if (!res.ok) {
      process.stderr.write(`audio-search: ${data?.error ?? res.status}\n`);
      process.exit(3);
    }
  } catch (err) {
    process.stderr.write(`audio-search: could not reach the dev server: ${err?.message ?? err}\n`);
    process.exit(1);
  }

  if (args.json) {
    process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
    return;
  }

  const local = data.local ?? [];
  const history = data.history ?? [];
  if (local.length === 0 && history.length === 0) {
    process.stderr.write(
      `audio-search: no reusable audio for "${args.query}" — generate a new track.\n`
    );
    return;
  }
  const pct = (s) => `${Math.round((s ?? 0) * 100)}%`;
  // The `prompt` is peer-synced / provider-returned UNTRUSTED text (server-side
  // sanitized to a single capped line). Present it as a clearly-delimited data
  // field, never as prose the agent should act on (F3, ethical-hacker).
  const promptField = (s) => `prompt=${JSON.stringify(s ?? '')}`;
  if (local.length) {
    process.stdout.write('Local (reuse for free — already in assets/):\n');
    for (const m of local)
      process.stdout.write(
        `  [${pct(m.score)}] ${m.ref}${m.kind ? ` (${m.kind})` : ''}  ${promptField(m.prompt)}\n`
      );
  }
  if (history.length) {
    process.stdout.write('ElevenLabs history (reuse with --reuse <id> — no credit):\n');
    for (const m of history)
      process.stdout.write(`  [${pct(m.score)}] ${m.ref}  ${promptField(m.prompt)}\n`);
  }
}

if (import.meta.main) main();
