// client/v2/link-server/link-server-api.js — 2.1.1 T5: what "Link your server" does in a PROJECT tab.
// (Home's API is built in onboarding/AdvancedSheets.jsx from home-api.js; the dialog is the same view.)
//
//   check        POST /_api/hub-signin/check  — one tokenless GET of the server's /health, made by THIS
//                project's server (routes/hub-signin.ts); the page never fetches the remote
//   signIn*      POST /_api/hub-signin/{start,poll,cancel} — the server's own page in the browser (#204);
//                an invite rides `start` and must name the same server
//   openSignIn   the shell opens exactly that page (github.js `openTeamServerSignIn`)
//   linkKey      POST /_api/hub/link {url, token} — a key the server's admin gave (the emergency path,
//                decision maude/v2-michal-hub-token-paste-stays-password-goes)
//   where        GET  /_api/cloud/status — THIS project's own folder (`place.folder`), when the person's folder
//                is not linked anywhere yet; null for a copy Maude keeps or a linked project (B5)
//   finish       the end of a team-server sign-in:
//                  · folder mode 'this' → POST /_api/hub/link-folder {url} — THIS folder joins the server
//                    (an empty server is seeded; one that holds work answers `needs-confirm`, nothing linked)
//                  · otherwise the server's project opens as its own copy in a tab
//                    (`openTeamProject({ kind: 'known-hub' })`, what Settings' "Add a team server" did)
//   confirmLink  POST /_api/hub/link-folder {url, confirm} — the person said yes to the counts
//
// `folders` is 'this': the only folder a project tab links is its own (a folder the person picks is Home's).

import { hubLink, openTeamProject, openTeamServerSignIn } from '../../github.js';
import { answerOf, checkAnswerOf } from './link-server-model.js';

export const LINK_FOLDER_ROUTE = '/_api/hub/link-folder';

async function getJson(path) {
  try {
    const res = await fetch(path, { headers: { accept: 'application/json' } });
    return res.ok ? await res.json().catch(() => null) : null;
  } catch {
    return null;
  }
}

/** `/_api/cloud/status` → this project's own, unlinked folder (`~/git/logo-ideas`), else null. */
export function folderOfStatus(status) {
  const place = status?.place;
  if (!place || place.kept || typeof place.folder !== 'string' || !place.folder) return null;
  if (status?.linkedHub?.url) return null;
  return place.folder;
}

/** A link-folder answer → what `runLink` / `runConfirm` read. */
export function linkFolderAnswerOf(r) {
  const j = r?.json && typeof r.json === 'object' ? r.json : null;
  if (r?.ok && j?.ok && j.state === 'linked') return { ok: true };
  if (r?.ok && j?.ok && j.state === 'needs-confirm' && typeof j.confirm === 'string')
    return {
      ok: false,
      needsConfirm: {
        host: typeof j.host === 'string' ? j.host : '',
        counts: j.counts ?? null,
        code: j.confirm,
      },
    };
  return { ok: false, ...(typeof j?.error === 'string' ? { error: j.error } : {}) };
}

async function post(path, body) {
  try {
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => null);
    return { ok: res.ok, status: res.status, json };
  } catch {
    return { ok: false, status: 0, json: null };
  }
}

/**
 * @param {{ fetchPost?: typeof post, fetchGet?: typeof getJson, openProject?: typeof openTeamProject,
 *           openPage?: typeof openTeamServerSignIn, link?: typeof hubLink }} [seams] tests only
 */
export function projectLinkApi(seams = {}) {
  const p = seams.fetchPost ?? post;
  const openProject = seams.openProject ?? openTeamProject;
  const link = seams.link ?? hubLink;
  const g = seams.fetchGet ?? getJson;
  return {
    context: 'project',
    folders: 'this',
    where: async () => ({ folder: folderOfStatus(await g('/_api/cloud/status')) }),
    check: async (url) => checkAnswerOf(await p('/_api/hub-signin/check', { url })),
    signInStart: async (url, invite) =>
      answerOf(await p('/_api/hub-signin/start', { url, ...(invite ? { invite } : {}) })),
    signInPoll: async (id) => answerOf(await p('/_api/hub-signin/poll', { id })),
    signInCancel: (id) => p('/_api/hub-signin/cancel', { id }),
    openSignIn: seams.openPage ?? openTeamServerSignIn,
    linkKey: async (url, token) => answerOf(await link({ url, token })),
    finish: async (url, folder) => {
      if (folder?.mode === 'this') return linkFolderAnswerOf(await p(LINK_FOLDER_ROUTE, { url }));
      const r = await openProject({ kind: 'known-hub', url });
      return r?.ok ? { ok: true } : { ok: false, error: r?.error };
    },
    confirmLink: async (url, code) =>
      linkFolderAnswerOf(await p(LINK_FOLDER_ROUTE, { url, confirm: code })),
  };
}
