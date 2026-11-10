// Internal shim behind footage.sh (`maude design footage show|save`).
//
// The footage sidecars of /design-video:reel and /design-video:video-analyze (feature-footage-analysis-
// director), for the orchestrator in the AI chat and a terminal (fix-bulk 2026-11-10 follow-up):
//   show  GET /_api/footage?asset=<…> | ?slug=<…>   a clip's FootageAnalysis, or a cut's EDL ({} = none yet)
//   save  PUT /_api/footage?asset=<…> | ?slug=<…>   validated and stamped by the studio (footage-store.ts)
// The analyst agent never runs this: it returns JSON, and the command persists it (DDR-183 F2).
//
// Why a verb and not a loopback curl: since 2.1.0 the studio's main origin needs its key from every
// caller (contract sec-loopback-bearer §7), and `curl-local` sends none. This finds the studio and its
// key the way every verb does (studio-locate.mjs). A `.footage.json` / EDL syncs between peers
// (DDR-054), so `show` prints it inside the untrusted-data block.
//
// `save --from <file>` reads the file the caller names: in a Maude chat that path is checked against the
// chat's read boundary by the dispatcher (cli/lib/confine-read.mjs SOURCE_FLAGS).

import { readFileSync } from 'node:fs';
import {
  call,
  clean,
  connect,
  parseWords,
  runVerb,
  UNTRUSTED_NOTICE,
  UsageError,
  writeUntrusted,
} from './_studio-verb.mjs';

export const USAGE = `usage: maude design footage show (--asset <clip> | --cut <slug>) [--json] [--root <project>]
       maude design footage save (--asset <clip> | --cut <slug>) --from <file.json> [--root <project>]
  show  a clip's footage analysis (its shots), or a cut's EDL; {} when there is none yet
  save  store the analysis (or EDL) in the file, as the studio validates it; a refusal names the field
  --asset  the clip: assets/<sha8>.<ext>, or its <sha8>
  --cut    the cut's EDL slug (.design/<slug>.edl.json)
  --from   the JSON file to store (- reads stdin)
Exit 0 ok · 1 refused (the JSON did not validate) · 2 usage · 3 no studio running.
`;

/** The words after `show` / `save` → `{ flags, query }`. Pure; throws UsageError. */
export function footageQuery(words, { save }) {
  const { flags, pos } = parseWords(words, {
    bool: save ? [] : ['--json'],
    value: save ? ['--asset', '--cut', '--from', '--root'] : ['--asset', '--cut', '--root'],
  });
  if (pos.length) throw new UsageError(`unexpected ${clean(pos[0])}`);
  const asset = flags['--asset'];
  const cut = flags['--cut'];
  if ((asset === undefined) === (cut === undefined))
    throw new UsageError('give exactly one of --asset <clip> or --cut <slug>');
  if (save && flags['--from'] === undefined) throw new UsageError('save needs --from <file.json>');
  const q = new URLSearchParams();
  if (asset !== undefined)
    q.set(
      'asset',
      String(asset)
        .replace(/^\.\//, '')
        .replace(/^\.design\//, '')
    );
  else q.set('slug', String(cut));
  return { flags, query: q.toString() };
}

function refused(r) {
  const b = r?.body ?? {};
  const why = clean(
    b.error ?? b.reason ?? (r ? r.text?.trim() || `HTTP ${r.status}` : 'no answer')
  );
  process.stderr.write(`maude design footage: refused — ${why}\n`);
  return 1;
}

async function show(words) {
  const { flags, query } = footageQuery(words, { save: false });
  const c = await connect('footage', flags['--root']);
  if (c.exit) return c.exit;
  const r = await call(c.studio, `/_api/footage?${query}`);
  if (r?.status !== 200 || !r.body || typeof r.body !== 'object') return refused(r);
  // JSON.stringify escapes every control character, so the text is safe to print as it is.
  if (flags['--json'])
    process.stdout.write(
      `${JSON.stringify({ untrusted: true, notice: UNTRUSTED_NOTICE, data: r.body })}\n`
    );
  else writeUntrusted(JSON.stringify(r.body, null, 2));
  return 0;
}

async function save(words) {
  const { flags, query } = footageQuery(words, { save: true });
  const from = flags['--from'];
  let text;
  try {
    text = readFileSync(from === '-' ? 0 : from, 'utf8');
  } catch {
    throw new UsageError(`cannot read ${clean(from)}`);
  }
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new UsageError(`${clean(from)} is not JSON`);
  }
  const c = await connect('footage', flags['--root']);
  if (c.exit) return c.exit;
  const r = await call(c.studio, `/_api/footage?${query}`, { method: 'PUT', json });
  if (r?.status === 200 && r.body?.ok) {
    process.stdout.write(`→ saved ${query.startsWith('asset=') ? 'the analysis' : 'the EDL'}\n`);
    return 0;
  }
  return refused(r);
}

const SUBS = { show, save };

if (import.meta.main) {
  runVerb('footage', USAGE, async (words) => {
    const sub = words[0];
    if (!sub || !Object.hasOwn(SUBS, sub))
      throw new UsageError(
        sub ? `unknown sub-verb ${clean(sub)}` : 'name a sub-verb: show or save'
      );
    return SUBS[sub](words.slice(1));
  });
}
