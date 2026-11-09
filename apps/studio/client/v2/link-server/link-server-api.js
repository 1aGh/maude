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
//   finish       today's end of a team-server sign-in: the server's project opens as its own copy in a
//                tab (`openTeamProject({ kind: 'known-hub' })`, what Settings' "Add a team server" did).
//
// `folders` is false: linking THIS folder to a team server (or a folder the person picks) has no route
// yet — the dialog then draws no "Folder on this Mac" block (named gap, 2.1.1 T5 hand-back).

import { hubLink, openTeamProject, openTeamServerSignIn } from '../../github.js';
import { answerOf, checkAnswerOf } from './link-server-model.js';

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
 * @param {{ fetchPost?: typeof post, openProject?: typeof openTeamProject,
 *           openPage?: typeof openTeamServerSignIn, link?: typeof hubLink }} [seams] tests only
 */
export function projectLinkApi(seams = {}) {
  const p = seams.fetchPost ?? post;
  const openProject = seams.openProject ?? openTeamProject;
  const link = seams.link ?? hubLink;
  return {
    context: 'project',
    folders: false,
    check: async (url) => checkAnswerOf(await p('/_api/hub-signin/check', { url })),
    signInStart: async (url, invite) =>
      answerOf(await p('/_api/hub-signin/start', { url, ...(invite ? { invite } : {}) })),
    signInPoll: async (id) => answerOf(await p('/_api/hub-signin/poll', { id })),
    signInCancel: (id) => p('/_api/hub-signin/cancel', { id }),
    openSignIn: seams.openPage ?? openTeamServerSignIn,
    linkKey: async (url, token) => answerOf(await link({ url, token })),
    finish: async (url) => {
      const r = await openProject({ kind: 'known-hub', url });
      return r?.ok ? { ok: true } : { ok: false, error: r?.error };
    },
  };
}
