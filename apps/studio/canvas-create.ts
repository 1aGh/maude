// canvas-create.ts — Phase 22 UI add-on. Pure helpers behind POST /_api/canvas
// (api.ts createCanvas), which lets the browser file-tree create a blank brief
// board directly — no slash command, no model cost. Generation (ingesting a
// board's notes into artboards) stays with Claude via `/design:new`; this only
// stamps out the empty annotation surface.
//
// SINGLE SOURCE — the board envelope is the SAME `brief-board.tsx.template`
// `/design:new --blank` substitutes. We text-import it so Bun.build inlines the
// content into the `bun --compile` standalone binary (verified: works at dev
// runtime AND embeds at build time), sidestepping DDR-045 — no runtime disk read
// of a file that lives outside `apps/studio/`. The template stayed under the
// design plugin (plugins/design/templates) when the studio moved (DDR-095).

import blankCanvasTemplate from '../../plugins/design/templates/blank-canvas.tsx.template' with {
  type: 'text',
};
import briefBoardTemplate from '../../plugins/design/templates/brief-board.tsx.template' with {
  type: 'text',
};

import { COMPONENT } from './sync/canvas-path.ts';

export const BRIEF_BOARD_TEMPLATE: string = briefBoardTemplate;
/** V2 S6.1 — the blank canvas: an empty DesignCanvas (⌘N, Home's "Start with an empty canvas"). */
export const BLANK_TEMPLATE: string = blankCanvasTemplate;

/**
 * The ONE security boundary for the create endpoint. A canvas name is the only
 * user-controlled value, and it becomes a real nested filesystem path
 * (`<group>/<name>.tsx`), the `@canvas` header comment, JSX text (brief board)
 * and a JSON string (`.meta.json`).
 *
 * Lead decision `v2-lead-canvas-names-sync-safe` (replaces the earlier any-filename-safe widening):
 * a canvas or folder name stays inside the SYNC PATH CHARSET — letters A–Z/a–z, digits, space, `_`
 * and `-`, first character not a space — which is exactly what `sync/canvas-path.ts` `COMPONENT`
 * accepts (imported, not re-typed, so the two cannot drift) and what every v1 receiver accepts. A name
 * outside it lands at a flat fallback path on other peers, and v1 peers can never be widened.
 * That one allowlist also keeps every sink safe:
 *   • path safety     — no `/`, `\`, `.` ⇒ no traversal, no dotfile, no `..` (and no `:`);
 *   • comment safety  — no `*` ⇒ nothing can close the header comment;
 *   • template safety — no `<`, `>`, `{`, `}`, `&` ⇒ no JSX tag, expression or entity
 *                       (`nameForTemplate` still escapes them, belt and braces);
 *   • JSON safety     — no `"` or `\`; the meta is written with JSON.stringify anyway.
 */
/** CONTRACT §4 voice (what is safe · one verb). `nameRefusal` adds the suggestion. */
export const NAME_RULE = 'Names can use letters, numbers, spaces, - and _.';
/** The words said for a refused name: the rule, then “Try “<suggestion>”.” — or “Try another name.” when
 *  there is no suggestion worth offering. */
export function nameRefusal(suggestion?: string | null): string {
  return suggestion ? `${NAME_RULE} Try “${suggestion}”.` : `${NAME_RULE} Try another name.`;
}
/** The longest name, in characters. */
export const NAME_MAX = 60;
export const NAME_TOO_LONG = `Names are ${NAME_MAX} characters or fewer.`;
export const NAME_EMPTY = 'Give it a name.';

/**
 * The typed name folded to the allowed set: — – and kin become `-`, letters lose their accents (NFD, then
 * strip the marks, so č→c), every other character is dropped, runs of spaces collapse, and the ends are
 * trimmed. Capped at the longest name. Empty when nothing usable is left. The client mirrors this
 * (`rename-model.js` `suggestName`); `test/canvas-names-sync-safe.test.ts` pins them equal.
 */
export function foldToAllowedName(raw: string): string {
  const folded = raw
    .normalize('NFC')
    .replace(/[\u2010-\u2015\u2212]/g, '-')
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .replace(/[^A-Za-z0-9 _-]+/g, '')
    .replace(/ +/g, ' ')
    .trim();
  return [...folded].slice(0, NAME_MAX).join('').trim();
}

export interface NameValidation {
  ok: boolean;
  name?: string;
  componentName?: string;
  error?: string;
  /** For a refused character set: the typed name folded to the allowed set (never empty). */
  suggestion?: string;
}

function checkCanvasName(raw: unknown): NameValidation {
  if (typeof raw !== 'string') return { ok: false, error: 'name must be a string' };
  // NFC-normalize so a decomposed (NFD) name and its composed sibling can't hash
  // to two JS strings that collide to ONE on-disk path on a normalizing filesystem
  // (APFS/HFS+) — which would let the 409 existence guard be bypassed and an
  // existing board silently overwritten (Phase 22 security review, low). Collapse
  // runs of SPACES to a single space so the JS slug (`/\s+/→_`) and slug.sh
  // (`tr ' ' '_'`) can't diverge on a double-spaced name (review #4). Tabs and
  // newlines are control characters and are refused below.
  const name = raw.normalize('NFC').trim().replace(/ +/g, ' ');
  if (!name) return { ok: false, error: NAME_EMPTY };
  // Outside the sync path charset (includes every dot, so `.`, `..` and dotfiles): refused in CONTRACT
  // words, with the folded name as the way out when anything usable is left.
  if (!COMPONENT.test(name)) {
    const suggestion = foldToAllowedName(name);
    return suggestion
      ? { ok: false, error: nameRefusal(suggestion), suggestion }
      : { ok: false, error: nameRefusal() };
  }
  if ([...name].length > NAME_MAX) return { ok: false, error: NAME_TOO_LONG };
  return { ok: true, name };
}

/** True when `name` is already the form a validated name takes (for names that arrive from a
 *  manifest rather than the create endpoint). */
export function isAllowedCanvasName(name: unknown): boolean {
  const v = checkCanvasName(name);
  return v.ok && v.name === name;
}

/**
 * Folder names share the canvas rule — one allowlist to audit, not two that could drift. A folder
 * name never reaches JSX or JSON, but it IS a path segment.
 */
export function validateFolderName(raw: unknown): NameValidation {
  return checkCanvasName(raw);
}

export function validateCanvasName(raw: unknown): NameValidation {
  const v = checkCanvasName(raw);
  if (!v.ok || !v.name) return v;
  return { ok: true, name: v.name, componentName: componentNameFrom(v.name) };
}

/** A name for the JSX text of a template: `{`, `}` and `&` would otherwise be read as code or an
 *  entity. (`<` `>` are already refused.) */
export function nameForTemplate(name: string): string {
  return name.replaceAll('&', '&amp;').replaceAll('{', '&#123;').replaceAll('}', '&#125;');
}

/** Substitute `{{NAME}}`: raw inside a ` * ` header-comment line, JSX-escaped everywhere else. */
function substituteName(template: string, name: string): string {
  return template
    .split('\n')
    .map((line) =>
      line.includes('{{NAME}}')
        ? line.replaceAll('{{NAME}}', /^\s*\*/.test(line) ? name : nameForTemplate(name))
        : line
    )
    .join('\n');
}

/** PascalCase a name into a valid JS identifier for the component default export.
 *  Non-identifier characters split words; an empty / digit-leading result gets a
 *  `Board` prefix so the emitted `export default function <id>()` always parses. */
export function componentNameFrom(name: string): string {
  // Split on NON-(letter|number) so Unicode letters survive (the validator
  // accepts them) — `Přihlášení` → `Přihlášení`, a valid JS identifier (verified
  // it parses), not the ASCII-mangled `PIhlEn` (review #1). Empty (all-symbol) →
  // `BriefBoard`; a digit-leading result (incl. Unicode digits) → `Board…` so the
  // emitted `export default function <id>()` always parses.
  const pascal = name
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join('');
  if (!pascal) return 'BriefBoard';
  if (/^\p{Nd}/u.test(pascal)) return `Board${pascal}`;
  return pascal;
}

export interface BriefBoardOpts {
  name: string;
  componentName: string;
  dsName: string;
  platform: string;
  seedHint: string;
  historyDir: string;
}

/** Substitute the brief-board template placeholders. Safe because `name`
 *  (the only user value reaching here) is validated by `validateCanvasName`,
 *  and every other field is server-derived (config / fixed strings). */
export function renderBriefBoard(opts: BriefBoardOpts): string {
  return substituteName(BRIEF_BOARD_TEMPLATE, opts.name)
    .replaceAll('{{COMPONENT_NAME}}', opts.componentName)
    .replaceAll('{{DS_NAME}}', opts.dsName)
    .replaceAll('{{PLATFORM}}', opts.platform)
    .replaceAll('{{SEED_HINT}}', opts.seedHint)
    .replaceAll('{{HISTORY_DIR}}', opts.historyDir);
}

export interface BlankCanvasOpts {
  name: string;
  componentName: string;
  dsName: string;
  platform: string;
  historyDir: string;
}

/** Substitute the blank-canvas template placeholders (same trust story as `renderBriefBoard`). */
export function renderBlankCanvas(opts: BlankCanvasOpts): string {
  return substituteName(BLANK_TEMPLATE, opts.name)
    .replaceAll('{{COMPONENT_NAME}}', opts.componentName)
    .replaceAll('{{DS_NAME}}', opts.dsName)
    .replaceAll('{{PLATFORM}}', opts.platform)
    .replaceAll('{{HISTORY_DIR}}', opts.historyDir);
}

// ── C4 naming (Gate 0 C4, CONTRACT §3 "Untitled canvas") ─────────────────────────────────────
// One rule for ⌘N, Home and offline create, run on the server so every surface agrees.

/** The name a new canvas gets when nothing says otherwise (CONTRACT §3). */
export const UNTITLED_CANVAS = 'Untitled canvas';
/** The name a new project gets when nothing says otherwise. */
export const UNTITLED_PROJECT = 'Untitled project';

/**
 * "Untitled canvas", then "Untitled canvas 2", "… 3": the first `base` (or `base N`) that is not
 * taken. `isTaken` answers for the target folder; a canvas in the trash is not there, so it does
 * not hold its name. Bounded, so a broken `isTaken` cannot spin forever.
 */
export function nextFreeCanvasName(base: string, isTaken: (name: string) => boolean): string {
  const root = base.trim() || UNTITLED_CANVAS;
  if (!isTaken(root)) return root;
  for (let n = 2; n < 10_000; n += 1) {
    const candidate = `${root} ${n}`;
    if (!isTaken(candidate)) return candidate;
  }
  return `${root} ${Date.now()}`;
}

/** Artifact nouns (EN + CZ). A match names the canvas; `re` runs on the lower-cased prompt. The
 *  earliest match in the sentence wins, and on a tie the earlier (more specific) row does. */
const ARTIFACT_NOUNS: Array<[RegExp, string]> = [
  [/\blanding[- ]?pages?\b|\bpřistávací stránk/u, 'Landing page'],
  [/\bpricing pages?\b|\bceník/u, 'Pricing page'],
  [/\blogo (?:ideas|concepts|options)\b/u, 'Logo ideas'],
  [/\blogos?\b|\blogem\b/u, 'Logo'],
  [/\breel covers?\b/u, 'Reel covers'],
  [/\bbusiness cards?\b|\bvizitk/u, 'Business card'],
  [/\bpitch decks?\b/u, 'Pitch deck'],
  [/\binstagram stor(?:y|ies)\b|\bstory\b|\bstories\b/u, 'Story'],
  [/\bnewsletters?\b/u, 'Newsletter'],
  [/\bonboarding\b/u, 'Onboarding'],
  [/\bdashboards?\b/u, 'Dashboard'],
  [/\bpresentations?\b|\bslides?\b|\bprezentac/u, 'Presentation'],
  [/\bbrochures?\b|\bleaflets?\b|\bflyers?\b|\bleták|\bletáky\b|\bbrožur/u, 'Flyer'],
  [/\bposters?\b|\bplakát/u, 'Poster'],
  [/\bbanners?\b/u, 'Banner'],
  [/\bwebsites?\b|\bweb ?stránk|\bwebov/u, 'Website'],
  [/\bapp screens?\b|\baplikac/u, 'App screens'],
  [/\binvitations?\b|\bpozvánk/u, 'Invitation'],
  [/\bmenu\b|\bjídelní lístek\b/u, 'Menu'],
  [/\bicons?\b|\bikon/u, 'Icons'],
  [/\bthumbnails?\b|\bnáhled/u, 'Thumbnail'],
  [/\bvideo\b|\bvidea\b/u, 'Video'],
];

/** A Czech prompt keeps its own word for the nouns that have a plain Czech form. */
const CZECH_NAMES: Array<[RegExp, string]> = [
  [/\bplakát/u, 'Plakát'],
  [/\bvizitk/u, 'Vizitka'],
  [/\bleták|\bletáky\b/u, 'Leták'],
  [/\bpozvánk/u, 'Pozvánka'],
  [/\bceník/u, 'Ceník'],
  [/\bprezentac/u, 'Prezentace'],
];

const CZECH_RE = /[ěščřžůťďň]|\b(?:na|pro|v|ve|se|do|že|jako|který)\b/iu;
const ENGLISH_RE = /\b(?:a|an|the|for|with|of|in|on|my|our|your)\b/iu;

// The "what it is for" part of a sentence, where it ends, and the words that do not belong to the name.
const FOR_RE = /\b(?:for|pro|na)\s+(.+)$/iu;
const CUT_RE = /\s+(?:on|in|at|with|by|from|that|which|to|and|but)\s+.*$|[,;:—–()!?.\n].*$/iu;
const LEAD_RE =
  /^(?:(?:a|an|the|my|our|your|his|her|their|some|small|little|tiny|big|new|local|nice|simple|one|two|three)\s+)+/iu;
// A project named "Saturday" or "a new brand" tells nobody anything — fall back instead.
const GENERIC_PROJECT = new Set([
  ...['brand', 'business', 'company', 'project', 'thing', 'client', 'idea', 'ideas', 'it', 'them'],
  ...['me', 'us', 'you', 'today', 'tomorrow', 'tonight', 'week', 'weekend', 'event', 'party'],
  ...['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'],
  ...['dnes', 'zítra', 'sobotu', 'neděli', 'pátek', 'čtvrtek', 'středu', 'úterý', 'pondělí'],
]);

const MAX_PROMPT_CHARS = 400;
const MAX_NAME_CHARS = 40;

function cleanName(raw: string): string {
  // Only letters, numbers, spaces and hyphens survive: the result is path- and JSX-safe by construction.
  let out = raw
    .normalize('NFC')
    .replace(/[^\p{L}\p{N} -]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[ -]+|[ -]+$/g, '');
  if (out.length > MAX_NAME_CHARS) {
    const cut = out.slice(0, MAX_NAME_CHARS);
    const sp = cut.lastIndexOf(' ');
    out = (sp > 12 ? cut.slice(0, sp) : cut).replace(/[ -]+$/g, '');
  }
  return out.charAt(0).toLocaleUpperCase() + out.slice(1);
}

function projectFrom(prompt: string, czech: boolean): string {
  const m = FOR_RE.exec(prompt);
  if (!m) return '';
  let rest = m[1].replace(CUT_RE, '').trim();
  if (czech) {
    // A Czech noun after "pro/na" is in an oblique case and cannot be turned back into its base form
    // without a dictionary. Keep only proper names (capitalised words), which stay as they are.
    rest = rest
      .split(/\s+/)
      .filter((w) => /^\p{Lu}/u.test(w))
      .join(' ');
  } else {
    rest = rest.replace(LEAD_RE, '');
  }
  const name = cleanName(rest);
  if (!name || GENERIC_PROJECT.has(name.toLocaleLowerCase())) return '';
  return name;
}

/**
 * C4: name a canvas (and the project it starts) from the first sentence, with no AI call.
 * `canvas` comes from a lexicon of artifact nouns (EN + CZ), `project` from what the sentence says
 * it is for. Either falls back to "Untitled canvas" / "Untitled project". The result only ever
 * holds the allowed set (A–Z, a–z, numbers, spaces and hyphens — accents folded off), at most 40 characters.
 */
export function nameFromPrompt(prompt: unknown): { canvas: string; project: string } {
  const text = typeof prompt === 'string' ? prompt.normalize('NFC').slice(0, MAX_PROMPT_CHARS) : '';
  const lower = text.toLocaleLowerCase();
  const czech = CZECH_RE.test(text) && !ENGLISH_RE.test(text);
  let canvas = '';
  let bestAt = Number.POSITIVE_INFINITY;
  for (const [re, name] of ARTIFACT_NOUNS) {
    const at = re.exec(lower)?.index;
    if (at !== undefined && at < bestAt) {
      bestAt = at;
      canvas = name;
    }
  }
  if (canvas && czech) {
    for (const [re, cz] of CZECH_NAMES) {
      if (re.test(lower)) {
        canvas = cz;
        break;
      }
    }
  }
  // S1.23c: the canvas name an app makes obeys the same allowed set as one a person types, so "Plakát"
  // becomes "Plakat" and the create endpoint never refuses what the app itself named. The project name
  // is not a canvas or folder name (no sync path component), so it keeps its accents.
  return {
    canvas: foldToAllowedName(canvas) || UNTITLED_CANVAS,
    project: projectFrom(text, czech) || UNTITLED_PROJECT,
  };
}
