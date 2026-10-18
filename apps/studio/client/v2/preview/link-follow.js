// client/v2/preview/link-follow.js — S3.10a: the shell plays a followed link (S3-links-format §5 steps 2–4).
//
// The canvas posts only `link-follow {elementId, artboardId}` (input-router, Preview branch). The shell —
// never the canvas — reads where the link goes from the versioned TSX (`GET /_api/links?file=<active>`),
// checks it, and acts:
//   artboard  → `view.zoom-to-artboard` on the active canvas, push a back entry
//   canvas    → open that canvas in this window (the mode stays Preview), frame its artboard, push a back entry
//   dangling  → stay put, say so
//   external  → S3.10b's trusted confirmation (external-link-confirm.jsx); the URL is re-checked there
// Dropped silently: not the active canvas's frame (the dgn gate), the shell is not in Preview, a modal is
// open, more than 4 follows a second, no entry for the element, an invalid entry.

import { parseLinkTarget } from '../../../bridge/link-target.ts';

export const FOLLOWS_PER_SECOND = 4;

export const DANGLING_CANVAS = "That link goes to a canvas that isn't here any more.";
export const DANGLING_ARTBOARD = "That link goes to an artboard that isn't here any more.";
/** The entry a follow addresses: by element id, and by artboard when the id is on two artboards. */
export function entryFor(links, elementId, artboardId) {
  const hits = (Array.isArray(links) ? links : []).filter((l) => l && l.id === elementId);
  if (hits.length <= 1) return hits[0] ?? null;
  return hits.find((l) => l.artboard === artboardId) ?? null;
}

/** What one follow does, as data. Pure. null = drop. */
export function followPlan(entry) {
  if (!entry || entry.state === 'invalid' || entry.kind === 'invalid') return null;
  if (entry.state === 'dangling')
    return { kind: 'toast', text: entry.kind === 'canvas' ? DANGLING_CANVAS : DANGLING_ARTBOARD };
  if (entry.kind === 'artboard' && typeof entry.toArtboard === 'string')
    return { kind: 'artboard', artboard: entry.toArtboard };
  if (entry.kind === 'canvas' && typeof entry.canvas === 'string')
    return { kind: 'canvas', canvas: entry.canvas, artboard: entry.toArtboard ?? null };
  if (entry.kind === 'external') {
    // The shell re-parses the URL itself: a body that says "external" about a `javascript:` value
    // (a forged or stale read) is dropped here, before any sheet.
    const t = parseLinkTarget(entry.url);
    return t && t.kind === 'external' ? { kind: 'external', url: t.url, host: t.host } : null;
  }
  return null;
}

/**
 * The follow handler. deps:
 *   mode()                 the shell's own mode (`preview` | …)
 *   modalOpen()            a modal dialog is open
 *   now()                  ms clock (tests inject)
 *   activePath()           the active tab's path
 *   fetchLinks(path)       → Promise<{ links } | null>   (GET /_api/links)
 *   zoomTo(artboard)       run `view.zoom-to-artboard` on the active canvas
 *   openCanvas(designRootRel, artboard)   open another canvas in this window and frame the artboard
 *   openTab(tabPath, artboard)            the same, for a tab path (going back)
 *   toast(text)
 *   external(url)          S3.10b: the trusted confirmation (external-link-confirm.jsx) — never an open
 *   history                preview-history.js
 *   nameOf(path)           the canvas display name for the back button
 * `follow(msg)` takes a message `acceptFromCanvas` already validated (`{elementId, artboardId}`).
 */
export function createLinkFollow(deps) {
  let stamps = [];
  return {
    async follow(msg) {
      if (deps.mode() !== 'preview' || deps.modalOpen()) return null;
      const t = deps.now();
      stamps = stamps.filter((s) => t - s < 1000);
      if (stamps.length >= FOLLOWS_PER_SECOND) return null;
      stamps.push(t);
      const from = deps.activePath();
      if (!from) return null;
      let body = null;
      try {
        body = await deps.fetchLinks(from);
      } catch {
        body = null;
      }
      // the world may have moved while the read was in flight
      if (deps.mode() !== 'preview' || deps.activePath() !== from) return null;
      const plan = followPlan(entryFor(body?.links, msg.elementId, msg.artboardId ?? null));
      if (!plan) return null;
      if (plan.kind === 'toast') {
        deps.toast(plan.text);
        return plan;
      }
      if (plan.kind === 'external') {
        // No back entry: the website opens outside this window (or not at all).
        deps.external(plan.url);
        return plan;
      }
      deps.history.push({
        canvas: from,
        artboard: msg.artboardId ?? null,
        name: deps.nameOf(from),
      });
      if (plan.kind === 'artboard') deps.zoomTo(plan.artboard);
      else deps.openCanvas(plan.canvas, plan.artboard);
      return plan;
    },
    /** `preview.back`: pop one entry and go there. */
    back() {
      const to = deps.history.pop();
      if (!to) return null;
      if (to.canvas === deps.activePath()) {
        if (to.artboard) deps.zoomTo(to.artboard);
      } else deps.openTab(to.canvas, to.artboard);
      return to;
    },
  };
}
