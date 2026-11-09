# 2.1.1 — Accounts, projects and where they live

**Status:** active · **Owner:** Michal (request via keeper, 2026-11-09) · **Lead:** Maude v2 session
**Target:** 2.1.1. Push, tag and release need Michal's OK.

## Goal

The person has several cloud.maude.sh accounts, several projects under each, and may also have projects on their own team servers. For each project, the shell says at a glance:

- which account it uses,
- where the project lives: their own local repo, a copy Maude keeps in the background, or a team server,
- whether the connection works.

Fixing a broken or missing sign-in takes one click.

## Michal's model (verbatim intent)

- Several accounts on cloud.maude.sh, several projects under each.
- A project is either connected to the person's own local repo, or Maude keeps a copy somewhere in the background.
- Plus projects on the person's own servers.
- The person must find their way at a glance: where they are signed in, in which project, and whether the connection works. As simple as possible.

## Today (scout inventory 2026-11-09, file:line in the session log)

- **Avatar card** (`v2/shell/project-account-card.jsx`, `project-account-model.js`): mixes account kind with location. A `local` project has no action.
- **"Sign in as another account…"** on a local project moves it to a brand-new empty profile (`cloud_sign_in_prepare` → `bind_chosen`). It then reads "This Mac only" with no way back, because `bind_profile` has no release caller.
- **Sync** (Diagnostics › Sync): when unlinked it says "nothing to sync" and offers no action.
- **Settings › Connections:** holds cloud and team-server linking.
- **Settings › Advanced:** 8 flat sections.
- **Two team-server dialogs:**
  - Settings "Add a team server" (`TeamProjects.jsx`): address only.
  - Home "Sign in to your own hub" (`HubSheet.jsx`): Test connection and invite.
- **Broken link** (`linkedHub.credentialed:false`, hub 401): surfaced only in the Settings row and the card button label. No toast, no avatar badge.
- **Local → team server:** no flow.

## Tasks

- [x] **T0** Sign-in return fix: `GET /_api/hub-signin/return` exempt from the main-origin key (`shell/api-key.ts`, contract §7.3, fail-first test). Commit 0fa21f6b6. Audit: the hub return is the only browser→project-server loopback hop. Home already exempts its own (#204 K2). Cloud sign-in is device-flow, and the deep links are page-posted.
- [x] **T1** Design canvas `.design/ui/v2/16 Accounts and Connections.tsx`:
  - the model (account → project → location),
  - connection states (ok / syncing / offline / sign-in missing / sign-in rejected / server unreachable),
  - avatar + menu per state,
  - Sync popup unlinked with its two actions,
  - Settings › General "Project" block,
  - one team-server dialog (Advanced: own key, local folder),
  - Advanced as an accordion,
  - Home per-project location.

  → shown to Michal (AskUserQuestion) **before** any builder.
- [x] **T2** (B1, merged 672d8c50e) Broken/missing sign-in:
  - a state derived from `/_api/cloud/status` `linkedHub.credentialed` + hub 401 / sync refused;
  - a toast once per session;
  - avatar badge (broken-link glyph);
  - avatar menu "Sign in again" with the address prefilled.
- [x] **T3** (B2, merged 6cd8e477d) Sync popup unlinked: "Create project on cloud.maude.sh" (the existing `/_api/cloud/move`) and "Link your server" (the T5 dialog).
- [x] **T4** (B1: project_use_account rebinds to an existing profile) Avatar menu: "Sign in with custom server…". "Sign in as another account…" is fixed for a local project: it never strands the project on an empty profile and can go back. Rebind to an existing profile, or offer the choice.
- [x] **T5** (B2 dialog 6cd8e477d + B5 link this folder 2213b7e7c) One team-server dialog, replacing both today's dialogs:
  - address, Test connection, invite;
  - Advanced: an own sign-in key, and the local folder the project connects to.
- [x] **T6** (B3, merged 464ca14b2) Settings: the project's connection (cloud + team server) moves from Connections to General, showing what it is linked to and how to change it. Advanced sections become an accordion.
- [x] **T7** (merged f36671930; lane e2e:accounts; rerun without MAUDE_E2E_PRE_CONSENT_FIX after the T8 studio fixes) Desktop e2e:
  - sign-in return lands (fake hub);
  - broken-sign-in state + re-sign-in;
  - sending a local project (cloud and team server, fake endpoints);
  - each new spec run once alone.
- [x] **T9** (merged 8e7e7e613: hub 409s a write over an owner-purge tombstone unless it names the seq; peer ledger remembers tombstones; journal records the writing peer) Owner-purge undone by a peer re-put. A peer offline during the purge PUT 2630 purged paths back on the 2.0.8 hub, and the hub accepted them silently. Expected:
  - the purge tombstone sends the deletion to that peer;
  - a peer-put on a purged path never silently restores it.
  Check whether manually deleted `_trash/<stamp>` dirs end the tombstone (699271593 "vanished tombstone as gone").
- [x] **T10** (merged 0ffdb4ea5: boot restore honours deletions; healer once per version; retired copy not re-adopted. Follow-ups: Dockerfile healthcheck timings, yield in first walkImport) Hub CPU saturation after the 2.1.0 upgrade:
  - `[sync/ctl] healed N path(s) from the journal` repeats on the same paths;
  - an adopt → retired → "new path never appeared — keeping the old copy" loop on one canvas;
  - the result: every canvas loads very slowly.
- [x] **T11** (merged dcc8edc87: a hub's own studio never holds a cold-start conflict; root cause = hub proxy refuses /_api/project/conflict by design (S9.24b), not the `_` path. Follow-up F1: a running-time refused proposal still leaves a dead-end card) Web Diagnostics conflict that can't be resolved: "The two versions can't be read right now", and Keep mine answers Not found. Suspected: a document whose path has a `_`-prefixed segment (`preview/_ui-feedback`) in cell/hub mode. The desktop doesn't show it.
- [x] **T13** (merged c56d83352) "Remove here too" for an incoming held delete batch in Sync details (T9 gap: a peer away during a large purge keeps the files held with no way to accept; `sync/held-deletes.ts`, the file-plane breaker loop, `sync/index.ts` 'until you accept').
- [x] **T12** (merged fe935f084; follow-ups: visible refusal through the edit check; a canvas moved before its creating run publishes) An AI write to a canvas another run created is reverted silently (`[sync/ai] … refused (run-overlap)`); the writer must be told, or the write must land.
- [ ] **T8** Gates + What's New entry + review (security on T4/T5 + the exemption).

## Acceptance Criteria

- [x] A team-server sign-in completes in the packaged flow (`hub-signin/return` reachable without the key; the test fails without the fix).
- [x] Michal approved the design (AskUserQuestion answer recorded here) before building. — 2026-11-09:
  - Round 1 (13 artboards). His note: General stacked; Connections-style icon cards, expandable; one look for General/Connections/Advanced.
  - Round 2: "Ano, stavěj".
  - Canvas 17 Accounts and Connections (merged 7a49cbdd6).
- [ ] A project whose repo names a server this Mac has no valid sign-in for shows a toast, a broken-link avatar, and "Sign in again" with the address prefilled.
- [ ] Sync popup on a local project offers "Create project on cloud.maude.sh" and "Link your server", and both work.
- [ ] The avatar menu has "Sign in with custom server…". "Sign in as another account…" on a local project never leaves it stuck on "This Mac only".
- [ ] One team-server dialog (Advanced: own key + local folder); the old two are gone (nothing-deleted map updated).
- [ ] Settings › General shows the project's connection; Advanced is an accordion.
- [ ] New desktop e2e specs green, each run alone; the full quality gate set green; mini studio suite green.
- [x] T9–T11: each has a root cause with evidence, a fail-first regression test and a fix (or a recorded decision why not in 2.1.1).
- [ ] No test touched the real keychain, `~/.config/maude` or Michal's projects; no system dialog.

## Rules

- Same rules as the issues burndown (`.ai/scenarios/issues-burndown/builder-preamble.md`): throwaway HOME/XDG, NO_OPEN=1, MAUDE_NO_AUTOBUILD=1, stub claude, kill by PID only.
- No writes to StudyFi / design.studyfi.com / alligators. Public repo: keep security detail generic.

## Progress log

- 2026-11-09: T1 design v1 (13 artboards) sent to Michal. His feedback: General stacked in one column, Connections-style icon cards, expandable, one look for General/Connections/Advanced → designer revising. Open-question defaults taken: 'Maude Cloud', 'changes wait on this Mac', Advanced 'This project' merges into General, canvas renumbered 17.
- 2026-11-09: T10 + T11 merged locally (not pushed). Operator advice relayed to the design.studyfi.com session (no hub restart until 2.1.1: boot restore re-hydrates purged files).
- Follow-up T12 (found by the designer): an AI Edit to a canvas another run created is silently reverted on disk (`[sync/ai] … refused (run-overlap)`), with no word to the writer.

- 2026-11-09: T0 committed (0fa21f6b6, local, not pushed). Scout inventory done. Next: T1 design.
- 2026-11-09: B1–B4 merged (672d8c50e, 6cd8e477d, 464ca14b2, 2b6a8af21), integration 3837d2e0b, release bundle 5a316896f; boot check + opening-card smoke PASS. Michal chose to build "link this folder to your server" in 2.1.1 → B5 running. Gaps named: Change… (folder ↔ kept-by-Maude move) has no backend; the switch list can't show server accounts; Home has no sign-in key paste; the CONTRACT §6 offline word is unchanged globally (the desktop chip shows the new words).
- 2026-11-09: T8 reviews.
  - Defender: NEEDS FIXES. M1: the project_use_account consent is page-owned. Lows L1–L5.
  - Adversarial: FAIL. F1: an unconfirmed committed address became a sign-in prompt. F2: hub-signin/start and hub/link were not person-only. Together they form a High chain. F3–F7 low or info.
  - Fix split:
    - Studio builder: F1–F7 and L1–L4. A broken sign-in applies only to a server this Mac linked before. An unconfirmed address gets a neutral state and the consent step.
    - Rust builder: M1 native consent and L5 neutral labels.
  - Reports are in `.ai/logs/security-reviews/2.1.1-accounts*.md`.
- 2026-11-09: S1 merged.
  - A first link used to lose a canvas's comments (and their recovery copy), replace sticky notes and replace layout with no copy kept. Now comments and sticky notes merge by id, layout keeps the server's version plus a recovery copy, each lane has its own recovery slot, and the confirm lines describe the measured outcome.
  - T14, queued after the T8 studio fixes merge (same files):
    1. Sync details shows the file conflict copy; fix the wrong "in the trash" word.
    2. Sync details shows set-aside notices.
    3. Count pictures and videos a server can't store on their own line.
    4. Port the S1 reproduction into hub-link-folder-route.test.ts: workspace mode, without fileEvents:false.
- 2026-11-09: T7 merged. The e2e found and fixed three bugs:
  - Sign in again opened a managed copy instead of the folder.
  - The chip stayed broken after sign-in.
  - Create on Maude Cloud did nothing with no canvas open.

  Open:
  - A member linking to a format-1 server gets the wrong words ("needs an update"); only the owner can raise the format.
  - `team-cell-missing.e2e.ts:452` probably has the stale offline words.
  - No screenshot of the Home where-chips yet.
  - 23 app screenshots in `.ai/scenarios/accounts-2.1.1/app-shots/`.

  T8 Rust merged (d58db2740).
