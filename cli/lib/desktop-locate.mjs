// desktop-locate.mjs — find the Maude desktop app's server for a project, and ask the app for one
// (#206 T6.3d; DDR-250; contract `apps/studio/client/v2/contracts/206-cli-reuses-desktop.md` §3–§4).
//
// While the desktop app runs it owns a checkout's server. The app writes a registry,
// `<app_data_dir>/servers.json` (0600 in a 0700 dir), naming each project root it serves with a
// port and a per-spawn `attestKey`. A terminal `maude design` verb believes a port from it only after
// the server there answers a fresh nonce:
//
//     mac = HMAC-SHA256(attestKey as UTF-8, "maude-attest/1\n" + nonce + "\n" + rootId + "\n" + port)
//
// (`GET /_api/shell/attest?n=`, apps/studio/shell/attest.ts), compared in constant time. A port
// squatter, a respawned sibling or a planted listener cannot answer it. Only the PORT is used, always
// on 127.0.0.1 — never a URL from any file.
//
// Trust rules:
//   • The registry is read only when it is a regular file of this user, at most 1 MiB, not writable
//     by group or others, `v: 1`, and its `app.pid` is alive (the same rules as shell/cli-yield.ts).
//     This module never creates it, nor its folder.
//   • When the registry names this root as RUNNING, the project's `_server.json` is never a trust
//     input: a planted copy cannot redirect a verb. If that server does not attest, the answer is
//     `unverified` and callers fail closed (no `_server.json` fallback).
//   • When the app is not running, or has no running server for this root, callers keep today's
//     `_server.json` + pid + `/_health` rootId check (studio-locate.mjs, server-up.sh).
//
// sec-loopback-bearer §7 — an app server requires its per-spawn API key from every caller. The registry
// entry carries it (`apiKey`); this module hands it out only with an ATTESTED port (never for an entry
// whose server did not answer the challenge), and never reads a key from any project file. Callers send
// it as `x-maude-api-key` (studio-locate.mjs `studioHeaders`; bash helpers through `key` mode below).
//
// The CLI → app socket (`cli.sock`, beside the registry): one JSON request per connection, one JSON
// reply. Used only when it is a socket of this user; absent → today's behaviour. The CLI never
// launches the app.
//
// Leaf module: node built-ins only. Also runnable (`node desktop-locate.mjs <mode> …`) for the bash
// helpers — see `main` at the bottom for the modes and exit codes.

import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { createConnection } from 'node:net';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REGISTRY_FILE_ENV = 'MAUDE_APP_REGISTRY_FILE';
export const APP_IDENTIFIER = 'com.maude.app';
export const SOCKET_FILE = 'cli.sock';
export const ATTEST_DOMAIN = 'maude-attest/1';
const ATTEST_KEY_RE = /^[0-9a-fA-F]{64}$/;
const REGISTRY_MAX_BYTES = 1024 * 1024;
const REPLY_MAX_BYTES = 64 * 1024;
const LABEL_RE = /^[A-Za-z0-9._-]{1,64}$/;

export const CAP_FULL_LINE =
  'Maude has 3 busy projects open — using a separate server for this run.';
export const BRANCH_UNSENT_LINE =
  'Maude has unsaved changes for another branch in this folder; save or discard them first.';
export const SHEET_LIMIT_LINE =
  'Maude asked about new folders too often just now — using a separate server for this run. Open the folder in Maude yourself (File › Open project…) to skip the question.';

// The characters that reorder or hide the text around them (bidi controls and marks, zero-width and
// other invisible format characters, line/paragraph separators, tag characters) — the same set the
// app strips from a branch name (project_resolve.rs `is_invisible`). A branch name from the app or the
// registry is printed in the terminal; it never needs one.
const INVISIBLE = [
  [0xad, 0xad],
  [0x34f, 0x34f],
  [0x61c, 0x61c],
  [0x115f, 0x1160],
  [0x17b4, 0x17b5],
  [0x180b, 0x180f],
  [0x200b, 0x200f],
  [0x2028, 0x202e],
  [0x2060, 0x206f],
  [0x3164, 0x3164],
  [0xfe00, 0xfe0f],
  [0xfeff, 0xfeff],
  [0xffa0, 0xffa0],
  [0xfff0, 0xfffb],
  [0x1bca0, 0x1bca3],
  [0x1d173, 0x1d17a],
  [0xe0000, 0xe0fff],
];
const isInvisible = (cp) => INVISIBLE.some(([lo, hi]) => cp >= lo && cp <= hi);
const isControl = (cp) => cp <= 0x1f || (cp >= 0x7f && cp <= 0x9f);

/** A branch name (or any app-supplied one-line name) fit for the terminal: one line, nothing hidden. */
export function cleanName(s) {
  let out = '';
  for (const ch of String(s)) {
    const cp = ch.codePointAt(0);
    if (isInvisible(cp)) continue;
    out += isControl(cp) ? ' ' : ch;
  }
  return out;
}

/** http.ts rootIdentity, verbatim: sha256(realpath(root)) hex, first 12. */
export function rootIdentity(root) {
  let resolved = root;
  try {
    resolved = realpathSync(root);
  } catch {
    /* hash what we were told */
  }
  return createHash('sha256').update(resolved, 'utf8').digest('hex').slice(0, 12);
}

function real(p) {
  try {
    return realpathSync(p);
  } catch {
    return null;
  }
}

const underTest = (e) => !!e && (!!e.NODE_TEST_CONTEXT || e.NODE_ENV === 'test');

/** The registry the app writes: Tauri's `app_data_dir()` + `servers.json` (cli-yield.ts registryPath). */
export function registryPath(env = process.env, platform = process.platform, home = homedir()) {
  const override = env[REGISTRY_FILE_ENV];
  if (override && isAbsolute(override)) return override;
  // Under a test runner (node --test, bun test) only an explicit override counts: a suite that runs
  // server-up or `design open` on this Mac must never reach the person's running Maude.
  if (underTest(env) || underTest(process.env)) return null;
  return appDataRegistryPath(env, platform, home);
}

/** The platform default alone (no override, no test guard): computed, never created. */
export function appDataRegistryPath(
  env = process.env,
  platform = process.platform,
  home = homedir()
) {
  if (platform === 'darwin')
    return join(home, 'Library', 'Application Support', APP_IDENTIFIER, 'servers.json');
  if (platform === 'win32')
    return env.APPDATA ? join(env.APPDATA, APP_IDENTIFIER, 'servers.json') : null;
  const data = env.XDG_DATA_HOME && isAbsolute(env.XDG_DATA_HOME) ? env.XDG_DATA_HOME : null;
  return join(data ?? join(home, '.local', 'share'), APP_IDENTIFIER, 'servers.json');
}

const validPort = (p) => Number.isInteger(p) && p >= 1 && p <= 65535;

/**
 * The registry, or null when it is absent, not a regular file of this user, writable by group or
 * others, over 1 MiB, or malformed. Entries that are not well-formed are dropped one by one.
 */
export function readRegistry(file) {
  if (!file) return null;
  try {
    const st = lstatSync(file);
    if (!st.isFile() || st.size > REGISTRY_MAX_BYTES) return null;
    const uid = process.getuid?.();
    if (uid !== undefined && st.uid !== uid) return null;
    if (process.platform !== 'win32' && (st.mode & 0o022) !== 0) return null;
    const doc = JSON.parse(readFileSync(file, 'utf8'));
    if (doc?.v !== 1 || !Array.isArray(doc.servers)) return null;
    const appPid = doc.app?.pid;
    if (!Number.isInteger(appPid) || appPid <= 0) return null;
    const servers = [];
    for (const s of doc.servers) {
      if (!s || typeof s !== 'object') continue;
      if (typeof s.root !== 'string' || !isAbsolute(s.root)) continue;
      if (s.state !== 'running' && s.state !== 'resting') continue;
      const e = { root: s.root, state: s.state };
      if (typeof s.rootId === 'string') e.rootId = s.rootId;
      if (typeof s.label === 'string' && LABEL_RE.test(s.label)) e.label = s.label;
      e.kind = s.kind === 'worktree' ? 'worktree' : 'project';
      if (typeof s.branch === 'string') e.branch = cleanName(s.branch);
      if (Number.isInteger(s.pid) && s.pid > 0) e.pid = s.pid;
      if (validPort(s.port)) e.port = s.port;
      if (typeof s.attestKey === 'string' && ATTEST_KEY_RE.test(s.attestKey))
        e.attestKey = s.attestKey;
      if (typeof s.apiKey === 'string' && ATTEST_KEY_RE.test(s.apiKey)) e.apiKey = s.apiKey;
      // a running entry without a port or a key cannot be verified: it reads as not running
      if (e.state === 'running' && (e.port === undefined || e.attestKey === undefined))
        e.state = 'starting';
      servers.push(e);
    }
    return { appPid, servers };
  } catch {
    return null;
  }
}

/** Alive and ours to signal. EPERM (another user's process) is not the app. */
export function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** The app socket beside the registry, when it is a socket of this user; else null. */
export function appSocketPath(file) {
  if (!file) return null;
  const sock = join(dirname(file), SOCKET_FILE);
  try {
    const st = lstatSync(sock);
    if (!st.isSocket()) return null;
    const uid = process.getuid?.();
    if (uid !== undefined && st.uid !== uid) return null;
    return sock;
  } catch {
    return null;
  }
}

export function attestMac(key, nonce, rootId, port) {
  return createHmac('sha256', key)
    .update(`${ATTEST_DOMAIN}\n${nonce}\n${rootId}\n${port}`)
    .digest('hex');
}

/** Constant-time compare (hashed first, so a length difference leaks nothing). */
export function macMatches(got, want) {
  if (typeof got !== 'string' || !got) return false;
  const a = createHash('sha256').update(got).digest();
  const b = createHash('sha256').update(want).digest();
  return timingSafeEqual(a, b);
}

/**
 * Does the server at `port` hold `entry.attestKey` for `rootId`? A fresh 32-hex nonce per call;
 * only 127.0.0.1; a redirect is a failure. Never throws.
 */
export async function verifyAttest(port, entry, { rootId, timeoutMs = 1500 } = {}) {
  if (!validPort(port) || !entry?.attestKey || !rootId) return false;
  const n = randomBytes(16).toString('hex');
  try {
    const r = await fetch(`http://127.0.0.1:${port}/_api/shell/attest?n=${n}`, {
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (r.status !== 200) return false;
    const body = await r.json();
    return macMatches(body?.mac, attestMac(entry.attestKey, n, rootId, port));
  } catch {
    return false;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The app's view of `root`, read once: `{ file, reg, entries, socket }`, or null (no app). */
function appView(root, env, alive) {
  const file = registryPath(env);
  const reg = readRegistry(file);
  if (!reg || !alive(reg.appPid)) return null;
  const want = real(root) ?? resolve(root);
  const id = rootIdentity(root);
  const entries = reg.servers.filter(
    (e) => (real(e.root) ?? e.root) === want && (e.rootId === undefined || e.rootId === id)
  );
  return { file, reg, entries, socket: appSocketPath(file), rootId: id };
}

/**
 * What the app says about `root`. Never throws.
 *   { state: 'no-app' }                                  no registry, or its app is not running
 *   { state: 'absent' | 'resting' | 'starting', socket } the app runs, with no usable server here
 *   { state: 'running', port, label, kind, socket }      an attested app server for this root
 *   { state: 'unverified', socket }                      the registry names a running server for
 *                                                        this root, but it did not attest
 */
export async function probeDesktop(
  root,
  { env = process.env, alive = pidAlive, timeoutMs = 1500, attempts = 1, retryDelayMs = 500 } = {}
) {
  try {
    for (let i = 0; i < Math.max(1, attempts); i++) {
      if (i > 0) await sleep(retryDelayMs);
      const v = appView(root, env, alive);
      if (!v) return { state: 'no-app' };
      const running = v.entries.filter((e) => e.state === 'running');
      if (!running.length) {
        const state = v.entries.some((e) => e.state === 'starting')
          ? 'starting'
          : v.entries.length
            ? 'resting'
            : 'absent';
        return { state, socket: v.socket };
      }
      for (const e of running) {
        if (await verifyAttest(e.port, e, { rootId: v.rootId, timeoutMs })) {
          return {
            state: 'running',
            port: e.port,
            label: e.label ?? null,
            kind: e.kind,
            socket: v.socket,
            ...(e.apiKey ? { apiKey: e.apiKey } : {}),
          };
        }
      }
      if (i === Math.max(1, attempts) - 1) return { state: 'unverified', socket: v.socket };
    }
  } catch {
    /* fall through */
  }
  return { state: 'no-app' };
}

const served = (p) => ({
  port: p.port,
  label: p.label,
  kind: p.kind,
  ...(p.apiKey ? { apiKey: p.apiKey } : {}),
});

/** `{ port, label, kind, apiKey? }` of the attested app server for `root`, or null (contract §8). */
export async function locateDesktop(root, opts = {}) {
  const p = await probeDesktop(root, opts);
  return p.state === 'running' ? served(p) : null;
}

/**
 * sec-loopback-bearer §7.6 — the API key for `root`'s app server on `port`, or null (no app, another
 * port, no key, or the server there did not attest). Never throws.
 */
export async function apiKeyFor(root, port, opts = {}) {
  const p = await probeDesktop(root, opts);
  return p.state === 'running' && p.port === Number(port) ? (p.apiKey ?? null) : null;
}

/**
 * `locateDesktop`, waited for: a tab the app has just shown may still be booting its server (the
 * app waits up to 45 s for one). Null once `waitMs` has passed or the app is gone.
 */
export async function waitDesktop(root, { waitMs = 45_000, pollMs = 500, ...opts } = {}) {
  const until = Date.now() + waitMs;
  for (;;) {
    const p = await probeDesktop(root, opts);
    if (p.state === 'running') return served(p);
    if (p.state === 'no-app' || Date.now() >= until) return null;
    await sleep(pollMs);
  }
}

/**
 * One request over the app socket: `{ v: 1, ...req }`, one JSON reply. Null when the app is not
 * running, there is no socket, or the exchange fails. Never throws.
 */
export async function askApp(req, { env = process.env, alive = pidAlive, timeoutMs = 2500 } = {}) {
  const file = registryPath(env);
  const reg = readRegistry(file);
  if (!reg || !alive(reg.appPid)) return null;
  const sock = appSocketPath(file);
  if (!sock) return null;
  const body = `${JSON.stringify({ v: 1, ...req })}\n`;
  if (Buffer.byteLength(body) > 8192) return null;
  return new Promise((done) => {
    let buf = '';
    let settled = false;
    const finish = (v) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        c.destroy();
      } catch {
        /* closed */
      }
      done(v);
    };
    const tryParse = () => {
      try {
        const v = JSON.parse(buf);
        return v && typeof v === 'object' ? v : null;
      } catch {
        return undefined;
      }
    };
    const c = createConnection({ path: sock });
    const timer = setTimeout(() => finish(null), timeoutMs);
    c.setEncoding('utf8');
    c.on('connect', () => c.end(body));
    c.on('data', (d) => {
      buf += d;
      if (buf.length > REPLY_MAX_BYTES) return finish(null);
      const v = tryParse();
      if (v !== undefined) finish(v);
    });
    c.on('end', () => finish(tryParse() ?? null));
    c.on('error', () => finish(null));
  });
}

const leaseId = (root) => `cli-${rootIdentity(root)}`;

/** Best-effort lease renewal for an app tab this run is using (contract §6 "Busy"). */
export async function renewLease(root, { env = process.env, ttlSec = 300 } = {}) {
  const r = await askApp(
    { op: 'lease', id: leaseId(root), root: real(root) ?? resolve(root), ttlSec },
    { env, timeoutMs: 1000 }
  );
  return r?.ok === true;
}

/** After the app said `running` on `port`: the registry's entry for it must attest. */
async function attestReplyPort(root, port, { env, alive, timeoutMs, waitMs = 3000 }) {
  const until = Date.now() + waitMs;
  for (;;) {
    const v = appView(root, env, alive);
    const e = v?.entries.find((x) => x.state === 'running' && x.port === port);
    if (e && (await verifyAttest(port, e, { rootId: v.rootId, timeoutMs }))) return e;
    if (Date.now() >= until) return null;
    await sleep(250);
  }
}

/**
 * Ask the app to serve (`purpose:'capture'`) or show (`op:'show'`) `root`, and wait out a consent
 * sheet (≤ consentWaitMs). Never throws.
 *   { state: 'running', port, label, kind, warning? }   attested
 *   { state: 'shown', label }                           op 'show' only
 *   { state: 'fallback', reason, line? }                use today's path (a separate server)
 *   { state: 'refused', reason, line }                  stop: the app said no for a reason that
 *                                                       must reach the person (exit 4)
 */
export async function ensureDesktop(
  root,
  {
    env = process.env,
    alive = pidAlive,
    purpose = 'capture',
    show = null,
    lease = true,
    timeoutMs = 1500,
    // the app answers `ensure` (and a `status` whose sheet was answered Open) only once the tab's
    // server is up — it waits up to 45 s for one (cli_channel.rs SERVER_WAIT_MS)
    ensureTimeoutMs = 50_000,
    consentWaitMs = 60_000,
    pollMs = 1000,
    log = () => {},
  } = {}
) {
  const absRoot = real(root) ?? resolve(root);
  const req =
    purpose === 'show'
      ? { op: 'show', root: absRoot, ...(show ?? {}) }
      : {
          op: 'ensure',
          root: absRoot,
          purpose,
          ...(lease ? { lease: { id: leaseId(root), ttlSec: 300 } } : {}),
        };
  const expectBranch = env.MAUDE_EXPECT_BRANCH;
  if (req.op === 'ensure' && expectBranch) req.expect = { branch: expectBranch };
  let reply = await askApp(req, { env, alive, timeoutMs: ensureTimeoutMs });
  if (!reply) return { state: 'fallback', reason: 'no-socket' };
  const until = Date.now() + consentWaitMs;
  let asked = false;
  while (reply?.status === 'consent' && typeof reply.ticket === 'string') {
    if (!asked) log('… Maude is asking whether to open this folder — answer in the Maude window.');
    asked = true;
    if (Date.now() >= until) return { state: 'fallback', reason: 'consent-timeout' };
    await sleep(pollMs);
    reply =
      (await askApp(
        { op: 'status', ticket: reply.ticket },
        { env, alive, timeoutMs: ensureTimeoutMs }
      )) ?? reply;
  }
  const warning = reply?.warning;
  if (warning?.kind === 'branch-changed') {
    const was = typeof warning.was === 'string' ? cleanName(warning.was) : '?';
    const now = typeof warning.now === 'string' ? cleanName(warning.now) : '?';
    log(`! This folder switched from ${was} to ${now}; Maude relabelled its tab.`);
  }
  switch (reply?.status) {
    case 'shown':
      return { state: 'shown', label: typeof reply.label === 'string' ? reply.label : null };
    case 'running': {
      if (!validPort(reply.port)) return { state: 'fallback', reason: 'bad-reply' };
      const e = await attestReplyPort(root, reply.port, { env, alive, timeoutMs });
      if (!e) return { state: 'fallback', reason: 'unverified' };
      return {
        state: 'running',
        port: reply.port,
        label: e.label ?? null,
        kind: e.kind,
        ...(e.apiKey ? { apiKey: e.apiKey } : {}),
        ...(warning ? { warning } : {}),
      };
    }
    case 'cap-full':
      return { state: 'fallback', reason: 'cap-full', line: CAP_FULL_LINE };
    case 'denied':
      return { state: 'fallback', reason: 'denied' };
    case 'refused':
      if (reply.reason === 'branch-changed-unsent')
        return { state: 'refused', reason: reply.reason, line: BRANCH_UNSENT_LINE };
      if (reply.reason === 'too-many-sheets')
        return { state: 'fallback', reason: reply.reason, line: SHEET_LIMIT_LINE };
      return { state: 'fallback', reason: 'refused' };
    default:
      return { state: 'fallback', reason: 'bad-reply' };
  }
}

/** Is `pid` the app or one of the servers its registry names? (never signal those) */
export function isAppPid(pid, { env = process.env } = {}) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  const reg = readRegistry(registryPath(env));
  if (!reg) return false;
  return reg.appPid === pid || reg.servers.some((e) => e.pid === pid);
}

/* ---------------------------------------------------------------------------------- the CLI */

const USAGE = `usage: desktop-locate.mjs <mode> --root <repo> [options]
  port     [--ensure capture|show] [--lease]   print the app server's port for the project
  show     [--canvas c] [--artboard a] [--element e] [--mode m]   ask the app to show the project
  restart                                      ask the app to restart its server for the project
  key      --port N                            print the API key of the app server on port N (attested)
  app-pid  --pid N                             exit 0 when N is the app or one of its servers
exit: 0 ok · 10 not the app's (use the project's own server; no key) · 11 the app serves this project but
      it did not answer the check (do not use _server.json) · 4 refused (message on stderr) · 2 usage
`;

function argsOf(argv) {
  const o = { mode: argv[0] };
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    const v = argv[i + 1];
    if (a === '--lease') o.lease = true;
    else if (
      [
        '--root',
        '--ensure',
        '--canvas',
        '--artboard',
        '--element',
        '--mode',
        '--pid',
        '--port',
      ].includes(a)
    ) {
      if (v === undefined) return { error: `${a} needs a value` };
      o[a.slice(2)] = v;
      i++;
    } else return { error: `unknown arg ${a}` };
  }
  return o;
}

export async function main(
  argv,
  { env = process.env, out = process.stdout, err = process.stderr } = {}
) {
  const a = argsOf(argv);
  if (a.error || !a.mode) {
    err.write(`${a.error ? `desktop-locate: ${a.error}\n` : ''}${USAGE}`);
    return 2;
  }
  const log = (l) => err.write(`${l}\n`);
  const refuse = (line) => {
    log(`✗ ${line}`);
    return 4;
  };
  if (a.mode === 'app-pid') return isAppPid(Number(a.pid), { env }) ? 0 : 1;
  if (!a.root) {
    err.write(`desktop-locate: --root is required\n${USAGE}`);
    return 2;
  }
  const root = resolve(a.root);
  if (a.mode === 'port') {
    const p = await probeDesktop(root, { env, attempts: 4, retryDelayMs: 750 });
    // `--ensure show` (/design:browse): the app shows the project itself — nothing on stdout
    if (a.ensure === 'show' && p.state !== 'no-app' && p.socket) {
      const r = await ensureDesktop(root, { env, purpose: 'show', log });
      if (r.state === 'shown') {
        log('✓ Maude is showing this project.');
        return 0;
      }
      if (r.state === 'refused') return refuse(r.line);
      if (r.line) log(r.line);
    }
    if (p.state === 'running') {
      if (a.lease && p.socket) await renewLease(root, { env });
      out.write(`${p.port}\n`);
      return 0;
    }
    if (p.state === 'unverified') {
      log(
        '✗ Maude has this project open, but its server did not answer the check. Close and reopen the tab in Maude, or quit Maude to use a separate server.'
      );
      return 11;
    }
    if (p.state === 'no-app' || a.ensure !== 'capture' || !p.socket) return 10;
    const r = await ensureDesktop(root, { env, purpose: 'capture', lease: !!a.lease, log });
    if (r.state === 'running') {
      out.write(`${r.port}\n`);
      return 0;
    }
    if (r.state === 'refused') return refuse(r.line);
    if (r.line) log(r.line);
    return 10;
  }
  if (a.mode === 'show') {
    const show = {};
    for (const k of ['canvas', 'artboard', 'element', 'mode']) if (a[k]) show[k] = a[k];
    const r = await ensureDesktop(root, { env, purpose: 'show', show, log });
    if (r.state === 'shown') return 0;
    if (r.state === 'refused') return refuse(r.line);
    return 10;
  }
  if (a.mode === 'key') {
    // stdout is the key and nothing else: a helper captures it into a shell variable and hands it to
    // curl through a config on stdin, never argv (sec-loopback-bearer §7.6)
    const p = await probeDesktop(root, { env });
    if (p.state === 'unverified') return 11;
    if (p.state !== 'running' || p.port !== Number(a.port) || !p.apiKey) return 10;
    out.write(`${p.apiKey}\n`);
    return 0;
  }
  if (a.mode === 'restart') {
    const r = await askApp({ op: 'restart', root: real(root) ?? root }, { env, timeoutMs: 5000 });
    if (!r) return 10;
    return r.status === 'restarting' ? 0 : 4;
  }
  err.write(`desktop-locate: unknown mode ${a.mode}\n${USAGE}`);
  return 2;
}

const isMain = (() => {
  try {
    return (
      !!process.argv[1] &&
      realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
    );
  } catch {
    return false;
  }
})();
if (isMain) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    () => process.exit(10)
  );
}
