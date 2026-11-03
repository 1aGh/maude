// client/v2/ai/activity-line.js — rc3-h (issue #182): the AI chat's ONE line that says what AI is doing right now.
//
// The chat already receives the agent's real stream (`{t:'update', update}` — tool calls with kind / locations /
// rawInput, the plan, thought and reply chunks). This module turns each event into a short present-tense line in
// product voice ("AI is reading Kanban", "AI is drawing Sprint board", "AI is thinking") and keeps the line calm:
//
//   · a new phrase waits until the last one has been up SWAP_MS (a burst shows only its newest, no flicker);
//   · after IDLE_MS with no event and nothing in flight the line falls back (`text: null` — the caller shows the
//     run's own headline, "AI is working");
//   · the polite live region hears a changed phrase at most once per ANNOUNCE_GAP_MS.
//
// What it never shows: a path, a command line, the model's prose. Names come from a file name or an artboard's
// `label` (a name, capped) — the canvas is untrusted (DDR-054), so nothing longer than a name leaves it. A plan
// step is shown only when it opens with a verb the `doing` table knows (decision v2-p8-c6-doing-from-ask); any
// other plan text becomes "AI is on step 2 of 5".
//
// Pure: no React, no DOM. use-activity-line.js feeds it from the connection and renders `view(now)`.

import { doingOf } from '../../../ai/run-doing.ts';

export const SWAP_MS = 1000;
export const IDLE_MS = 8000;
export const ANNOUNCE_GAP_MS = 10_000;
const NAME_MAX = 48;

/** One line of a name: control characters out, whitespace collapsed, capped at a word with an ellipsis. */
export function cleanName(s, max = NAME_MAX) {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping control characters is the point
  const t = String(s ?? '').replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮]/g, ' ');
  const one = t.replace(/\s+/g, ' ').trim();
  if (one.length <= max) return one;
  const cut = one.slice(0, max - 1);
  const sp = cut.lastIndexOf(' ');
  return `${(sp > max / 2 ? cut.slice(0, sp) : cut).trimEnd()}…`;
}

/** The design-root-relative path of `p` (absolute or repo-relative), or null when it is not under the root. */
export function designPath(p, designRel = '.design') {
  if (typeof p !== 'string' || !p) return null;
  const norm = p.replace(/\\/g, '/');
  const root = String(designRel || '.design').replace(/^\/+|\/+$/g, '');
  let rel = null;
  if (norm.startsWith(`${root}/`)) rel = norm.slice(root.length + 1);
  else {
    const at = norm.lastIndexOf(`/${root}/`);
    if (at >= 0) rel = norm.slice(at + root.length + 2);
  }
  if (!rel || rel.split('/').some((seg) => seg === '..' || seg === '')) return null;
  return rel;
}

/** "ui/Kanban board.tsx" → "Kanban board". */
export function canvasName(rel) {
  const base =
    String(rel ?? '')
      .split('/')
      .pop() ?? '';
  return cleanName(
    base.replace(/\.(?:tsx|jsx|ts|js|html|svg|meta\.json|annotations\.json|css)$/i, '')
  );
}

/** The `<DCArtboard>` tags in a piece of canvas source: `{ id, label }` per tag, in order. */
export function artboardsIn(text) {
  const out = [];
  if (typeof text !== 'string' || !text) return out;
  const re = /<DCArtboard\b([^>]*)>/g;
  for (let m = re.exec(text); m && out.length < 50; m = re.exec(text)) {
    const attrs = m[1];
    const id = attrs.match(/\bid=(["'])([^"']{1,128})\1/)?.[2];
    if (!id) continue;
    const label = attrs.match(/\blabel=(["'])([^"']{0,200})\1/)?.[2] ?? '';
    out.push({ id, label });
  }
  return out;
}

const humanize = (id) =>
  cleanName(
    String(id)
      .replace(/[-_]+/g, ' ')
      .replace(/^\w/, (c) => c.toUpperCase())
  );

/** `maude design <verb>` → the verb's plain words. Not a maude verb → null. */
const VERB_WORDS = {
  screenshot: 'AI is checking how it looks',
  'visual-sanity': 'AI is checking how it looks',
  smoke: 'AI is checking the canvases',
  'canvas-rects': 'AI is measuring the canvas',
  'canvas-errors': 'AI is checking the canvas for errors',
  'canvas-source': 'AI is reading the canvas',
  'read-annotations': 'AI is reading the notes',
  annotate: 'AI is adding notes',
  'canvas-edit': 'AI is editing the canvas',
  place: 'AI is placing it on the canvas',
  'layout-check': 'AI is checking the layout',
  'draw-build': 'AI is drawing a vector',
  'draw-proof': 'AI is checking the drawing',
  'svg-optimize': 'AI is tidying the drawing',
  'ds-check': 'AI is checking the design system',
  'import-tokens': 'AI is bringing in the design tokens',
  'import-asset': 'AI is bringing in a file',
  'import-figma': 'AI is bringing in the Figma file',
  'import-brand': 'AI is bringing in the brand',
  'fetch-asset': 'AI is fetching an image',
  generate: 'AI is generating media',
  export: 'AI is exporting',
  handoff: 'AI is preparing the handoff',
  'photo-adjust': 'AI is adjusting the photo',
  'photo-bg-remove': 'AI is removing the background',
  captions: 'AI is writing captions',
  transcribe: 'AI is listening to the audio',
  'transcribe-local': 'AI is listening to the audio',
  beats: 'AI is finding the beats',
  'cut-words': 'AI is cutting the video',
  'cut-to-beat': 'AI is cutting the video',
  'reel-place': 'AI is placing the clips',
  'probe-footage': 'AI is looking at the footage',
  'ingest-footage': 'AI is looking at the footage',
  'smart-frames': 'AI is looking at the footage',
  'audio-search': 'AI is looking for music',
  'to-lottie': 'AI is exporting the animation',
  prep: 'AI is getting ready',
  'bootstrap-check': 'AI is getting ready',
  'server-up': 'AI is getting ready',
  'runtime-health': 'AI is getting ready',
  'ensure-browser': 'AI is getting ready',
  open: 'AI is opening a canvas',
  index: 'AI is looking through the canvases',
  status: 'AI is looking through the canvases',
  assets: 'AI is looking through the assets',
  logs: 'AI is reading the logs',
  check: 'AI is checking the project',
};

export function verbWords(command) {
  if (typeof command !== 'string') return null;
  const m = command.match(/(?:^|[\s;&|(])maude\s+design\s+([a-z][a-z-]{0,40})/);
  if (!m) return null;
  return VERB_WORDS[m[1]] ?? 'AI is working on the canvas';
}

const isSubagent = (u) => {
  const n = u?._meta?.claudeCode?.toolName;
  return n === 'Task' || n === 'Agent';
};

function pathOf(u) {
  const raw = u?.rawInput && typeof u.rawInput === 'object' ? u.rawInput : null;
  for (const c of [raw?.file_path, raw?.abs_path, raw?.path, raw?.notebook_path])
    if (typeof c === 'string' && c) return c;
  const loc = Array.isArray(u?.locations)
    ? u.locations.find((l) => typeof l?.path === 'string')
    : null;
  return loc?.path ?? null;
}

const SOURCE_RE = /\.(?:tsx|jsx)$/i;

function readPhrase(u, ctx) {
  const rel = designPath(pathOf(u), ctx.designRel);
  if (!rel) return pathOf(u) ? 'AI is reading the project files' : 'AI is reading';
  if (rel.startsWith('system/')) return 'AI is reading the design system';
  if (SOURCE_RE.test(rel) || /\.(?:meta|annotations)\.json$/i.test(rel))
    return `AI is reading ${canvasName(rel)}`;
  return 'AI is reading the project';
}

function editPhrase(u, ctx) {
  const rel = designPath(pathOf(u), ctx.designRel);
  if (!rel) return { text: pathOf(u) ? 'AI is editing a project file' : 'AI is editing' };
  if (rel.startsWith('system/')) return { text: 'AI is updating the design system' };
  const name = canvasName(rel);
  if (/\.meta\.json$/i.test(rel)) return { text: `AI is arranging ${name}` };
  if (/\.css$/i.test(rel)) return { text: `AI is styling ${name}` };
  if (!SOURCE_RE.test(rel)) return { text: 'AI is editing the project' };
  const file = `${String(ctx.designRel || '.design').replace(/\/+$/, '')}/${rel}`;
  const raw = u?.rawInput && typeof u.rawInput === 'object' ? u.rawInput : {};
  const next = typeof raw.content === 'string' ? raw.content : (raw.new_string ?? '');
  const prev = typeof raw.old_string === 'string' ? raw.old_string : '';
  const known = new Map(
    (ctx.labelsFor?.(file) ?? []).filter((b) => b?.id).map((b) => [b.id, b.label])
  );
  const before = new Set(artboardsIn(prev).map((a) => a.id));
  const inNext = artboardsIn(next);
  const added = inNext.filter((a) => !before.has(a.id) && !known.has(a.id));
  if (added.length === 1) {
    const label = cleanName(added[0].label) || humanize(added[0].id);
    return {
      text: `AI is drawing ${label}`,
      target: { file, artboard: added[0].id, label, adding: true },
    };
  }
  if (added.length > 1) return { text: `AI is drawing ${added.length} artboards` };
  const touched = [...artboardsIn(prev), ...inNext].find((a) => known.has(a.id));
  if (touched) {
    const label = cleanName(known.get(touched.id) || touched.label) || humanize(touched.id);
    return { text: `AI is editing ${label}`, target: { file, artboard: touched.id, label } };
  }
  const ids = new Set(String(next).match(/data-cd-id=["'][^"']{1,128}["']/g) ?? []);
  if (ids.size >= 2) return { text: `AI is editing ${ids.size} elements` };
  return { text: `AI is editing ${name}` };
}

function planPhrase(u) {
  const entries = Array.isArray(u?.entries)
    ? u.entries.filter((e) => e && typeof e === 'object')
    : [];
  if (!entries.length) return null;
  let i = entries.findIndex((e) => e.status === 'in_progress');
  if (i < 0) i = entries.findIndex((e) => e.status !== 'completed');
  if (i < 0) return null;
  const step = `Step ${i + 1} of ${entries.length}`;
  const doing = doingOf(typeof entries[i].content === 'string' ? entries[i].content : '');
  return { text: doing ? `AI is ${doing}` : `AI is on step ${i + 1} of ${entries.length}`, step };
}

/**
 * One ACP `session/update` → `{ text, target?, step? }`, or null when it says nothing new (bookkeeping, a
 * completion). `ctx = { designRel, labelsFor(repoRelFile) → [{id,label}] }`.
 */
export function phraseFor(u, ctx = {}) {
  if (!u || typeof u !== 'object') return null;
  switch (u.sessionUpdate) {
    case 'agent_thought_chunk':
      return { text: 'AI is thinking' };
    case 'agent_message_chunk':
      return u.content?.type === 'text' && u.content.text ? { text: 'AI is replying' } : null;
    case 'plan':
      return planPhrase(u);
    case 'tool_call':
      break;
    case 'tool_call_update':
      // a pending call's details can arrive on its first update; a completion says nothing new
      if (u.status === 'completed' || u.status === 'failed' || !u.kind) return null;
      break;
    default:
      return null;
  }
  if (isSubagent(u)) return { text: 'AI is asking a helper' };
  switch (u.kind) {
    case 'read':
      return { text: readPhrase(u, ctx) };
    case 'edit':
      return editPhrase(u, ctx);
    case 'search':
      return { text: 'AI is searching the project' };
    case 'execute':
      return { text: verbWords(u.rawInput?.command) ?? 'AI is running a step' };
    case 'fetch':
      return { text: 'AI is reading the web' };
    case 'think':
      return { text: 'AI is thinking' };
    case 'delete':
      return { text: 'AI is removing a file' };
    case 'move':
      return { text: 'AI is moving a file' };
    default:
      return null;
  }
}

/**
 * The line over time. `feed(update, now, ctx)` takes each event; `view(now)` is what to draw:
 * `{ text: string|null, step: string|null, target, announce: {id, text}|null }` (`text: null` = fall back to the
 * run's headline). `nextAt(now)` is when the view next changes by itself (a waiting swap, the idle fallback, an
 * announcement), or null.
 */
export function createActivityLine({
  swapMs = SWAP_MS,
  idleMs = IDLE_MS,
  announceGapMs = ANNOUNCE_GAP_MS,
} = {}) {
  let shown = null; // { text, step, target, at }
  let pending = null; // { text, step, target }
  let lastEventAt = null;
  let step = null;
  const open = new Map(); // toolCallId → target|null
  let announced = null; // { id, text, at }
  let seq = 0;

  const reset = () => {
    shown = null;
    pending = null;
    lastEventAt = null;
    step = null;
    open.clear();
    announced = null;
  };

  function feed(u, now, ctx = {}) {
    if (!u || typeof u !== 'object') return;
    lastEventAt = now;
    if (
      u.sessionUpdate === 'tool_call_update' &&
      (u.status === 'completed' || u.status === 'failed')
    ) {
      open.delete(u.toolCallId);
      // its target lets go now: the write landed (or did not)
      if (shown?.target && !hasTarget(shown.target)) shown = { ...shown, target: null };
      if (pending?.target && !hasTarget(pending.target)) pending = { ...pending, target: null };
      return;
    }
    const p = phraseFor(u, ctx);
    if (u.sessionUpdate === 'tool_call' && u.toolCallId) open.set(u.toolCallId, p?.target ?? null);
    if (!p) return;
    if (p.step) step = p.step;
    const next = { text: p.text, step: p.step ?? null, target: p.target ?? null };
    if (!shown) shown = { ...next, at: now };
    else if (shown.text === next.text && !pending) shown = { ...shown, target: next.target };
    else pending = next;
  }

  function hasTarget(t) {
    for (const v of open.values())
      if (v && v.file === t.file && v.artboard === t.artboard) return true;
    return false;
  }

  function settle(now) {
    if (pending && (!shown || now - shown.at >= swapMs)) {
      shown = { ...pending, at: now };
      pending = null;
    }
    const quiet = !open.size && !pending && lastEventAt !== null && now - lastEventAt >= idleMs;
    if (quiet && shown && shown.text !== null)
      shown = { text: null, step: null, target: null, at: now };
  }

  function view(now) {
    settle(now);
    const text = shown?.text ?? null;
    if (text && text !== announced?.text && (!announced || now - announced.at >= announceGapMs)) {
      seq += 1;
      announced = { id: seq, text, at: now };
    }
    return {
      text,
      step: text ? step : null,
      target: shown?.target ?? null,
      announce: announced ? { id: announced.id, text: announced.text } : null,
    };
  }

  function nextAt(now) {
    const at = [];
    if (pending && shown) at.push(shown.at + swapMs);
    if (!open.size && lastEventAt !== null && shown?.text) at.push(lastEventAt + idleMs);
    if (shown?.text && announced && shown.text !== announced.text)
      at.push(announced.at + announceGapMs);
    const future = at.filter((t) => t >= now);
    return future.length ? Math.min(...future) : null;
  }

  return { feed, view, nextAt, reset };
}

/**
 * What the working line draws: the live phrase (or the run's headline when there is none), and under it the
 * plan step, else the person's own ask when the line has moved on from it ("Drawing a calm landing page"), and how
 * many helpers run. `headline` is run-model's `workingText(run)`.
 */
export function workingLineParts({ headline, activity, subagents = 0 }) {
  const head = headline || 'AI is working';
  const text = activity?.text || head;
  const ask =
    activity?.text && head !== 'AI is working' && head !== text
      ? head.replace(/^AI is\s+/i, '').replace(/^\w/, (c) => c.toUpperCase())
      : '';
  const helpers =
    subagents > 0 ? `${subagents} ${subagents === 1 ? 'helper' : 'helpers'} working` : '';
  const step = [activity?.step || ask, helpers].filter(Boolean).join(' · ');
  return { text, step };
}

/**
 * The ring the canvas wears for an in-flight edit that names one of its artboards (`ai-runs` shape), before the
 * write lands and the run's own lease ring arrives. An artboard still being ADDED has nothing to ring yet (the
 * canvas marks it itself when it lands). `file` is the frame's repo-relative path.
 */
export function targetRings(target, file) {
  if (!target || target.adding || !file || target.file !== file) return {};
  const id = typeof target.artboard === 'string' ? target.artboard : '';
  if (!id || id.length > 128) return {};
  const label = cleanName(target.label || id);
  return {
    [id]: { state: 'running', who: 'you', tag: `AI is editing ${label}`.slice(0, 120), waiting: 0 },
  };
}
