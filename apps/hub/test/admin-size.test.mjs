// Bundle-size guardrail: the combined gzipped size of the admin shell + CSS +
// JS must stay under the hard ceiling.
//
// Ceiling history:
//   - 15 KB gz — Phase 9 Task 2.5 spec (MDCC redesign; ~8.7 KB used).
//   - 28 KB gz — DDR-097: the maude reskin + sidebar-nav app-shell + inline SVG
//     icon set + three new surfaces (canvases / activity / settings markup +
//     render logic) grew it to ~17.4 KB gz. 28 KB keeps the MDCC-era ~40%
//     headroom. The admin SPA is served once per operator session over
//     `no-store` from a self-hosted box — not a hot public asset — so 28 KB gz
//     (~4× a typical above-the-fold chunk) is still trivially small for a
//     console that now does six jobs instead of four. Stays a HARD ceiling so
//     future growth is a conscious decision, not drift.
//   - 32 KB gz — the team-server admin (2026-11): five pages (Overview with
//     "needs you" · People as one list · Projects · kept Activity with filters
//     and CSV · Settings with who-can-join), the invite and person sheets, the
//     member's page and the sign-in door grew it to ~29.5 KB gz, after the old
//     app-shell CSS was removed. Raised deliberately, with ~8% headroom.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { gzipSync } from 'node:zlib';

import { ADMIN_CSS, ADMIN_HTML, ADMIN_JS } from '../src/admin-assets.mjs';

const BUDGET_BYTES = 32 * 1024; // 32 KB gz, hard ceiling (see the history above).

test('combined gzipped admin bundle is under 32 KB', () => {
  const combined = `${ADMIN_HTML}\n${ADMIN_CSS}\n${ADMIN_JS}`;
  const gz = gzipSync(Buffer.from(combined, 'utf8'), { level: 9 });
  assert.ok(
    gz.byteLength < BUDGET_BYTES,
    `admin bundle gz=${gz.byteLength} exceeds ${BUDGET_BYTES} budget`
  );
});

test('individual admin files are non-empty (loader resolved them)', () => {
  assert.ok(ADMIN_HTML.length > 100, 'index.html missing or empty');
  assert.ok(ADMIN_CSS.length > 100, 'style.css missing or empty');
  assert.ok(ADMIN_JS.length > 100, 'app.js missing or empty');
});
