// client/home/home-starters.js — the three starters under Home's question (S6.4, decision Q5).
//
// A FIXED catalogue, no AI call and no network: the same target gives the same three lines, so Home
// is instant and works offline. Picked by what the target is:
//   · a new project            the 05 empty-state sets (signed in / not)
//   · a project with no canvases yet   a landing page, logo ideas, and "Bring my existing brand"
//   · a project with canvases  by the dominant artboard kind (V2-1.17 `counts.byKind`): print / video /
//                              digital, else the web set — and "for <project>" is its own name
// Every line is a sentence from the canvases (01/02 Home, 05 es-home-*). A starter FILLS the prompt and
// does not send; "Bring my existing brand" is not a sentence — it is the `import-brand` intent, and (S10.16c, 13 ·
// ds-make-inputs) "A design system" is the `make-ds` intent: the target's window opens the three-input sheet.
// Pure; art is the name of a small lifted illustration (home.css `.home-art--*`).

/** The one starter that is an action, not a sentence. Runs `import-brand` in the target. */
export const BRAND_STARTER = Object.freeze({
  id: 'brand',
  title: 'Bring my existing brand',
  detail: 'logo, colours, fonts',
  art: 'moodboard',
  intent: 'import-brand',
});

/**
 * S10.16c — "A design system", the starter that is not a sentence either: it parks the `make-ds` intent in the
 * target project, whose window opens the three-input sheet (`ds.make`, 13 · ds-make-inputs). "for <project>" is its
 * own name, like the logo starter it replaces. Home cannot see whether the project already has a system; the sheet
 * names a second one apart from the first.
 */
const dsFor = (name) =>
  Object.freeze({
    id: 'ds',
    title: 'A design system',
    detail: `for ${name}`,
    art: 'brand',
    intent: 'make-ds',
  });
/** The shape of the starter, for a caller that has no project name. */
export const DS_STARTER = dsFor('your brand');

const s = (id, title, detail, prompt, art) => Object.freeze({ id, title, detail, prompt, art });

const PRICING = s(
  'pricing',
  'A pricing page',
  'with a yearly toggle',
  'A pricing page with a yearly toggle',
  'price'
);
const LOGOS_NEW = s(
  'logos-new',
  'Three logo ideas',
  'for a new brand',
  'Three logo ideas for a new brand',
  'brand'
);
const POSTER = s(
  'poster',
  'A matchday poster',
  'A4, ready to print',
  'A matchday poster, A4, ready to print',
  'poster'
);
const PORTFOLIO = s(
  'portfolio',
  'A portfolio page',
  'six projects, calm',
  'A portfolio page, six projects, calm',
  'home'
);
const MOODBOARD = s(
  'moodboard',
  'A moodboard',
  'photos and swatches',
  'A moodboard with photos and swatches',
  'moodboard'
);
const LANDING = s(
  'landing',
  'A landing page',
  'calm and light',
  'A landing page, calm and light',
  'home'
);
const ONBOARDING = s(
  'onboarding',
  'An onboarding flow',
  'four screens, mobile',
  'An onboarding flow, four screens, mobile',
  'onb'
);
const FLYER = s('flyer', 'A flyer', 'A6, front and back', 'A flyer, A6, front and back', 'poster');
const TITLE_CARD = s(
  'title-card',
  'A title card',
  'for a short video',
  'A title card for a short video',
  'poster'
);

const logosFor = (name) =>
  s('logos', 'Three logo ideas', `for ${name}`, `Three logo ideas for ${name}`, 'brand');

/** The dominant artboard kind of a project's index counts (`{web: 3, print: 1}`), or null. */
function dominantKind(byKind) {
  let best = null;
  let n = 0;
  for (const [k, v] of Object.entries(byKind ?? {})) {
    if (typeof v === 'number' && v > n) {
      best = k;
      n = v;
    }
  }
  return best;
}

/**
 * @param {{ target: { kind: 'new'|'local'|'cloud', name?: string, canvases?: number|null,
 *                     byKind?: Record<string, number> }, signedIn: boolean }} input
 * @returns {Array<{ id: string, title: string, detail: string, prompt?: string, art: string, intent?: string }>}
 */
export function pickStarters({ target, signedIn }) {
  if (!target || target.kind === 'new')
    return signedIn ? [PRICING, LOGOS_NEW, POSTER] : [PORTFOLIO, LOGOS_NEW, MOODBOARD];
  const name = (target.name || '').trim() || 'your brand';
  if (target.canvases === 0) return [LANDING, logosFor(name), BRAND_STARTER];
  switch (dominantKind(target.byKind)) {
    case 'print':
      return [dsFor(name), POSTER, FLYER];
    case 'video':
      return [dsFor(name), TITLE_CARD, PRICING];
    case 'digital':
      return [dsFor(name), ONBOARDING, PRICING];
    default:
      return [dsFor(name), PRICING, ONBOARDING];
  }
}
