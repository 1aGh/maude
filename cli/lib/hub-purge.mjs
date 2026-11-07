// `maude hub purge` — the operator's front for the hub's confirmed bulk purge
// (`POST /api/file-purge`, apps/hub/src/owner-purge.mjs). 2.0.7 #8.
//
//   maude hub purge <URL> --prefix assets/unused/        # dry run: lists the set
//   maude hub purge <URL> --prefix assets/unused/ --confirm <token>
//
// Human tier (`maude hub` is terminal-only in the verb registry, never the AI
// chat's). The owner credential comes from the environment ($MAUDE_HUB_TOKEN,
// or the variable --token-env names), never from argv where `ps` shows it, and
// it is only sent over https or to a loopback host.

import { readFileSync } from 'node:fs';

import { parseArgs } from './argv.mjs';

const PURGE_PATH = '/api/file-purge';
const MAX_WAIT_MS = 60_000;
const MAX_RETRIES = 5;

export const PURGE_USAGE = `  purge <URL> (--prefix PATH/ | --list FILE) [--confirm TOKEN] [--token-env NAME] [--json]
        Delete many project files on a hub at once — the project OWNER's path
        past the per-hour delete limit. Without --confirm it is a dry run: it
        lists the exact set (count, bytes, sample paths) and prints a
        confirmation. Run it again with --confirm <that token> to delete that
        exact set; if any file changed in between, nothing is deleted and you
        run the dry run again. Files go to the hub's _trash/ (restorable) and
        are deleted in paced batches. The owner token is read from
        $MAUDE_HUB_TOKEN (or --token-env NAME); https only, except localhost.
        --list FILE  one path per line (or a JSON array), design-root relative.
`;

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

/**
 * @param {{ args: string[], env?: object, fetchImpl?: typeof fetch,
 *   out?: (s: string) => void, err?: (s: string) => void,
 *   sleep?: (ms: number) => Promise<void> }} io
 * @returns {Promise<number>} the exit code
 */
export async function runPurge({
  args,
  env = process.env,
  fetchImpl = fetch,
  out = (s) => process.stdout.write(s),
  err = (s) => process.stderr.write(s),
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
}) {
  const { flags, positional } = parseArgs(args, { booleans: ['json', 'dry-run'] });
  const fail = (code, msg) => {
    err(`maude hub purge: ${msg}\n`);
    return code;
  };
  const base = positional[0];
  if (!base) return fail(2, 'name the hub URL (maude hub purge <URL> --prefix …)');
  let url;
  try {
    url = new URL(PURGE_PATH, base.endsWith('/') ? base : `${base}/`);
  } catch {
    return fail(2, `not a URL: ${base}`);
  }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && LOOPBACK.has(url.hostname))) {
    return fail(2, 'refusing to send an owner token over plain http to a non-local host');
  }
  const tokenVar = typeof flags['token-env'] === 'string' ? flags['token-env'] : 'MAUDE_HUB_TOKEN';
  const token = String(env[tokenVar] ?? '').trim();
  if (!token) return fail(2, `set $${tokenVar} to the hub's owner token`);

  let spec;
  if (typeof flags.prefix === 'string' && flags.list === undefined) {
    spec = { prefix: flags.prefix };
  } else if (typeof flags.list === 'string' && flags.prefix === undefined) {
    let text;
    try {
      text = readFileSync(flags.list, 'utf8');
    } catch (e) {
      return fail(2, `cannot read --list ${flags.list}: ${e.message}`);
    }
    spec = { paths: parseList(text) };
    if (spec.paths.length === 0) return fail(2, `--list ${flags.list} names no paths`);
  } else {
    return fail(2, 'name exactly one of --prefix PATH/ or --list FILE');
  }

  const post = async (body) => {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        'x-maude-format': '2',
      },
      body: JSON.stringify(body),
    });
    let json = null;
    try {
      json = await res.json();
    } catch {
      json = null;
    }
    return { status: res.status, json };
  };

  const confirm = typeof flags.confirm === 'string' ? flags.confirm : null;
  if (!confirm) {
    const r = await post({ ...spec, dryRun: true });
    if (r.status !== 200) return fail(1, refusal(r));
    if (flags.json) {
      out(`${JSON.stringify(r.json)}\n`);
      return 0;
    }
    const j = r.json;
    out(`Dry run — nothing was deleted.\n`);
    out(`  ${j.count} file(s), ${formatBytes(j.bytes)}\n`);
    for (const p of j.sample ?? []) out(`    ${p}\n`);
    if (j.count > (j.sample?.length ?? 0)) out(`    … and ${j.count - j.sample.length} more\n`);
    if (j.missing) out(`  ${j.missing} named path(s) are not on the hub and are left out.\n`);
    if (!j.confirm) {
      out('Nothing to delete.\n');
      return 0;
    }
    const what = spec.prefix !== undefined ? `--prefix ${spec.prefix}` : `--list ${flags.list}`;
    out(
      `\nTo delete exactly these files (good until ${new Date(j.expiresAt).toISOString()}):\n` +
        `  maude hub purge ${base} ${what} --confirm ${j.confirm}\n`
    );
    return 0;
  }

  let purged = 0;
  let retries = 0;
  for (;;) {
    const r = await post({ ...spec, confirm });
    if (r.status === 200) {
      retries = 0;
      purged += r.json?.purged ?? 0;
      if (flags.json) out(`${JSON.stringify(r.json)}\n`);
      else out(`  deleted ${purged}, ${r.json?.remaining ?? '?'} to go\n`);
      if (r.json?.done) {
        if (!flags.json) out(`Done. The files are in the hub's ${r.json.trash}/ (restorable).\n`);
        return 0;
      }
      await sleep(waitFor(r));
      continue;
    }
    if ((r.status === 429 || r.status === 503) && retries < MAX_RETRIES) {
      retries += 1;
      await sleep(waitFor(r));
      continue;
    }
    return fail(1, `${refusal(r)}${purged ? ` (${purged} deleted before this)` : ''}`);
  }
}

function waitFor(r) {
  const ms = Number(r.json?.retryAfterMs);
  return Number.isFinite(ms) && ms > 0 ? Math.min(ms, MAX_WAIT_MS) : 1000;
}

function refusal(r) {
  const msg = r.json?.error ?? r.json?.code ?? 'no answer';
  return `the hub refused (${r.status}): ${msg}`;
}

/** One path per line (`#` comments, blanks skipped), or a JSON array of paths. */
export function parseList(text) {
  const trimmed = text.trim();
  if (trimmed.startsWith('[')) {
    const arr = JSON.parse(trimmed);
    return Array.isArray(arr) ? arr.filter((p) => typeof p === 'string' && p.length > 0) : [];
  }
  return trimmed
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('#'));
}

function formatBytes(n) {
  if (!Number.isFinite(n)) return '? bytes';
  if (n < 1024) return `${n} bytes`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}
