// gate-evidence.mjs — the MAC on a command gate's evidence (#168 A; scripts/v2-gates.mjs).
//
// A `kind:'command'` record is a file anyone who can write the tree can author (a lane agent, a sync
// peer), so on its own it proves neither the run nor its exit code. `--record` / `--carry` sign each
// record with HMAC-SHA256 over the claims a check relies on (gate, pass, exit, head, quality hash,
// command, a digest of the output, and a carry's provenance) under a per-machine key kept OUTSIDE the
// tree. `fresh()` refuses a record with a missing or bad MAC.
//
//   $V2_GATES_KEY_FILE || ~/.claude/maude-gates/evidence.key     dir 0700, file 0600, 32 random bytes hex
//
// The key is created on the first record and never by a check. It is refused when it resolves inside
// the repository, is a symlink, or is readable by anyone but its owner. A record made on another
// machine verifies only where the same key sits.

import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { lstatSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

const KEY_RE = /^[0-9a-f]{64}$/;
const MAC_RE = /^[0-9a-f]{64}$/;

/** Where this machine's gate key lives. */
export function gateKeyPath(env = process.env) {
  const o = env.V2_GATES_KEY_FILE;
  return typeof o === 'string' && o
    ? resolve(o)
    : join(homedir(), '.claude', 'maude-gates', 'evidence.key');
}

/** `p` with its deepest existing ancestor realpath'd (the missing tail kept as written). */
function realish(p) {
  let cur = p;
  const tail = [];
  for (;;) {
    try {
      return join(realpathSync(cur), ...tail.reverse());
    } catch {
      const up = dirname(cur);
      if (up === cur) return p;
      tail.push(cur.slice(up.length + 1));
      cur = up;
    }
  }
}
const inside = (child, dir) => {
  const rel = relative(dir, child);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
};

/**
 * The gate key as a Buffer, or `{ error }`. `create` (the record paths only) makes a missing key.
 * @param {{ env?: NodeJS.ProcessEnv, repoRoot: string, create?: boolean }} opts
 */
export function readGateKey({ env = process.env, repoRoot, create = false }) {
  const path = gateKeyPath(env);
  if (inside(realish(path), realish(resolve(repoRoot))))
    return { error: `the gate key ${path} is inside the repository — keep it outside the tree` };
  let st = null;
  try {
    st = lstatSync(path);
  } catch (e) {
    if (e?.code !== 'ENOENT') return { error: `the gate key ${path} cannot be read` };
  }
  if (!st) {
    if (!create) return { error: `no gate key at ${path} (a --record creates it)` };
    try {
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
      // `wx`: never follows or replaces something planted at the name in between
      writeFileSync(path, `${randomBytes(32).toString('hex')}\n`, { mode: 0o600, flag: 'wx' });
      st = lstatSync(path);
    } catch {
      return { error: `the gate key ${path} cannot be created` };
    }
  }
  if (st.isSymbolicLink() || !st.isFile())
    return { error: `the gate key ${path} is not a plain file` };
  if (st.mode & 0o077)
    return { error: `the gate key ${path} is readable by others (chmod 600 it)` };
  if (typeof process.getuid === 'function' && st.uid !== process.getuid())
    return { error: `the gate key ${path} belongs to another user` };
  const text = readFileSync(path, 'utf8').trim();
  if (!KEY_RE.test(text)) return { error: `the gate key ${path} is not a key` };
  return Buffer.from(text, 'hex');
}

/** What a MAC covers, in a fixed order: every claim a check or a carry reads. */
const signed = (ev) =>
  JSON.stringify([
    'maude-gate-evidence/1',
    ev.gate ?? null,
    ev.pass === true,
    Number.isInteger(ev.exit) ? ev.exit : null,
    ev.head ?? null,
    ev.qualityHash ?? null,
    ev.cmd ?? null,
    createHash('sha256')
      .update(typeof ev.log === 'string' ? ev.log : '')
      .digest('hex'),
    ev.carriedFrom ?? null,
    ev.scoped ?? null,
  ]);

/** The record's MAC (hex) under `key`. */
export const evidenceMac = (key, ev) => createHmac('sha256', key).update(signed(ev)).digest('hex');

/** Does `ev.mac` hold for `key`? */
export function evidenceSigned(key, ev) {
  if (!Buffer.isBuffer(key) || typeof ev?.mac !== 'string' || !MAC_RE.test(ev.mac)) return false;
  return timingSafeEqual(Buffer.from(ev.mac, 'hex'), Buffer.from(evidenceMac(key, ev), 'hex'));
}
