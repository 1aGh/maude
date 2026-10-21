Wave-B gate — hub/cell evidence (fork of gate-b-compat). Canvas 10 Share and Collaboration has NO built rows (all 20 open, S9).
Part 2 (cloud pages on the local cell): shell loads for owner/member/Can comment/Can view (no stuck Opening…: p2-*-pitch.png);
sign-in page p2-signin.png. Share sheet under cloud identity with the stub control plane reads "Sharing is not available right now.
Invites you send wait here and go out once this Mac reaches the project." (p2-owner-share-sheet.png) — the authority is the control
plane, which the stub does not serve, so invites/roles/join were NOT verified in a browser here; note the words say "this Mac" in a
browser tab (copy question for the lead). Invite landing (/join) is the self-hosted hub's page and needs the hub-authority posture.

Rig (2026-10-21, gate-b-compat fork): local cell from scripts/dev/local-cell.mjs on port 4890 (--no-watch --keep),
hub process binary /Users/iagh/.nvm/versions/node/v24.13.0/bin/node (lsof txt of the hub pid), studio child bun on 4690.
Cloud identity: MAUDE_CLOUD_IDENTITY=1 (hybrid), MAUDE_TENANT_ID=alligators, MAUDE_CONTROL_PLANE_URL=http://127.0.0.1:4899 —
a LOOPBACK fake control plane (scratchpad gate/b/fake-cp.mjs) that answers only POST /auth/handoff/exchange with a token signed by
apps/hub/src/cloud-identity.mjs (signAccessToken / signAccessTokenV2). Browser sessions go through the cell's real /auth/browser door.
/health.access = {authority:control-plane, roles:[viewer,member,owner], scopes:[project], links:false} (rolesV2 dark, production posture).
Identities (each its own Playwright context; Tereza in a separate browser process where focus matters):
  owner  you@local.test (password sign-in) · member tereza@local.test · Can comment klara@local.test (role viewer) ·
  Can view jonas@local.test (v2 claim role observer). Canvas ui/pitch.tsx (3 artboards Cover/Plan/Ask) seeded into the cell checkout.
No real cloud, hub, Stripe or Cloudflare was contacted. Scripts: scratchpad gate/b/p*.mjs. Shots: shots/ (this dir).
