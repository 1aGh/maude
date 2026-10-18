// client/v2/ai/gate-lines.js — S5.13: what the panel says when AI cannot run yet (03 `ai-not-ready`).
//
// A prompt that cannot go now waits in the outbox (V2-1.14, S5.6) and the server tells the panel which
// gate is closed: `{t:'queued', gates, words, presentation, askId, intentId}`. After a reload the same
// facts come back from `GET /_api/outbox` (an `ai.prompt` record: `gates`, `allowanceResetsAt`).
//
// The words are the server's (`gateWords` in outbox/policy.ts) — the frame carries them, so the panel
// never invents a line. These constants are the SAME four lines for the reload path, where no frame
// carries them; test/v2-ai-needs-you.test.ts pins them to `gateWords` so a drift is a red test.
//
//   offline      → "Queued — sends when this Mac is online." + "AI is back when this Mac is online."
//   connect      → the one sheet (ConnectSheet): Connect · Cancel
//   setting-up   → "Setting up AI on this Mac. About a minute — keep drawing meanwhile."   (in the field)
//   used-up      → "AI's allowance is used up until 18:40. Your prompt is kept and sends then." (in the field)

export const OFFLINE_QUEUED = 'Queued — sends when this Mac is online.';
export const OFFLINE_BACK = 'AI is back when this Mac is online.';
export const SETTING_UP = 'Setting up AI on this Mac. About a minute — keep drawing meanwhile.';
export const CONNECT_WORDS =
  "Connect your Claude account to let AI draft this. Your prompt waits here and runs as soon as it's connected.";

export const usedUpWords = (time) =>
  `AI's allowance is used up until ${time}. Your prompt is kept and sends then.`;

/** HH:MM on this Mac's clock — the same rendering the server's words use. */
export function clock(ms) {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return '';
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** "Setting up AI on this Mac." + "About a minute …" — the bold lead and the rest of a state line. */
export function splitLead(text) {
  const t = String(text ?? '');
  const at = t.search(/[.!?]\s/);
  return at < 0 ? { lead: t, rest: '' } : { lead: t.slice(0, at + 1), rest: t.slice(at + 2) };
}

/**
 * The first closed gate decides the surface (the server's own rule: `gateWords` speaks for gates[0]).
 *
 * @param {{ gates?: string[], words?: string|null, presentation?: 'sent'|'field', allowanceResetsAt?: number|null }} q
 * @returns {{ kind: 'offline'|'connect'|'setting-up'|'used-up'|'waiting'|null, lines: string[], lead?: string, rest?: string, field: boolean }}
 */
export function notReadyModel(q) {
  const gates = Array.isArray(q?.gates) ? q.gates : [];
  const first = gates[0];
  const field = q?.presentation === 'field';
  switch (first) {
    case 'online':
    case 'hub':
      return {
        kind: 'offline',
        lines: [q?.words || OFFLINE_QUEUED, OFFLINE_BACK],
        field: false,
      };
    case 'ai-connected':
      return { kind: 'connect', lines: [q?.words || CONNECT_WORDS], field: false };
    case 'ai-ready': {
      const text = q?.words || SETTING_UP;
      return { kind: 'setting-up', lines: [text], ...splitLead(text), field: true };
    }
    case 'ai-allowance': {
      const text = q?.words || usedUpWords(clock(q?.allowanceResetsAt));
      return { kind: 'used-up', lines: [text], ...splitLead(text), field: true };
    }
    case undefined:
      // Nothing closed but the prompt is still in the outbox: an earlier prompt of this chat is ahead
      // of it (O2). It goes by itself, in order.
      return {
        kind: q ? 'waiting' : null,
        lines: q ? ['Waiting for your earlier ask to go first.'] : [],
        field,
      };
    default:
      return { kind: 'waiting', lines: q?.words ? [q.words] : [], field };
  }
}

/** The outbox records of one chat that have not had a final answer (a reload brings these back). */
export function queuedForChat(intents, chatId) {
  if (!Array.isArray(intents)) return [];
  return intents
    .filter(
      (r) =>
        r &&
        r.kind === 'ai.prompt' &&
        r.payload?.chatId === chatId &&
        (r.state === 'queued' || r.state === 'sending')
    )
    .map((r) => ({
      intentId: r.id,
      // The same derivation as the server's `askIdForIntent`: the run the drain makes carries this askId.
      askId: `a_${String(r.id).replace(/^i_/, '')}`,
      gates: Array.isArray(r.gates) ? r.gates : [],
      words: null,
      presentation: r.payload?.presentation === 'field' ? 'field' : 'sent',
      allowanceResetsAt: typeof r.allowanceResetsAt === 'number' ? r.allowanceResetsAt : null,
      text: typeof r.payload?.text === 'string' ? r.payload.text : '',
    }));
}

const WINDOW_NAMES = {
  five_hour: '5-hour allowance',
  seven_day: 'weekly allowance',
  seven_day_opus: 'weekly allowance',
  seven_day_sonnet: 'weekly allowance',
  seven_day_oauth_apps: 'weekly allowance',
  seven_day_overage_included: 'weekly allowance',
};

/** "90% of this 5-hour allowance used · resets 18:40" — only for the almost-used-up warning. */
export function quotaModel(rateLimit) {
  if (!rateLimit || rateLimit.status !== 'allowed_warning' || typeof rateLimit.pct !== 'number')
    return null;
  const at = rateLimit.resetsAt;
  const ms = typeof at === 'number' ? (at < 1e12 ? at * 1000 : at) : null;
  const name = WINDOW_NAMES[rateLimit.type] ?? 'allowance';
  const reset = ms ? ` · resets ${clock(ms)}` : '';
  return { pct: rateLimit.pct, text: `${rateLimit.pct}% of this ${name} used${reset}` };
}
