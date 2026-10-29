// client/v2/assets/import-lines.js — the one line each arrival gets (S8.22; 12 · ia-more-ways, ia-edges).
//
// "Nine awkward arrivals, each answered in one line. What happened · what is safe · one verb at most. Nothing blocks the
// canvas." The server answers with facts (`POST /_api/import-asset`: reused, converted, removed, or a refusal `reason`
// from bin/_import-asset.mjs); the words live here, so no surface parses an error message. Words per CONTRACT §3–§4:
// plain, no mono, no paths (the stored name lives only under Advanced).
//
// Pure: an answer in, `{ tone, text, verb? }` out — or null when the arrival needs no line (a plain photo that landed).

const NUMBER_WORDS = [
  'no',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
];
const count = (n, one, many) => {
  const w = n >= 0 && n < NUMBER_WORDS.length ? NUMBER_WORDS[n] : String(n);
  return `${w} ${n === 1 ? one : many}`;
};
/** "a script" reads better than "one script" inside a list. */
const countA = (n, one, many) => (n === 1 ? `a ${one}` : count(n, one, many));

function joinAnd(parts) {
  if (parts.length <= 1) return parts.join('');
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

/** What a cleaned logo lost, as one clause — or null when nothing was left out. */
export function removedClause(removed) {
  if (!removed) return null;
  const parts = [];
  if (removed.links > 0)
    parts.push(count(removed.links, 'link to another site', 'links to other sites'));
  if (removed.scripts > 0) parts.push(countA(removed.scripts, 'script', 'scripts'));
  if (removed.other > 0)
    parts.push(countA(removed.other, 'part that isn’t drawing', 'parts that aren’t drawing'));
  if (!parts.length) return null;
  const total = (removed.links || 0) + (removed.scripts || 0) + (removed.other || 0);
  return `${joinAnd(parts)} ${total === 1 ? 'was' : 'were'} left out`;
}

/**
 * The line for one import answer.
 * @param {object} answer  the route's JSON (`{ ok, reused, converted, removed, reason }`)
 * @param {{ name?: string, original?: boolean, fromLink?: boolean, host?: string }} [ctx]  the file’s name as the person knows it;
 *   `original` when this Mac kept where it came from (S8.21 Advanced shows it); `fromLink` when it came from a link
 *   (Assets › Add from a link…, `POST /_api/import-link`) — its landing says the copy is the person's own
 * @returns {{ tone: 'info'|'warn', text: string, verb?: string } | null}
 */
export function importLine(answer, ctx = {}) {
  const name = ctx.name || answer?.name || 'The file';
  if (answer?.ok) {
    // 12 · ia-edges F — a link lands as a copy: the page can change, the copy won't
    if (ctx.fromLink) return { tone: 'info', text: ARRIVAL_LINES.fromLink() };
    if (answer.reused) {
      return {
        tone: 'info',
        text: `${name} is already in Assets — placed the same one, not a copy.`,
      };
    }
    if (answer.converted === 'psd') {
      return {
        tone: 'info',
        text: `Placed the flat picture from ${name}. Its layers stay in Photoshop.`,
      };
    }
    if (answer.converted === 'heic') {
      return {
        tone: 'info',
        text: ctx.original
          ? `${name} came in as a JPG the canvas can show. The original stays under Advanced.`
          : `${name} came in as a JPG the canvas can show.`,
      };
    }
    const lost = removedClause(answer.removed);
    if (lost)
      return {
        tone: 'info',
        text: `${name} kept its shapes and colours; ${lost}.`,
        verb: 'Details',
      };
    return null;
  }
  switch (answer?.reason) {
    case 'no-flat-picture':
      return {
        tone: 'warn',
        text: `${name} has no flat picture. Save it from Photoshop as a PNG or JPG and add that.`,
      };
    case 'not-on-mac':
      return { tone: 'warn', text: `${name} comes in on a Mac. Here, add it as a PNG or JPG.` };
    case 'too-many-pixels':
      return {
        tone: 'warn',
        text: `${name} is too big to bring in — over 100 megapixels. Add a smaller copy.`,
      };
    case 'too-large':
      return { tone: 'warn', text: `${name} is too large to bring in. Add a smaller copy.` };
    case 'timeout':
      return {
        tone: 'warn',
        text: `${name} took too long to prepare, so it was left out.`,
        verb: 'Try again',
      };
    case 'busy':
      return {
        tone: 'warn',
        text: `Another file is still preparing. ${name} waits a moment.`,
        verb: 'Try again',
      };
    case 'external-reference':
      return { tone: 'warn', text: `${name} points at files outside itself, so it was left out.` };
    case 'forbidden':
      return { tone: 'warn', text: 'You can view this project. Adding files needs Can edit.' };
    case 'unsupported':
      return { tone: 'warn', text: `${name} isn’t a picture Maude can bring in.` };
    // p8-import-link — a link that was not brought in (link-import.ts `LinkReason`); nothing was added in every case
    case 'link-bad':
      return {
        tone: 'warn',
        text: 'That isn’t a link. Paste an address that starts with https://.',
      };
    case 'link-not-https':
      return { tone: 'warn', text: 'Only https:// links come in, so nothing was added.' };
    case 'link-refused':
      return {
        tone: 'warn',
        text: 'That link carries a password or an unusual port, so nothing was added.',
      };
    // F3 — one answer for a private address, no DNS answer and no connection, so none can be told apart
    case 'link-unreachable':
      return { tone: 'warn', text: 'That link can’t be reached from here, so nothing was added.' };
    case 'link-proxy':
      return {
        tone: 'warn',
        text: 'This Mac sends web traffic through a proxy, so links don’t come in. Download the file and add it.',
      };
    case 'link-http':
      return {
        tone: 'warn',
        text: `${ctx.host || 'The site'} didn’t send a file for that link, so nothing was added.`,
      };
    case 'link-redirects':
      return { tone: 'warn', text: 'That link kept pointing elsewhere, so nothing was added.' };
    case 'link-not-media':
      return {
        tone: 'warn',
        text: 'That link is a page, not a picture, video or sound, so nothing was added.',
      };
    case 'link-svg':
      return {
        tone: 'warn',
        text: 'Logos don’t come in from a link. Save the SVG and use Add files…, which cleans it.',
      };
    case 'link-not-on-mac':
      return { tone: 'warn', text: 'Links come in on a Mac. Here, download the file and add it.' };
    default:
      return { tone: 'warn', text: `${name} couldn’t be brought in safely, so it was left out.` };
  }
}

/** Lines for the arrivals the import route does not answer (12 · ia-more-ways, ia-edges). */
export const ARRIVAL_LINES = Object.freeze({
  pasted: (where) =>
    `Pasted into ${where}, where the pointer was. Paste it again and the same picture is reused, not copied.`,
  preparing: (name, about) =>
    `Preparing ${name} — keeps working in the background.${about ? ` About ${about}.` : ''}`,
  offline: () => 'Kept on this Mac — goes up by itself once it’s online.',
  fromLink: () => 'Saved a copy from the link — the page can change, your copy won’t.',
  addedBy: (who) => `Added by ${who}`,
});

// biome-ignore lint/suspicious/noControlCharactersInRegex: dropping control characters is the point
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/g;

/**
 * p8-import-link — what the line calls a link while it comes in: its last path segment (`combine-2025-12.jpg`), else
 * its site. Display only — the server names the stored file from its bytes. Anything that does not parse is "the link".
 * @param {string} url
 * @returns {{ name: string, host: string }}
 */
export function linkName(url) {
  try {
    const u = new URL(String(url).trim());
    let last = u.pathname.split('/').filter(Boolean).pop() ?? '';
    try {
      last = decodeURIComponent(last);
    } catch {
      /* keep it as it came */
    }
    last = last.replace(CONTROL_CHARS, '').trim().slice(0, 120);
    return { name: last || u.hostname || 'the link', host: u.hostname };
  } catch {
    return { name: 'the link', host: '' };
  }
}

/** From this size a file is "huge" (12 · ia-edges A: a 500 MB 4K clip): it says it is preparing, not just adding. */
export const LARGE_FILE_BYTES = 100 * 1024 * 1024;

/** "4 min" / "a minute" from the pace so far — null until there is a pace to go on. */
function timeLeft(progress, elapsedMs) {
  if (!(progress > 0 && progress < 1) || !(elapsedMs > 0)) return null;
  const minutes = Math.round((elapsedMs * (1 - progress)) / progress / 60_000);
  return minutes <= 1 ? 'a minute' : `${minutes} min`;
}

/**
 * The Assets panel's line while files are going in (p8-fix-e, F16 · A). A huge file gets the board's
 * "Preparing <name> — keeps working in the background. About 4 min." with its percent; anything else keeps the
 * short "Adding… 50%".
 * @param {{ progress: number, name?: string, bytes?: number, elapsedMs?: number } | null} upload  the largest file in flight
 */
export function addingLine(upload) {
  if (!upload || typeof upload.progress !== 'number') return 'Adding…';
  const pct = Math.round(upload.progress * 100);
  if (upload.name && (upload.bytes ?? 0) >= LARGE_FILE_BYTES) {
    return `${ARRIVAL_LINES.preparing(upload.name, timeLeft(upload.progress, upload.elapsedMs))} ${pct} %`;
  }
  return `Adding… ${pct}%`;
}
