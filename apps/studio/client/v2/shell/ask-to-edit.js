// client/v2/shell/ask-to-edit.js — S3.12: the Viewing button's one action.
//
// A viewing role (Can view / Can comment) has no Edit to go to; the cluster's primary button is "Ask to edit"
// (CONTRACT §6 access status, 04 md-edge-viewer). The FLOW — the request to the project's owners, its note,
// the answer, the 7-day expiry — is S9.21's (outbox kind `share.ask-to-edit`, V2-1.14). This button only runs
// the registry action by id once S9 registers it, so it needs no change the day that lands.
//
// A leaf module on purpose: the cluster host imports it, and a test drives it without the shell.

import { ACTIONS_BY_ID } from '../../../actions/index.ts';

/** The registry id of the flow (S9.21 registers it; V2-1.14 outbox kind `share.ask-to-edit`). */
export const ASK_TO_EDIT_ACTION = 'share.ask-to-edit';

/** The sentence said while S9.21 has not registered the action. */
export const ASK_TO_EDIT_FALLBACK = 'Ask a project owner for edit access.';

/** Is the S9.21 flow registered in this build? */
export const askToEditRegistered = () => ACTIONS_BY_ID.has(ASK_TO_EDIT_ACTION);

/**
 * @param run (id) => void — the shell's runner
 * @param toast (text) => void — the fallback line
 * @returns 'action' when the registry action ran, 'fallback' when only the line was said
 */
export function askToEdit(run, toast) {
  if (askToEditRegistered()) {
    run(ASK_TO_EDIT_ACTION);
    return 'action';
  }
  toast(ASK_TO_EDIT_FALLBACK);
  return 'fallback';
}
