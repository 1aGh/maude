// client/v2/ai/ai-offer.js — S4.15 (contract S4-S5-ai-annotations §4): the "Make these changes" offer.
//
// After it reads the stickies the agent ends its answer with ONE fenced block:
//
//   ```maude-offer
//   { "v": 1, "says": "…", "answers": ["s_a1"], "leaves": ["s_d4"],
//     "targets": [{ "ref": "el:desktop/hero-picture", "name": "The hero picture" }] }
//   ```
//
// sec-a C2 (wave-A attacker): only the agent's OWN closing block counts — exactly ONE block in the answer, at a
// line start (a `> ` quote is not one), and nothing after it but space. A block quoted mid-answer, a second
// block, or a block whose body the person's own message (or any other `echoes` text: annotation / canvas words
// the caller holds) already carried, makes NO offer, and stays visible as text, so an echo is seen for what it is.
//
// `parseOffer` lifts the block out of the answer (it is not shown as text) and validates it: `answers` and
// `leaves` keep only ids that are in the ask's scope, a target keeps only a host ref of the right shape (at most
// 8), `says` is cut to 240 and rendered as TEXT. A block that is not JSON, or not `v: 1`, is ignored and the
// answer reads as plain text.
//
// What reaches the untrusted canvas (`seenTargetsFor`) is the REF and a tag built from the ref alone — the
// element's id, humanized. The agent's own `name` stays in the shell (decision v2-lead-neutral-ai-ring-tags: no
// word of the answer crosses to the canvas; S5.19 rejected an agent-reported point for the same reason).
//
// No DOM, no React: test/annotations-ai-offer.test.ts runs it directly.

import { humanize } from './runs-model.js';

export const OFFER_SAYS_MAX = 240;
export const OFFER_NAME_MAX = 40;
export const OFFER_TARGETS_MAX = 8;
/** The fixed words (CONTRACT §3–§4) — the agent writes only `says` and the names. */
export const OFFER_WORDS = Object.freeze({
  primary: 'Make these changes',
  secondary: 'Not now',
});

const ID = '[A-Za-z0-9_.:-]{1,128}';
const REF_RE = new RegExp(`^(?:ab:${ID}|el:${ID}/${ID})$`);
const ANNOTATION_ID_RE = /^[A-Za-z0-9_.:-]{1,64}$/;
const BLOCK_RE = /```maude-offer[ \t]*\r?\n([\s\S]*?)\r?\n?```/g;
/** The one block the agent may close with: at a line start, last in the answer (sec-a C2). */
const TRAILING_RE = /(?:^|\n)```maude-offer[ \t]*\r?\n([\s\S]*?)\r?\n?```\s*$/;

const plain = (v, max) =>
  typeof v === 'string'
    ? v
        // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping control characters is the point
        .replace(/[\u0000-\u001f\u007f]+/g, ' ')
        .trim()
        .slice(0, max)
    : '';

const idList = (raw, scope) =>
  Array.isArray(raw)
    ? [
        ...new Set(
          raw.filter((id) => typeof id === 'string' && ANNOTATION_ID_RE.test(id) && scope.has(id))
        ),
      ]
    : [];

/**
 * @param {string} text the assistant's final message (its OWN text parts — never a tool output)
 * @param {{ scopeIds?: string[], echoes?: string[] }} [ctx] the annotation ids of the ask this answers; `echoes`
 *   = texts the agent was GIVEN (the person's message, annotation words) — a block found in one is an echo
 * @returns {{ text: string, offer: null | { v: 1, says: string, answers: string[], leaves: string[],
 *   targets: Array<{ ref: string, name: string }> } }}
 */
export function parseOffer(text, { scopeIds = [], echoes = [] } = {}) {
  const src = typeof text === 'string' ? text : '';
  const blocks = [...src.matchAll(BLOCK_RE)];
  if (!blocks.length) return { text: src, offer: null };
  // sec-a C2 — one block, the answer's own last word; anything else is read (and shown) as plain text
  const tail = TRAILING_RE.exec(src);
  if (blocks.length !== 1 || !tail) return { text: src, offer: null };
  const last = tail[1];
  const body = last.trim();
  const echoed = (Array.isArray(echoes) ? echoes : []).some(
    (e) => typeof e === 'string' && (e.includes('```maude-offer') || (body && e.includes(body)))
  );
  if (echoed) return { text: src, offer: null };
  const stripped = src
    .slice(0, tail.index)
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  let raw = null;
  try {
    raw = JSON.parse(last);
  } catch {
    return { text: src, offer: null }; // a bad block reads as plain text
  }
  if (!raw || typeof raw !== 'object' || raw.v !== 1) return { text: src, offer: null };
  const scope = new Set(Array.isArray(scopeIds) ? scopeIds : []);
  const targets = [];
  for (const t of Array.isArray(raw.targets) ? raw.targets : []) {
    if (!t || typeof t.ref !== 'string' || !REF_RE.test(t.ref)) continue;
    if (targets.some((x) => x.ref === t.ref)) continue;
    targets.push({ ref: t.ref, name: plain(t.name, OFFER_NAME_MAX) });
    if (targets.length >= OFFER_TARGETS_MAX) break;
  }
  const says = plain(raw.says, OFFER_SAYS_MAX);
  if (!says) return { text: src, offer: null };
  return {
    text: stripped,
    offer: {
      v: 1,
      says,
      answers: idList(raw.answers, scope),
      leaves: idList(raw.leaves, scope).filter((id) => !idList(raw.answers, scope).includes(id)),
      targets,
    },
  };
}

/** The answer without its offer block — what the feed shows as text. A bad block stays (it reads as plain text). */
export const stripOffer = (text) => parseOffer(text).text;

/** "The hero picture" from `el:desktop/hero-picture` — the id, humanized; never the agent's words. */
export function tagForRef(ref) {
  const id = String(ref ?? '')
    .replace(/^(?:ab|el):/, '')
    .split('/')
    .pop();
  const h = humanize(id);
  return `The ${h.charAt(0).toLowerCase()}${h.slice(1)}`.slice(0, OFFER_NAME_MAX);
}

/** The `ai-seen` payload: refs and neutral tags, nothing else of the offer. */
export function seenTargetsFor(offer) {
  return (offer?.targets ?? []).map((t) => ({ ref: t.ref, tag: tagForRef(t.ref) }));
}

// ── the ask this answer belongs to ──────────────────────────────────────────────────────────────────────────
// The thread keeps what the person typed, not the frozen `[maude-scope …]` block, so the adapter notes the
// annotation scope of each send here (acp-runtime.js, one line). An offer is validated against it: a block that
// names ids the ask never carried loses them.
let asked = null;

/** @param {{ annotations?: { file: string, ids: string[] } } | null | undefined} frozen the context a send froze */
export function noteAskedAnnotations(frozen) {
  const a = frozen?.annotations;
  asked = a
    ? {
        file: a.file,
        ids: [...a.ids],
        artboards: [...(a.artboards ?? [])],
        kinds: { ...(a.kinds ?? {}) },
      }
    : null;
}

/** The stickies / arrows the latest send was about (`null`: it was not about annotations). */
export const askedAnnotations = () => asked;

/**
 * sec-a C2 — exactly what "Make these changes" sends, in words, shown on the card before the press: the
 * canned text, how many stickies ride as the scope, which of them the run may resolve, and where it points
 * (tags built from the refs — never the agent's own names).
 */
export function sendsLine(offer, ask) {
  const n = Array.isArray(ask?.ids) ? ask.ids.length : 0;
  const noun = (k) => (k === 1 ? '1 sticky' : `${k} stickies`);
  const parts = [`Sends “${OFFER_WORDS.primary}” with ${noun(n)}`];
  const a = offer?.answers?.length ?? 0;
  parts.push(a ? `resolves ${a === n ? 'all of them' : noun(a)} when done` : 'resolves none');
  const tags = (offer?.targets ?? []).map((t) => tagForRef(t.ref));
  if (tags.length) parts.push(`about ${tags.join(', ')}`);
  return `${parts.join(' · ')}.`;
}

/**
 * The "Make these changes" send: the person's words plus the hidden line the apply run reads
 * (`[maude-offer-accepted answers=<ids>]`). The scope stays the same `annotations` scope.
 */
export function acceptedLine(offer) {
  const ids = (offer?.answers ?? []).filter((id) => ANNOTATION_ID_RE.test(id));
  return `[maude-offer-accepted answers=${ids.join(',')}]`;
}
