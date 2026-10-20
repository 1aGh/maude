// client/v2/ds/upgrade-model.js — S10.15b: the words and the arithmetic of "Bring <system> up to the schema?"
// (13 · ds-multi-schema). Pure: no React, no fetch. The sheet draws it; the host fetches and does the writes.
//
// The sheet has four faces, all derived from what the server says (`POST /_api/ds/upgrade {step:'status'}`):
//   ask       the four lines the canvas shows, from the mechanical plan — nothing has run yet
//   working   the AI has the job (it is the person's gesture; one writer, A13) — waiting for its stage
//   proving   the stage is being checked: canvases done of total, and Cancel stops it
//   review    the same four lines from the proof (`review.json`) + "N canvases can't be updated yet";
//             the primary button applies it as one action, one ⌘Z
// plus `converted` — a system already on a Design system canvas, which the engine refuses (`ds-upgrade-converted`).
// Words follow CONTRACT §3–§4: the title asks with the verb the button repeats.

export const UPGRADE_WORDS = Object.freeze({
  cancel: 'Cancel',
  ask: '✦ Bring it up',
  go: 'Bring it up',
  working: 'AI is bringing it up',
  waiting: 'Reading the system and the canvases that use it. This takes a few minutes.',
  staged: 'Plan made. Checking next that nothing changes.',
  fine: 'Uses your Claude account.',
  noAI: 'Bring it up uses your Claude account through the AI chat in the Mac app. In Claude Code: /design:setup-ds <system> --upgrade-schema.',
  stale: 'The project changed since this was checked. Cancel, then bring it up again.',
  systemFailed:
    'A change to the system’s own files shows on a canvas, so nothing is applied. Ask AI to adjust the plan.',
  needsPick: 'AI left a choice open. Ask it to finish the plan.',
  forbidden: 'Not changed. You can look here; ask to edit.',
  failed: 'Nothing changed; try again.',
  offline: "No project home answers right now — try when you're back online.",
  rejected: 'The project refused the change. Nothing changed.',
  discarded: 'Put back. Nothing changed.',
});

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
export const canvasCount = (n) => plural(n, 'canvas', 'canvases');

export const upgradeTitle = (label) => `Bring ${label} up to the schema?`;
export const upgradeLead = (label) =>
  `${label} was made before the schema. Until it does, canvases can’t switch to or from it cleanly.`;

/** A converted system is refused by the engine; say so (and that it stays as it is). */
export const convertedWords = (label) =>
  `${label} is on a Design system canvas, and Bring it up can’t update those yet. It keeps working as it is — nothing here changes.`;

/** `--on-accent` → "On accent". */
export function roleLabel(name) {
  const s = String(name ?? '')
    .replace(/^--+/, '')
    .replace(/[-_]+/g, ' ')
    .trim();
  return s ? s[0].toUpperCase() + s.slice(1) : '';
}

const joinNames = (xs, max = 6) =>
  xs.length > max ? `${xs.slice(0, max).join(', ')} and ${xs.length - max} more` : xs.join(', ');

const ownName = (native) => roleLabel(String(native ?? '').replace(/^--x-/, ''));

/**
 * The four lines before the AI has run, from the mechanical plan: roles it has to add (`add-role` items),
 * the own tokens it keeps (`prefix-own`), components (unknown until the AI matches them) and how many
 * canvases follow the system. A line with nothing in it is not drawn (the canvas shows only what happens).
 */
export function previewLines(plan, { label, canvases = 0 } = {}) {
  const items = Array.isArray(plan?.items) ? plan.items : [];
  const roles = items
    .filter((i) => i.kind === 'add-role')
    .map((i) => roleLabel(i.id.replace(/^role:/, '')));
  const own = items.filter((i) => i.kind === 'prefix-own');
  const out = [];
  if (roles.length)
    out.push({
      kind: 'roles',
      title: `Adds ${plural(roles.length, 'role', 'roles')}`,
      detail: `${joinNames(roles)} — from ${label}’s own colours and type`,
    });
  out.push({
    kind: 'components',
    title: 'Renames its components',
    detail: `AI matches ${label}’s components to the standard ones, variants and names kept`,
  });
  if (own.length)
    out.push({
      kind: 'own',
      title: `Keeps ${plural(own.length, 'own token', 'own tokens')}`,
      detail: `${joinNames(
        own.map((i) => ownName(i.native)),
        4
      )} — named as its own, so a switch hands them to AI`,
    });
  out.push({
    kind: 'canvases',
    title: `Updates ${canvasCount(canvases)}`,
    detail: 'They point at the new names; nothing looks different',
  });
  return out;
}

/** The same four lines from the proof (`review.json`): what the stage really does. */
export function reviewLines(review, { label } = {}) {
  const roles = (review?.addsRoles ?? []).map((r) => r.label || roleLabel(r.name));
  const renames = review?.renamesComponents ?? [];
  const own = review?.keepsOwn ?? [];
  const updated = (review?.updatesCanvases ?? []).filter((c) => c.diff === 'pass');
  const out = [];
  if (roles.length)
    out.push({
      kind: 'roles',
      title: `Adds ${plural(roles.length, 'role', 'roles')}`,
      detail: `${joinNames(roles)} — from ${label}’s own colours and type`,
    });
  if (renames.length)
    out.push({
      kind: 'components',
      title: `Renames ${plural(renames.length, 'component', 'components')}`,
      detail: `${renames.map((r) => `${r.from} → ${r.to}`).join(' · ')}, variants and names kept`,
    });
  if (own.length)
    out.push({
      kind: 'own',
      title: `Keeps ${plural(own.length, 'own token', 'own tokens')}`,
      detail: `${joinNames(
        own.map((o) => ownName(o.native)),
        4
      )} — named as its own, so a switch hands them to AI`,
    });
  out.push({
    kind: 'canvases',
    title: `Updates ${canvasCount(updated.length)}`,
    detail: 'They point at the new names; nothing looks different',
  });
  return out;
}

/** "N canvases can't be updated yet" — the canvases the proof or a rule refused; they stay as they are. */
export function refusedLine(review) {
  const paths = [...new Set((review?.refused ?? []).map((r) => r.path))].filter(Boolean);
  if (!paths.length) return null;
  return { count: paths.length, text: `${canvasCount(paths.length)} can’t be updated yet`, paths };
}

/** Most useful stage first: being proved, then proved (newest), then merely staged. */
export function pickStage(stages) {
  const live = Array.isArray(stages) ? stages : [];
  const by = (phase) => live.filter((s) => s.phase === phase);
  return by('proving')[0] ?? by('proved')[0] ?? by('staged')[0] ?? null;
}

/**
 * What the sheet shows. `status` = the server's answer; `asked` = this sheet sent the AI off (or a stage already
 * exists, which is the same thing to the person). `plan` = the mechanical plan, for the lines before the run.
 * @returns {{ kind: 'converted' } | { kind: 'ask', lines: any[], canAsk: boolean }
 *   | { kind: 'working', step: 'waiting' | 'staged', stamp?: string }
 *   | { kind: 'proving', stamp: string, current: number, total: number }
 *   | { kind: 'review', stamp: string, lines: any[], refused: any, blocker: string | null }}
 */
export function viewOf({
  status,
  asked = false,
  plan = null,
  label,
  canvases = 0,
  canAskAI = false,
}) {
  if (status?.converted === true) return { kind: 'converted' };
  const stage = pickStage(status?.stages);
  if (stage?.phase === 'proving') {
    const p = stage.progress ?? {};
    return {
      kind: 'proving',
      stamp: stage.stamp,
      current: Number.isFinite(p.current) ? p.current : 0,
      total: Number.isFinite(p.total) ? p.total : 0,
    };
  }
  if (stage?.phase === 'proved' && stage.review) {
    const r = stage.review;
    const blocker = r.systemFailed
      ? UPGRADE_WORDS.systemFailed
      : stage.stale
        ? UPGRADE_WORDS.stale
        : (r.needsPick ?? []).length
          ? UPGRADE_WORDS.needsPick
          : null;
    return {
      kind: 'review',
      stamp: stage.stamp,
      lines: reviewLines(r, { label }),
      updated: (r.updatesCanvases ?? []).filter((c) => c.diff === 'pass').length,
      refused: refusedLine(r),
      blocker,
    };
  }
  if (stage?.phase === 'staged') return { kind: 'working', step: 'staged', stamp: stage.stamp };
  if (asked) return { kind: 'working', step: 'waiting' };
  return { kind: 'ask', lines: previewLines(plan, { label, canvases }), canAsk: canAskAI };
}

/**
 * The message the AI composer gets (origin `ds-upgrade`). One paragraph of the skill's § upgrade-schema: which
 * verbs, in which order, and where to stop — the person applies, in the sheet.
 */
export function upgradeBrief({ ds, label }) {
  return [
    `Bring the design system "${label}" up to the schema with /design:setup-ds ${ds} --upgrade-schema (skill design-system § upgrade-schema).`,
    '',
    `Run \`maude design ds-upgrade analyse ${ds}\` for the mechanical plan, judge what it leaves open (the roles it lacks, the component names) from ${label}’s own colours and type, check it with \`validate\`, then \`--stage\` and \`--prove\` it. Every artboard must look the same afterwards.`,
    '',
    'Stop at the proved stage. Do not run --apply: I will, from the sheet that is open, and it is one undo step.',
  ].join('\n');
}

/** A refusal code → the person's words. */
export function refusalWords(code, label = 'This system') {
  switch (code) {
    case 'ds-upgrade-converted':
      return convertedWords(label);
    case 'ds-upgrade-stale':
      return UPGRADE_WORDS.stale;
    case 'ds-upgrade-proof-failed':
      return UPGRADE_WORDS.systemFailed;
    case 'ds-upgrade-not-proved':
      return UPGRADE_WORDS.waiting;
    case 'ds-kernel-unavailable':
      return UPGRADE_WORDS.offline;
    case 'ds-kernel-rejected':
      return UPGRADE_WORDS.rejected;
    case 'forbidden':
      return UPGRADE_WORDS.forbidden;
    default:
      return UPGRADE_WORDS.failed;
  }
}

/** The toast after Bring it up. */
export function appliedWords(result, label) {
  const n = Number.isFinite(result?.updated) ? result.updated : 0;
  const kept = Number.isFinite(result?.refused) ? result.refused : 0;
  return kept > 0
    ? `Brought ${label} up to the schema. ${canvasCount(n)} updated; ${kept} can’t be updated yet.`
    : `Brought ${label} up to the schema. ${canvasCount(n)} updated.`;
}

/** The progress bar's fill, 0..1. */
export const progressFraction = (current, total) =>
  total > 0 ? Math.max(0, Math.min(1, current / total)) : 0;
