// `maude design link|unlink|status|adopt` — peer pairing against a hub.
//
// Phase 9 Task 3. Pairs a local `.design/`-bearing repo clone with a hub URL
// + per-user token. The actual bidirectional file sync (Yjs ↔ disk) is Task 4;
// this command sets up the linked state the sync agent later reads.
//
// Two-file plumbing:
//   .design/config.json       (committed)  →  linkedHub: { url, linkedAt, adopt? }
//   ~/.config/maude/hubs.json (per-machine) →  { [url]: { token, linkedAt } }
//
// Token NEVER lands in .design/config.json — that's git-committed.

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';

import { parseArgs } from './argv.mjs';
import { adoptToHub, detachToRepo, ownershipState } from './design-ownership.mjs';
import { BEGIN_MARKER, writeGitignoreBlock } from './gitignore-block.mjs';
import {
  addHub,
  getHub,
  isHubTrusted,
  normalizeUrl,
  removeHub,
  setHubCodeModules,
  setHubUnlimitedDeletes,
  trustHub,
} from './hubs-config.mjs';

const DESIGN_CONFIG_PATH = '.design/config.json';
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

// ---------------------------------------------------------------- link

export async function runLink({ args, cwd = process.cwd(), forceAdopt = false }) {
  const tail = args.slice(args.indexOf(forceAdopt ? 'adopt' : 'link') + 1);
  const { flags, positional } = parseArgs(tail, {
    booleans: ['adopt', 'force', 'yes', 'sync-tsx', 'no-sync-tsx'],
  });
  const url = positional[0];
  const token = flags.token;

  if (!url) {
    process.stderr.write('maude design link: <url> positional argument is required.\n');
    process.exit(2);
  }
  if (!token || typeof token !== 'string') {
    process.stderr.write('maude design link: --token <value> is required.\n');
    process.exit(2);
  }

  const adopt = forceAdopt || !!flags.adopt;
  const designConfigPath = resolve(cwd, DESIGN_CONFIG_PATH);
  if (!existsSync(designConfigPath)) {
    process.stderr.write(
      `maude design link: no ${DESIGN_CONFIG_PATH} in ${cwd}. Run 'maude design init' first.\n`
    );
    process.exit(1);
  }

  let normUrl;
  try {
    normUrl = normalizeUrl(url);
  } catch (err) {
    process.stderr.write(`maude design link: ${err.message}\n`);
    process.exit(2);
  }

  const cfg = readDesignConfig(designConfigPath);

  // DDR-054 F2/F4: linking to a non-loopback hub grants a remote actor the same
  // write access to .design/ as the local user (hub-pushed content lands on
  // disk verbatim, like `git pull` from a stranger). Require explicit trust for
  // a new remote hub. Trust is checked PER-MACHINE (`isHubTrusted`), never from
  // a committable repo file — a committed allowlist (or the committed
  // `linkedHub.url` itself) would let a malicious PR pre-seed trust and bypass
  // this gate (trust laundering). Loopback dev hubs are exempt.
  const loopback = isLoopbackUrl(normUrl);
  const alreadyTrusted = loopback || isHubTrusted(normUrl);
  const manifest = adopt ? collectAdoptManifest(cwd) : [];

  if (!alreadyTrusted) {
    process.stderr.write(trustGateText(normUrl, adopt, manifest));
    if (flags.yes) {
      process.stderr.write('  → confirmed via --yes\n');
    } else if (process.stdin.isTTY) {
      const question = adopt
        ? `Link this repo to ${normUrl} AND push local design state up to it? [y/N] `
        : `Link this repo to ${normUrl}? [y/N] `;
      const ok = await promptYesNo(question);
      if (!ok) {
        process.stderr.write('maude design link: aborted — hub not trusted.\n');
        process.exit(1);
      }
    } else {
      process.stderr.write(
        `maude design link: linking to a non-local hub (${normUrl}) requires confirmation.\n  Re-run in an interactive terminal, or pass --yes to confirm non-interactively.\n`
      );
      process.exit(1);
    }
    // NOTE: trust is recorded AFTER the link succeeds (below), not here — an
    // aborted link (probe fail without --force, config write throws) must not
    // leave a persisted trust that silently skips the gate on a later re-link.
  } else if (adopt && manifest.length > 0) {
    // Trusted (e.g. localhost) adopt — surface the manifest informationally.
    process.stdout.write(adoptManifestText(normUrl, manifest));
  }

  // Reachability probe — best-effort. Hub auth happens on WS upgrade (Task 4),
  // so a successful /health response only tells us the hub is up + reachable.
  // Token validity is verified when the sync agent connects for real.
  const probe = await probeHealth(normUrl);
  if (!probe.ok && !flags.force) {
    process.stderr.write(
      `maude design link: cannot reach ${normUrl}/health (${probe.error}).\n  Pass --force to link anyway (e.g. hub is behind a firewall + you trust the URL).\n`
    );
    process.exit(1);
  }

  // DDR-102 incident learning (same-machine token overwrite): hubs.json is
  // keyed per hub URL only, so a second `link --token` silently replaced the
  // first machine-wide — both dev servers then authenticated as the same
  // label and shared one hub rate bucket. Make the overwrite explicit.
  if (getHub(normUrl)) {
    process.stdout.write(
      `[design link] note: replacing the stored token for ${normUrl} (the token is per-machine — this applies to EVERY project linked to this hub on this machine).\n`
    );
  }

  // Write hub side: token (+ adopt attestation) in ~/.config/maude/hubs.json.
  const hubRecord = addHub(normUrl, token, adopt ? { adoptedAt: Date.now() } : {});

  // Write project side: linkedHub field on .design/config.json.
  const existing = cfg.linkedHub;
  if (existing && !flags.force) {
    process.stdout.write(
      `[design link] note: replacing existing link to ${existing.url} (was added ${new Date(existing.linkedAt).toISOString()}).\n`
    );
  }
  // DDR-079 — TSX sync defaults ON, so we only PERSIST `syncTsx` when it's an
  // explicit choice; absence means "the default", and we never write
  // `syncTsx: true` just to encode the default (that's what bit us — a value
  // that git-restore could wipe to silently flip behavior). Precedence:
  //   --no-sync-tsx → false (project-wide opt-out)
  //   --sync-tsx    → true  (explicit, == default; useful to pin against a future
  //                          default change or to self-document)
  //   else, re-link to the SAME hub → carry the existing explicit value forward
  //         (a NEW hub URL is a fresh trust decision — don't inherit, DDR-054 F2)
  //   else          → omit (= on by default)
  let syncTsx;
  if (flags['no-sync-tsx']) syncTsx = false;
  else if (flags['sync-tsx']) syncTsx = true;
  else if (existing && existing.url === normUrl && typeof existing.syncTsx === 'boolean') {
    syncTsx = existing.syncTsx;
  }
  cfg.linkedHub = {
    url: normUrl,
    linkedAt: hubRecord.linkedAt,
    ...(adopt ? { adopt: true } : {}),
    ...(syncTsx !== undefined ? { syncTsx } : {}),
  };
  writeDesignConfig(designConfigPath, cfg);

  // Record per-machine trust only now that the link fully succeeded, so a
  // later re-link to this hub won't re-prompt. Skipped for loopback + hubs
  // already trusted on this machine.
  if (!alreadyTrusted) trustHub(normUrl);

  // Phase 9 Task 9 (DDR-056) — solo→linked transition. On --adopt, offer to add
  // the design-runtime .gitignore block if it's missing, so the shared repo
  // ignores per-machine runtime state. Default yes; --yes / non-TTY auto-adds.
  if (adopt) {
    await maybeWriteGitignoreBlock(cwd, !!flags.yes);
  }

  // The code-module consent (DDR-226 §9 / review finding A5). This is the
  // ONLY writer: the receiver reads `codeModulesAllowed` from the stored hub
  // record and nothing else may set it — least of all a sign-in response,
  // which is the hub telling you what your own role is.
  //
  // Without a writer the field could never be true, so `code-module` had no
  // transport at all in hub-owned mode: an owner could push one through the
  // door and no peer would ever accept it. Closed harder than intended is
  // still closed wrong.
  await askCodeModuleConsent(normUrl, { assumeYes: !!flags.yes, loopback });

  // DDR-228 — a link must land in ONE of the two ownership modes.
  //
  // Linked-and-committed is not a lighter version of hub-owned; it is two
  // systems owning the same bytes with different merge rules, where a `git
  // pull` and a sync pass can each undo the other and which wins is timing.
  // It also reads as extra safety right up until they disagree.
  await settleOwnership(cwd, { assumeYes: !!flags.yes, adopt });

  const tsxSyncLine =
    syncTsx === false
      ? 'off (opted out — linkedHub.syncTsx: false)'
      : 'on by default (DDR-079) — every .tsx body syncs; opt out with --no-sync-tsx or a canvas .meta.json "syncable": false';
  process.stdout.write(
    `[design link] linked ${cwd} to ${normUrl}.\n  token:    stored in ~/.config/maude/hubs.json (per-machine, never committed)\n  config:   .design/config.json.linkedHub = { url, linkedAt${adopt ? ', adopt: true' : ''}${syncTsx !== undefined ? `, syncTsx: ${syncTsx}` : ''} }\n  TSX sync: ${tsxSyncLine}\n  hub:      ${probe.ok ? `v${probe.version}, uptime ${Math.round((probe.uptimeMs ?? 0) / 1000)}s, ${probe.tokenCount} token(s) (${probe.authMode})` : 'NOT REACHED — linked anyway (--force)'}\n\nNext step: start 'maude design serve' — the linked sync agent ${adopt ? 'will push local state up to the hub on first connect' : 'will mirror hub state to disk on first connect'}.\n`
  );
  if (!loopback) process.stderr.write(linkedModeBanner());
}

// ---------------------------------------------------------------- adopt

export async function runAdopt({ args, cwd = process.cwd() }) {
  // Same shape as link — share the implementation.
  return runLink({ args, cwd, forceAdopt: true });
}

// ---------------------------------------------------------------- unlink

export async function runUnlink({ args, cwd = process.cwd() }) {
  const tail = args.slice(args.indexOf('unlink') + 1);
  const { flags } = parseArgs(tail, { booleans: ['keep-token'] });
  const designConfigPath = resolve(cwd, DESIGN_CONFIG_PATH);

  if (!existsSync(designConfigPath)) {
    process.stderr.write(`maude design unlink: no ${DESIGN_CONFIG_PATH} in ${cwd}.\n`);
    process.exit(1);
  }
  const cfg = readDesignConfig(designConfigPath);
  if (!cfg.linkedHub) {
    process.stdout.write('[design unlink] already in solo mode — nothing to do.\n');
    return;
  }
  const url = cfg.linkedHub.url;
  cfg.linkedHub = undefined;
  writeDesignConfig(designConfigPath, cfg);

  let tokenRemoved = false;
  if (!flags['keep-token']) {
    tokenRemoved = removeHub(url);
  }

  process.stdout.write(
    `[design unlink] dropped link to ${url}.\n  config:  removed .design/config.json.linkedHub\n  token:   ${tokenRemoved ? 'cleared from ~/.config/maude/hubs.json' : flags['keep-token'] ? 'kept (--keep-token)' : '(none to clear)'}\n  files:   .design/*.html etc. untouched — repo is now in solo mode.\n`
  );
}

/**
 * Ask, once per hub, whether it may deliver executable modules.
 *
 * `.ts`/`.mjs` outside a canvas body are read by the AGENT and by every
 * `maude design *` helper — a different blast radius from a `.tsx` rendering
 * in the sandboxed canvas origin. Default NO on every non-answer (non-TTY,
 * declined, anything unparsed): the pessimistic branch, same as every other
 * default in this lane.
 */
async function askCodeModuleConsent(normUrl, { assumeYes = false, loopback = false } = {}) {
  // A loopback pairing is this machine talking to itself; there is no remote
  // party to consent about.
  if (loopback) return;
  const existing = getHub(normUrl);
  if (existing && typeof existing.codeModulesAllowed === 'boolean') return;

  let allow = false;
  if (assumeYes) {
    allow = false; // --yes accepts DEFAULTS, and this default is no.
  } else if (process.stdin.isTTY) {
    process.stdout.write(
      '\n  Shared code (.ts / .mjs outside a canvas) is read by Claude and by the\n' +
        '  maude helpers on this machine, not just rendered in a preview.\n'
    );
    allow = await promptYesNo(`  Let ${normUrl} deliver those to this machine? [y/N] `, false);
  }
  setHubCodeModules(normUrl, allow);
  process.stdout.write(
    allow
      ? '[design link] this hub may deliver shared code modules to this machine.\n'
      : `[design link] shared code modules from ${normUrl} will NOT be written here (design files still sync). Re-link and answer yes to change it.\n`
  );
}

// ------------------------------------------------------- ownership (DDR-228)

/**
 * Put this repo in exactly one ownership mode, asking once if it is unclear.
 *
 * Called at the END of a link, so the hub already has the credential and the
 * push is about to happen — the folder is not orphaned for a moment in
 * between. Non-TTY takes the safe branch (leave it committed, say so) rather
 * than untracking a person's files with nobody watching.
 */
async function settleOwnership(cwd, { assumeYes = false, adopt = false } = {}) {
  const st = ownershipState(cwd, { linked: true });
  // No repo ⇒ no second owner ⇒ nothing to settle.
  if (!st.git || st.mode === 'hub-owned') return;
  if (st.trackedCount === 0 && !st.ignored) {
    // A fresh clone of a Mode-B repo: nothing tracked because there is nothing
    // here yet. Declare the mode now so the first pull lands ignored.
    adoptToHub(cwd);
    process.stdout.write(
      '[design link] this project is hub-owned — .design/ is gitignored and mirrored by the hub.\n'
    );
    warnSyncthing(st);
    return;
  }

  process.stdout.write(
    `\n  This repo currently commits .design/ (${st.trackedCount} file${st.trackedCount === 1 ? '' : 's'}) AND is now linked to a hub.\n` +
      '  Those are two owners for the same files, which is the one state Maude does not support:\n' +
      '  a git pull and a sync pass can each undo the other.\n\n' +
      '  Hub-owned  — stop committing .design/, let the hub mirror it (nothing is deleted).\n' +
      '  Repo-owned — keep committing it, and unlink the hub.\n\n'
  );

  const goHub =
    assumeYes || !process.stdin.isTTY
      ? assumeYes
      : await promptYesNo('  Make this project hub-owned? [Y/n] ', true);

  if (!goHub) {
    process.stdout.write(
      '[design link] left as-is. Run `maude design adopt` to hand .design/ to the hub, or `maude design unlink` to keep it in git.\n'
    );
    return;
  }

  const res = adoptToHub(cwd);
  process.stdout.write(
    `[design link] hub-owned: .gitignore ${res.action}, ${res.untracked} file(s) untracked (still on disk, staged as deletions — commit when ready).\n`
  );
  warnSyncthing(st);
}

/**
 * Syncthing does not read `.gitignore`.
 *
 * So a hub-owned project inside a synced tree rides two transports with
 * different conflict rules — the same double-ownership one layer down, through
 * a door the ignore cannot close.
 */
function warnSyncthing(st) {
  if (!st.syncthingRoot) return;
  process.stdout.write(
    `\n  NOTE: this repo is inside a Syncthing folder (${st.syncthingRoot}).\n` +
      '  Syncthing ignores .gitignore, so it will keep syncing .design/ alongside the hub.\n' +
      `  Add this line to ${st.syncthingRoot}/.stignore to stop that:\n\n      ${st.stignoreLine}\n\n`
  );
}

/** `maude design detach` — B back to A. */
export async function runDetach({ args, cwd = process.cwd() }) {
  const tail = args.slice(args.indexOf('detach') + 1);
  const { flags } = parseArgs(tail, { booleans: ['yes', 'keep-token'] });
  const designConfigPath = resolve(cwd, DESIGN_CONFIG_PATH);

  if (!existsSync(designConfigPath)) {
    process.stderr.write(`maude design detach: no ${DESIGN_CONFIG_PATH} in ${cwd}.\n`);
    process.exit(1);
  }
  const cfg = readDesignConfig(designConfigPath);
  const linked = !!cfg.linkedHub;
  const st = ownershipState(cwd, { linked });

  if (!linked && st.mode === 'repo-owned' && !st.ignored) {
    process.stdout.write('[design detach] already repo-owned — nothing to do.\n');
    return;
  }

  const ok =
    flags.yes || !process.stdin.isTTY
      ? true
      : await promptYesNo('  Take .design/ back into this repo and stop syncing it? [Y/n] ', true);
  if (!ok) return;

  // Unlink first: the mirror is a FULL copy, so there is nothing to fetch and
  // no window where the folder belongs to neither owner.
  if (linked) {
    const url = cfg.linkedHub.url;
    cfg.linkedHub = undefined;
    writeDesignConfig(designConfigPath, cfg);
    if (!flags['keep-token']) removeHub(url);
    process.stdout.write(`[design detach] unlinked from ${url}.\n`);
  }
  const res = detachToRepo(cwd);
  process.stdout.write(
    `[design detach] repo-owned: .gitignore ${res.action}. Every file is already on disk — commit .design/ when you are ready:\n\n      git add .design && git commit -m "take the design folder back into the repo"\n\n`
  );
}

// ---------------------------------------------------------------- bulk-deletes

/**
 * `maude design bulk-deletes on|off|status [--hub <url>]`
 *
 * Turns THIS machine's outbound delete breaker off (or back on) for the
 * project's linked hub, so a deliberate cleanup propagates in one pass instead
 * of 10 per pass and 25 per hour. Local consent, recorded in hubs.json as
 * `unlimitedDeletes` — the studio reads it at sync start, so restart
 * `maude design serve` / the desktop app after changing it.
 *
 * The hub decides the other half: it admits deletes past its budget only from
 * an owner-role token. For anyone else this setting changes nothing but where
 * the refusal comes from.
 */
export async function runBulkDeletes({ args, cwd = process.cwd() }) {
  const tail = args.slice(args.indexOf('bulk-deletes') + 1);
  const { flags, positional } = parseArgs(tail);
  const verb = positional[0] ?? 'status';
  if (!['on', 'off', 'status'].includes(verb)) {
    process.stderr.write('usage: maude design bulk-deletes on|off|status [--hub <url>]\n');
    process.exit(2);
  }
  let url = typeof flags.hub === 'string' ? flags.hub : null;
  if (!url) {
    const designConfigPath = resolve(cwd, DESIGN_CONFIG_PATH);
    const cfg = existsSync(designConfigPath) ? readDesignConfig(designConfigPath) : null;
    url = cfg?.linkedHub?.url ?? null;
  }
  if (!url) {
    process.stderr.write(
      '[design bulk-deletes] no linked hub here — run it in a linked project or pass --hub <url>.\n'
    );
    process.exit(1);
  }
  const normUrl = normalizeUrl(url);
  const record = getHub(normUrl);
  if (!record) {
    process.stderr.write(`[design bulk-deletes] ${normUrl} is not linked on this machine.\n`);
    process.exit(1);
  }
  if (verb !== 'status') setHubUnlimitedDeletes(normUrl, verb === 'on');
  const on = verb === 'status' ? record.unlimitedDeletes === true : verb === 'on';
  process.stdout.write(
    on
      ? `[design bulk-deletes] ON for ${normUrl} — deletes on this machine propagate without the 10/pass · 25/hour breaker. The hub admits that only from an owner-role token. Restart the sync (maude design serve / the app) to apply.\n`
      : `[design bulk-deletes] off for ${normUrl} — the delete breaker holds bulk deletes (10 per pass, 25 per hour).${verb === 'off' ? ' Restart the sync to apply.' : ''}\n`
  );
}

// ---------------------------------------------------------------- status

export async function runStatus({ args, cwd = process.cwd() }) {
  const tail = args.slice(args.indexOf('status') + 1);
  const { flags } = parseArgs(tail, { booleans: ['json', 'watch'] });
  if (flags.watch) return await runStatusWatch({ cwd, intervalMs: watchInterval(flags) });
  const designConfigPath = resolve(cwd, DESIGN_CONFIG_PATH);

  if (!existsSync(designConfigPath)) {
    const payload = { mode: 'no-design', reason: `no ${DESIGN_CONFIG_PATH} in ${cwd}` };
    if (flags.json) {
      process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    } else {
      process.stdout.write(`[design status] ${payload.reason}.\n`);
    }
    return;
  }
  const cfg = readDesignConfig(designConfigPath);
  if (!cfg.linkedHub) {
    const payload = { mode: 'solo' };
    if (flags.json) {
      process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    } else {
      process.stdout.write('[design status] solo mode — no linkedHub configured.\n');
    }
    return;
  }

  const url = cfg.linkedHub.url;
  const hubRecord = getHub(url);
  const probe = await probeHealth(url);
  const sync = readSyncState(resolve(cwd, '.design', '_sync.json'));

  const payload = {
    mode: 'linked',
    url,
    linkedAt: cfg.linkedHub.linkedAt,
    adopt: !!cfg.linkedHub.adopt,
    // DDR-079 — effective TSX-sync state: on unless explicitly opted out.
    syncTsx: cfg.linkedHub.syncTsx !== false,
    syncTsxExplicit: typeof cfg.linkedHub.syncTsx === 'boolean' ? cfg.linkedHub.syncTsx : null,
    tokenStored: !!hubRecord,
    hub: probe.ok
      ? {
          reachable: true,
          version: probe.version,
          uptimeMs: probe.uptimeMs,
          tokenCount: probe.tokenCount,
          authMode: probe.authMode,
        }
      : { reachable: false, error: probe.error },
    // Task 8 — the running sync agent writes `.design/_sync.json` with the live
    // offline/online state, queued-op count, last sync, and conflict log.
    sync: sync ?? { agent: 'idle', detail: 'no _sync.json — sync agent not running' },
    // DDR-228 — which of the two ownership modes this project is in, or
    // `hybrid` for a project linked before the model existed.
    ownership: ownershipState(cwd, { linked: true }),
  };

  if (flags.json) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return;
  }

  // The legacy-hybrid notice. Persistent rather than one-shot on purpose: it
  // describes a state that is still true every time you look, and the answer
  // is a decision only the person can make.
  if (payload.ownership.mode === 'hybrid') {
    process.stdout.write(
      `\n  ⚠ legacy hybrid — this project is linked to a hub AND still commits .design/ (${payload.ownership.trackedCount} file(s)).\n` +
        '    Two owners, different merge rules: a git pull and a sync pass can each undo the other.\n' +
        '    Pick one:  `maude design adopt <url> --token <hex>`  (hub-owned, nothing deleted)\n' +
        '               `maude design detach`                     (repo-owned, stops syncing)\n\n'
    );
  }

  const uptimeS = Math.round((probe.uptimeMs ?? 0) / 1000);
  // THE FILE PLANE, which this command did not mention at all.
  //
  // It rendered `docs:` and nothing else, so a project whose doc lane was
  // healthy (85/87 synced, 0 pending) and whose file plane had 803 undelivered
  // files reported `0 pending` — and a person read that as "finished". This is
  // the single worst item in the 2026-09-03 report: not a wrong number, an
  // absent lane.
  const filesLine = renderFilesLine(sync, cwd);
  // DDR-102 — per-doc rollup (old payloads without `docs` render unchanged).
  const docsLine = sync?.docs
    ? `, docs: ${sync.docs.synced} synced · ${sync.docs.pending} pending · ${sync.docs.rejected} rejected`
    : '';
  const syncLine = sync?.notSyncable
    ? `linked but 0 syncable canvases — ${sync.reason}`
    : sync
      ? `${sync.state}${sync.sharedDoc ? ' [shared-doc]' : ''}${sync.queuedOps ? ` — ${sync.queuedOps} edit(s) queued` : ''}${
          sync.lastSyncAt ? `, last sync ${new Date(sync.lastSyncAt).toISOString()}` : ''
        }${docsLine}${sync.conflicts?.length ? `, ${sync.conflicts.length} conflict notice(s)` : ''}`
      : 'idle (start `maude design serve` in linked mode)';
  process.stdout.write(
    `Maude design — linked mode\n  hub URL:      ${url}\n  linked at:    ${new Date(cfg.linkedHub.linkedAt).toISOString()}\n  adopt mode:   ${cfg.linkedHub.adopt ? 'yes (push-on-first-sync)' : 'no (hub-wins)'}\n  TSX sync:     ${cfg.linkedHub.syncTsx === false ? 'off (opted out — linkedHub.syncTsx: false)' : 'on (default — DDR-079)'}\n  token stored: ${hubRecord ? 'yes (~/.config/maude/hubs.json)' : "NO — re-run 'maude design link'"}\n  hub status:   ${probe.ok ? `up — v${probe.version}, ${uptimeS}s uptime, ${probe.tokenCount} token(s), ${probe.authMode}` : `UNREACHABLE — ${probe.error}`}\n  sync agent:   ${syncLine}\n`
  );
  if (filesLine) process.stdout.write(filesLine);
  // DDR-102 — auth-rejected canvases (per-slug honesty).
  if (Array.isArray(sync?.rejectedSlugs) && sync.rejectedSlugs.length > 0) {
    const total = sync.docs?.rejected ?? sync.rejectedSlugs.length;
    const more =
      total > sync.rejectedSlugs.length ? ` (+${total - sync.rejectedSlugs.length} more)` : '';
    process.stdout.write(
      `  not syncing:  ${sync.rejectedSlugs.join(', ')}${more} — hub rejected auth; the serve log names the reason (scope / invalid token / rate limit).\n`
    );
  }
  // DDR-102 — conflict log with winner + snapshot refs + the recovery story.
  if (Array.isArray(sync?.conflicts) && sync.conflicts.length > 0) {
    process.stdout.write('  conflicts:\n');
    for (const c of sync.conflicts.slice(-10)) {
      const at = c.at ? new Date(c.at).toISOString() : '?';
      if (c.kind === 'cold-start-diverged') {
        const snaps = c.snapshots
          ? ` snapshots: ${[
              c.snapshots.local ? `local@${c.snapshots.local}` : null,
              c.snapshots.hub ? `hub@${c.snapshots.hub}` : null,
            ]
              .filter(Boolean)
              .join(' ')}`
          : '';
        process.stdout.write(
          `    ${at}  ${c.slug} — diverged, kept ${c.winner ?? 'hub'} (newest-wins);${snaps}\n      recover the other version: /design:rollback ${c.slug}\n`
        );
        if (c.snapshotFailed) {
          process.stdout.write(
            `      ⚠ the _history snapshot FAILED — local was KEPT instead of overwritten (DDR-102 fail-closed); check disk space / _history write perms.\n`
          );
        }
      } else {
        process.stdout.write(`    ${at}  ${c.slug} — ${c.kind}\n`);
      }
    }
  }
  // DDR-079 migration advisory: a config with no explicit `syncTsx` rides the
  // default, which FLIPPED from off→on in maude 0.27. Surface it so an upgrader
  // who relied on the old "TSX never syncs" behavior isn't surprised that every
  // .tsx now goes to the hub.
  if (cfg.linkedHub.syncTsx === undefined) {
    process.stdout.write(
      '\n  ℹ  syncTsx is not set, so it uses the DEFAULT — which is now ON (DDR-079, maude ≥ 0.27): every .tsx syncs to this hub.\n     Upgraded from an older maude and want the pre-0.27 behavior (no TSX sync)? Set  .design/config.json → linkedHub.syncTsx: false  (or  maude design link <url> --token … --no-sync-tsx).\n'
    );
  }
}

/**
 * On --adopt, add the design-runtime .gitignore block if missing. Prompts
 * [Y/n] in a TTY (default yes); auto-adds with --yes or non-interactively.
 * Idempotent — a repo that already has the block is left untouched.
 */
async function maybeWriteGitignoreBlock(cwd, assumeYes) {
  const gitignorePath = resolve(cwd, '.gitignore');
  const current = existsSync(gitignorePath) ? readFileSync(gitignorePath, 'utf8') : '';
  if (current.includes(BEGIN_MARKER)) return; // already present — nothing to do

  let add = assumeYes || !process.stdin.isTTY;
  if (!add) {
    add = await promptYesNo(
      'Add the Maude design-runtime .gitignore block (ignores per-machine runtime state)? [Y/n] ',
      true
    );
  }
  if (!add) {
    process.stdout.write(
      '[design link] skipped .gitignore block — add it later with another `maude design adopt`.\n'
    );
    return;
  }
  const { action } = writeGitignoreBlock(cwd, { designRel: '.design' });
  process.stdout.write(`[design link] .gitignore: ${action} maude design-runtime block.\n`);
}

function watchInterval(flags) {
  const raw = Number(flags.interval);
  return Number.isFinite(raw) && raw >= 1 ? Math.min(raw, 300) * 1000 : 2_000;
}

/**
 * `maude design status --watch` — the seed, live.
 *
 * A seed against a large project is minutes to hours of work (an 8.8 GB
 * project needs at least two hourly quota windows), and the one-shot status
 * was the only way to look at it. Asking a person to re-run a command in a
 * loop is how "is it still going?" goes unanswered.
 *
 * EXIT CODES ARE THE CONTRACT: 0 on converged, 1 on blocked. `paused` is
 * neither — nothing is wrong and nothing is lost, so it keeps waiting. That
 * makes this usable as a script gate without it failing on an ordinary wall.
 */
async function runStatusWatch({ cwd, intervalMs }) {
  const tty = process.stdout.isTTY;
  let last = '';
  for (;;) {
    const sync = readSyncState(resolve(cwd, '.design', '_sync.json'));
    const fresh =
      sync && Number.isFinite(sync.updatedAt) && Date.now() - sync.updatedAt < SYNC_JSON_STALE_MS;
    const p = (fresh ? sync?.files?.progress : null) ?? readLedgerProgress(cwd);
    if (!p) {
      process.stdout.write('[design status] nothing to watch — no file plane state yet.\n');
      return;
    }
    const line = watchLine(p);
    if (tty) {
      process.stdout.write(`\r\x1b[2K${line}`);
    } else if (line !== last) {
      process.stdout.write(`${line}\n`);
    }
    last = line;
    if (p.phase === 'converged') {
      if (tty) process.stdout.write('\n');
      return;
    }
    if (p.phase === 'blocked') {
      if (tty) process.stdout.write('\n');
      process.exitCode = 1;
      return;
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

function watchLine(p) {
  const pct = p.tracked > 0 ? Math.floor((p.delivered / p.tracked) * 100) : 100;
  const width = 24;
  const filled = Math.round((pct / 100) * width);
  const bar = `${'█'.repeat(filled)}${'░'.repeat(width - filled)}`;
  const blockedTotal = (p.blocked ?? []).reduce((n, b) => n + b.count, 0);
  const bits = [`${p.delivered}/${p.tracked}`];
  if (p.remaining > 0) bits.push(`${p.remaining} waiting`);
  if (blockedTotal > 0) bits.push(`${blockedTotal} need attention`);
  const phase =
    { paused: ' · paused', blocked: ' · blocked', scanning: ' · scanning' }[p.phase] ?? '';
  return `${bar} ${String(pct).padStart(3)}%  ${bits.join(' · ')}${phase}`;
}

/** How stale `_sync.json` may be before we stop believing it. Two poll ticks. */
const SYNC_JSON_STALE_MS = 60_000;

/**
 * The `files:` block — from `_sync.json`, or from the LEDGER when that file is
 * missing or stale.
 *
 * The fallback is not belt-and-braces. `_sync.json` froze for the whole of a
 * 20-minute run on 2026-09-03 while the ledger under
 * `.design/_state/file-ledger/` stayed current to within a second — the ledger
 * is the source that was right, so a status command that cannot reach it is
 * one restart away from lying again.
 */
function renderFilesLine(sync, cwd) {
  const fresh =
    sync && Number.isFinite(sync.updatedAt) && Date.now() - sync.updatedAt < SYNC_JSON_STALE_MS;
  const p = fresh ? sync?.files?.progress : null;
  if (p) return formatFiles(p, sync.files, '');
  const fromLedger = readLedgerProgress(cwd);
  if (!fromLedger) {
    // Say nothing rather than imply everything is fine — but only when there
    // is genuinely nothing to read.
    return sync?.files
      ? `  files:        ${sync.files.synced ?? 0} synced${
          sync.files.pushed ? ` · ${sync.files.pushed} pushed` : ''
        }  (no progress detail — older sync runtime)\n`
      : '';
  }
  return formatFiles(fromLedger, null, fresh ? '' : ' (from the ledger — _sync.json is stale)');
}

function formatFiles(p, raw, note) {
  const bits = [`${p.delivered} of ${p.tracked} delivered`];
  if (p.remaining > 0) bits.push(`${p.remaining} waiting`);
  const blockedTotal = (p.blocked ?? []).reduce((n, b) => n + b.count, 0);
  if (blockedTotal > 0) {
    bits.push(`${blockedTotal} need attention (${p.blocked.map((b) => b.class).join(', ')})`);
  }
  let out = `  files:        ${bits.join(' · ')}${note}\n`;
  const phaseNote = {
    paused: 'paused — nothing is lost; it resumes by itself',
    blocked: 'nothing is moving without a decision',
    scanning: 'still looking through the project',
    converged: 'everything is up to date',
  }[p.phase];
  if (phaseNote && p.phase !== 'converged') out += `                ${phaseNote}\n`;
  if (p.passCapped) {
    out += `                more to come — the last pass hit its ${p.passCapped} ceiling\n`;
  }
  if (raw) {
    // The raw counters, so the derived line above is falsifiable (DDR-214).
    out += `                (raw: synced ${raw.synced ?? 0}, pushed ${raw.pushed ?? 0}, pulled ${raw.pulled ?? 0})\n`;
  }
  return out;
}

/**
 * Fold the on-disk ledger into the same progress shape, WITHOUT importing the
 * studio's TypeScript.
 *
 * The CLI is a Node shim (see CLAUDE.md); `sync/seed-progress.ts` runs under
 * Bun inside the dev-server. Duplicating a ~15-line fold is the cheaper of the
 * two evils here — the alternative is a build step for the CLI, or the CLI
 * silently having no fallback at all, which is the state that let a frozen
 * `_sync.json` be the only thing anyone could read.
 */
function readLedgerProgress(cwd) {
  const dir = resolve(cwd, '.design', '_state', 'file-ledger');
  if (!existsSync(dir)) return null;
  let rows = {};
  try {
    const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
    if (files.length === 0) return null;
    // Newest ledger wins when a project has been linked to more than one hub.
    const newest = files
      .map((f) => ({ f, m: statSync(join(dir, f)).mtimeMs }))
      .sort((a, b) => b.m - a.m)[0];
    const parsed = JSON.parse(readFileSync(join(dir, newest.f), 'utf8'));
    rows = parsed?.rows && typeof parsed.rows === 'object' ? parsed.rows : {};
  } catch {
    return null;
  }
  const DELIVERED = new Set(['on-hub', 'durable', 'at-peer', 'ui-healed', 'everywhere']);
  const BLOCKED = new Set(['refused', 'referenced-but-unoffered']);
  let tracked = 0;
  let delivered = 0;
  const blocked = new Map();
  for (const row of Object.values(rows)) {
    tracked += 1;
    const st = row?.state;
    if (st && DELIVERED.has(st)) {
      delivered += 1;
    } else if (st && BLOCKED.has(st)) {
      const reason = String(row?.reason ?? '').toLowerCase();
      const cls = reason.includes('too big')
        ? 'too-large'
        : reason.includes('allowance')
          ? 'quota'
          : reason.includes('could not reach')
            ? 'unreachable'
            : 'refused';
      blocked.set(cls, (blocked.get(cls) ?? 0) + 1);
    }
  }
  const blockedTotal = [...blocked.values()].reduce((n, c) => n + c, 0);
  const remaining = Math.max(0, tracked - delivered - blockedTotal);
  return {
    phase: remaining > 0 ? 'seeding' : blockedTotal > 0 ? 'blocked' : 'converged',
    tracked,
    delivered,
    remaining,
    blocked: [...blocked.entries()].map(([cls, count]) => ({ class: cls, count })),
  };
}

/** Read the sync agent's `_sync.json` runtime state, or null when absent. */
function readSyncState(p) {
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- helpers

function readDesignConfig(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    throw new Error(`unable to read ${path}: ${err.message}`);
  }
}

function writeDesignConfig(path, cfg) {
  const dir = dirname(path);
  if (!existsSync(dir)) {
    throw new Error(`design root ${dir} does not exist`);
  }
  writeFileSync(path, `${JSON.stringify(cfg, null, 2)}\n`, 'utf8');
}

async function probeHealth(url) {
  const target = `${url}/health`;
  try {
    const res = await fetch(target);
    if (!res.ok) return { ok: false, error: `${res.status} ${res.statusText}` };
    const body = await res.json();
    return { ok: true, ...body };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// ----------------------------------------------------- trust gate (DDR-054 F2/F4)

/** True when the hub URL points at the local machine (no remote-write risk). */
function isLoopbackUrl(normUrl) {
  try {
    return LOOPBACK_HOSTS.has(new URL(normUrl).hostname);
  } catch {
    return false;
  }
}

/**
 * Promise-resolving prompt. Prompt + echo go to stderr (stdout is data).
 * `defaultYes` controls how an empty answer resolves ([Y/n] vs [y/N]).
 */
function promptYesNo(question, defaultYes = false) {
  return new Promise((res) => {
    const rl = createInterface({ input: process.stdin, output: process.stderr });
    rl.question(question, (answer) => {
      rl.close();
      const trimmed = answer.trim();
      if (trimmed === '') return res(defaultYes);
      res(/^y(es)?$/i.test(trimmed));
    });
  });
}

/**
 * Files `--adopt` would push up to the hub: top-level canvases + annotation
 * SVGs + comment JSON snapshots (the git-tracked sync surface per Task 9).
 */
function collectAdoptManifest(cwd) {
  const base = resolve(cwd, '.design');
  const files = [];
  try {
    for (const f of readdirSync(base)) {
      if (
        f.endsWith('.html') ||
        f.endsWith('.annotations.json') ||
        f.endsWith('.annotations.svg')
      ) {
        try {
          files.push({ rel: `.design/${f}`, bytes: statSync(resolve(base, f)).size });
        } catch {
          /* skip unreadable */
        }
      }
    }
  } catch {
    /* no .design — manifest stays empty */
  }
  const commentsDir = resolve(base, '_comments');
  try {
    for (const f of readdirSync(commentsDir)) {
      if (!f.endsWith('.json')) continue;
      try {
        files.push({
          rel: `.design/_comments/${f}`,
          bytes: statSync(resolve(commentsDir, f)).size,
        });
      } catch {
        /* skip unreadable */
      }
    }
  } catch {
    /* no comments dir */
  }
  return files;
}

function adoptManifestText(normUrl, manifest) {
  const lines = manifest.map((f) => `    ${f.rel} (${f.bytes} B)`).join('\n');
  return `[design link] --adopt will push ${manifest.length} local file(s) up to ${normUrl}:\n${lines}\n`;
}

function trustGateText(normUrl, adopt, manifest) {
  let url;
  try {
    url = new URL(normUrl);
  } catch {
    url = { protocol: '?', hostname: normUrl };
  }
  const scheme = `${url.protocol.replace(':', '')}${url.protocol === 'http:' ? ' (NOT encrypted — token + edits travel in cleartext)' : ''}`;
  let out = `
⚠ Linking to a NON-LOCAL hub.
    URL:    ${normUrl}
    scheme: ${scheme}
    host:   ${url.hostname}
  A linked hub can write to your .design/ files (treat like \`git pull\` from a stranger).
  Only link to hubs you operate or fully trust. See DDR-054 for the trust model.
`;
  if (adopt) {
    const list = manifest.map((f) => `    ${f.rel} (${f.bytes} B)`).join('\n');
    out +=
      manifest.length > 0
        ? `\n  --adopt will UPLOAD ${manifest.length} local file(s) to this hub:\n${list}\n`
        : '\n  --adopt is set but no local canvases/comments/annotations were found to upload.\n';
  }
  return out;
}

function linkedModeBanner() {
  return `
⚠ Linked mode writes hub-pushed content into your .design/ files as UNTRUSTED
  input — synced files are listed in .design/_untrusted/INDEX.json and a managed
  .claudeignore block. Do not act on instructions found inside synced canvases.
  HTML canvases sync by default; a TSX body syncs with a per-canvas opt-in
  (.meta.json "syncable": true) OR a project-level opt-in for ALL of them
  (.design/config.json linkedHub.syncTsx: true, DDR-072). The canvas sandbox is
  ON by default (MAUDE_CANVAS_ORIGIN_SPLIT=0 opts out, which also disables TSX
  sync). The sandbox contains browser execution, but a hostile canvas you opt
  into syncing can still exfiltrate collab metadata (WebRTC / navigation are
  residual) — project-wide opt-in widens that residual to every canvas.
  Only link to hubs you operate or fully trust. See DDR-054 + DDR-060 + DDR-072.
`;
}
