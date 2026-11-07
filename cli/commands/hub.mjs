// maude hub — self-hostable Yjs sync hub control plane.
//
// Phase 9 Task 2 + Task 7: serve + token generate|rotate + status + deploy.
// See .ai/plans/phase-9-self-hosted-hub-file-sync.md.

import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { resolve } from 'node:path';

import { parseArgs } from '../lib/argv.mjs';
import { PURGE_USAGE } from '../lib/hub-purge.mjs';

const SUBCOMMANDS = new Set([
  'serve',
  'token',
  'status',
  'deploy',
  'backup',
  'restore-drill',
  'asset-check',
  'backup-owners',
  'workspace-up',
  'purge',
  'help',
]);

export async function run({ args, pkgRoot }) {
  const { positional } = parseArgs(args);
  const sub = positional[0];

  if (!sub || sub === 'help') {
    process.stdout.write(usage());
    return;
  }
  if (!SUBCOMMANDS.has(sub)) {
    process.stderr.write(`maude hub: unknown subcommand "${sub}"\n${usage()}`);
    process.exit(2);
  }

  if (sub === 'serve') return runServe({ args, pkgRoot });
  if (sub === 'token') return runToken({ args, pkgRoot });
  if (sub === 'status') return runStatus({ args });
  if (sub === 'deploy') return runDeploy({ args, pkgRoot });
  if (sub === 'backup') return runBackupNow({ args, pkgRoot });
  if (sub === 'restore-drill') return runRestoreDrill({ args, pkgRoot });
  if (sub === 'asset-check') return runAssetCheck({ args, pkgRoot });
  if (sub === 'backup-owners') return runBackupOwners({ args, pkgRoot });
  if (sub === 'purge') {
    const { runPurge } = await import('../lib/hub-purge.mjs');
    const code = await runPurge({ args: args.slice(args.indexOf('purge') + 1) });
    if (code !== 0) process.exit(code);
    return;
  }
  if (sub === 'workspace-up') {
    const mod = await import('./hub-workspace.mjs');
    return mod.run({ args, pkgRoot });
  }
}

function usage() {
  return `maude hub <serve|token|status|deploy|backup|restore-drill|asset-check|backup-owners|workspace-up|purge> [options]

  serve [--port N] [--data PATH] [--secret HEX] [--insecure-http] [--dev]
        Start the self-hostable Yjs sync hub in the current process tree.
        --port           listen port (default 1234, env PORT)
        --data           hub.db + tokens.db dir (default ./data, env DATA_DIR)
        --secret         HUB_SECRET escape-hatch token (env HUB_SECRET).
                         If unset on an empty hub, a one-time bootstrap link is
                         printed to logs — open it in a browser to claim admin.
        --insecure-http  cosmetic log-only flag for non-TLS dev
        --dev            generate a one-shot mau_dev_<hex> token, print the
                         connect command, then run the hub. Convenience for
                         contributor onboarding — token persists in tokens.db
                         after exit (clean the --data dir by hand to reset).

        On boot the hub prints its /admin URL. The admin UI generates invite
        tokens, lists peers, and rotates tokens without shelling into the host.

  token generate --label NAME [--data PATH] [--dev] [--scope SCOPE]
        Generate a new mau_<32hex> token and store it (HMAC-hashed) in
        <data>/tokens.db with the given label. Prints the raw token ONCE,
        plus the ready-to-paste 'maude design link' connect command.

        --dev produces a mau_dev_<hex> token (convention only — same auth).
        --scope '*' mints a hub-wide token (authorizes any canvas). Omitted →
                 the scope defaults to the label (DDR-053). Canvas sync uses a
                 flat per-canvas slug as the documentName, so a label-scoped
                 token will NOT authorize a real canvas — pass --scope '*' for
                 a peer that syncs canvases (this is what /admin invites do).

        Equivalent to the "Generate invite" button in the /admin UI — use
        whichever is more convenient for the deploy.

  token rotate --label NAME [--data PATH]
        Invalidate the named token and mint a fresh value with the same label
        + scope. Prints the new raw token ONCE. New connections with the OLD
        token are rejected immediately; ALREADY-CONNECTED peers stay until they
        reconnect — use the /admin UI "Rotate" button (kicks live sessions) or
        restart the hub to force-disconnect them now.

  status [URL] [--json]
        HTTP GET <url>/health, print uptime/version/token-count/peers. URL
        defaults to http://localhost:1234. --json emits the raw response.

  backup [--data PATH] [--target file://DIR] [--keep N]
        Take one snapshot generation now (VACUUM INTO → gzip → target) and
        prune to the retention limit. Target defaults to $MAUDE_BACKUP_TARGET,
        or the MAUDE_S3_* env set (R2 / MinIO / S3).

  restore-drill [--target file://DIR] [--sentinel DOCNAME] [--keep-dir] [--json]
        Restore the NEWEST complete backup generation into a throwaway
        directory and verify it: SQLite integrity_check, document count, and
        (with --sentinel) that one named document came back with a non-empty
        payload. Never touches the live data dir. Exits non-zero on failure so
        it can be a CI step.

        Run this on a schedule. A backup nobody has restored is a hypothesis:
        a database that restores readable-but-empty looks exactly like a
        working one until the day you need it.

  asset-check [--root PATH] [--json]
        Every 'assets/<sha8>' reference in the project must resolve — locally,
        in the bucket, or both. Reports DANGLING references (referenced by a
        canvas, present in neither) and, with a bucket configured, assets that
        exist locally but were never mirrored.

        A dangling reference is a permanently broken canvas: the 'assets/'
        prefix is NEVER garbage-collected, and bucket lifecycle/expiry rules
        must be OFF for it, because a canvas in git history can reference an
        asset no current canvas does. Exits non-zero when anything dangles.

${PURGE_USAGE}
  workspace-up [--domain HOST] [--admin-email EMAIL] [--s3-* ...] [--dry-run]
        Stand up a self-hosted WORKSPACE — a hub that owns the project, commits
        autosaves, and stores media in object storage — and verify it works
        before saying so. Renders compose + Caddyfile + .env (0600), boots the
        stack, then runs a verification plan (health, admin credential, sign-in,
        canvas round-trip, git commit, object storage + no-expiry, restore
        drill). Re-running is the upgrade path and REUSES existing secrets.

        It scaffolds and verifies once — it does not operate the deployment.
        Rotation, backups, upgrades and the bill stay with you; the run prints
        that list rather than saying "done".

        Run 'maude hub workspace-up --help' for every option.

  deploy <fly|docker> [--name NAME] [--region CODE] [--tag TAG] [--out DIR] [--force]
        Emit the deploy templates for the chosen target into the current
        directory (or --out DIR) with placeholders substituted, then print the
        exact commands to run next. Does NOT execute fly/docker for you —
        review the emitted files first, then run the printed command.

        fly     → fly.toml (+ reuses apps/hub/Dockerfile).
                  --name   app name (default maude-hub-<rand>)
                  --region Fly region code (default iad)
        docker  → docker-compose.yml + Caddyfile (universal — Lightsail, EC2,
                  Hetzner, DigitalOcean, Coolify, home server).
                  --tag    ghcr.io/1agh/maude-hub image tag (default latest)

NOTES
  serve / token / deploy run inside a 'maude' source checkout (they read the
  bundled hub workspace at apps/hub). Production hubs run the
  published Docker image (ghcr.io/1agh/maude-hub) — see 'maude hub deploy'.
  status works from anywhere (plain HTTP GET against /health).

EXAMPLES
  maude hub serve --port 4400
  maude hub token generate --label alice
  maude hub token rotate --label alice
  maude hub status http://localhost:4400
  maude hub deploy fly --name maude-hub-acme --region fra
  maude hub deploy docker --tag latest --out ./deploy

  # Recommended flow on a fresh deploy:
  #   1. maude hub serve            → copy bootstrap link from logs
  #   2. open the link in browser   → first-run wizard, mint admin secret
  #   3. click "Generate invite"    → copy 'maude design link …' command
  #   4. paste on the peer machine  → linked
`;
}

// ---------------------------------------------------------------- serve

async function runServe({ args, pkgRoot }) {
  const { flags } = parseArgs(args.slice(args.indexOf('serve') + 1), {
    booleans: ['insecure-http', 'dev'],
  });

  const hubRoot = findHubRoot(pkgRoot);
  if (!hubRoot) {
    process.stderr.write(
      'maude hub serve: hub workspace not found.\n\n' +
        'This slice ships in local dev tree only. Production-install packaging\n' +
        'is a follow-up Task 2 sub-slice. Run inside a maude source checkout.\n'
    );
    process.exit(1);
  }

  const env = { ...process.env };
  if (flags.port) env.PORT = String(flags.port);
  if (flags.data) env.DATA_DIR = resolve(String(flags.data));
  if (flags.secret) env.HUB_SECRET = String(flags.secret);
  if (flags['insecure-http']) env.HUB_INSECURE_HTTP = '1';

  if (flags.dev) {
    const dataDir = env.DATA_DIR ?? resolve(process.cwd(), 'data');
    if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
    const { addToken } = await import(resolveHubModule(hubRoot, 'src/tokens.mjs'));
    const port = env.PORT ?? '1234';
    const record = addToken(dataDir, { label: 'dev', dev: true });
    process.stdout.write(
      `[hub] --dev token written to ${dataDir}/tokens.db:\n      label: ${record.label}\n      value: ${record.value}\n\n      Connect from a peer:\n        maude design link http://localhost:${port} --token=${record.value}\n\n`
    );
  }

  const entry = resolveHubEntry(hubRoot);
  const child = spawn(process.execPath, [entry], {
    stdio: 'inherit',
    env,
  });
  child.on('exit', (code) => process.exit(code ?? 0));
  child.on('error', (err) => {
    process.stderr.write(`maude hub serve: ${err.message}\n`);
    process.exit(1);
  });
}

// ---------------------------------------------------------------- token generate

async function runToken({ args, pkgRoot }) {
  const tail = args.slice(args.indexOf('token') + 1);
  const op = tail[0];

  if (op !== 'generate' && op !== 'rotate') {
    process.stderr.write(
      `maude hub token: unknown op "${op ?? ''}". Use "generate" or "rotate" with --label.\n`
    );
    process.exit(2);
  }

  const { flags } = parseArgs(tail.slice(1), { booleans: ['dev'] });
  const label = flags.label;
  if (!label || typeof label !== 'string') {
    process.stderr.write(`maude hub token ${op}: --label <name> is required.\n`);
    process.exit(2);
  }
  const dataDir = flags.data ? resolve(String(flags.data)) : resolve(process.cwd(), 'data');

  const hubRoot = findHubRoot(pkgRoot);
  if (!hubRoot) {
    process.stderr.write(`maude hub token ${op}: hub workspace not found.\n`);
    process.exit(1);
  }
  const { addToken, rotateToken } = await import(resolveHubModule(hubRoot, 'src/tokens.mjs'));

  // better-sqlite3 won't create the parent dir; the running hub does this in
  // createHub, but a CLI generate against a fresh --data path must too.
  if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });

  let record;
  if (op === 'rotate') {
    try {
      record = rotateToken(dataDir, label);
    } catch (err) {
      process.stderr.write(`maude hub token rotate: ${err.message}\n`);
      process.exit(1);
    }
  } else {
    // --scope '*' mints a hub-wide token (authorizes any documentName); an
    // explicit value scopes it to that prefix. Omitted → addToken defaults the
    // scope to the label (DDR-053 §3). NOTE: canvas sync uses flat per-canvas
    // slugs as the documentName, so a label-scoped token does NOT authorize a
    // canvas unless its label equals the slug — pass --scope '*' for sync use.
    const scope = typeof flags.scope === 'string' ? flags.scope : undefined;
    record = addToken(dataDir, {
      label,
      dev: !!flags.dev,
      ...(scope !== undefined ? { scope } : {}),
    });
  }

  const verb = op === 'rotate' ? 'rotated' : 'written';
  const liveNote =
    op === 'rotate'
      ? 'Old token is rejected on new connections immediately. Already-connected\npeers persist until they reconnect — use the /admin UI "Rotate" button (kicks\nlive sessions) or restart the hub to force-disconnect them now.\n'
      : 'Restart the hub if it is already running for the new token to take effect.\n';
  const shownScope = record.scope ?? '*';
  const scopeNote =
    shownScope === '*'
      ? 'hub-wide — authorizes any canvas'
      : `only authorizes documentName "${shownScope}" or "${shownScope}/…" — canvas sync uses flat slugs, so pass --scope '*' for whole-hub sync`;
  process.stdout.write(
    `[hub] token ${verb} in ${dataDir}/tokens.db:\n  label:      ${record.label}\n  value:      ${record.value}\n  scope:      ${shownScope} (${scopeNote})\n  created:    ${new Date(record.createdAt).toISOString()}\n\nConnect from a peer (replace HOST):\n  maude design link https://HOST --token=${record.value}\n\n${liveNote}`
  );
}

// ---------------------------------------------------------------- status

async function runStatus({ args }) {
  const { flags, positional } = parseArgs(args.slice(args.indexOf('status') + 1), {
    booleans: ['json'],
  });
  let url = positional[0] ?? 'http://localhost:1234';
  if (url.startsWith('ws://')) url = `http://${url.slice('ws://'.length)}`;
  if (url.startsWith('wss://')) url = `https://${url.slice('wss://'.length)}`;
  if (url.endsWith('/')) url = url.slice(0, -1);

  const target = `${url}/health`;
  let payload;
  try {
    const res = await fetch(target);
    if (!res.ok) {
      process.stderr.write(
        `maude hub status: ${target} returned ${res.status} ${res.statusText}\n`
      );
      process.exit(1);
    }
    payload = await res.json();
  } catch (err) {
    process.stderr.write(`maude hub status: cannot reach ${target}: ${err.message}\n`);
    process.exit(1);
  }

  if (flags.json) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return;
  }

  const uptimeS = Math.round((payload.uptimeMs ?? 0) / 1000);
  // `dataDir` is omitted from the unauthenticated /health payload (it's a
  // server filesystem path — recon over-share). Only print it if present.
  const dataDirLine = payload.dataDir ? `  dataDir:    ${payload.dataDir}\n` : '';
  process.stdout.write(
    `Maude Hub @ ${url}
  ok:         ${payload.ok}
  version:    ${payload.version}
  uptime:     ${formatDuration(uptimeS)}
  port:       ${payload.port}
${dataDirLine}  tokens:     ${payload.tokenCount} (mode: ${payload.authMode})
`
  );
}

// ---------------------------------------------------------------- deploy

const VALID_TARGETS = new Set(['fly', 'docker']);
// Fly app names: lowercase alnum + hyphen, must start/end alnum.
const FLY_NAME_REGEX = /^[a-z0-9][a-z0-9-]{0,61}[a-z0-9]$/;
const REGION_REGEX = /^[a-z]{3}$/;
const IMAGE_TAG_REGEX = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

function runDeploy({ args, pkgRoot }) {
  const tail = args.slice(args.indexOf('deploy') + 1);
  const { flags, positional } = parseArgs(tail, { booleans: ['force'] });
  const target = positional[0];

  if (!target || !VALID_TARGETS.has(target)) {
    process.stderr.write(
      `maude hub deploy: target must be one of ${[...VALID_TARGETS].join(' | ')} (got "${target ?? ''}").\n`
    );
    process.exit(2);
  }

  const hubRoot = findHubRoot(pkgRoot);
  if (!hubRoot) {
    process.stderr.write(
      'maude hub deploy: hub workspace not found.\n\n' +
        'Deploy templates ship in the maude source tree. Run inside a checkout,\n' +
        'or clone https://github.com/1aGh/maude and run from there.\n'
    );
    process.exit(1);
  }

  const outDir = flags.out ? resolve(String(flags.out)) : process.cwd();
  // CREATE IT. The docs' own command is `--out ./deploy` on a fresh box, where
  // that directory does not exist yet — and the emitter used to write straight
  // into it, so the very first thing a self-hoster runs died on
  // `ENOENT ... docker-compose.yml`. Found by running the operator path end to
  // end (B2/D7) rather than reading it. `process.cwd()` always exists, so this
  // only ever fires for an explicit --out.
  mkdirSync(outDir, { recursive: true });

  if (target === 'fly') return deployFly({ hubRoot, outDir, flags });
  return deployDocker({ hubRoot, outDir, flags });
}

function deployFly({ hubRoot, outDir, flags }) {
  const appName = flags.name ? String(flags.name) : `maude-hub-${randHex(4)}`;
  if (!FLY_NAME_REGEX.test(appName)) {
    process.stderr.write(
      `maude hub deploy fly: invalid --name "${appName}" (lowercase alphanumeric + hyphen, 2-63 chars).\n`
    );
    process.exit(2);
  }
  const region = flags.region ? String(flags.region) : 'iad';
  if (!REGION_REGEX.test(region)) {
    process.stderr.write(
      `maude hub deploy fly: invalid --region "${region}" (3-letter Fly code, e.g. iad, fra, nrt).\n`
    );
    process.exit(2);
  }

  const flyToml = renderTemplate(hubRoot, 'fly.toml.template', {
    APP_NAME: appName,
    REGION: region,
  });
  const flyOut = resolve(outDir, 'fly.toml');
  guardOverwrite(flyOut, flags.force, 'fly.toml');
  writeFileSync(flyOut, flyToml, 'utf8');

  // The Dockerfile is referenced by fly.toml [build]; copy it alongside so a
  // `fly deploy` from outDir finds it (Fly builds remotely from the context).
  const dockerfileSrc = resolve(hubRoot, 'Dockerfile');
  const dockerfileOut = resolve(outDir, 'Dockerfile');
  if (existsSync(dockerfileSrc) && (flags.force || !existsSync(dockerfileOut))) {
    copyFileSync(dockerfileSrc, dockerfileOut);
  }

  process.stdout.write(
    `[hub deploy fly] wrote:
  ${flyOut}
  ${dockerfileOut} (copied)

App:    ${appName}
Region: ${region}
URL:    https://${appName}.fly.dev

Next steps (review fly.toml first, then run):
  fly launch --copy-config --no-deploy --name ${appName} --region ${region}
  fly volumes create maude_hub_data --region ${region} --size 3 --yes
  fly deploy

After deploy, the boot logs print a single-use /admin bootstrap link.
Open it → "Generate invite" → copy the \`maude design link …\` command.
Hub auth uses the token store; HUB_SECRET stays unset unless you want a
headless escape hatch (\`fly secrets set HUB_SECRET=$(openssl rand -hex 32)\`).
`
  );
}

function deployDocker({ hubRoot, outDir, flags }) {
  const tag = flags.tag ? String(flags.tag) : 'latest';
  if (!IMAGE_TAG_REGEX.test(tag)) {
    process.stderr.write(`maude hub deploy docker: invalid --tag "${tag}".\n`);
    process.exit(2);
  }

  const compose = renderTemplate(hubRoot, 'docker-compose.yml.template', { IMAGE_TAG: tag });
  const composeOut = resolve(outDir, 'docker-compose.yml');
  guardOverwrite(composeOut, flags.force, 'docker-compose.yml');
  writeFileSync(composeOut, compose, 'utf8');

  // Caddyfile uses {$ENV} runtime substitution — no placeholders to render.
  const caddySrc = resolve(hubRoot, 'Caddyfile.template');
  const caddyOut = resolve(outDir, 'Caddyfile');
  guardOverwrite(caddyOut, flags.force, 'Caddyfile');
  copyFileSync(caddySrc, caddyOut);

  process.stdout.write(
    `[hub deploy docker] wrote:
  ${composeOut}
  ${caddyOut}

Image: ghcr.io/1agh/maude-hub:${tag}

Next steps (point DNS at this box, then run):
  cat > .env <<EOF
  HUB_SECRET=$(openssl rand -hex 32)
  PUBLIC_DOMAIN=maude-hub.example.com
  ACME_EMAIL=you@example.com
  EOF
  docker compose up -d
  docker compose logs hub          # copy the single-use /admin bootstrap link

Caddy fetches a Let's Encrypt cert for PUBLIC_DOMAIN automatically and
proxies WSS to the hub. Works on Lightsail, EC2, Hetzner, DigitalOcean,
Coolify, or a home server. See the hub-deploy docs for per-provider notes.
`
  );
}

function renderTemplate(hubRoot, name, vars) {
  const path = resolve(hubRoot, name);
  if (!existsSync(path)) {
    process.stderr.write(`maude hub deploy: template not found: ${path}\n`);
    process.exit(1);
  }
  let out = readFileSync(path, 'utf8');
  for (const [key, value] of Object.entries(vars)) {
    out = out.replaceAll(`{{${key}}}`, value);
  }
  return out;
}

function guardOverwrite(path, force, label) {
  if (existsSync(path) && !force) {
    process.stderr.write(
      `maude hub deploy: ${label} already exists at ${path}. Pass --force to overwrite.\n`
    );
    process.exit(1);
  }
}

function randHex(bytes) {
  return randomBytes(bytes).toString('hex');
}

// ---------------------------------------------------------------- helpers

function findHubRoot(pkgRoot) {
  const dev = resolve(pkgRoot, 'apps', 'hub');
  if (existsSync(resolve(dev, 'package.json'))) {
    try {
      const pkg = JSON.parse(readFileSync(resolve(dev, 'package.json'), 'utf8'));
      if (pkg.name === '@maude/hub') return dev;
    } catch {
      /* fall through */
    }
  }
  return null;
}

function resolveHubEntry(hubRoot) {
  // Prefer the bundled binary (matches the production-install path); fall back
  // to source for fresh dev trees where bun build hasn't been run yet.
  const bundle = resolve(hubRoot, 'dist', 'hub.bundle.mjs');
  if (existsSync(bundle)) return bundle;
  return resolve(hubRoot, 'src', 'server.mjs');
}

function resolveHubModule(hubRoot, relPath) {
  // Dynamic import expects a URL or absolute path. Bundle does not include
  // standalone module exports (tokens.mjs lives in src/), so we always load
  // from src/ for CLI helpers — independent of whether the bundle exists.
  return `file://${resolve(hubRoot, relPath)}`;
}

function formatDuration(seconds) {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m < 60) return `${m}m${s.toString().padStart(2, '0')}s`;
  const h = Math.floor(m / 60);
  return `${h}h${(m % 60).toString().padStart(2, '0')}m${s.toString().padStart(2, '0')}s`;
}

// --------------------------------------------------------- backup + drill

/**
 * Resolve the hub's backup engine. It lives in apps/hub (it is hub-internal,
 * not part of the published npm surface), so it is imported by path rather
 * than as a package — the same way runServe reaches the hub entry point.
 */
async function loadBackupEngine(pkgRoot) {
  const candidates = [
    resolve(pkgRoot, 'apps/hub/src/backup.mjs'),
    resolve(pkgRoot, '../apps/hub/src/backup.mjs'),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return import(`file://${candidate}`);
  }
  process.stderr.write(
    'maude hub: the backup engine (apps/hub/src/backup.mjs) was not found.\n' +
      'This verb runs from a full checkout or the hub image, not from a plain npm install.\n'
  );
  process.exit(2);
}

function resolveTarget(engine, flags) {
  const explicit = flags.target;
  const target = explicit
    ? explicit.startsWith('file://')
      ? engine.fileTarget(explicit)
      : null
    : engine.targetFromEnv();
  if (!target) {
    process.stderr.write(
      'maude hub: no backup target configured.\n' +
        '  --target file:///path/to/dir, or set MAUDE_BACKUP_TARGET,\n' +
        '  or the MAUDE_S3_{ENDPOINT,BUCKET,ACCESS_KEY_ID,SECRET_ACCESS_KEY} env set.\n'
    );
    process.exit(2);
  }
  return target;
}

async function runBackupNow({ args, pkgRoot }) {
  const { flags } = parseArgs(args);
  const engine = await loadBackupEngine(pkgRoot);
  const dataDir = resolve(flags.data ?? process.env.DATA_DIR ?? 'data');
  const target = resolveTarget(engine, flags);
  const keep = Number(flags.keep ?? 14);

  try {
    const result = await engine.runBackup({ dataDir, target, keep });
    process.stdout.write(`backed up ${dataDir} → ${target.describe}\n  ${result.prefix}\n`);
    for (const f of result.files) {
      process.stdout.write(`    ${f.name.padEnd(12)} ${(f.bytes / 1024).toFixed(1)} KB gz\n`);
    }
    if (result.pruned.length > 0) {
      process.stdout.write(`  pruned ${result.pruned.length} old generation(s)\n`);
    }
  } catch (err) {
    process.stderr.write(`maude hub backup: ${err.message}\n`);
    process.exit(1);
  }
}

async function runRestoreDrill({ args, pkgRoot }) {
  const { flags } = parseArgs(args);
  const engine = await loadBackupEngine(pkgRoot);
  const target = resolveTarget(engine, flags);
  const scratchDir = resolve(
    flags['scratch-dir'] ?? `${process.env.TMPDIR ?? '/tmp'}/maude-restore-drill-${process.pid}`
  );

  let verdict;
  try {
    verdict = await engine.restoreDrill({
      target,
      scratchDir,
      sentinel: flags.sentinel,
      which: flags.generation,
    });
  } catch (err) {
    if (flags.json) process.stdout.write(`${JSON.stringify({ ok: false, error: err.message })}\n`);
    else process.stderr.write(`maude hub restore-drill: ${err.message}\n`);
    process.exit(1);
  }

  if (flags.json) {
    process.stdout.write(`${JSON.stringify(verdict, null, 2)}\n`);
  } else {
    process.stdout.write(
      `restore drill — ${target.describe}\n` +
        `  generation   ${verdict.generation}\n` +
        `  restored     ${verdict.restored.join(', ')}\n` +
        `  integrity    ${verdict.integrity}\n` +
        `  documents    ${verdict.documents}\n` +
        (verdict.sentinel
          ? `  sentinel     ${verdict.sentinel.name} — ${verdict.sentinel.present ? `${verdict.sentinel.bytes} bytes` : 'ABSENT'}\n`
          : '') +
        `  ${verdict.ok ? 'PASS' : 'FAIL'}\n`
    );
    for (const p of verdict.problems) process.stderr.write(`  ! ${p}\n`);
  }

  if (!flags['keep-dir']) {
    try {
      rmSync(scratchDir, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  }
  if (!verdict.ok) process.exit(1);
}

// ------------------------------------------------------- asset integrity

/**
 * Every `assets/<sha8>` a canvas points at must resolve somewhere.
 *
 * The failure this catches is quiet and permanent: a reference whose bytes
 * exist on nobody's disk and in no bucket renders as a broken image forever,
 * and no amount of syncing fixes it. Content addressing means we can check it
 * cheaply — the reference IS the identity.
 */
/**
 * `maude hub backup-owners` — who owns the generations in this keyspace.
 *
 * ADVISORY, and deliberately so. Workspace identity (Phase 0 F1) is
 * forward-only: from the upgrade on, every new generation names its owner and
 * the write refusal stops two hubs destroying each other. It says nothing
 * about a bucket whose generations are ALREADY interleaved — those predate the
 * field, are indistinguishable from each other, and are still being pruned
 * across. This reports that so a person can act on it.
 *
 * It never gates anything. Spacing and counts are evidence, not conditions:
 * a merged series that happens to look evenly spaced would pass, and a
 * single-owner series whose hub was down a day would fail.
 */
async function runBackupOwners({ args, pkgRoot }) {
  const { flags } = parseArgs(args);
  const engine = await loadBackupEngine(pkgRoot);
  const target = resolveTarget(engine, flags);
  const identity = await loadWorkspaceIdentity(pkgRoot);
  const dataDir = flags['data-dir'] ?? process.env.DATA_DIR ?? null;
  const workspace = dataDir && identity ? identity.readWorkspaceId(dataDir) : null;

  let report;
  try {
    report = await engine.inspectKeyspace(target, { workspace });
  } catch (err) {
    if (flags.json) process.stdout.write(`${JSON.stringify({ ok: false, error: err.message })}\n`);
    else process.stderr.write(`maude hub backup-owners: ${err.message}\n`);
    process.exit(1);
  }

  if (flags.json) {
    process.stdout.write(`${JSON.stringify({ ok: true, ...report }, null, 2)}\n`);
    return;
  }
  process.stdout.write(
    `[backup-owners] ${report.describe}\n` +
      `  generations   ${report.generations}\n` +
      `  owners        ${report.owners.length ? report.owners.join(', ') : '(none recorded)'}\n` +
      `  unidentified  ${report.unidentified}\n` +
      `  verdict       ${report.verdict}\n`
  );
  if (report.shared) {
    process.stdout.write(
      '\nTwo hubs sharing one keyspace prune each other\u2019s history. Give each its own\n' +
        'MAUDE_BACKUP_PREFIX, or its own bucket. Nothing here has changed anything.\n'
    );
  }
}

/** The identity helpers live beside the backup engine; same resolution rule. */
async function loadWorkspaceIdentity(pkgRoot) {
  for (const candidate of [
    resolve(pkgRoot, 'apps/hub/src/workspace-identity.mjs'),
    resolve(pkgRoot, '../apps/hub/src/workspace-identity.mjs'),
  ]) {
    if (existsSync(candidate)) return import(`file://${candidate}`);
  }
  return null;
}

async function runAssetCheck({ args, pkgRoot }) {
  const { flags } = parseArgs(args);
  const root = resolve(flags.root ?? process.env.CLAUDE_PROJECT_DIR ?? process.cwd());
  const designRoot = resolveDesignRoot(root);
  if (!designRoot) {
    process.stderr.write(`maude hub asset-check: no .design/ found under ${root}\n`);
    process.exit(2);
  }

  // Scan every text file under the design root for asset references. Regex over
  // the whole tree rather than parsing TSX: a reference is a reference whether
  // it appears in JSX, a meta sidecar, or a CSS url().
  const referenced = new Map(); // key -> Set(files that reference it)
  const REF = /assets\/([0-9a-f]{8})(?:\.[A-Za-z0-9]{1,8})?/g;
  const SKIP_DIRS = new Set(['assets', 'node_modules', '.git']);
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.') && entry.name !== '.design') continue;
      // Per-machine runtime state (DDR-115's `_*` taxonomy) is not a canvas
      // reference — `_generate-history.json` recording an asset it once made
      // is not a broken canvas, and scanning it would report noise as damage.
      if (entry.name.startsWith('_')) continue;
      const abs = resolve(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) walk(abs);
        continue;
      }
      if (!/\.(tsx|jsx|ts|js|json|css|svg|md|html)$/i.test(entry.name)) continue;
      let text;
      try {
        text = readFileSync(abs, 'utf8');
      } catch {
        continue;
      }
      for (const m of text.matchAll(REF)) {
        const key = m[0].slice('assets/'.length);
        if (!referenced.has(key)) referenced.set(key, new Set());
        referenced.get(key).add(abs.slice(root.length + 1));
      }
    }
  };
  walk(designRoot);

  // Local presence, keyed by the LEADING 8 hex chars of the filename.
  //
  // Splitting on '.' looks equivalent and is not: the real corpus contains
  // `<sha8>-<label>.<ext>` (ingested footage) and `<sha8>.<part>.json`
  // (sidecars), so `name.split('.')[0]` yields `deadbeef-cloud` and the asset
  // reads as missing. That produced a false DANGLING report against this repo's
  // own design root — the reference was fine and the index was wrong.
  const assetsDir = resolve(designRoot, 'assets');
  const localBySha = new Map();
  if (existsSync(assetsDir)) {
    for (const name of readdirSync(assetsDir)) {
      const sha = name.match(/^([0-9a-f]{8})(?:[-.]|$)/)?.[1];
      if (sha && !localBySha.has(sha)) localBySha.set(sha, name);
    }
  }

  const engine = await loadBackupEngine(pkgRoot);
  const s3mod = await import(`file://${resolve(pkgRoot, 'apps/hub/src/s3.mjs')}`).catch(() => null);
  const s3 = s3mod?.s3ConfigFromEnv?.() ?? null;
  void engine;

  const dangling = [];
  const localOnly = [];
  let inBucket = 0;

  for (const [key, files] of referenced) {
    const sha = key.split('.')[0];
    const local = localBySha.has(sha);
    let remote = false;
    if (s3) {
      try {
        remote = !!(await s3mod.headObject(s3, `assets/${localBySha.get(sha) ?? key}`));
      } catch {
        remote = false;
      }
    }
    if (remote) inBucket++;
    if (!local && !remote) dangling.push({ key, files: [...files] });
    else if (local && s3 && !remote) localOnly.push({ key, files: [...files] });
  }

  const report = {
    designRoot: designRoot.slice(root.length + 1),
    referenced: referenced.size,
    local: localBySha.size,
    bucket: s3 ? `s3://${s3.bucket}` : null,
    inBucket: s3 ? inBucket : null,
    dangling,
    notMirrored: s3 ? localOnly : null,
    ok: dangling.length === 0,
  };

  if (flags.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(
      `asset check — ${report.designRoot}\n` +
        `  referenced   ${report.referenced}\n` +
        `  on disk      ${report.local}\n` +
        (s3
          ? `  in bucket    ${inBucket}/${report.referenced} (${report.bucket})\n`
          : '  bucket       not configured (set MAUDE_S3_* to check the mirror)\n')
    );
    for (const d of dangling) {
      process.stderr.write(`  DANGLING assets/${d.key} — referenced by ${d.files.join(', ')}\n`);
    }
    if (localOnly.length > 0) {
      process.stdout.write(
        `  ${localOnly.length} asset(s) exist locally but are NOT mirrored — ` +
          'a second machine cannot resolve them yet.\n'
      );
    }
    process.stdout.write(`  ${report.ok ? 'OK' : 'FAILED'}\n`);
  }

  if (!report.ok) process.exit(1);
}

/** `.design/` under `root`, honouring a config-declared designRoot. */
function resolveDesignRoot(root) {
  const configured = (() => {
    for (const candidate of ['.design/config.json', '.maude/config.json']) {
      const abs = resolve(root, candidate);
      if (existsSync(abs)) return resolve(root, candidate, '..');
    }
    return null;
  })();
  if (configured) return configured;
  const fallback = resolve(root, '.design');
  return existsSync(fallback) ? fallback : null;
}
