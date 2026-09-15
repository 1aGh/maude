// DDR-093 — canvasUrl() token-resolution. Regression guard for the
// "non-default-DS UI canvas renders unstyled" bug: every `ui/*.tsx` authored
// under a non-default design system used to load designSystems[0]'s tokens
// (scoped to a different `.<rootClass>` subtree) so every `var(--*)` went
// undefined and the canvas rendered white.

import { afterEach, describe, expect, test } from 'bun:test';

import {
  canvasTokenRefreshDelay,
  canvasUrl,
  setLiveCanvasToken,
  urlOf,
} from '../client/canvas-url.js';

// Mirrors this repo's real multi-DS config: `project` is the default (ds0),
// `maude` is the non-default one that the bug broke.
const cfg = {
  designRel: '.design',
  designSystems: [
    { name: 'project', path: 'system/project', tokensCssRel: 'system/project/colors_and_type.css' },
    { name: 'maude', path: 'system/maude', tokensCssRel: 'system/maude/colors_and_type.css' },
  ],
};

function paramsOf(url: string): URLSearchParams {
  const qs = url.split('?')[1] ?? '';
  return new URLSearchParams(qs);
}

describe('canvasUrl — per-canvas design-system token resolution', () => {
  test('explicit opts.ds resolves a non-default DS canvas to its OWN tokens', () => {
    const p = paramsOf(canvasUrl('.design/ui/Studio.tsx', cfg, { ds: 'maude' }));
    expect(p.get('tokens')).toBe('system/maude/colors_and_type.css');
    expect(p.get('components')).toBe('system/maude/preview/_components.css');
  });

  test('RCA interface form — relative path + opts.ds', () => {
    const p = paramsOf(canvasUrl('ui/Studio.tsx', cfg, { ds: 'maude' }));
    expect(p.get('tokens')).toBe('system/maude/colors_and_type.css');
    expect(p.get('components')).toBe('system/maude/preview/_components.css');
  });

  test('opts.ds = the default DS resolves to ds0 tokens', () => {
    const p = paramsOf(canvasUrl('.design/ui/Studio.tsx', cfg, { ds: 'project' }));
    expect(p.get('tokens')).toBe('system/project/colors_and_type.css');
    expect(p.get('components')).toBe('system/project/preview/_components.css');
  });

  test('cfg.canvasDesignSystems map drives resolution when opts.ds is absent', () => {
    const withMap = { ...cfg, canvasDesignSystems: { '.design/ui/Studio.tsx': 'maude' } };
    const p = paramsOf(canvasUrl('.design/ui/Studio.tsx', withMap));
    expect(p.get('tokens')).toBe('system/maude/colors_and_type.css');
    expect(p.get('components')).toBe('system/maude/preview/_components.css');
  });

  test('opts.ds wins over the map', () => {
    const withMap = { ...cfg, canvasDesignSystems: { '.design/ui/Studio.tsx': 'maude' } };
    const p = paramsOf(canvasUrl('.design/ui/Studio.tsx', withMap, { ds: 'project' }));
    expect(p.get('tokens')).toBe('system/project/colors_and_type.css');
  });

  test('unknown / no DS falls back to ds0 (single-DS + legacy behavior intact)', () => {
    const p = paramsOf(canvasUrl('.design/ui/Plain.tsx', cfg, {}));
    expect(p.get('tokens')).toBe('system/project/colors_and_type.css');
    expect(p.get('components')).toBe('system/project/preview/_components.css');
  });

  test('an unknown DS name (not in designSystems) falls back to ds0, never undefined', () => {
    const p = paramsOf(canvasUrl('.design/ui/Ghost.tsx', cfg, { ds: 'does-not-exist' }));
    expect(p.get('tokens')).toBe('system/project/colors_and_type.css');
  });

  test('specimen paths stay path-resolved and are unaffected by the map', () => {
    const withWrongMap = {
      ...cfg,
      // A bogus map entry must NOT override the specimen branch.
      canvasDesignSystems: { '.design/system/maude/preview/Buttons.tsx': 'project' },
    };
    const p = paramsOf(canvasUrl('.design/system/maude/preview/Buttons.tsx', withWrongMap));
    expect(p.get('tokens')).toBe('system/maude/colors_and_type.css');
    expect(p.get('layout')).toBe('system/maude/preview/_layout.css');
    expect(p.get('components')).toBe('system/maude/preview/_components.css');
  });

  test('the bug it guards against: ds0 is the WRONG DS for a maude canvas', () => {
    // Documents the failure mode — with neither opts.ds nor a map entry the
    // resolver returns designSystems[0] (project), which is exactly what broke a
    // maude canvas before DDR-093. The fix is that the map now supplies 'maude'.
    const p = paramsOf(canvasUrl('.design/ui/Studio.tsx', cfg));
    expect(p.get('tokens')).toBe('system/project/colors_and_type.css'); // ds0 — wrong for maude
    const fixed = paramsOf(
      canvasUrl('.design/ui/Studio.tsx', {
        ...cfg,
        canvasDesignSystems: { '.design/ui/Studio.tsx': 'maude' },
      })
    );
    expect(fixed.get('tokens')).toBe('system/maude/colors_and_type.css'); // fixed
  });

  test('non-tsx paths bypass the shell and return a direct URL', () => {
    expect(canvasUrl('.design/ui/legacy.html', cfg)).toBe(urlOf('.design/ui/legacy.html'));
  });

  // Cloud Phase 25 C2 — the viewer role rides into the canvas as ?ro=1 so the
  // iframe chrome is read-only from its very first paint (boot-static, no
  // postMessage race).
  test('cfg.readOnly stamps ro=1; absent/false omits it', () => {
    expect(paramsOf(canvasUrl('.design/ui/Studio.tsx', { ...cfg, readOnly: true })).get('ro')).toBe(
      '1'
    );
    expect(paramsOf(canvasUrl('.design/ui/Studio.tsx', cfg)).get('ro')).toBeNull();
    expect(
      paramsOf(canvasUrl('.design/ui/Studio.tsx', { ...cfg, readOnly: false })).get('ro')
    ).toBeNull();
  });
});

// Cloud Phase 27 (DDR-209) — the canvas origin's capability.
//
// In the cloud the canvas origin is a cookieless, cross-site hostname: a cookie
// scoped widely enough to cover it would be readable by the untrusted canvas
// content itself, which is the one thing the DDR-054 split exists to prevent.
// So the capability rides in the URL. It reaches `cfg` through the `/_config`
// projection — which silently dropped it once, and would have 401'd every
// canvas iframe in production (see `config-projection.test.ts`).

test('a canvas URL carries the capability when the server minted one', () => {
  const url = canvasUrl('.design/ui/Home.tsx', {
    designRel: '.design',
    canvasOrigin: 'https://canvas.cloud.maude.sh/alligators',
    canvasToken: 'cap-abc123',
  });
  expect(url.startsWith('https://canvas.cloud.maude.sh/alligators/_canvas-shell.html?')).toBe(true);
  expect(new URL(url).searchParams.get('t')).toBe('cap-abc123');
});

test('a desktop URL is byte-identical to before — no capability, no query', () => {
  // The loopback canvas origin needs none, so this must not change for the
  // shell that has always worked.
  const url = canvasUrl('.design/ui/Home.tsx', { designRel: '.design' });
  expect(new URL(url, 'http://x').searchParams.has('t')).toBe(false);
});

// issue #115 — the canvas origin is an OS-assigned ephemeral port
// (`startCanvasServer(0)`), so it is DIFFERENT in every dev-server process. When
// the desktop supervisor respawns a crashed sidecar, the page's cached `cfg` is
// still the dead process's, and every canvas iframe navigates at a port that no
// longer exists. The shell stays live (the main origin reclaims its
// deterministic port from 4399), so only *switching* canvases goes white — and
// silently, since the canvas shell never loads and its own error surface never
// exists to report anything.
//
// The fix is in app.jsx (re-read `/_config` on a WS reconnect). What these pin
// is the property that makes the fix work at all: `canvasUrl` must be a pure
// function of the `cfg` it is handed, holding no memo of a previous origin.

test('a canvas URL follows a changed canvasOrigin — nothing is cached across configs', () => {
  const before = canvasUrl('.design/ui/Home.tsx', {
    designRel: '.design',
    canvasOrigin: 'http://localhost:51234',
  });
  const after = canvasUrl('.design/ui/Home.tsx', {
    designRel: '.design',
    canvasOrigin: 'http://localhost:51999',
  });

  expect(before.startsWith('http://localhost:51234/_canvas-shell.html?')).toBe(true);
  expect(after.startsWith('http://localhost:51999/_canvas-shell.html?')).toBe(true);
  // Only the origin moved — the canvas identity and every resolved param are
  // unchanged, so a respawn re-navigates the SAME canvas at the live port.
  expect(new URL(after).search).toBe(new URL(before).search);
});

test('a canvasOrigin that disappears falls back to same-origin, never to the stale one', () => {
  // If `/_config` comes back without a canvasOrigin (older server, or the split
  // turned off), the URL must go relative rather than keep pointing at a port
  // the previous process owned.
  const stale = canvasUrl('.design/ui/Home.tsx', {
    designRel: '.design',
    canvasOrigin: 'http://localhost:51234',
  });
  const fresh = canvasUrl('.design/ui/Home.tsx', { designRel: '.design' });

  expect(stale.startsWith('http://localhost:51234/')).toBe(true);
  expect(fresh.startsWith('/_canvas-shell.html?')).toBe(true);
});

// The capability expires (15 min, render-token.mjs). The shell re-mints it and
// records it here; a URL built after that carries the fresh one — a canvas
// opened late in a long session must not be built with the page-load token.
describe('a re-minted canvas capability', () => {
  const cloud = {
    designRel: '.design',
    canvasOrigin: 'https://canvas.cloud.maude.sh/alligators',
    canvasToken: 'boot-token',
  };
  afterEach(() => setLiveCanvasToken(null));

  test('a URL built after a refresh carries the fresh capability', () => {
    setLiveCanvasToken('fresh-token');
    expect(new URL(canvasUrl('.design/ui/Home.tsx', cloud)).searchParams.get('t')).toBe(
      'fresh-token'
    );
  });

  test('a desktop never gains one, whatever was recorded', () => {
    setLiveCanvasToken('fresh-token');
    const url = canvasUrl('.design/ui/Home.tsx', { designRel: '.design' });
    expect(new URL(url, 'http://x').searchParams.has('t')).toBe(false);
  });

  test('the refresh follows the token’s own expiry, within bounds', () => {
    const now = 1_000_000;
    const tok = (e: number) =>
      `${Buffer.from(JSON.stringify({ p: 'p', s: 'a@b.c', e })).toString('base64url')}.sig`;
    expect(canvasTokenRefreshDelay(tok(now + 15 * 60_000), now)).toBe(9 * 60_000);
    expect(canvasTokenRefreshDelay(tok(now + 3 * 60_000), now)).toBe(108_000);
    // Expired or skewed: never a busy loop.
    expect(canvasTokenRefreshDelay(tok(now - 60_000), now)).toBe(30_000);
    // Unreadable: the ceiling.
    expect(canvasTokenRefreshDelay('not-a-token', now)).toBe(10 * 60_000);
    expect(canvasTokenRefreshDelay(tok(now + 48 * 3600_000), now)).toBe(10 * 60_000);
  });
});
