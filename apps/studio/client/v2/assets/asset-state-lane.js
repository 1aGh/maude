// client/v2/assets/asset-state-lane.js — S8.19: the shell tells each open canvas which of its pictures
// are here, still uploading from here, waiting for someone's Mac, or missing (contract
// S8-S9-asset-presence §5.5). Parent → iframe only (`asset-state`); the canvas draws the placeholder
// frame (asset-placeholder.tsx) and never asks a route itself.
//
// The rels are the ones the canvas FILE names: the studio reads them (`GET /_api/asset-state?canvas=`),
// so a canvas can never make the shell look up a path it does not reference.
//
// When: on canvas open (`loaded` / `canvas-rendered`), every 60 s while anything waits, at reconnect,
// and after a sweep ends. A refusal (a cell's studio, an older studio, offline) is the quiet state:
// nothing is said, and a frame that had news is told it has none — never Missing.
//
// Relink…: a Missing frame's button posts `asset-relink-request {rel}`; only the ACTIVE canvas is
// heard (origin + source gate). The canvas's string is only ever MATCHED against this lane's own
// answer for that canvas (S8.19c): a rel the studio did not say is missing is dropped, so a canvas
// cannot make the shell open a relink for a path of its choosing. `onRelink` gets the studio's rel.
//
// 2.0.3 — a Git LFS placeholder (`lfs-pointer`: the file is here, but it is a pointer, the project was
// cloned without `git lfs pull`). Where the AI chat exists (`lfsActions`, the desktop app) the frame
// offers "Fix with AI" (`asset-lfs-fix-request`) and "Copy prompt" (`asset-lfs-copy-request`). Same
// gate as Relink: the active canvas only, and only a rel this lane's own answer calls `lfs-pointer`.
// The prompt is built HERE from that answer (`lfsRepairPrompt`), never from canvas text. Fix with AI
// pre-fills the AI chat (the error card's "Ask AI" path, never sent); Copy prompt writes the clipboard
// here (the canvas iframe has no clipboard rights) and answers the frame `asset-lfs-copied {rel, ok}`
// so its button can say "Copied".

import { useEffect, useRef, useSyncExternalStore } from 'react';
import { acceptFromCanvas } from '../../../bridge/dgn-protocol.ts';
import { INDEX_CHANGED_EVENT } from '../canvases/use-canvas-index.js';
import { nativeSave } from '../export/native-save.js';
import { dispatchCanvasOp } from '../left-panel/left-panel-bus.js';
import { ASK_AI_MAX } from '../search/search-env.js';

/** canvas file → (rel → item): what the studio last said about each canvas. The relink gate and the
 *  Inspector's absent-picture box read it; nothing else does. */
const answers = new Map();
const subs = new Set();
let answersVersion = 0;
const NONE = new Map();

function setAnswer(canvas, items) {
  const next = new Map();
  for (const it of items) if (it && typeof it.rel === 'string') next.set(it.rel, it);
  const prev = answers.get(canvas);
  if (prev && JSON.stringify([...prev]) === JSON.stringify([...next])) return;
  if (next.size) answers.set(canvas, next);
  else answers.delete(canvas);
  answersVersion += 1;
  for (const fn of subs) fn();
}

/** The studio's last answer for a canvas: rel → item. Empty when nothing is known. */
export const assetItemsFor = (canvas) => answers.get(canvas) ?? NONE;
export const assetAnswersVersion = () => answersVersion;
export function subscribeAssetAnswers(fn) {
  subs.add(fn);
  return () => subs.delete(fn);
}
/** Tests only. */
export function clearAssetAnswers() {
  answers.clear();
  answersVersion += 1;
  for (const fn of subs) fn();
}

/** The studio's item for an element's `src` (`/assets/x.png`, `./assets/x.png?v=2`), or null. */
export function assetItemForSrc(canvas, src) {
  if (typeof src !== 'string' || !src) return null;
  let s = src.replace(/[?#].*$/, '');
  while (s.startsWith('./')) s = s.slice(2);
  s = s.replace(/^\/+/, '');
  return assetItemsFor(canvas).get(s) ?? null;
}

/**
 * S8.14 — the upload state of a project file (`assets/x.jpg`) as ANY open canvas was last told: `{ progress? }` while this
 * Mac still owes the hub its bytes, else null. The Assets tab draws the thin bar on a tile from it; nothing else reads it.
 */
export function assetUploadOf(rel) {
  for (const items of answers.values()) {
    const it = items.get(rel);
    if (it && it.state === 'uploading')
      return { progress: typeof it.progress === 'number' ? it.progress : undefined };
  }
  return null;
}

/** Re-render when the studio's answers change (the tile bars). Returns the version, which only means "something moved". */
export function useAssetAnswers() {
  return useSyncExternalStore(subscribeAssetAnswers, assetAnswersVersion, assetAnswersVersion);
}

/** The prompt lists at most this many paths, then "and N more". */
export const LFS_PROMPT_MAX_PATHS = 50;
const LFS_SPEC = 'version https://git-lfs.github.com/spec/v1';

/** `2026-11-04` in local time (the backup folder's name). */
function dayStamp(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * The repair prompt for a canvas's Git LFS placeholders. Built from the STUDIO's answer only: `items`
 * are this lane's own items for the canvas; anything not `lfs-pointer` is ignored. Pure.
 *
 * It fits `maxChars` (default ASK_AI_MAX): Fix with AI pre-fills the chat through `sendToAskAI`, which
 * keeps only that many chars, so a long path list would push the steps off the end. Paths are listed
 * while they fit (at most LFS_PROMPT_MAX_PATHS); the rest are "…and N more", with how to find them.
 *
 * The restore goes through `git lfs` only (2.0.3 e2e): the design plugin's Bash guard refuses a `cp`
 * into the design root and Write cannot put binary bytes back, so a prompt that said "copy the object
 * over the placeholder" stopped after the backup. `git lfs checkout` restores a local object offline.
 *
 * @param {{ items: Iterable<any>, designRel?: string, date?: Date, maxChars?: number }} o
 */
export function lfsRepairPrompt({
  items,
  designRel = '.design',
  date = new Date(),
  maxChars = ASK_AI_MAX,
}) {
  const root = String(designRel || '')
    .replace(/^\/+|\/+$/g, '')
    .replace(/^\.\/?$/, '');
  const inRoot = (rel) => (root ? `${root}/${rel}` : rel);
  const ptrs = [];
  for (const it of items) {
    // a path is shown in backticks: one with a backtick or a line break is not listed
    if (it?.state === 'lfs-pointer' && typeof it.rel === 'string' && !/[`\r\n]/.test(it.rel))
      ptrs.push(it);
  }
  const backup = inRoot(`_trash/lfs-pointers-${dayStamp(date)}`);
  const lineOf = (it) =>
    `- \`${inRoot(it.rel)}\`${it.localObject ? ' (its object is already in .git/lfs/objects)' : ''}`;
  const moreLine = (n) =>
    `- …and ${n} more. Find the rest: every file of at most 1 KB under \`${root || '.'}/\` whose first line is exactly \`${LFS_SPEC}\`.`;
  const head = [
    'Some pictures and videos in this project are Git LFS placeholders: small text files that stand where the real media should be (the project was cloned without `git lfs pull`). Please put the real files back.',
    '',
    'The placeholder files, from the project root:',
  ];
  const steps = [
    '',
    'Do this, step by step:',
    `1. Back up the placeholder files first. Copy each one, keeping its path, into \`${backup}/\` (for example \`${inRoot('assets/a.png')}\` goes to \`${backup}/assets/a.png\`). That folder is ignored by git and never syncs.`,
    '2. Restore them with Git LFS. Check it is installed with `git lfs version`; if it is not, say so (it installs with `brew install git-lfs`, then `git lfs install`) and stop. A file whose object is already in `.git/lfs/objects/<oid[0:2]>/<oid[2:4]>/<oid>` (the `oid sha256:<oid>` line of its pointer) comes back with `git lfs checkout <its path>`, with no network. For the ones left, run `git lfs pull --include "<their paths, comma-separated>"`; if that fails, say why. Do not copy or write the media files any other way.',
    '3. Check each restored file: its sha256 must equal the oid, and its size must equal the `size <n>` line of its pointer. If one does not match, write its placeholder text back from the backup and tell me which file.',
    '4. Do not commit anything, and do not change any other file.',
    '5. Leave the restored files where they are. Maude uploads them by itself; there is nothing else to do.',
  ];
  // +1 per line for the joining '\n'
  const len = (lines) => lines.reduce((n, l) => n + l.length + 1, -1);
  const fixed = len([...head, ...steps]) + 1;
  const lines = [];
  let used = fixed;
  for (const it of ptrs.slice(0, LFS_PROMPT_MAX_PATHS)) {
    const line = lineOf(it);
    const rest = ptrs.length - lines.length - 1;
    // room for this line, and for the "…and N more" line if any are left after it
    const need = line.length + 1 + (rest > 0 ? moreLine(rest).length + 1 : 0);
    if (used + need > maxChars) break;
    lines.push(line);
    used += line.length + 1;
  }
  const more = ptrs.length - lines.length;
  if (more > 0) lines.push(moreLine(more));
  return [...head, ...lines, ...steps].join('\n');
}

/**
 * Copy `text` from the shell; false when it was refused. The click was inside the canvas iframe, so the shell
 * has no user activation: `navigator.clipboard` is tried briefly, then the desktop's `clipboard_write_text`.
 */
async function shellCopyText(text) {
  try {
    return (await nativeSave().copyText(String(text))).ok === true;
  } catch {
    return false;
  }
}

const FRAME = 'iframe[data-testid="canvas-frame"]';
export const ASSET_STATE_POLL_MS = 60_000;
/** While something of this Mac's is still going up, ask again soon: the bar moves and goes away when the last byte lands. */
export const ASSET_UPLOAD_POLL_MS = 2_500;
const INDEX_REASK_MS = 800;

/** The canvas file a frame shows (`data-path`). */
const pathOf = (frame) => frame?.getAttribute?.('data-path') || frame?.dataset?.path || '';

/**
 * @param {object} deps
 * @param {typeof fetch} [deps.fetchImpl]
 * @param {() => Element[]} [deps.frames] — the canvas iframes (default: every `canvas-frame`)
 * @param {() => Window | null} [deps.activeWindow] — the active canvas window (relink gate)
 * @param {() => string} deps.canvasOrigin
 * @param {(rel: string, canvas: string) => void} [deps.onRelink]
 * @param {() => boolean} [deps.lfsActions] — this shell can repair an LFS placeholder (the AI chat exists)
 * @param {() => string} [deps.designRel] — the design root, project-relative (the prompt's paths)
 * @param {(prompt: string, canvas: string) => void} [deps.onLfsFix] — open the AI chat, pre-filled
 * @param {(text: string) => Promise<boolean>} [deps.copyText]
 * @param {() => Date} [deps.now]
 * @param {Window} [deps.win]
 * @param {(fn: () => void, ms: number) => unknown} [deps.setTimer]
 * @param {(t: unknown) => void} [deps.clearTimer]
 */
export function createAssetStateLane(deps) {
  const fetchImpl = deps.fetchImpl ?? globalThis.fetch?.bind(globalThis);
  const doc = globalThis.document;
  const frames = deps.frames ?? (() => [...(doc?.querySelectorAll?.(FRAME) ?? [])]);
  const win = deps.win ?? globalThis.window;
  const setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = deps.clearTimer ?? ((t) => clearTimeout(t));
  const lfsActions = () => deps.lfsActions?.() === true;
  const copyText = deps.copyText ?? shellCopyText;
  /** Window → the JSON last said to it; `waiting` → whether it needs the 60 s poll. */
  const spoken = new WeakMap();
  const waiting = new Set();
  const uploading = new Set();
  let timer = null;
  let stopped = false;

  async function ask(canvas) {
    let res;
    try {
      res = await fetchImpl(`/_api/asset-state?canvas=${encodeURIComponent(canvas)}`, {
        headers: { accept: 'application/json' },
      });
    } catch {
      return null;
    }
    if (!res?.ok) return null; // 503 (a cell), 404, 400 — the quiet state
    try {
      const body = await res.json();
      return Array.isArray(body?.items) ? body.items : null;
    } catch {
      return null;
    }
  }

  async function tell(frame, force = false) {
    const target = frame?.contentWindow;
    const canvas = pathOf(frame);
    if (!target || !canvas || stopped) return;
    const got = await ask(canvas);
    // Refused / unreadable: quiet. Never invent a Missing; a frame that had news hears "none".
    const items = got ?? [];
    setAnswer(canvas, items);
    if (items.some((it) => it?.state === 'waiting')) waiting.add(canvas);
    else waiting.delete(canvas);
    if (items.some((it) => it?.state === 'uploading')) uploading.add(canvas);
    else uploading.delete(canvas);
    arm();
    // The buttons are offered only where the AI chat exists, and only when there is a placeholder.
    const offer = lfsActions() && items.some((it) => it?.state === 'lfs-pointer');
    const json = JSON.stringify(offer ? [items, true] : items);
    const before = spoken.get(target);
    if (!force && before === json) return;
    if (before === undefined && items.length === 0) return;
    spoken.set(target, json);
    try {
      // A literal `{ dgn }` (not postToCanvas) so the bridge inventory sees this send site.
      target.postMessage(
        offer ? { dgn: 'asset-state', items, lfsActions: true } : { dgn: 'asset-state', items },
        deps.canvasOrigin() || '*'
      );
    } catch {
      /* detached */
    }
  }

  function arm() {
    if (stopped || timer !== null || (waiting.size === 0 && uploading.size === 0)) return;
    timer = setTimer(
      () => {
        timer = null;
        void refreshAll();
      },
      uploading.size > 0 ? ASSET_UPLOAD_POLL_MS : ASSET_STATE_POLL_MS
    );
  }

  async function refreshAll(force = false) {
    await Promise.all(frames().map((f) => tell(f, force)));
    arm();
  }

  const onMessage = (e) => {
    const dgn = e?.data?.dgn;
    if (dgn === 'loaded' || dgn === 'canvas-rendered') {
      const frame = frames().find((f) => f.contentWindow === e.source);
      if (frame) {
        spoken.delete(frame.contentWindow);
        void tell(frame, true);
      }
      return;
    }
    if (dgn === 'asset-lfs-fix-request' || dgn === 'asset-lfs-copy-request') {
      void onLfsRequest(e);
      return;
    }
    if (dgn !== 'asset-relink-request') return;
    const m = acceptFromCanvas(e, {
      canvasOrigin: deps.canvasOrigin(),
      active: deps.activeWindow?.() ?? null,
    });
    if (!m || m.dgn !== 'asset-relink-request') return;
    const frame = frames().find((f) => f.contentWindow === e.source);
    const canvas = pathOf(frame);
    // Only a picture the studio itself calls Missing opens a relink (a waiting one is relinked from
    // the Inspector's box, where the person chose it).
    const item = assetItemsFor(canvas).get(m.rel);
    if (item?.state === 'missing') deps.onRelink?.(item.rel, canvas);
  };
  // 2.0.3 — Fix with AI / Copy prompt. The canvas names a rel; everything else is this lane's.
  async function onLfsRequest(e) {
    if (!lfsActions()) return;
    const m = acceptFromCanvas(e, {
      canvasOrigin: deps.canvasOrigin(),
      active: deps.activeWindow?.() ?? null,
    });
    if (!m || (m.dgn !== 'asset-lfs-fix-request' && m.dgn !== 'asset-lfs-copy-request')) return;
    const frame = frames().find((f) => f.contentWindow === e.source);
    const canvas = pathOf(frame);
    const mine = assetItemsFor(canvas);
    const item = mine.get(m.rel);
    if (!canvas || item?.state !== 'lfs-pointer') return;
    const prompt = lfsRepairPrompt({
      items: mine.values(),
      designRel: deps.designRel?.() ?? '.design',
      date: deps.now?.() ?? new Date(),
    });
    if (m.dgn === 'asset-lfs-fix-request') {
      deps.onLfsFix?.(prompt, canvas);
      return;
    }
    const ok = await copyText(prompt);
    try {
      // A literal `{ dgn }` so the bridge inventory sees this send site.
      frame.contentWindow.postMessage(
        { dgn: 'asset-lfs-copied', rel: item.rel, ok: ok === true },
        deps.canvasOrigin() || '*'
      );
    } catch {
      /* detached */
    }
  }
  win?.addEventListener?.('message', onMessage);
  // S8.14 — photos just placed from Finder reach the canvas file before their bytes reach the hub: when the index moves (the
  // placement is one), ask again shortly, so the new pictures hear `uploading` and wear a bar. One quiet read per burst.
  let indexTimer = null;
  const onIndexChanged = (e) => {
    if (stopped || indexTimer !== null || e?.type !== INDEX_CHANGED_EVENT) return;
    indexTimer = setTimer(() => {
      indexTimer = null;
      void refreshAll();
    }, INDEX_REASK_MS);
  };
  win?.addEventListener?.(INDEX_CHANGED_EVENT, onIndexChanged);

  return {
    /** A canvas opened / the socket came back / a sweep ended: ask again for every open canvas. */
    refresh: () => refreshAll(true),
    /** Test seam: is the 60 s poll armed? */
    polling: () => timer !== null,
    stop() {
      stopped = true;
      if (timer !== null) clearTimer(timer);
      timer = null;
      win?.removeEventListener?.('message', onMessage);
      win?.removeEventListener?.(INDEX_CHANGED_EVENT, onIndexChanged);
      if (indexTimer !== null) clearTimer(indexTimer);
      indexTimer = null;
    },
  };
}

/** True once per edge: the socket came back, or a sweep that was running finished. */
export function assetStateTriggers(prev, next) {
  if (!prev) return false;
  if (!prev.wsConnected && next.wsConnected) return true;
  const was = prev.syncStatus;
  const now = next.syncStatus;
  if (was?.state && was.state !== 'online' && now?.state === 'online') return true;
  if (was?.assets && !was.assets.finished && now?.assets?.finished) return true;
  return false;
}

/**
 * Mount once in the shell. `syncStatus` / `wsConnected` are the app's live values; `onRelink` opens
 * the relink sheet for (rel, canvas). `askAiAvailable` is the shell's answer the canvas error card
 * uses (the desktop app's AI chat, not read-only): it alone turns on the LFS placeholder's buttons,
 * and "Fix with AI" goes the error card's way — `ask-ai-fix` opens the chat with the prompt, unsent.
 */
export function useAssetStateLane({
  syncStatus,
  wsConnected,
  canvasOrigin,
  activeWindow,
  onRelink,
  askAiAvailable = false,
  designRel = '.design',
}) {
  const lane = useRef(null);
  const live = useRef({ canvasOrigin, activeWindow, onRelink, askAiAvailable, designRel });
  live.current = { canvasOrigin, activeWindow, onRelink, askAiAvailable, designRel };
  useEffect(() => {
    lane.current = createAssetStateLane({
      canvasOrigin: () => live.current.canvasOrigin?.() ?? '',
      activeWindow: () => live.current.activeWindow?.() ?? null,
      onRelink: (rel, canvas) => live.current.onRelink?.(rel, canvas),
      lfsActions: () => live.current.askAiAvailable === true,
      designRel: () => live.current.designRel || '.design',
      onLfsFix: (prompt, canvas) => dispatchCanvasOp('ask-ai-fix', canvas, prompt),
    });
    return () => lane.current?.stop();
  }, []);
  // The answer can arrive after the first tell (config loads late): say it again with the buttons.
  const askedAi = useRef(askAiAvailable);
  useEffect(() => {
    if (askedAi.current === askAiAvailable) return;
    askedAi.current = askAiAvailable;
    void lane.current?.refresh();
  }, [askAiAvailable]);
  const prev = useRef(null);
  useEffect(() => {
    const next = { syncStatus, wsConnected };
    if (assetStateTriggers(prev.current, next)) void lane.current?.refresh();
    prev.current = next;
  }, [syncStatus, wsConnected]);
}
