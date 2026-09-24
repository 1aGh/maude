// `maude hub workspace-up` — Cloud Phase 4 Task 1, the effects layer.
//
// The decisions live in `cli/lib/workspace-plan.mjs` (pure, tested without a
// VPS). This file does the parts that genuinely touch the world: read config,
// write files, boot the stack, run the verification plan, print the result.
//
// IDEMPOTENT BY CONSTRUCTION. Re-running is the upgrade path: the rendered
// files are regenerated, but `.env` secrets that already exist are REUSED, not
// re-minted. Re-minting HUB_SECRET on every run would silently lock out every
// peer that already has a token, and it would do it to the person whose
// instinct after a failed run is to try again.
//
// It does NOT claim to own the deployment afterwards — see `operatorDuties`.

import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { parseArgs } from '../lib/argv.mjs';
import {
  classifyRenderImage,
  envEntries,
  hostContainerPlatform,
  operatorDuties,
  renderCaddyfile,
  renderCompose,
  renderEnv,
  renderImageRef,
  safeSeedUrl,
  validateWorkspaceConfig,
  verificationPlan,
  workspaceBaseUrl,
} from '../lib/workspace-plan.mjs';

export function usage() {
  return `maude hub workspace-up [options]

  Stand up a self-hosted Maude WORKSPACE — a hub that owns the project, commits
  autosaves, and stores media in object storage — and verify it actually works
  before saying so.

  --domain HOST            public hostname (design.acme.com)
  --canvas-domain HOST     SECOND hostname for the canvas origin
                           (canvas.acme.com). The studio renders canvases on
                           their own origin; without a public name for it the
                           iframe points at a container-internal port and every
                           canvas is a blank frame. Point DNS here too.
  --embed-origin ORIGIN    an app allowed to FRAME the studio read-only
                           (https://orbit.acme.com), for the ?embed=1 view.
                           Repeatable, or comma-separated. Framing only: an
                           embedder never gets write access to a canvas.
  --acme-email EMAIL       Let's Encrypt contact
  --admin-email EMAIL      the first person who can sign in
  --admin-password PASS    their initial password (>= 12 chars; generated if omitted)
  --s3-endpoint URL        object storage (R2 / MinIO / S3)
  --s3-bucket NAME
  --s3-access-key-id ID
  --s3-secret-access-key SECRET
  --s3-region REGION       default "auto"
  --dev-minio              run a local MinIO under the compose 'dev' profile
  --local                  TESTING: serve plain HTTP on localhost, no
                           certificate, no ACME. --domain defaults to
                           "localhost" and must stay a loopback NAME.
                           Lets you exercise the whole stack — and every
                           verification step — on a laptop, with no domain and
                           no paid account. Never serve a real workspace this
                           way: sign-in passwords would travel in the clear.
  --render                 add the maude-render sidecar — the one container
                           that carries a browser. Enables PNG/PDF/PPTX/video
                           export from the hosted studio (DDR-230). Without
                           it those formats say so and point at the desktop
                           app; ZIP export works either way.
                           Needs a host architecture the sidecar image is
                           published for, and ~3 GB of image plus headroom for
                           Chromium. This command checks the published
                           architectures before writing anything and refuses
                           rather than leaving you an "exec format error".
  --seed-repo URL          clone an existing project; omit to start fresh
  --image-tag TAG          default "latest" — pin it before you rely on this
  --config FILE            read all of the above from a JSON file
  --out DIR                where to write compose/Caddyfile/.env (default: cwd)
  --dry-run                render + print the plan, touch nothing else
  --json                   machine-readable result

  Re-running is the UPGRADE path: files are regenerated, existing secrets in
  .env are REUSED (re-minting HUB_SECRET would lock out every peer that already
  has a token).

  What it does NOT do: own the deployment. It scaffolds and verifies once.
  Rotation, backups, upgrades and the bill stay with you — the run prints the
  list.
`;
}

/** Every value of a repeatable `--name V` / `--name=V` flag, comma lists split. */
export function repeatedFlag(args, name) {
  const out = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === `--${name}` && i + 1 < args.length) out.push(args[++i]);
    else if (a.startsWith(`--${name}=`)) out.push(a.slice(name.length + 3));
  }
  return out
    .flatMap((v) => String(v).split(','))
    .map((v) => v.trim())
    .filter(Boolean);
}

export async function run({ args, pkgRoot }) {
  const { flags } = parseArgs(args, {
    booleans: ['help', 'dry-run', 'json', 'dev-minio', 'local', 'render'],
  });
  if (flags.help) {
    process.stdout.write(usage());
    return;
  }

  const outDir = resolve(String(flags.out ?? process.cwd()));
  const raw = flags.config ? readConfigFile(String(flags.config)) : {};
  const merged = {
    domain: flags.domain ?? raw.domain,
    acmeEmail: flags['acme-email'] ?? raw.acmeEmail,
    adminEmail: flags['admin-email'] ?? raw.adminEmail,
    ...((flags['admin-password'] ?? raw.adminPassword)
      ? { adminPassword: flags['admin-password'] ?? raw.adminPassword }
      : {}),
    devMinio: flags['dev-minio'] === true || raw.devMinio === true,
    local: flags.local === true || raw.local === true,
    render: flags.render === true || raw.render === true,
    seedRepo: flags['seed-repo'] ?? raw.seedRepo,
    canvasDomain: flags['canvas-domain'] ?? raw.canvasDomain,
    // Repeatable, which parseArgs (last one wins) cannot express.
    embedOrigins: repeatedFlag(args, 'embed-origin').length
      ? repeatedFlag(args, 'embed-origin')
      : raw.embedOrigins,
    imageTag: flags['image-tag'] ?? raw.imageTag,
    ...(flags['s3-endpoint'] || raw.s3
      ? {
          s3: {
            endpoint: flags['s3-endpoint'] ?? raw.s3?.endpoint,
            bucket: flags['s3-bucket'] ?? raw.s3?.bucket,
            accessKeyId: flags['s3-access-key-id'] ?? raw.s3?.accessKeyId,
            secretAccessKey: flags['s3-secret-access-key'] ?? raw.s3?.secretAccessKey,
            region: flags['s3-region'] ?? raw.s3?.region,
          },
        }
      : {}),
    // BYO identity travels via --config only: a client secret does not belong
    // on a command line (argv is visible in `ps` and shell history — see
    // _credentials.md). The config block is passed straight through to
    // validateWorkspaceConfig, which renders and forwards the HUB_OIDC_* vars.
    ...(raw.oidc ? { oidc: raw.oidc } : {}),
  };

  // Read the existing .env BEFORE validating, because whether this deployment
  // already exists decides the backup namespace (Phase 0 F3).
  const envPath = resolve(outDir, '.env');
  const envExists = existsSync(envPath);
  const existing = readExistingEnv(envPath);

  // NEVER force a namespace onto a deployment that has been running without
  // one. A prefixed target lists a DISJOINT keyspace, so adding one makes every
  // existing generation invisible to `listBackups` — orphaned, unprunable, and
  // the next lost volume would see zero generations and seed over the loss. The
  // write-side identity refusal already protects the bare root, so the prefix
  // is a remedy here rather than the safety mechanism.
  const backupPrefix = envExists ? existing.MAUDE_BACKUP_PREFIX || null : undefined;

  const { ok, errors, config } = validateWorkspaceConfig({ ...merged, backupPrefix });
  if (!ok) {
    if (flags.json) {
      process.stdout.write(`${JSON.stringify({ ok: false, errors }, null, 2)}\n`);
    } else {
      process.stderr.write('maude hub workspace-up: the configuration is not usable yet.\n\n');
      for (const e of errors) process.stderr.write(`  • ${e}\n`);
      process.stderr.write('\nRun with --help for the full list of options.\n');
    }
    process.exit(2);
  }

  // REFUSE `--render` on a host the sidecar image cannot run on (M10).
  //
  // Checked HERE — before the admin-password gate, before a byte is written —
  // because the whole point is to cost the operator a message rather than a
  // 2.99 GB pull that ends in `exec format error`. Applies to `--dry-run` too:
  // a dry run that describes a stack which cannot start is the bug, not a
  // preview of it.
  if (config.render) {
    const imageRef = renderImageRef(config);
    const verdict = classifyRenderImage({
      imageRef,
      hostPlatform: hostContainerPlatform(),
      probe: await probeImagePlatforms(imageRef),
    });
    if (!verdict.ok) {
      if (flags.json) {
        process.stdout.write(
          `${JSON.stringify({ ok: false, errors: [verdict.message] }, null, 2)}\n`
        );
      } else {
        process.stderr.write(`maude hub workspace-up: ${verdict.message}`);
      }
      process.exit(2);
    }
    // stderr even under --json: a caveat the machine reader will not see is a
    // caveat nobody sees, and stderr never corrupts the JSON on stdout.
    if (verdict.level === 'warn') process.stderr.write(verdict.message);
  }

  // REFUSE a new admin password on a re-run, rather than writing one that goes
  // nowhere.
  //
  // `seedFirstUser()` (first-user.mjs) creates the account on FIRST BOOT only.
  // On a re-run the account already exists and keeps its original password, so
  // letting `--admin-password` win here produces a `.env` that states one
  // password and a database that holds another. The command's own verification
  // then reports `HTTP 401 — the first user cannot sign in`, and the only
  // repair found on the live AWS run was `docker compose down -v` — on a
  // production box that is losing the project, not fixing the password.
  //
  // Checked BEFORE anything is written or started, so the refusal costs the
  // operator a message rather than a half-applied run.
  if (config.adminPassword && existing.MAUDE_ADMIN_PASSWORD) {
    const message =
      'the first user already exists — `--admin-password` applies to a FIRST boot only. ' +
      'Change their password in the admin UI; re-run without the flag to leave it alone.';
    if (flags.json) {
      process.stdout.write(`${JSON.stringify({ ok: false, errors: [message] }, null, 2)}\n`);
    } else {
      process.stderr.write(`maude hub workspace-up: ${message}\n`);
    }
    process.exit(2);
  }

  // Reuse existing secrets — re-minting on a re-run would lock out every peer
  // that already holds a token, and re-running is exactly what someone does
  // after a failed attempt. (`existing` was read above, before validation.)
  const hubSecret = existing.HUB_SECRET || randomBytes(32).toString('hex');
  const adminPassword = config.adminPassword || existing.MAUDE_ADMIN_PASSWORD || generatePassword();
  const reusedSecret = Boolean(existing.HUB_SECRET);
  // Its OWN secret (DDR-230) — rotating the render bearer must never lock out
  // peers holding hub tokens, and vice versa. Reused on re-runs like the rest.
  const renderSecret = existing.MAUDE_RENDER_SECRET || randomBytes(32).toString('hex');

  const entries = envEntries(config, { hubSecret, adminPassword, renderSecret });
  const files = [
    { name: '.env', body: renderEnv(entries), mode: 0o600 },
    { name: 'docker-compose.yml', body: renderCompose(config), mode: 0o644 },
    { name: 'Caddyfile', body: renderCaddyfile(config), mode: 0o644 },
  ];
  const plan = verificationPlan(config);
  const duties = operatorDuties(config);

  if (flags['dry-run']) {
    const result = {
      ok: true,
      dryRun: true,
      outDir,
      files: files.map((f) => ({ name: f.name, bytes: Buffer.byteLength(f.body), mode: f.mode })),
      verification: plan.map((s) => ({ id: s.id, title: s.title })),
      duties: duties.map((d) => d.title),
      reusedSecret,
    };
    if (flags.json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    else {
      printDryRun({ config, outDir, files, plan, duties, reusedSecret });
      warnNoCanvasDomain(config);
    }
    return;
  }

  warnNoCanvasDomain(config);

  mkdirSync(outDir, { recursive: true });
  for (const f of files) {
    const path = resolve(outDir, f.name);
    writeFileSync(path, f.body, { encoding: 'utf8', mode: f.mode });
    try {
      chmodSync(path, f.mode);
    } catch {
      /* windows — best effort */
    }
  }

  const dockerAvailable = await which('docker');
  if (!dockerAvailable) {
    if (flags.json) {
      process.stdout.write(
        `${JSON.stringify({ ok: false, wrote: files.map((f) => f.name), error: 'docker not found' }, null, 2)}\n`
      );
    } else {
      process.stdout.write(
        `Wrote ${files.map((f) => f.name).join(', ')} to ${outDir}\n\n` +
          'Docker is not on PATH, so the stack was not started and NOTHING WAS VERIFIED.\n' +
          'Install Docker and run:\n\n' +
          `  cd ${outDir} && docker compose up -d\n\n` +
          'Then re-run this command to verify the deployment.\n'
      );
    }
    process.exit(1);
  }

  process.stdout.write(`Wrote ${files.map((f) => f.name).join(', ')} to ${outDir}\n`);
  process.stdout.write('Starting the stack…\n');
  // `--dev-minio` renders MinIO behind the `dev` compose profile, and a profile
  // service does NOT start on a plain `compose up`. Rendering the bucket into
  // the hub's config while never starting the bucket is the shape of failure
  // that reports "storage configured" and then cannot store anything.
  const composeArgs = config.s3?.dev
    ? ['compose', '--profile', 'dev', 'up', '-d']
    : ['compose', 'up', '-d'];
  const up = await sh('docker', composeArgs, { cwd: outDir });
  if (up.code !== 0) {
    process.stderr.write(`docker compose up failed:\n${up.stderr}\n`);
    process.exit(1);
  }

  // `compose up -d` returns when the containers are STARTED, not when they are
  // SERVING. Verifying immediately reported "the workspace answers — ✗
  // unreachable" against a stack that was healthy three seconds later: a false
  // failure, which corrodes trust in the suite exactly as fast as a false pass.
  // Bounded, and it gives up rather than waiting forever — a stack that never
  // comes up must still be reported.
  await waitForHealth(workspaceBaseUrl(config));

  // Verification is the deliverable. A URL printed without a proven round-trip
  // tells the operator something this command does not know.
  process.stdout.write('\nVerifying — this is the part that matters:\n');
  const results = [];
  let failed = 0;
  for (const step of plan) {
    const outcome = await runVerification(step, {
      config,
      hubSecret,
      adminPassword,
      outDir,
      pkgRoot,
    });
    results.push({ id: step.id, title: step.title, ...outcome });
    const mark = outcome.ok ? '✓' : outcome.skipped ? '–' : '✗';
    process.stdout.write(`  ${mark} ${step.title}${outcome.note ? ` — ${outcome.note}` : ''}\n`);
    if (!outcome.ok && !outcome.skipped) failed++;
  }

  if (flags.json) {
    process.stdout.write(
      `${JSON.stringify({ ok: failed === 0, outDir, verification: results, duties }, null, 2)}\n`
    );
  } else {
    printDuties(duties);
    process.stdout.write(
      failed === 0
        ? `\nWorkspace verified: ${workspaceBaseUrl(config)}\n`
        : `\n${failed} check(s) did NOT pass. The stack is running but is not proven — fix and re-run.\n`
    );
  }
  if (failed > 0) process.exit(1);
}

// ------------------------------------------------------------------ helpers

function readConfigFile(path) {
  try {
    return JSON.parse(readFileSync(resolve(path), 'utf8'));
  } catch (err) {
    process.stderr.write(
      `maude hub workspace-up: couldn't read --config ${path}: ${err.message}\n`
    );
    process.exit(2);
  }
}

/** Parse an existing `.env` so a re-run reuses secrets instead of re-minting. */
function readExistingEnv(path) {
  if (!existsSync(path)) return {};
  const out = {};
  try {
    for (const line of readFileSync(path, 'utf8').split('\n')) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      // Values are single-quoted by renderEnv (F8), so unquote on the way back
      // in — otherwise a re-run reads `'secret'` (with quotes) and re-quotes it,
      // and every peer holding the old HUB_SECRET is locked out.
      if (m) out[m[1]] = unquoteEnvValue(m[2]);
    }
  } catch {
    /* unreadable → treat as absent */
  }
  return out;
}

/** Reverse of `renderEnvValue`: strip the single quotes and unescape. */
function unquoteEnvValue(v) {
  if (v.length >= 2 && v.startsWith("'") && v.endsWith("'")) {
    return v.slice(1, -1).replace(/'\\''/g, "'");
  }
  return v;
}

/** Readable, high-entropy, and safe to paste — no ambiguous glyphs. */
function generatePassword() {
  const alphabet = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const bytes = randomBytes(24);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}

function sh(cmd, args, opts = {}) {
  return new Promise((resolvePromise) => {
    const child = spawn(cmd, args, { ...opts, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => {
      stdout += d;
    });
    child.stderr.on('data', (d) => {
      stderr += d;
    });
    child.on('error', () => resolvePromise({ code: 127, stdout, stderr: 'spawn failed' }));
    child.on('close', (code) => resolvePromise({ code: code ?? 1, stdout, stderr }));
  });
}

/**
 * Poll `/health` until the stack is serving, or give up.
 *
 * Deliberately silent on success and NEVER fatal: if the wait expires, the
 * verification steps run anyway and report the real failure. This function
 * removes a timing artefact; it must not become a second place that decides
 * whether the deployment is good.
 */
async function waitForHealth(base, { timeoutMs = 45_000, intervalMs = 1_000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let announced = false;
  while (Date.now() < deadline) {
    const res = await tryFetch(`${base}/health`);
    if (res.ok) return true;
    if (!announced) {
      process.stdout.write('Waiting for the stack to answer…\n');
      announced = true;
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return false;
}

async function which(bin) {
  const res = await sh(process.platform === 'win32' ? 'where' : 'which', [bin]);
  return res.code === 0;
}

/**
 * Ask the registry which platforms an image is published for.
 *
 * `docker manifest inspect --verbose` is the form that answers for BOTH shapes:
 * an ARRAY of descriptors for a manifest list, ONE object for a single-platform
 * image — whose `.Descriptor.platform` is the only place its architecture
 * appears at all. The plain (non-verbose) form omits it entirely for the single
 * case, which is precisely why the live AWS run could not tell an amd64-only
 * image from a portable one without pulling 3 GB of it.
 *
 * Never throws and never blocks: anything it cannot establish comes back as
 * `unknown`, and `classifyRenderImage` turns that into a warning.
 */
async function probeImagePlatforms(imageRef) {
  if (!(await which('docker'))) {
    return { status: 'unknown', platforms: [], note: 'docker is not on PATH' };
  }
  const res = await sh('docker', ['manifest', 'inspect', '--verbose', imageRef]);
  if (res.code !== 0) {
    const err = `${res.stderr}${res.stdout}`;
    if (/manifest unknown|not found|no such manifest|denied/i.test(err)) {
      return { status: 'missing', platforms: [] };
    }
    return { status: 'unknown', platforms: [], note: firstLine(err) };
  }
  try {
    const parsed = JSON.parse(res.stdout);
    const platforms = [
      ...new Set(
        (Array.isArray(parsed) ? parsed : [parsed])
          .map((entry) => entry?.Descriptor?.platform)
          // `unknown/unknown` is how buildx describes an attestation manifest —
          // a sibling of the real images in the list, never a runnable one.
          .filter((p) => p?.os && p?.architecture && p.architecture !== 'unknown')
          .map((p) => `${p.os}/${p.architecture}`)
      ),
    ];
    return platforms.length
      ? { status: 'ok', platforms }
      : { status: 'unknown', platforms: [], note: 'the manifest declared no platform' };
  } catch {
    return { status: 'unknown', platforms: [], note: 'the manifest was not JSON' };
  }
}

function firstLine(text) {
  return String(text).trim().split('\n')[0].slice(0, 200);
}

/**
 * Execute one verification step.
 *
 * A step this build cannot yet perform reports `skipped` with a reason — it
 * NEVER reports success. Counting an unrun check as passed is the single
 * fastest way to make a verification suite worthless.
 */
async function runVerification(step, { config, hubSecret, adminPassword, outDir, pkgRoot }) {
  const base = workspaceBaseUrl(config);
  switch (step.id) {
    case 'health': {
      const res = await tryFetch(`${base}/health`);
      return res.ok ? { ok: true } : { ok: false, note: res.note };
    }
    case 'admin-claimed': {
      const res = await tryFetch(`${base}/admin/api/status`, {
        headers: { Authorization: `Bearer ${hubSecret}` },
      });
      return res.ok ? { ok: true } : { ok: false, note: res.note };
    }
    case 'user-signin':
      return verifySignin(base, config.adminEmail, adminPassword);
    case 'git-commit':
      return verifyGitHistory(outDir);
    case 's3-object':
      return verifyBucketRoundTrip(config, pkgRoot);
    case 's3-no-expiry':
      return verifyNoLifecycle(config, pkgRoot);
    case 'restore-drill':
      return verifyRestoreDrill(config, { outDir, pkgRoot });
    case 'render-health':
      return verifyRenderHealth(outDir);
    default:
      return {
        ok: false,
        skipped: true,
        note: 'not yet automated — verify by hand, then close it in the plan',
      };
  }
}

/**
 * The credential the operator is about to be handed actually works.
 *
 * This is the check that would have caught the shipped bug where a provisioned
 * workspace had no users at all: every other check passed, the URL printed,
 * and the first person to try the login was the one who found out.
 */
async function verifySignin(base, email, password) {
  if (!password) return { ok: false, note: 'no admin password was generated' };
  try {
    const res = await fetch(`${base}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return { ok: false, note: `HTTP ${res.status} — the first user cannot sign in` };
    const body = await res.json().catch(() => null);
    return body?.token ? { ok: true } : { ok: false, note: 'login returned no session token' };
  } catch (err) {
    return { ok: false, note: err.name === 'TimeoutError' ? 'timed out' : 'unreachable' };
  }
}

/**
 * The render sidecar answers AND is configured (DDR-230).
 *
 * Probed from INSIDE the hub container, because that is the only place the
 * service is reachable from — it deliberately has no public port. `configured`
 * comes from the service's own /_health: a booted sidecar with a missing
 * secret or an empty origin allowlist refuses every job, and "up but refusing
 * everything" must not read as a pass.
 */
async function verifyRenderHealth(outDir) {
  const probe = await sh(
    'docker',
    [
      'compose',
      'exec',
      '-T',
      'hub',
      'sh',
      '-c',
      'wget -q -O - http://render:8790/_health || curl -sf http://render:8790/_health',
    ],
    { cwd: outDir }
  );
  if (probe.code !== 0) return { ok: false, note: 'the render service did not answer /_health' };
  try {
    const body = JSON.parse(probe.stdout);
    if (body?.ok && body?.configured) return { ok: true };
    return {
      ok: false,
      note: body?.ok
        ? 'render service is up but not configured (missing secret or canvas-origin allowlist)'
        : 'render service /_health did not report ok',
    };
  } catch {
    return { ok: false, note: 'render service /_health returned something that is not JSON' };
  }
}

/**
 * The server-side checkout has real commits (Cloud Phase 16).
 *
 * Read from INSIDE the container, because that is where the history lives.
 * Checking a path on the operator's laptop would pass on a machine that
 * happens to have a repo and tell us nothing about the deployment.
 */
async function verifyGitHistory(outDir) {
  const probe = await sh(
    'docker',
    ['compose', 'exec', '-T', 'hub', 'git', '-C', '/repo', 'log', '-1', '--format=%H %an'],
    { cwd: outDir }
  );
  if (probe.code !== 0) {
    const err = `${probe.stderr}`.toLowerCase();
    // A fresh workspace has no commits because nobody has edited anything yet.
    // That is the NORMAL state five seconds after provisioning, and reporting
    // it as a failure trains the operator to ignore a red mark — which is
    // precisely what makes a real one invisible later. Skipped says the truth:
    // this was not proven, and here is what would prove it.
    if (err.includes('does not have any commits') || err.includes('bad default revision')) {
      return {
        ok: false,
        skipped: true,
        note: 'the checkout is ready but empty — edit a canvas, then re-run to prove autosave commits',
      };
    }
    if (err.includes('not a git repository')) {
      return {
        ok: false,
        note: 'the workspace has no checkout — server-side history is not running',
      };
    }
    if (err.includes('executable file not found') || err.includes('not found')) {
      return { ok: false, note: 'git is missing from the hub image — history cannot be kept' };
    }
    return { ok: false, note: `git log failed: ${probe.stderr.trim().slice(0, 120)}` };
  }
  const line = probe.stdout.trim();
  if (!line) {
    return {
      ok: false,
      skipped: true,
      note: 'the checkout is ready but empty — edit a canvas, then re-run',
    };
  }
  return { ok: true, note: `HEAD by ${line.split(' ').slice(1).join(' ') || 'unknown'}` };
}

/** Load the hub's S3 client from the installed package. */
async function loadS3(pkgRoot) {
  for (const candidate of [
    resolve(pkgRoot, 'apps/hub/src/s3.mjs'),
    resolve(pkgRoot, '../apps/hub/src/s3.mjs'),
  ]) {
    const mod = await import(`file://${candidate}`).catch(() => null);
    if (mod) return mod;
  }
  return null;
}

function s3ConfigFrom(config) {
  const s = config.s3;
  // The dev MinIO endpoint (`http://minio:9000`) is a compose-network name.
  // These checks run on the OPERATOR's machine, which cannot resolve it — but
  // the compose file publishes the port, so loopback is the same bucket.
  const endpoint = s.dev ? s.endpoint.replace('//minio:', '//127.0.0.1:') : s.endpoint;
  return {
    endpoint,
    bucket: s.bucket,
    accessKeyId: s.accessKeyId,
    secretAccessKey: s.secretAccessKey,
    region: s.region ?? 'auto',
  };
}

/**
 * A real object goes into the bucket and comes back out.
 *
 * Content-addressed, so the sentinel is indistinguishable from a genuine
 * asset — and it is removed afterwards, because a verification step that
 * litters a customer's bucket is a verification step people turn off.
 */
async function verifyBucketRoundTrip(config, pkgRoot) {
  if (!config.s3) return { ok: false, skipped: true, note: 'no object storage configured' };
  const s3 = await loadS3(pkgRoot);
  if (!s3)
    return { ok: false, skipped: true, note: 'the hub S3 client was not found in this install' };
  const cfg = s3ConfigFrom(config);
  const bytes = Buffer.from(`maude workspace-up sentinel\n`);
  const key = `assets/${createHash('sha256').update(bytes).digest('hex').slice(0, 8)}.bin`;
  try {
    // The stack was declared healthy by the HUB's health check; object storage
    // is a different container and may still be starting. A one-shot attempt
    // here reported "fetch failed" against a MinIO that was serving four
    // seconds later — a false failure, which corrodes the suite as fast as a
    // false pass.
    await retry(() => s3.putObject(cfg, key, bytes), { attempts: 6, delayMs: 2000 });
    const head = await s3.headObject(cfg, key);
    if (!head) return { ok: false, note: 'the object was written but could not be read back' };
    if (head.size !== bytes.length) {
      return { ok: false, note: `read back ${head.size} bytes, wrote ${bytes.length}` };
    }
    return { ok: true };
  } catch (err) {
    if (/NoSuchBucket/i.test(err.message)) {
      return {
        ok: false,
        note: `the bucket "${cfg.bucket}" does not exist at ${cfg.endpoint} — create it, then re-run`,
      };
    }
    if (/InvalidAccessKeyId|SignatureDoesNotMatch/i.test(err.message)) {
      return { ok: false, note: 'object storage rejected the credentials' };
    }
    return { ok: false, note: `bucket rejected the round trip: ${err.message.slice(0, 120)}` };
  } finally {
    await s3.deleteObject(s3ConfigFrom(config), key).catch(() => {});
  }
}

/**
 * No lifecycle rule can expire the media.
 *
 * The quiet catastrophe this guards: assets are content-addressed and
 * referenced from git history forever, so an expiry rule deletes objects that
 * canvases still point at, with no recovery path and no error at the time.
 *
 * A bucket with NO lifecycle configuration answers 404 — that is the pass.
 */
async function verifyNoLifecycle(config, pkgRoot) {
  if (!config.s3) return { ok: false, skipped: true, note: 'no object storage configured' };
  const s3 = await loadS3(pkgRoot);
  if (!s3?.signRequest) {
    return { ok: false, skipped: true, note: 'the hub S3 client was not found in this install' };
  }
  const cfg = s3ConfigFrom(config);
  try {
    const signed = s3.signRequest(cfg, { method: 'GET', key: '', query: { lifecycle: '' } });
    const res = await fetch(signed.url, {
      method: 'GET',
      headers: signed.headers,
      signal: AbortSignal.timeout(15_000),
    });
    if (res.status === 404) return { ok: true, note: 'no lifecycle configuration' };
    if (!res.ok) {
      // Cannot read the config ⇒ cannot claim it is safe. Skipped, never passed.
      //
      // 403 gets its own sentence because it is almost always OUR fault, not a
      // misconfiguration: the least-privilege policy we ship omitted
      // `s3:GetLifecycleConfiguration` until 2026-08-20, so following the docs
      // to the letter left this check permanently skipped — and the thing it
      // guards (an expiry rule silently deleting media that canvases still
      // reference) has no recovery path once it fires.
      const why =
        res.status === 403
          ? 'the credential may not read lifecycle config — add s3:GetLifecycleConfiguration on the bucket ARN'
          : `HTTP ${res.status}`;
      return {
        ok: false,
        skipped: true,
        note: `could not read lifecycle config (${why})`,
      };
    }
    const xml = await res.text();
    const rules = xml.match(/<Rule>/g)?.length ?? 0;
    if (rules === 0) return { ok: true, note: 'no lifecycle rules' };
    // Any rule at all is reported. Deciding which prefixes a rule matches from
    // its XML is exactly the kind of parsing that is wrong in the one case
    // that matters, so this reports rather than adjudicates.
    return {
      ok: false,
      note: `${rules} lifecycle rule(s) on this bucket — confirm none can expire assets/`,
    };
  } catch (err) {
    return {
      ok: false,
      skipped: true,
      note: `lifecycle check failed: ${err.message.slice(0, 100)}`,
    };
  }
}

/**
 * Turn a failed drill subprocess into a verdict — and separate the two very
 * different things a non-zero exit can mean.
 *
 * Exported because this distinction, not the spawning, is the thing worth
 * pinning: on the first live AWS run all three of "no generation yet",
 * "nowhere to run" and "the restore is broken" printed as a single red
 * `failed`, and the operator spent the evening on the third when the truth was
 * the second.
 */
export function classifyDrillFailure(text) {
  if (/no complete backup generation/i.test(text)) {
    return {
      ok: false,
      skipped: true,
      note: 'no generation exists yet (the first one lands within 6h) — run `maude hub restore-drill` then',
    };
  }
  // "NOWHERE TO RUN" IS NOT "THE BACKUP IS BROKEN". The standard deployment
  // this command generates is container-only: the host clone has no
  // `node_modules` (so `backup.mjs` dies on `Cannot find module
  // 'better-sqlite3'`) and the image carries the bundled server, not
  // `cli/bin/maude.mjs` — so the drill has nowhere to execute, through no
  // fault of the backups. Reported as `failed`, that reads as data loss.
  if (/cannot find module|backup engine.*not found|ERR_MODULE_NOT_FOUND/i.test(text)) {
    return {
      ok: false,
      skipped: true,
      note:
        'the drill could not run here — this host has no installed backup engine, so nothing ' +
        'about the backups was proven either way. Run `maude hub restore-drill` from a full ' +
        'checkout against the same target.',
    };
  }
  return { ok: false, note: `provisioning drill failed: ${text.trim().slice(0, 160)}` };
}

/**
 * A backup nobody has restored is a hypothesis. Runs the real drill.
 *
 * This used to report `skipped` unconditionally, on the grounds that "the
 * drill needs the hub's own data dir, which lives inside the container". That
 * was never true of the drill: `runRestoreDrill` restores into a SCRATCH
 * directory from a target resolved off flags and env — it never touches the
 * hub's data dir. And the credentials it needs are the ones we just rendered
 * into `.env` on this machine.
 *
 * What the old note WAS right about is the claim it makes. Running it at
 * provisioning time proves the code path works against this bucket with these
 * credentials; it does not prove the deployment is restorable next month. So
 * it is labelled a PROVISIONING drill and the recurring duty stays uncrossed
 * in `operatorDuties()`.
 */
async function verifyRestoreDrill(config, { outDir, pkgRoot }) {
  if (!config.s3) return { ok: false, skipped: true, note: 'no backup target configured' };

  // PASS THE RENDERED ENV EXPLICITLY.
  //
  // The subprocess resolves its target through `engine.targetFromEnv()` — the
  // SHELL's environment. `MAUDE_S3_*` was rendered into `.env` for the
  // CONTAINER and was never exported here, so the drill reported "no backup
  // target configured" on a deployment whose storage was configured and
  // working. The note above this function said the credentials "are the ones
  // we just rendered into `.env` on this machine": rendered, yes — loaded, no.
  const rendered = readExistingEnv(resolve(outDir, '.env'));
  const env = { ...process.env };
  for (const [key, value] of Object.entries(rendered)) {
    if (
      key.startsWith('MAUDE_S3_') ||
      key === 'MAUDE_BACKUP_TARGET' ||
      key === 'MAUDE_BACKUP_PREFIX'
    ) {
      env[key] = value;
    }
  }

  const drill = await sh(
    process.execPath,
    [resolve(pkgRoot, 'cli/bin/maude.mjs'), 'hub', 'restore-drill', '--json'],
    { env }
  );
  if (drill.code !== 0) {
    const text = `${drill.stdout}${drill.stderr}`;
    return classifyDrillFailure(text);
  }
  return { ok: true, note: 'provisioning drill passed — schedule it, this proves today only' };
}

/** Retry a flaky-at-startup operation. Rethrows the LAST error, so the
 *  reported cause is the real one rather than "timed out". */
async function retry(fn, { attempts, delayMs }) {
  let last;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      last = err;
      // A definitive answer from the service is not worth retrying — only the
      // "not listening yet" shape is.
      if (!/fetch failed|ECONNREFUSED|socket hang up/i.test(err.message)) throw err;
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw last;
}

async function tryFetch(url, init) {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10_000);
    try {
      const res = await fetch(url, { ...init, signal: ctrl.signal });
      return res.ok ? { ok: true } : { ok: false, note: `HTTP ${res.status}` };
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    return { ok: false, note: err.name === 'AbortError' ? 'timed out' : 'unreachable' };
  }
}

/**
 * The M7 warning — LOUD, in both the dry run and the real one.
 *
 * Without a canvas domain the stack comes up, every verification step passes,
 * and every canvas renders as a blank frame: the iframe's origin defaults to
 * `http://localhost:<container port>`, an address only the server itself can
 * reach. The spike hit exactly this, concluded "the workspace can't render by
 * design", and planned around a limitation that was one missing hostname.
 */
function warnNoCanvasDomain(config) {
  if (config.canvasDomain || config.local) return;
  process.stderr.write(
    '\n  ⚠ no --canvas-domain: canvases will NOT render in remote browsers.\n' +
      '    The canvas iframe needs its own public hostname (e.g. canvas.' +
      config.domain.replace(/^[^.]+\./, '') +
      ').\n' +
      '    Point a DNS record at this machine and re-run with --canvas-domain <host>.\n' +
      '    The studio chrome (file tree, comments) works either way.\n\n'
  );
}

function printDryRun({ config, outDir, files, plan, duties, reusedSecret }) {
  process.stdout.write(
    `maude hub workspace-up — DRY RUN, nothing was written\n\n` +
      `  workspace   ${workspaceBaseUrl(config)}${config.local ? '  (LOCAL — plain HTTP)' : ''}\n` +
      `  first user  ${config.adminEmail}\n` +
      `  storage     ${config.s3 ? `${config.s3.bucket} @ ${config.s3.endpoint}${config.s3.dev ? ' (dev MinIO)' : ''}` : 'none — media stays in git'}\n` +
      `  project     ${safeSeedUrl(config.seedRepo) ?? 'starts fresh'}\n` +
      `  canvas      ${config.canvasDomain ? `${config.local ? 'http' : 'https'}://${config.canvasDomain}` : config.local ? 'same-machine (local mode — the browser can reach the container port)' : 'NOT SET — canvases will not render in remote browsers'}\n` +
      (config.embedOrigins?.length
        ? `  embeds      ${config.embedOrigins.join(' ')}  (may frame the studio read-only)\n`
        : '') +
      `  image       ghcr.io/1agh/maude-hub:${config.imageTag}\n` +
      `  out         ${outDir}\n` +
      (reusedSecret ? '  secrets     reusing HUB_SECRET from the existing .env\n' : '') +
      '\nWould write:\n'
  );
  for (const f of files) {
    process.stdout.write(
      `  ${f.name.padEnd(20)} ${Buffer.byteLength(f.body)} bytes  mode ${f.mode.toString(8)}\n`
    );
  }
  process.stdout.write('\nWould then verify:\n');
  for (const s of plan) process.stdout.write(`  • ${s.title} — ${s.detail}\n`);
  printDuties(duties);
}

function printDuties(duties) {
  process.stdout.write(
    '\nThis command scaffolded and verified your workspace once. It does not\noperate it. What stays yours:\n\n'
  );
  for (const d of duties) {
    process.stdout.write(`  ${d.title}\n      ${d.detail}\n`);
  }
}
