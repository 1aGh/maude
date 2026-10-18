// client/v2/inspector/css-text.js — S11.8: "Edit as text" under Inspector › Advanced › CSS.
//
// The element's inline declarations as `prop: value;` lines, edited as one block. Applying it is the same
// per-property write the raw editor makes (/_api/edit-css, or `reset: true` for a line taken away), so
// undo is the same N entries and a peer sees the same edits. Nothing here writes a second way.

import { trackRecordableWrite } from '../../inspector/css-knobs.jsx';
import { cssTextOf } from './model.js';

const PROP_RE = /^(?:--[\w-]+|[a-z][a-z0-9-]*)$/i;

/** The editable text for an element: what Copy CSS copies. */
export const cssTextFor = cssTextOf;

/**
 * Split a block into declarations. A `;` or a line break ends one, except inside parentheses or quotes
 * (a `url(data:…;base64,…)` stays whole). `bad` lists the 1-based lines that are not `property: value`.
 * Canvas-only `data-cd-*` names are never part of the text, so they never come back out of it.
 * @returns {{ decls: Array<[string, string]>, bad: number[] }}
 */
export function parseCssText(text) {
  const decls = [];
  const bad = [];
  let depth = 0;
  let quote = '';
  let cur = '';
  let line = 1;
  let startLine = 1;
  const flush = () => {
    const stmt = cur.trim();
    cur = '';
    if (!stmt) return;
    const at = stmt.indexOf(':');
    const prop = at > 0 ? stmt.slice(0, at).trim() : '';
    const value = at > 0 ? stmt.slice(at + 1).trim() : '';
    if (!PROP_RE.test(prop) || !value) {
      bad.push(startLine);
      return;
    }
    if (prop.toLowerCase().startsWith('data-cd-')) return;
    decls.push([prop.startsWith('--') ? prop : prop.toLowerCase(), value]);
  };
  for (const ch of String(text ?? '')) {
    if (!cur.trim()) startLine = line;
    if (quote) {
      cur += ch;
      if (ch === quote) quote = '';
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      cur += ch;
    } else if (ch === '(') {
      depth++;
      cur += ch;
    } else if (ch === ')') {
      depth = Math.max(0, depth - 1);
      cur += ch;
    } else if (ch === ';' && depth === 0) {
      flush();
    } else if (ch === '\n' && depth === 0) {
      flush();
    } else {
      cur += ch;
    }
    if (ch === '\n') line++;
  }
  flush();
  return { decls, bad };
}

/** The declarations the element has now, as one map (authored, then custom). */
export function currentDecls(el) {
  const out = {};
  for (const map of [el?.authored, el?.customStyles])
    for (const [k, v] of Object.entries(map || {})) if (!k.startsWith('data-cd-')) out[k] = v;
  return out;
}

/**
 * What applying `text` changes: `{ prop: value }` for a new or changed line, `{ prop: null }` for one taken away.
 * @returns {{ patch: Record<string, string | null>, bad: number[] }}
 */
export function patchFromText(el, text) {
  const { decls, bad } = parseCssText(text);
  const next = new Map(decls);
  const now = currentDecls(el);
  const patch = {};
  for (const [k, v] of next) if ((now[k] ?? '').trim() !== v) patch[k] = v;
  for (const k of Object.keys(now)) if (!next.has(k)) patch[k] = null;
  return { patch, bad };
}

let chain = Promise.resolve();

async function post(url, payload) {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const j = await res.json().catch(() => ({}));
    return res.ok && j?.ok ? j : null;
  } catch {
    return null;
  }
}

/**
 * Write a patch one property at a time, in order, recording each undo entry from what the server says it
 * replaced. Resolves `{ ok }`: false when any write did not land (the rest still ran; the file is the truth).
 * @param {any} el  the selected element's payload (`file`, `id`, `index`, `artboardId`)
 */
export function applyCssPatch(el, patch, { onOptimistic, onRecordEdit } = {}) {
  const now = currentDecls(el);
  let ok = true;
  const done = Promise.all(
    Object.entries(patch).map(([prop, value]) => {
      const before = now[prop] ?? null;
      onOptimistic?.({
        id: el.id,
        artboardId: el.artboardId ?? null,
        index: el.index ?? 0,
        prop,
        value,
      });
      const payload =
        value === null
          ? { canvas: el.file, id: el.id, property: prop, reset: true }
          : { canvas: el.file, id: el.id, property: prop, value };
      chain = trackRecordableWrite(
        chain.then(async () => {
          const j = await post('/_api/edit-css', payload);
          if (!j) {
            ok = false;
            return;
          }
          const prev = Object.hasOwn(j, 'previous') ? j.previous : before;
          if ((prev ?? null) === (value ?? null)) return;
          onRecordEdit?.({
            op: 'css',
            canvas: el.file,
            id: el.id,
            key: prop,
            before: prev == null || prev === '' ? null : prev,
            after: value == null || value === '' ? null : value,
          });
        })
      );
      return chain;
    })
  );
  return done.then(() => ({ ok }));
}

/** Add or change one HTML attribute (`aria-label`, `data-…`) — the raw editor's attribute write. */
export function applyAttr(el, attr, value, { onRecordEdit } = {}) {
  const before = el?.attrs?.[attr] ?? null;
  let ok = true;
  chain = trackRecordableWrite(
    chain.then(async () => {
      const j = await post('/_api/edit-attr', { canvas: el.file, id: el.id, attr, value });
      if (!j) {
        ok = false;
        return;
      }
      const prev = Object.hasOwn(j, 'previous') ? j.previous : before;
      if ((prev ?? null) === (value ?? null)) return;
      onRecordEdit?.({
        op: 'attr',
        canvas: el.file,
        id: el.id,
        key: attr,
        before: prev == null || prev === '' ? null : prev,
        after: value,
      });
    })
  );
  return chain.then(() => ({ ok }));
}
