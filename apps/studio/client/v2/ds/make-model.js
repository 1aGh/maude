// client/v2/ds/make-model.js — S10.16b: making a design system with AI (13 · ds-make-inputs … ds-make-done).
//
// Pure: the words, the three inputs, the brief that goes to the AI, the name of the new system, and how the done
// card reads the server's `make-state`. Nothing here writes. The person's sentence is passed to the AI VERBATIM
// (never reworded, never padded with references or "vibes"); what a website or a logo said is never in the text —
// only that the person named one.

export const MAKE_WORDS = Object.freeze({
  title: (project) => (project ? `Make a design system for ${project}` : 'Make a design system'),
  sentenceLabel: 'Say what the brand is, in a sentence',
  sentenceHint: 'Describe the brand in your own words',
  learnLabel: 'Anything to learn from?',
  optional: 'Optional',
  forLabel: 'Mostly for',
  fine: "AI puts three directions on a new Design system canvas, each in Light and Dark. Your canvases don't change until you choose.",
  noAI: 'Making a design system uses AI, which runs in the Maude app.',
  cancel: 'Cancel',
  go: 'Make three directions',
  going: 'Making…',
  started: (label) => `Making ${label}. Three directions are on its Design system canvas soon.`,
  ref: Object.freeze({
    logo: { title: 'Logo', empty: 'Choose a file', hint: 'An SVG or PNG from this Mac' },
    website: { title: 'Website', empty: 'Paste a link', hint: 'A public web address' },
    figma: { title: 'Figma library', empty: 'Connect', hint: 'If Figma is connected' },
    canvases: { title: 'Your canvases' },
  }),
});

/** What the third input offers (13 · "Mostly for"). */
export const AUDIENCES = Object.freeze([
  { id: 'websites', label: 'Websites' },
  { id: 'apps', label: 'Apps' },
  { id: 'print', label: 'Print and social' },
  { id: 'everything', label: 'A bit of everything' },
]);

const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;
export const SENTENCE_MAX = 600;

/** The sentence as the person typed it, minus control characters; null when it is empty. */
export function cleanSentence(raw) {
  const s = String(raw ?? '')
    .replace(CONTROL, '')
    .trim();
  return s ? s.slice(0, SENTENCE_MAX) : null;
}

/** Only the sentence is needed (13 · 13). */
export const canMake = ({ sentence }) => cleanSentence(sentence) !== null;

/** "Studio site" → `studio-site`; the next free name when it is taken. */
export function systemNameFor(label, taken = []) {
  const base =
    String(label ?? '')
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .replace(/^[^a-z]+/, '')
      .slice(0, 40)
      .replace(/-+$/, '') || 'brand';
  const used = new Set(taken);
  if (!used.has(base)) return base;
  for (let n = 2; n < 100; n++) if (!used.has(`${base}-${n}`)) return `${base}-${n}`;
  return `${base}-${Date.now().toString(36)}`;
}

/** The label of the new system: the project's own name (13: "Studio site system is ready"). */
export function systemLabelFor(project) {
  const l = String(project ?? '')
    .replace(CONTROL, '')
    .trim()
    .slice(0, 48);
  return l || 'My brand';
}

const HOST = /^[a-z0-9.-]{1,253}$/;
const LOGO_REF = /^assets\/logos\/[a-z0-9]{8}\.(svg|png)$/;

/** "studio-brno.cz" from whatever was typed, or null when it is not a host. */
export function hostOf(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  try {
    const u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : `https://${s}`);
    const h = u.hostname.replace(/^www\./, '').toLowerCase();
    return HOST.test(h) && h.includes('.') ? h : null;
  } catch {
    return null;
  }
}

/**
 * The message the AI composer gets (origin `ds-make`). The person's sentence goes in verbatim, between marks; the
 * references are only named (a server-shaped logo path, a host the person typed, "Figma", the canvases' count).
 * The rest is the app mode of `/design:setup-ds` in one paragraph: which verbs to use, in which order.
 */
export function makeBrief({ ds, label, sentence, audience, refs = {}, canvases = 0 }) {
  const brief = cleanSentence(sentence) ?? '';
  const learn = [];
  if (LOGO_REF.test(refs.logoRef ?? '')) learn.push(`the logo at ${refs.logoRef}`);
  const host = hostOf(refs.website);
  if (host) learn.push(`the website ${host}`);
  if (refs.figma === true) learn.push('the Figma library, if Figma is connected');
  if (refs.canvases === true && canvases > 0)
    learn.push(`the project's own ${canvases === 1 ? 'canvas' : `${canvases} canvases`}`);
  const mostly = AUDIENCES.find((a) => a.id === audience)?.label ?? null;
  return [
    `Make the design system "${label}" with /design:setup-ds ${ds} --app (the app mode). It is already started as "${ds}": its Design system canvas is open and every section is an outline.`,
    '',
    'The brief, as I wrote it:',
    `"""${brief}"""`,
    mostly ? `Mostly for: ${mostly}.` : null,
    learn.length ? `Learn from: ${learn.join('; ')}.` : 'Nothing else to learn from.',
    '',
    `Write three directions with \`maude design ds draft ${ds} --direction a|b|c --tokens <file>\` (Light and Dark for every colour), say what you read and what you could not, and ask me the one question that changes the outcome. I pick one (\`ds use\`) or mix (\`ds mix\`). Then fill the sections in the working files, Brand and Colour first, and tell me what is missing. Do not run \`ds done\`: I will.`,
  ]
    .filter((l) => l !== null)
    .join('\n');
}

/** The plain words for a refusal from `POST /_api/ds/make`. */
export function refusalWords(code) {
  switch (code) {
    case 'forbidden':
      return 'You can’t change this project’s design systems.';
    case 'ds-exists':
      return 'A design system with that name already exists.';
    case 'ds-make-invalid':
      return 'That name can’t be used for a design system.';
    case 'ds-not-making':
      return 'This system is already made.';
    case 'ds-unknown-direction':
      return 'That direction isn’t on the canvas yet.';
    case 'ds-nothing-made':
      return 'There is nothing in it yet. Pick a direction first.';
    case 'unreachable':
      return 'Couldn’t reach the studio. Try again.';
    default:
      return 'Couldn’t do that. Try again.';
  }
}

/* ------------------------------------------------------------ the done card */

/** What `ds-check` reasons mean to a designer, said once each. */
const REASON_WORDS = {
  'missing-core': 'some colours, type or spacing are missing',
  'missing-functional': 'some colours, type or spacing are missing',
  'theme-gap': 'a few values have no Dark value',
  'single-theme': 'a few values have no Dark value',
  'components-missing': 'the components are not all drawn',
  'brand-missing': 'the logo or the icons are missing',
};

/** "the logo or the icons are missing · the components are not all drawn" — each once, in a fixed order. */
export function missingWords(reasons) {
  const seen = [];
  for (const r of Array.isArray(reasons) ? reasons : []) {
    const w = REASON_WORDS[r];
    if (w && !seen.includes(w)) seen.push(w);
  }
  return seen;
}

const FILLING = ['colour', 'type', 'space', 'motion'];

/**
 * Is there something to finish? Something has landed in the working files and no section is being drawn right now.
 * @returns {{ show: boolean, complete: boolean, missing: string[] }}
 */
export function readiness(state) {
  if (!state || state.making !== true) return { show: false, complete: false, missing: [] };
  const s = state.sections ?? {};
  const landed = FILLING.some((k) => s[k] === 'done');
  const drawing = Object.values(s).some((v) => v === 'drawing');
  const missing = missingWords(state.reasons);
  const gaps = Object.entries(s)
    .filter(([k, v]) => v !== 'done' && k !== 'patterns')
    .map(([k]) => k);
  return {
    show: landed && !drawing,
    complete: missing.length === 0 && gaps.length === 0,
    missing,
  };
}

export const READY_WORDS = Object.freeze({
  ready: (label) => `${label} system is ready.`,
  partly: (label) => `${label} system is partly ready.`,
  use: (label) => `Use as ${label}'s style`,
  sub: 'Every canvas then picks it up after a review.',
  busy: 'Finishing…',
  used: (label) => `${label} is now the style for new canvases.`,
  usedMissing: (label, missing) =>
    `${label} is now the style for new canvases. Still missing: ${missing.join(', ')}.`,
});

/** The sections the canvas should draw, from `make-state` (the shell posts them to the frame). */
export function sectionsToPost(state) {
  if (!state || state.making !== true || !state.sections) return null;
  const out = {};
  for (const [k, v] of Object.entries(state.sections))
    if (v === 'waiting' || v === 'drawing' || v === 'done') out[k] = v;
  return out;
}
