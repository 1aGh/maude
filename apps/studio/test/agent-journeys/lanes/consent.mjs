// agent-journeys/lanes/consent.mjs — what the lanes answer to a permission card (decision
// v2-S12.16-lanes-allow-named-prompt-verbs). Nobody answers a card EXCEPT for a prompt-tier verb the
// journey JSON names in its `allow` array (e.g. ["maude design history restore"]): that stands for
// the person saying yes to the task they asked for. Every other card is refused.
//
// Pure and light (no studio, no fixtures) so the self-test can pin it without a run.

/** A journey `allow` entry: `maude design <verb> [<sub>]` — words only, no flags, no paths. */
const ENTRY_RE = /^maude design [a-z][a-z-]*(?: [a-z][a-z-]*)?$/;

/** Why a journey's `allow` array is malformed ([] = fine). */
export function lintAllow(allow) {
  if (allow === undefined) return [];
  if (!Array.isArray(allow) || !allow.length) return ['allow must be a non-empty array'];
  const why = [];
  for (const a of allow)
    if (typeof a !== 'string' || !ENTRY_RE.test(a))
      why.push(`allow entry ${JSON.stringify(a)} is not "maude design <verb> [<sub>]"`);
  if (new Set(allow).size !== allow.length) why.push('allow names a verb twice');
  return why;
}

export const allowOf = (journey) => (Array.isArray(journey?.allow) ? journey.allow : []);

/** The terminal lane's rules for them: one `--allowedTools` argv each (after the chat's defaults). */
export const allowRules = (journey) => allowOf(journey).map((a) => `Bash(${a}:*)`);

/**
 * Is `command` one simple call of an allowed verb? The verb must be the whole head of the command
 * (word boundary), and the call must be a single command: a chain, pipe, redirect or substitution
 * is refused even when it starts with an allowed verb, so "yes to the restore" never covers a second
 * thing.
 */
export function commandAllowed(allow, command) {
  if (typeof command !== 'string') return false;
  const c = command.trim();
  if (!c || /[;&|<>`\n\r]|\$\(/.test(c)) return false;
  return allow.some((a) => c === a || c.startsWith(`${a} `));
}

/** The command a permission card is about: the tool input's, else the card's title (Bash cards name it). */
export function cardCommand(req) {
  const call = req?.toolCall ?? {};
  const cmd = call.rawInput?.command;
  if (typeof cmd === 'string') return cmd;
  return call.rawInput === undefined && typeof call.title === 'string' ? call.title : null;
}

/**
 * The ACP lane's answer to one card: `{ allow, optionId, why }`. An allow is the ONE-TIME option
 * (`allow_once`), never `allow_always`; with no such option offered, or a verb not named, it refuses
 * with the card's reject option (or `cancelled`, the chat's own timeout default).
 */
export function answerCard(allow, req) {
  const options = req?.options ?? [];
  const reject = options.find((o) => String(o.kind).startsWith('reject'));
  const refuse = (why) => ({ allow: false, optionId: reject?.optionId ?? 'cancelled', why });
  const command = cardCommand(req);
  if (!commandAllowed(allow, command))
    return refuse(command ? `"${command.slice(0, 80)}" is not a named verb` : 'not a Bash card');
  const once = options.find((o) => o.kind === 'allow_once');
  if (!once) return refuse('no one-time allow option offered');
  return { allow: true, optionId: once.optionId, why: 'named in the journey allow list' };
}
