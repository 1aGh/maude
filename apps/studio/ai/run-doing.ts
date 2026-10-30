// run-doing.ts — P8-C6: the one-line "what AI is doing" of your own run (`RunRecord.doing`, V2-1.15 §5.4).
//
// The working line reads "AI is making it greener" (03 AI Chat `ai-working`). The words come from the person's OWN
// ask — their first verb put in the present tense — never from the model's prose and never from a tool title. An ask
// that does not open with a verb we know (a question, another language) gives nothing, and the line stays "AI is
// working": an honest plain line beats a wrong guess. Studio-local like the rest of `doing`: `publicRun` does not
// carry it, and the ring on the canvas keeps its fixed tag.

/** imperative → present participle. A table, not a rule: English gerunds have too many exceptions to guess. */
const GERUND: Record<string, string> = {
  add: 'adding',
  adjust: 'adjusting',
  align: 'aligning',
  apply: 'applying',
  balance: 'balancing',
  brighten: 'brightening',
  build: 'building',
  center: 'centering',
  centre: 'centring',
  change: 'changing',
  clean: 'cleaning',
  color: 'coloring',
  colour: 'colouring',
  combine: 'combining',
  convert: 'converting',
  copy: 'copying',
  create: 'creating',
  crop: 'cropping',
  darken: 'darkening',
  decrease: 'decreasing',
  delete: 'deleting',
  design: 'designing',
  draw: 'drawing',
  duplicate: 'duplicating',
  enlarge: 'enlarging',
  export: 'exporting',
  fill: 'filling',
  fix: 'fixing',
  flip: 'flipping',
  generate: 'generating',
  group: 'grouping',
  hide: 'hiding',
  increase: 'increasing',
  insert: 'inserting',
  layout: 'laying out',
  lighten: 'lightening',
  make: 'making',
  match: 'matching',
  merge: 'merging',
  move: 'moving',
  place: 'placing',
  put: 'putting',
  recolor: 'recoloring',
  recolour: 'recolouring',
  reduce: 'reducing',
  remove: 'removing',
  rename: 'renaming',
  reorder: 'reordering',
  replace: 'replacing',
  resize: 'resizing',
  restyle: 'restyling',
  rewrite: 'rewriting',
  rotate: 'rotating',
  scale: 'scaling',
  set: 'setting',
  shorten: 'shortening',
  show: 'showing',
  shrink: 'shrinking',
  simplify: 'simplifying',
  soften: 'softening',
  split: 'splitting',
  stack: 'stacking',
  swap: 'swapping',
  tidy: 'tidying',
  translate: 'translating',
  turn: 'turning',
  update: 'updating',
  use: 'using',
  write: 'writing',
};

/** Courtesy the person wraps an ask in: "please make…", "can you make…". */
const COURTESY =
  /^(?:(?:hey|hi|ok|okay|so)[ ,]+)?(?:(?:can|could|would|will) you (?:please )?|please |pls )/i;
/** The longest line the panel shows before it is cut at a word. */
export const DOING_MAX = 60;

export function doingOf(ask: unknown): string {
  if (typeof ask !== 'string') return '';
  // the first non-empty line, its first sentence: "Make it greener. Then the badge." → "Make it greener"
  const line = ask.split(/\r?\n/).find((l) => l.trim()) ?? '';
  const sentence = line
    .trim()
    .replace(COURTESY, '')
    .split(/[.!?;](?:\s|$)/)[0]
    .replace(/[.!?;,\s]+$/, '');
  const m = sentence.match(/^([A-Za-z]+)(?:\s+(.*))?$/);
  if (!m) return '';
  const gerund = GERUND[m[1].toLowerCase()];
  if (!gerund) return '';
  const out = m[2] ? `${gerund} ${m[2]}` : gerund;
  if (out.length <= DOING_MAX) return out;
  const cut = out.slice(0, DOING_MAX - 1);
  const word = cut.lastIndexOf(' ');
  return `${(word > gerund.length ? cut.slice(0, word) : cut).trimEnd()}…`;
}
