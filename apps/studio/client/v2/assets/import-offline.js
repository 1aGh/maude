// client/v2/assets/import-offline.js — S8.22b: is this Mac offline in the sense the Share cluster says so?
//
// "Kept on this Mac — goes up by itself once it's online" (12 · ia-edges D) is only true of a project that IS linked:
// a local project has nothing to go up to. The same rule as the cluster's word (`saveStatus`), so the two never
// disagree. The bytes themselves go up through the S8.19 asset-state lane (`uploading` → here), nothing here moves them.

import { syncPresentation } from '../../../sync/presentation.ts';
import { saveStatus } from '../shell/save-status.js';

/**
 * @param {{ linked?: boolean, online?: boolean, phase?: string | null }} state
 * @returns {boolean} true when what is added now waits on this Mac
 */
export function importsWaitHere({ linked, online, phase = null } = {}) {
  return saveStatus({ linked: !!linked, online, phase }).kind === 'offline';
}

/** The browser's own word on the network, read at the moment of use (true when it cannot be asked). */
export const onlineNow = () =>
  typeof navigator === 'undefined' ? true : navigator.onLine !== false;

/**
 * The shell's own values in, the answer out — what the Share cluster computes for its word, read when the files land.
 * @param {{ cfg?: object, cloudLinkedHub?: object, syncStatus?: object, project?: string }} shell
 */
export function importsWaitHereFrom({ cfg, cloudLinkedHub, syncStatus, project } = {}) {
  const linked =
    !!cfg?.cloud || !!cloudLinkedHub?.credentialed || (!!syncStatus && syncStatus.linked !== false);
  const phase =
    syncPresentation(syncStatus, { project: cfg?.cloud?.projectName || project })?.phase ?? null;
  return importsWaitHere({ linked, online: onlineNow(), phase });
}
