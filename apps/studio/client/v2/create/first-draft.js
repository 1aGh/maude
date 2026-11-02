// client/v2/create/first-draft.js — S6.3: a canvas from one sentence, drafted by AI (01 cf-ai-drafting, 02 ob-first-draw).
//
// Two steps, in this order, and nothing waits on anything slower than it must:
//   1. `POST /_api/canvas {kind:'blank', fromPrompt}` — the server names the canvas from the sentence (C4) and
//      the shell opens it: the artboard-less canvas is in front within the first second;
//   2. `maude:ai-send {prompt, scope:{canvas}, newChat:true}` — the sentence goes into a NEW chat through the
//      composer (ai-send.js), so the connect gate, offline queueing and the run registry apply as for a typed
//      message, and ⌘Z / "Undo this chat" (S5.15) takes the whole draft back as one run.
//
// The first send with no Claude opens S5's ConnectSheet (NeedsYouSlot); Cancel there leaves what step 1 made:
// an empty canvas that is ready to be drawn on — step 1 never depends on step 2.

import { sendToAi } from '../ai/ai-send.js';
import { createBlankCanvas } from './new-canvas.js';

/**
 * Make a canvas from `prompt`, open it, and start the AI run on it.
 * @param {string} prompt  a sentence a person typed (or a parked Home intent carried — validated by the caller)
 * @param {{ fetchImpl?: typeof fetch, open?: (file: string) => void, toast?: (m: string) => void,
 *           send?: typeof sendToAi }} [deps]
 * @returns {Promise<{ ok: true, file: string } | { ok: false, error: string }>}
 */
export async function startFirstDraft(prompt, deps = {}) {
  const sentence = typeof prompt === 'string' ? prompt.trim() : '';
  if (!sentence) return { ok: false, error: 'nothing typed' };
  const made = await createBlankCanvas({ ...deps, fromPrompt: sentence });
  if (!made.ok) return made;
  (deps.send ?? sendToAi)({ prompt: sentence, scope: { canvas: made.file }, newChat: true });
  return made;
}
