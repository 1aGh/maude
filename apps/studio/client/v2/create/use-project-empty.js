// client/v2/create/use-project-empty.js — S6.2: "a new project with no canvases" (05 es-project-new).
//
// The model is a pure function of what the shell already knows (the project's tree groups, whether the tree
// has loaded, the open tabs, the role), so every rule is a plain test. The starter turns the two ways out into
// the one create call S6.1 built: ↵ in the prompt sends the sentence as `fromPrompt` (the server names the
// canvas from it and S6.3's `startFirstDraft` then sends the sentence to a new AI chat to draft the first
// version); the plain button, like ⌘N, makes a blank canvas. Neither opens the Connect sheet — that waits for the first SEND in the chat (lead decision
// v2-lead-connect-sheet-on-first-send).

import { useCallback, useRef, useState } from 'react';
import { buildTree } from '../canvases/tree-model.js';
import { startFirstDraft } from './first-draft.js';
import { createBlankCanvas } from './new-canvas.js';

/** How many canvases a project holds, by the same rule the Canvases panel counts them. */
export function projectCanvasCount(groups) {
  return buildTree({ groups }).total;
}

/**
 * What the empty-project card shows — or null when the project is not empty (or not known yet).
 * `canCreate` is false for a role that cannot edit: the card then says the situation and nothing else, because
 * there is no door to offer (Hidden ≠ refused: the server still refuses the create).
 * @param {{ groups?: unknown[], treeLoaded?: boolean, tabCount?: number, viewerMode?: boolean,
 *           project?: string }} s
 * @returns {{ project: string, canCreate: boolean } | null}
 */
export function projectEmptyModel({
  groups,
  treeLoaded = false,
  tabCount = 0,
  viewerMode = false,
  project = '',
}) {
  if (!treeLoaded || tabCount > 0) return null;
  if (projectCanvasCount(groups) > 0) return null;
  return { project: project || 'This project', canCreate: !viewerMode };
}

/** The sentence a person typed, tidied; null when there is nothing to send. */
export function sentenceOf(raw) {
  const s = typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim() : '';
  return s || null;
}

/**
 * ↵ in the prompt: create a canvas from the sentence. Nothing typed → nothing happens (no empty canvas by
 * accident; the blank door is the button).
 * @returns {Promise<{ ok: true, file: string } | { ok: false, error: string }>}
 */
export async function startFromSentence(raw, deps = {}) {
  const sentence = sentenceOf(raw);
  if (!sentence) return { ok: false, error: 'nothing typed' };
  return startFirstDraft(sentence, deps);
}

/** "Start with an empty canvas ⌘N": the same call ⌘N makes. */
export function startBlank(deps = {}) {
  return createBlankCanvas(deps);
}

/**
 * The card's two actions with a busy flag, so a double ↵ makes one canvas.
 * @param {{ fetchImpl?: typeof fetch, open?: (file: string) => void, toast?: (m: string) => void }} [deps]
 */
export function useProjectStarter(deps = {}) {
  const [busy, setBusy] = useState(false);
  const depsRef = useRef(deps);
  depsRef.current = deps;
  const busyRef = useRef(false);
  const run = useCallback(async (go) => {
    if (busyRef.current) return null;
    busyRef.current = true;
    setBusy(true);
    try {
      return await go(depsRef.current);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, []);
  const submit = useCallback((raw) => run((d) => startFromSentence(raw, d)), [run]);
  const blank = useCallback(() => run((d) => startBlank(d)), [run]);
  return { busy, submit, blank };
}
