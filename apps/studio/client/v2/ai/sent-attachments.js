// client/v2/ai/sent-attachments.js — P8 c10 (03 `ai-long`, `YouWith` / `Sent`): what an ask was SENT with, drawn above
// its bubble — photos as thumbnails, footage / PDFs / folders as small cards. Two sources, one shape:
//   · live   — the chips that rode with the send (`sentFromChips`, recorded by the adapter under the ask's message id)
//   · reload — the chips the transcript's attachments block names (acp/transcript.ts)
// Both are `{ kind, name, meta, path }`; `sentFromTranscript` turns them into what is drawn, `{ kind, name, meta, src? }`
// (`src` only for a photo whose file this panel can serve).

import { useSyncExternalStore } from 'react';
import { chipMeta } from './attach.js';

const RASTER = /\.(?:png|jpe?g|gif|webp)$/i;
const CHAT_ATTACHMENT = /(?:^|\/)_chat\/attachments\/([0-9a-f]{8}\.(?:png|jpe?g|gif|webp))$/;

/**
 * The URL that serves a sent photo, or null: a chat attachment through its own route, a raster file under the
 * design root through the static lane (never a `..` segment, never an encoded one). Anything else shows a card.
 */
export function sentImageSrc(path, designRel = '.design') {
  const p = String(path || '');
  const att = CHAT_ATTACHMENT.exec(p);
  if (att) return `/_api/acp/attachment?name=${encodeURIComponent(att[1])}`;
  const rel = String(designRel || '.design').replace(/^\/+|\/+$/g, '');
  if (!rel || !RASTER.test(p) || /%|(?:^|\/)\.\.(?:\/|$)/.test(p)) return null;
  const at = p.lastIndexOf(`/${rel}/`);
  return at >= 0 ? p.slice(at) : null;
}

const strip = (o) => {
  const out = { kind: o.kind, name: o.name, meta: o.meta || '' };
  if (o.src) out.src = o.src;
  return out;
};

/** The transcript's chips (`attachments` of a reloaded ask) → sent chips. */
export function sentFromTranscript(list, designRel = '.design') {
  return (Array.isArray(list) ? list : []).map((a) =>
    strip({
      kind: a.kind,
      name: a.name,
      meta: a.meta,
      src: a.kind === 'image' ? sentImageSrc(a.path, designRel) : null,
    })
  );
}

/** The chips that rode with a send (`ready` only — a folder still waiting did not go), in the transcript's shape. */
export function sentFromChips(chips) {
  return (Array.isArray(chips) ? chips : [])
    .filter((c) => c && c.state === 'ready' && typeof c.path === 'string' && c.path)
    .map((c) => ({ kind: c.kind, name: c.name, meta: chipMeta(c), path: c.path }));
}

// ── the live record: message id → sent chips ─────────────────────────────────────────────────────────

const byMessage = new Map();
const listeners = new Set();

/** The adapter calls this when a send goes out, under the ask's message id. */
export function recordSent(messageId, sent) {
  if (!messageId || !sent?.length) return;
  byMessage.set(messageId, sent);
  for (const fn of listeners) fn();
}

const subscribe = (fn) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

/** The chips recorded for this message id this session (stable reference), or null. */
export function useRecordedSent(messageId) {
  return useSyncExternalStore(
    subscribe,
    () => byMessage.get(messageId) ?? null,
    () => null
  );
}
