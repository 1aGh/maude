// client/v2/ai/needs-you.js — S5.13: the pure models behind the inline cards (03 `ai-permission`,
// `ai-choice-fail`). No React, no DOM: the cards render these, the tests pin them.
//
//   permissionModel(request)  an ACP permission request -> what the card says and which option each button
//                             answers with. D4: a card appears exactly when Claude Code asks; "Always for this
//                             canvas" is the agent's own `allow_always` option, hidden when the agent did not
//                             offer one (and always for an out-of-project write — the server strips it too).
//   choiceModel(request)      an elicitation -> the simple choice card, or `null` (the v1 form takes over).
//   problemModel(error)       a turn error / `{t:'error', code}` frame -> What happened · what is safe · one verb.
//   needsYouLine(model)       the question the toast and the Canvases row quote.
//
// Words: CONTRACT §3–§4. The title verb IS the button verb ("Replace 4 photos" under "Replace 4 team photos?").

import { buildElicitationContent, parseElicitationSchema } from '../../panels/acp-elicitation.js';
import {
  describeOutOfProject,
  pickDefaultAllow,
  pickDefaultReject,
  sanitizePathForDisplay,
} from '../../panels/PermissionPrompt.jsx';

/** The verb a tool call is asking to do, by ACP ToolKind. Title and button share it. */
const VERB_BY_KIND = {
  edit: 'Edit',
  delete: 'Delete',
  move: 'Move',
  execute: 'Run',
  fetch: 'Fetch',
  read: 'Read',
  search: 'Search',
  switch_mode: 'Switch',
};

const KNOWN_KINDS = new Set(['allow_once', 'allow_always', 'reject_once', 'reject_always']);

function targetOf(toolCall) {
  const raw = toolCall?.rawInput;
  const fromInput =
    raw && typeof raw === 'object'
      ? raw.path || raw.file_path || raw.abs_path || raw.filePath
      : undefined;
  const fromLocation = Array.isArray(toolCall?.locations) ? toolCall.locations[0]?.path : undefined;
  const path = fromInput || fromLocation;
  return path ? sanitizePathForDisplay(String(path).split('/').pop()) : null;
}

/**
 * @param {{ id?: string, toolCall?: object, options?: object[], scope?: object|null }} request
 * @returns {{
 *   shape: 'simple' | 'options',
 *   outside: object|null,
 *   verb: string|null,         // the verb in the title and on the button (simple only)
 *   title: string,
 *   detail: string|null,       // what the agent called the call — never hidden behind the short title
 *   target: string|null,
 *   allow: object|null,        // the option the primary button answers with (unless "Always" is ticked)
 *   always: object|null,       // the agent's own allow_always option: null = no checkbox
 *   reject: object|null,       // "Not now"
 *   options: object[],         // every visible option (the `options` shape renders them all)
 * }}
 */
export function permissionModel(request) {
  const toolCall = request?.toolCall ?? {};
  const outside = describeOutOfProject(request?.scope);
  const all = Array.isArray(request?.options) ? request.options.filter(Boolean) : [];
  // Decision D is enforced server-side; this second pass only keeps a stale frame from painting a
  // button the server would refuse.
  const options = outside ? all.filter((o) => o.kind !== 'allow_always') : all;

  const once = options.filter((o) => o.kind === 'allow_once');
  const always = options.filter((o) => o.kind === 'allow_always');
  const rejects = options.filter((o) => o.kind === 'reject_once' || o.kind === 'reject_always');
  // The compact card only fits the plain shape: one "yes", at most one standing "yes", one "no". An
  // ExitPlanMode set (several allow_always, "No, keep planning") keeps every option as its own button.
  const simple =
    options.every((o) => KNOWN_KINDS.has(o.kind)) &&
    once.length === 1 &&
    always.length <= 1 &&
    rejects.length <= 1 &&
    toolCall.kind !== 'switch_mode';

  const target = outside
    ? outside.paths.length === 1
      ? sanitizePathForDisplay(String(outside.paths[0]).split('/').pop())
      : null
    : targetOf(toolCall);
  const raw = toolCall.title ? sanitizePathForDisplay(String(toolCall.title)) : null;

  let verb = null;
  let title;
  if (outside) {
    // Never echo the model's own title for a write the path gate refused (acp-write-scope): a fixed
    // headline plus the resolved basename; the body carries the full resolved path.
    verb = outside.inProjectDenied ? 'Write to a file that runs' : 'Write outside this project';
    title = `${verb}${target ? ` — ${target}` : ''}?`;
  } else if (simple) {
    // A new file is "Write", a change to an existing one "Edit": the adapter says which in its own title.
    verb =
      toolCall.kind === 'edit' && /^write\b/i.test(String(toolCall.title ?? ''))
        ? 'Write'
        : (VERB_BY_KIND[toolCall.kind] ?? 'Allow');
    title = target ? `${verb} ${target}?` : raw ? `${verb} — ${raw}?` : `${verb}?`;
  } else {
    title = raw ?? 'Claude needs your OK';
  }

  return {
    shape: simple ? 'simple' : 'options',
    outside,
    verb,
    title,
    detail: raw && raw !== target ? raw : null,
    target,
    allow: pickDefaultAllow(options),
    always: always[0] ?? null,
    reject: pickDefaultReject(options),
    options,
  };
}

/** The optionId a "yes" answers with: the standing option only when the person ticked the box. */
export function permissionAnswer(model, alwaysTicked) {
  if (alwaysTicked && model.always) return model.always.optionId;
  return model.allow?.optionId ?? null;
}

/** The optionId "Not now" / esc answers with — the agent's reject, else the protocol's `cancelled`. */
export function permissionDecline(model) {
  return model.reject?.optionId ?? 'cancelled';
}

/**
 * The simple choice card (03 `ai-choice-fail`, left): ONE single-select question with options.
 * Anything else — several questions, a multi-select, free text, a credential-shaped ask — returns
 * null and the v1 form (ElicitationPrompt, whose masking and wizard are security-reviewed) renders.
 */
export function choiceModel(request) {
  const questions = parseElicitationSchema(request?.requestedSchema);
  if (questions.length !== 1) return null;
  const q = questions[0];
  if (q.kind !== 'single' || q.secretShaped || q.options.length === 0) return null;
  const generic = 'Please answer the following questions.';
  const message = typeof request?.message === 'string' ? request.message.trim() : '';
  const question =
    q.description || (message && message !== generic ? message : null) || q.title || 'Which one?';
  return {
    question,
    questionId: q.id,
    options: q.options.map((o) => ({
      value: o.value,
      label: o.label,
      hint: o.description || null,
    })),
    otherFieldId: q.customFieldId,
    required: q.required,
    questions,
  };
}

/**
 * 03 `.ai-sw`: the colour an option names, for its 18 px disc. Only a literal hex in the label or hint
 * (`#2f9e44`) is a colour — nothing is guessed from a word, and nothing but a validated hex reaches a style.
 */
export function swatchOf(option) {
  const m = /#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/.exec(
    `${option?.label ?? ''} ${option?.hint ?? ''}`
  );
  return m ? m[0] : null;
}

/**
 * 03 `PERM_DETAIL`: the artboards a waiting permission is about, named. From the run's scope (the artboards it
 * was asked about) or, for a whole-canvas ask, what it has touched so far; never "all of them" — we do not
 * know. `boards` is the canvas index's list for the run's canvas. At most `max` come back, the rest as a count.
 */
export function willChangeFor(run, boards, max = 4) {
  const scope = run?.scope;
  if (!scope) return { boards: [], more: 0 };
  const touched =
    scope.canvas && Array.isArray(run.touched?.[scope.canvas]) ? run.touched[scope.canvas] : [];
  const ids = Array.isArray(scope.artboards) ? scope.artboards : touched;
  const uniq = [...new Set(ids.filter((id) => typeof id === 'string' && id))];
  const named = uniq.map((id) => ({
    id,
    label: (boards || []).find((b) => b.id === id)?.label || id,
  }));
  return { boards: named.slice(0, max), more: Math.max(0, named.length - max) };
}

/** The `accept` response for picking one of the card's options (or typing the "Something else…" answer). */
export function choiceAnswer(model, { value, custom }) {
  const answers = {};
  if (typeof custom === 'string' && custom.trim() && model.otherFieldId) {
    answers[model.otherFieldId] = custom;
  } else {
    answers[model.questionId] = value;
  }
  return { action: 'accept', content: buildElicitationContent(model.questions, answers) };
}

const READ_ONLY_WORDS =
  'This project is view only for you, so AI can’t change it. Ask the owner for edit access.';

/**
 * What happened · what is safe · one verb (CONTRACT §4) for a refusal the SERVER coded. `error` is what the
 * panel holds: `{ message, code? }` — `code` is the server's (`read-only`, `not-queued`).
 */
export function problemModel(error) {
  if (!error) return null;
  const message = typeof error.message === 'string' ? error.message.trim() : '';
  if (error.code === 'read-only') {
    // Words come from the server so they cannot drift; nothing was sent, so nothing changed. No verb:
    // the way back is the owner's, and a button that cannot work would be a lie.
    return { code: 'read-only', title: message || READ_ONLY_WORDS, detail: null, verb: null };
  }
  if (error.code === 'not-queued') {
    return {
      code: 'not-queued',
      title: message || 'This prompt could not be kept. Try again.',
      detail: 'Your text is still in the box.',
      verb: null,
    };
  }
  if (error.code === 'bad-scope') {
    // S5.17 G1 — the server refused a scope outside the design root before anything ran
    return {
      code: 'bad-scope',
      title:
        message || 'That selection is not on a canvas in this project. Choose it again and resend.',
      detail: null,
      verb: null,
    };
  }
  // An uncoded error is the v1 connection-problem card (Feed.jsx ErrorCard, `chat-error-card`): it keeps its place.
  return null;
}

/**
 * S5.17b G7 — the failure card (03 `ai-choice-fail`, right): "Couldn't finish — <what>. <what is safe>." and
 * ONE verb. What is safe depends on the run: "Nothing changed." only when the run touched nothing; when it
 * did, the chat's own Undo is the way back; when we cannot tell (no run frame seen), nothing is promised.
 * `changed` is `changedSomething(run)` (run-model.js), or null/undefined when there is no run to ask.
 * The raw message is for › Advanced, never the headline.
 */
export function failureModel(error, { changed } = {}) {
  if (!error) return null;
  const raw = typeof error.message === 'string' ? error.message.trim() : '';
  let safe = '';
  if (changed === true) safe = ' Undo this chat takes back what it did.';
  else if (changed === false) safe = ' Nothing changed.';
  return {
    title: `Couldn't finish — the connection to Claude was interrupted.${safe}`,
    verb: 'Try again',
    raw: raw || null,
  };
}

/** The question a Needs-you toast / row quotes: "replace 4 team photos?" — lower-cased verb, no trailing "?". */
export function needsYouLine(model) {
  return model.title.replace(/\?$/, '');
}
