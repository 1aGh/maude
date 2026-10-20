// Internal shim behind describe.sh (`maude design describe`). See USAGE.
//
// Search in pictures from a terminal (S12.13; contract V2-1.17 §5.9). The SAME describe service the studio runs
// (describe/batch.ts), in-process, against the same files on this Mac — so the person's answer, Stop, the budget
// (10 a batch, one batch in flight per Mac, 20 s apart, the project's daily cap) and the validator hold exactly as they
// do for the UI. Nothing here can say yes for the person: without their consent the verb sends nothing (exit 3).
//
// The describer is the studio's (`envDescriber`): the asset-describer agent through the person's own `claude`
// (describe/claude.ts — Read only, cwd = an OS temp dir of tiles, no project path), or the stub under
// MAUDE_DESCRIBE_STUB=1. It spends the person's Claude account → effect `external` → the permission card.
//
// Prints counts and states only — never what AI said a picture shows (that is untrusted and stays in the index).

import path from 'node:path';

import { DESIGN_REL, parseWords, projectRoot, runVerb, UsageError } from './_studio-verb.mjs';

export const USAGE = `usage: maude design describe [--batch N] [--status] [--stop] [--json] [--root <project>]
  (none)      describe one batch of this project's pictures now (up to 10), with your Claude account
  --batch N   up to N batches (1-20), 20 seconds apart
  --status    whether search in pictures is on, how many pictures are described, and why it waits
  --stop      stop describing; it stays on, and Resume is yours, in Assets
  --json      machine-readable
Sends nothing until you said yes to "Let AI describe your pictures so search can find what's in them"
(Assets, or Settings › General). The same limits as the studio: 10 pictures a batch, one batch at a time on
this Mac, 20 seconds apart, the project's daily cap. What goes is each picture's Assets tile; no project
path or file name reaches the AI.
Exit 0 ok · 1 error · 2 usage · 3 off or stopped (nothing sent) · 4 waiting (no AI, today's cap, another batch).
`;

const BATCHES_MAX = 20;

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const hhmm = (ms) => {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

/** Why nothing went, in words. */
export function waitWords(why, status) {
  switch (why) {
    case 'off':
      return status?.consent?.asked
        ? 'Search in pictures is off for this project. Turn it on in Assets or Settings › General.'
        : 'Search in pictures is not on for this project yet. Turn it on in Assets: "Let AI describe your pictures so search can find what\'s in them".';
    case 'stopped':
      return 'Describing is stopped. Resume it in Assets.';
    case 'no-ai':
      return "AI isn't connected: Maude describes pictures with Claude Code (the claude CLI) signed in on this Mac.";
    case 'offline':
      return 'Offline. Describing goes on when this Mac is back online.';
    case 'used-up':
      return status?.until
        ? `Your Claude account is used up until ${hhmm(status.until)}.`
        : 'Your Claude account is used up for now.';
    case 'daily-cap':
      return `Today's limit for this project is reached (${plural(status?.consent?.dailyCap ?? 0, 'picture', 'pictures')}). Describing goes on tomorrow.`;
    case 'in-flight':
    case 'busy':
      return 'Another batch is being described on this Mac. Try again in a minute.';
    case 'too-soon':
      return 'The last batch ended less than 20 seconds ago. Try again in a moment.';
    default:
      return String(why);
  }
}

const progress = (s) =>
  `${s.done} of ${plural(s.total, 'picture', 'pictures')} described${s.paused === 'stopped' ? ' (stopped)' : ''}`;

/** The project's asset rows with their fingerprints, built in-process (nothing is written). */
async function assetRows(designRoot) {
  const { createAssetIndex } = await import('../index/assets.ts');
  const idx = createAssetIndex({
    designRoot,
    canvases: () => [],
    history: () => null,
    historyFile: null,
    now: Date.now,
    emit: () => {},
    hash: true,
  });
  try {
    idx.assets();
    await idx.settled();
    return idx.assets().map((r) => ({ rel: r.rel, kind: r.kind, sha256: r.sha256 }));
  } finally {
    idx.stop();
  }
}

async function main(words) {
  const { flags, pos } = parseWords(words, {
    bool: ['--status', '--stop', '--json'],
    value: ['--batch', '--root'],
  });
  if (pos.length) throw new UsageError('describe takes no positional argument');
  const modes = ['--status', '--stop', '--batch'].filter((f) => flags[f] !== undefined);
  if (modes.length > 1) throw new UsageError(`${modes.join(' and ')} are exclusive`);
  let batches = 1;
  if (flags['--batch'] !== undefined) {
    batches = Number(flags['--batch']);
    if (!Number.isInteger(batches) || batches < 1 || batches > BATCHES_MAX)
      throw new UsageError(`--batch takes a whole number from 1 to ${BATCHES_MAX}`);
  }
  const root = projectRoot(flags['--root']);
  if (!root) {
    process.stderr.write(
      'maude design describe: no .design/config.json here or above — run it inside a Maude project\n'
    );
    return 2;
  }
  const designRoot = path.join(root, DESIGN_REL);
  const json = flags['--json'];
  const out = (o, text) => console.log(json ? JSON.stringify(o, null, 2) : text);

  const [{ createDescribeService, envDescriber }, { GAP_MS }, { pidOf }] = await Promise.all([
    import('../describe/batch.ts'),
    import('../describe/budget.ts'),
    import('../index/snapshot.ts'),
  ]);
  const rows = await assetRows(designRoot);
  const svc = createDescribeService({
    designRoot,
    pid: pidOf(root),
    rows: () => rows,
    describer: envDescriber,
    auto: false,
  });
  try {
    const status = svc.status();

    if (flags['--status']) {
      const why = status.paused ? waitWords(status.paused, status) : null;
      out(
        { ok: true, status },
        status.consent.on
          ? `Search in pictures is on. ${progress(status)}.${why ? ` ${why}` : ''}`
          : waitWords('off', status)
      );
      return 0;
    }

    if (flags['--stop']) {
      if (!status.consent.on) {
        out({ ok: false, reason: 'off', status }, waitWords('off', status));
        return 3;
      }
      const s = svc.setStopped(true);
      out(
        { ok: true, status: s },
        `Stopped at ${s.done} of ${plural(s.total, 'picture', 'pictures')}. Resume it in Assets.`
      );
      return 0;
    }

    // describing: the person's yes, and not stopped — the verb never asks on their behalf
    if (!status.consent.on || status.consent.stopped) {
      const why = status.consent.on ? 'stopped' : 'off';
      process.stderr.write(`maude design describe: ${waitWords(why, status)}\n`);
      if (json) out({ ok: false, reason: why, status });
      return 3;
    }

    const runs = [];
    for (let i = 0; i < batches; i++) {
      let r = await svc.runOnce();
      // between this verb's own batches the 20 s gap is waited out, once
      if (!r.ran && r.why === 'too-soon' && i > 0) {
        await new Promise((res) => setTimeout(res, GAP_MS + 250));
        r = await svc.runOnce();
      }
      runs.push(r);
      if (!r.ran || r.refused) break;
    }
    const after = svc.status();
    const sent = runs.reduce((n, r) => n + (r.ran ? r.sent : 0), 0);
    const stored = runs.reduce((n, r) => n + (r.ran ? r.stored : 0), 0);
    const dropped = runs.reduce((n, r) => n + (r.ran ? r.dropped.length : 0), 0);
    const last = runs[runs.length - 1];

    if (last.ran && last.refused) {
      const text =
        last.refused === 'describer-failed'
          ? after.paused === 'used-up'
            ? waitWords('used-up', after)
            : "AI didn't answer. Nothing was kept; try again later."
          : 'AI answered in a shape Maude cannot read. Nothing was kept from that batch.';
      if (json)
        out({ ok: false, reason: last.refused, sent, stored, dropped, runs, status: after });
      else process.stderr.write(`maude design describe: ${text}\n`);
      return stored ? 0 : 1;
    }
    if (sent) {
      out(
        { ok: true, sent, stored, dropped, runs, status: after },
        `Described ${plural(stored, 'picture', 'pictures')}${dropped ? ` (${dropped} answer${dropped === 1 ? '' : 's'} left out)` : ''}. ${progress(after)}.`
      );
      return 0;
    }
    if (last.why === 'nothing-left') {
      const text =
        after.total && after.done >= after.total
          ? `Every picture is described (${after.done} of ${after.total}).`
          : after.total
            ? 'No picture is ready to describe yet: its tile is made while the project is open in Maude.'
            : 'This project has no pictures to describe.';
      out({ ok: true, sent: 0, stored: 0, dropped: 0, runs, status: after }, text);
      return 0;
    }
    const text = waitWords(last.why, after);
    if (json) out({ ok: false, reason: last.why, runs, status: after });
    else process.stderr.write(`maude design describe: ${text}\n`);
    return last.why === 'off' || last.why === 'stopped' ? 3 : 4;
  } finally {
    svc.dispose();
  }
}

if (import.meta.main) await runVerb('describe', USAGE, main);
