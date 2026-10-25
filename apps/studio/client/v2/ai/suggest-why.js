// client/v2/ai/suggest-why.js — S5.8 (03 AI Chat `ai-suggest`): up to three suggestion chips and the one
// line that says why they are there, derived from what the person was just doing.
//
// Pure: the panel hands in plain facts (open comments, selected clips, a canvas just shared, the last
// ask) and gets back `{ icon, chips, why } | null`. The lead context wins, in this order — open
// comments, selected clips, a canvas you just shared, your last ask — "the lead chip follows it".
// A chip PREFILLS the composer and never sends (the v1 rule for every suggestion).
//
// Words (CONTRACT §3–4): no "we", no "I", "AI" without an article, counts use the real noun.

/** A canvas counts as "just shared" for this long. */
export const SHARED_WINDOW_MS = 15 * 60 * 1000;

/** localStorage key of Advanced › Suggestions (on by default; S5.12 owns the switch). */
export const SUGGEST_PREF_KEY = 'maude-ai-suggestions';

/** The longest slice of the last ask the why line quotes. */
const ASK_QUOTE_MAX = 36;

const noun = (n, one, many) => (n === 1 ? one : many);

/** Suggestions are on unless the person turned them off. Never throws. */
export function readSuggestPref(storage) {
  try {
    return (storage ?? globalThis.localStorage)?.getItem(SUGGEST_PREF_KEY) !== 'off';
  } catch {
    return true;
  }
}

export function writeSuggestPref(on, storage) {
  try {
    (storage ?? globalThis.localStorage)?.setItem(SUGGEST_PREF_KEY, on ? 'on' : 'off');
  } catch {
    /* private window / blocked storage — the switch just doesn't persist */
  }
}

const COLOUR =
  /colou?r|green|blue|red\b|yellow|orange|purple|pink|dark|light|barv|zelen|modr|cerven|tmav|svetl|odst/i;
const TEXT = /font|text|headline|heading|size|larger|bigger|smaller|písm|pism|velik/i;

/** The kind of the last ask: 'colour' | 'text' | 'other'. */
export function askTopic(text) {
  const t = String(text ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '');
  if (COLOUR.test(t)) return 'colour';
  if (TEXT.test(t)) return 'text';
  return 'other';
}

function quote(text) {
  const s = String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  return s.length > ASK_QUOTE_MAX ? `${s.slice(0, ASK_QUOTE_MAX - 1).trimEnd()}…` : s;
}

const chip = (id, label, prompt, extra = {}) => ({ id, label, prompt: prompt ?? label, ...extra });

/**
 * @param {object} i
 * @param {boolean} [i.enabled=true] — Advanced › Suggestions
 * @param {number} [i.openComments=0] — open comments on this canvas
 * @param {number} [i.selectedClips=0] — clips selected in the timeline
 * @param {{ name?: string, at: number } | null} [i.justShared] — a canvas shared by this person
 * @param {{ text: string } | null} [i.lastAsk] — this person's last ask in this chat
 * @param {boolean} [i.lastFailed=false] — S5.19: the last ask FAILED; "Try a variation / Explain what changed" would follow up on nothing
 * @param {string|null} [i.repair=null] — P8 c8 (01 `cf-render-error`): the canvas cannot draw; the composer text of "Ask AI to fix it" (the card keeps ONE verb, the repair is this chip)
 * @param {boolean} [i.resultShown=false] — P8 c6: the result card under the last reply already carries the follow-up chips (03 `ai-done`)
 * @param {number} [i.now]
 * @returns {{ context: string, icon: string, chips: Array<{id:string,label:string,prompt:string,testid?:string}>, why: string } | null}
 */
export function deriveSuggestions({
  enabled = true,
  openComments = 0,
  selectedClips = 0,
  justShared = null,
  lastAsk = null,
  lastFailed = false,
  resultShown = false,
  repair = null,
  now = Date.now(),
} = {}) {
  // A broken canvas is not a suggestion the person can switch off: it is the card's other half (01 cf-render-error).
  if (repair)
    return {
      context: 'repair',
      icon: 'sparkle',
      chips: [chip('repair', 'Ask AI to fix it', repair, { testid: 'ai-repair-chip' })],
      why: "Because this canvas can't be drawn right now",
    };
  if (!enabled) return null;

  if (openComments > 0) {
    return {
      context: 'comments',
      icon: 'comment',
      chips: [
        chip(
          'resolve',
          `Resolve ${openComments} ${noun(openComments, 'comment', 'comments')}`,
          '/design:edit fix open comments',
          { testid: 'chat-qa-implement-comments' }
        ),
        chip('reply', 'Reply to the comments', 'Reply to the open comments'),
        chip('list', 'List what changed', 'List what changed on this canvas'),
      ],
      why: `Because ${openComments} ${noun(openComments, 'comment is', 'comments are')} open on this canvas`,
    };
  }

  if (selectedClips > 0) {
    return {
      context: 'clips',
      icon: 'video',
      chips: [
        chip(
          'cut',
          `Cut a 15 s video from ${noun(selectedClips, 'this clip', 'these')}`,
          `Cut a 15 s video from the ${noun(selectedClips, 'selected clip', 'selected clips')}`
        ),
        chip('captions', 'Add captions'),
        chip('moments', 'Best moments'),
      ],
      why: `Because ${selectedClips} ${noun(selectedClips, 'clip is', 'clips are')} selected`,
    };
  }

  if (justShared && Number.isFinite(justShared.at) && now - justShared.at <= SHARED_WINDOW_MS) {
    return {
      context: 'shared',
      icon: 'view',
      chips: [
        chip('review', 'Run a design review'),
        chip('print', 'Check it for print'),
        chip('english', 'English version'),
      ],
      why: 'Because you just shared this canvas',
    };
  }

  // A slash command is not an ask to follow up on (and `/design:edit fix open comments` is a chip's own text).
  if (
    !lastFailed &&
    !resultShown &&
    lastAsk?.text &&
    String(lastAsk.text).trim() &&
    !String(lastAsk.text).trim().startsWith('/')
  ) {
    const topic = askTopic(lastAsk.text);
    const chips =
      topic === 'colour'
        ? [
            chip('same', 'Same on the other artboards'),
            chip('shade', 'A darker shade'),
            chip('everywhere', 'Apply it everywhere'),
          ]
        : topic === 'text'
          ? [
              chip('same', 'Same on the other artboards'),
              chip('larger', 'A bit larger'),
              chip('check', 'Check every text size'),
            ]
          : [
              chip('same', 'Same on the other artboards'),
              chip('variation', 'Try a variation'),
              chip('explain', 'Explain what changed'),
            ];
    return {
      context: 'last-ask',
      icon: 'history',
      chips,
      why:
        topic === 'colour'
          ? 'Because you last asked about colour'
          : topic === 'text'
            ? 'Because you last asked about text'
            : `Because you last asked “${quote(lastAsk.text)}”`,
    };
  }

  return null;
}
