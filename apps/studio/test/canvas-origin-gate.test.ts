// Canvas-origin route gate — A1/A2 (DDR-060 F1 re-audit). Boots a real server
// with MAUDE_CANVAS_ORIGIN_SPLIT=1 and probes the segregated canvas origin to
// prove: (1) the %2f-encoded path-traversal that previously leaked repo files
// outside designRoot is now 403'd; (2) privileged routes stay 403; (3) legit
// designRoot assets + the shell still serve; (4) the shell carries the hardened
// CSP. See .ai/logs/security-reviews/phase-9.1-t2-f1-cross-origin-reaudit.md.

import { describe, expect, test } from 'bun:test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { bootServer, killProc, makeSandbox, nextPort } from './_helpers.ts';

async function readCanvasOrigin(designRoot: string): Promise<string> {
  // server.ts writes _server.json under the designRoot once both listeners bind.
  for (let i = 0; i < 40; i++) {
    try {
      const info = JSON.parse(readFileSync(join(designRoot, '_server.json'), 'utf8'));
      if (info.canvasOrigin) return info.canvasOrigin as string;
    } catch {
      /* not written yet */
    }
    await Bun.sleep(50);
  }
  throw new Error('canvasOrigin never appeared in _server.json');
}

describe('canvas-origin gate — A1/A2 traversal + privilege containment', () => {
  test('%2f traversal out of designRoot is 403; privileged 403; legit 200; CSP hardened', async () => {
    const { root, designRoot } = makeSandbox();
    // A real asset OUTSIDE .design/ but INSIDE repoRoot — the traversal target.
    writeFileSync(join(root, 'secret-outside.css'), '.leak{content:"SECRET"}');
    // A legit canvas asset under designRoot (the allowed case).
    mkdirSync(join(designRoot, 'ui'), { recursive: true });
    writeFileSync(
      join(designRoot, 'ui', 'Gate.tsx'),
      'export default function G(){return <main/>}\n'
    );
    // DDR-210 — RUNTIME STATE, AT DEPTH.
    //
    // The underscore rule narrowed from "any path segment" to "the first path
    // segment", because a design system's `preview/_components.css` is
    // versioned, shipped, and was 403ing. The narrowing is sound only while
    // DDR-115's taxonomy stays first-segment — which it is today, and which
    // nothing was asserting. `git/service.ts`'s `isMaudeRuntimeState` matches
    // those names at ANY depth, so the two lists now encode different shapes:
    // a future nested runtime dir would be correctly gitignored, correctly
    // hidden from the Changes list, and SERVED TO THE UNTRUSTED CANVAS.
    // These two files are the tripwire.
    mkdirSync(join(designRoot, '_history', 'gate'), { recursive: true });
    writeFileSync(join(designRoot, '_history', 'gate', 'snap.tsx'), 'export default 1\n');
    mkdirSync(join(designRoot, 'system', 'ds', 'preview'), { recursive: true });
    writeFileSync(join(designRoot, 'system', 'ds', 'preview', '_components.css'), '.a{}\n');

    const port = nextPort();
    const proc = await bootServer(root, port, { MAUDE_CANVAS_ORIGIN_SPLIT: '1' });
    try {
      const canvas = await readCanvasOrigin(designRoot);
      const code = async (p: string) =>
        (await fetch(canvas + p, { signal: AbortSignal.timeout(2000) })).status;

      // (1) The confirmed bypass — must now be 403, not 200.
      expect(await code('/.design/..%2fsecret-outside.css')).toBe(403);
      expect(await code('/.design/ui/..%2f..%2fsecret-outside.css')).toBe(403);
      // Double-encoded + mixed-case variants stay closed.
      expect(await code('/.design/%2e%2e%2fsecret-outside.css')).toBe(403);

      // (2) Privileged / out-of-scope routes stay 403 on the canvas origin.
      // /_api/canvas (Phase 22 file-write) is deliberately NOT in the canvas
      // origin's route allowlist — an untrusted canvas iframe must never create
      // arbitrary .tsx files. It is reachable ONLY from the main origin.
      // Phase 12 (DDR-103) — the in-canvas direct-edit write routes are
      // MAIN-ORIGIN ONLY: absent from CANVAS_SAFE_API + startCanvasServer's
      // route map, so the untrusted canvas iframe origin must never reach a
      // source-write endpoint. A GET here 403s at the gate (not 405 from the
      // handler), proving the route is unreachable on this origin.
      for (const p of [
        '/_config',
        '/_sync-status',
        // Cloud Phase 3 Task 3 — the sign-in handler RECEIVES A PASSWORD, and
        // the disclosure route is main-origin UI chrome. Both are absent from
        // CANVAS_SAFE_API and from startCanvasServer's route map, so a GET
        // 403s at the gate rather than 405-ing from the handler — which is what
        // proves the route is unreachable on this origin at all.
        '/_api/workspace/sign-in',
        '/_api/workspace/disclosure',
        '/_api/export',
        // feature-background-export-notification-center — the background job
        // routes carry the same privileged data class as /_api/export (job
        // status, progress, and eventually the rendered bytes); absent from
        // CANVAS_SAFE_API + startCanvasServer's routes (dual-allowlist).
        '/_api/export-jobs',
        '/_api/export-jobs/download',
        '/_api/canvas',
        // feature-file-tree-drag-drop-folders (Task 5) — move/mkdir are
        // file-write routes, same MAIN-ORIGIN-ONLY posture as /_api/canvas
        // right above: absent from CANVAS_SAFE_API + startCanvasServer's
        // routes, so a GET here 403s at the gate, not 405 from the handler.
        '/_api/fs-move',
        '/_api/fs-mkdir',
        '/_api/edit-css',
        '/_api/edit-text',
        '/_api/edit-attr',
        // DDR-148 — raw canvas source for the Timeline parser is MAIN-ORIGIN
        // ONLY (the untrusted canvas iframe must never read project source).
        // Cloud Phase 23 C3 — the Maude Cloud lane holds the PERSONAL TOKEN
        // and can write linkedHub + a hub credential. Absent from
        // CANVAS_SAFE_API and from startCanvasServer's routes; the security
        // pass confirmed that by reading, which is exactly the kind of fact
        // that should be pinned rather than re-read (validate 2026-07-30).
        '/_api/cloud/status',
        '/_api/cloud/projects',
        '/_api/cloud/signin/start',
        '/_api/cloud/signin/poll',
        '/_api/cloud/signout',
        '/_api/cloud/attach',
        '/_api/cloud/attach/code',
        '/_api/canvas-source',
        // DDR-148 — Timeline drag-to-retime is a source-write, MAIN-ORIGIN ONLY.
        '/_api/retime-sequence',
        // DDR-150 P2 — the clip enumerator reads project source structure, so it
        // is MAIN-ORIGIN ONLY (same boundary as /_api/canvas-source): the
        // untrusted canvas iframe must never enumerate the comp it renders.
        '/_api/comp-clips',
        // DDR-150 P3 — clip removal is a source-write, MAIN-ORIGIN ONLY.
        '/_api/remove-sequence',
        // DDR-150 P4 — clip insert is a source-write, MAIN-ORIGIN ONLY.
        '/_api/insert-sequence',
        // DDR-150 P5 — z-order reorder is a source-write, MAIN-ORIGIN ONLY.
        '/_api/reorder-sequence',
        // enhanced-video-editing Phase 2 — the parametric clip-verb door (speed ·
        // trim · split · transition · layer-order · set-text · to-overlay · …) is
        // a source-write, MAIN-ORIGIN ONLY; the layer-order verb rides this route
        // and does NOT widen the canvas surface (security review 2026-07-30).
        '/_api/clip-edit',
        // enhanced-video-editing Task 7 — the filmstrip/waveform cache holds
        // dataURL frames of local footage; MAIN-ORIGIN ONLY + DNS-rebinding guard.
        '/_api/timeline-media',
        // DDR-150 dogfood — array-src replace is a source-write, MAIN-ORIGIN ONLY.
        '/_api/edit-array-src',
        // DDR-150 dogfood — clip hide/show is a source-write, MAIN-ORIGIN ONLY.
        '/_api/toggle-hide',
        // Phase 12.1 (DDR-138) — node-move reorder is a source-write, MAIN-ORIGIN
        // ONLY. The canvas iframe requests a reorder over the dgn:* bus; the shell
        // performs the write. A GET here 403s at the gate (route unreachable on
        // this origin), not 405 from the handler. Same boundary for the Cmd+Z
        // revert route (whole-file swap — strictly more powerful than a move).
        '/_api/reorder',
        '/_api/reorder-revert',
        // Stage I (feature-element-editing-robustness) — general element
        // structural edits (delete / insert / new-artboard) + free-hand artboard
        // resize (D4) are ALL source-writes, MAIN-ORIGIN ONLY. The untrusted
        // canvas iframe requests them over the dgn:* bus; the shell performs the
        // write. A GET from the canvas origin must 403 at the gate (route
        // unreachable on this origin), never 405 from a reached handler.
        '/_api/delete-element',
        '/_api/insert-element',
        '/_api/duplicate-element',
        '/_api/insert-artboard',
        '/_api/resize-artboard',
        '/_api/delete-artboard',
        // feature-3-web-artboards T3 — "Duplicate at width…" is a source-write,
        // same MAIN-ORIGIN-ONLY posture as the other artboard structural ops
        // right above.
        '/_api/duplicate-artboard',
        // Plan T25/L08 — artboard rename, requested over the dgn bus.
        '/_api/set-artboard-label',
        // feature-bug-report-button — the debug bundle reveals server logs +
        // project context, the submit proxy triggers outbound network, and the
        // fallback writes to disk. All three are MAIN-ORIGIN ONLY: absent from
        // CANVAS_SAFE_API + startCanvasServer's routes, so a GET from the
        // canvas origin 403s at the gate, never reaching the handler.
        '/_api/debug-bundle',
        '/_api/report',
        '/_api/report-fallback',
        // …and the shell capture SPAWNS A PROCESS (screenshot.sh → a headless
        // browser) and renders the whole project. Reachable from the canvas
        // origin it would be a resource-exhaustion lever driven by untrusted
        // canvas code, so it carries the same main-origin-only posture.
        '/_api/shell-shot',
        // Stage F1 — the AssetPicker's asset-listing GET is a shell (main-origin)
        // concern; the untrusted canvas iframe must not enumerate project media.
        '/_api/assets',
        // Stage H — the edit-scope (local-vs-shared) verdict is a shell badge
        // concern; the untrusted canvas origin must not reach it (dual-allowlist).
        '/_api/edit-scope',
        // Phase 27 (E2) — every /_api/git/* route is MAIN-ORIGIN ONLY: absent from
        // CANVAS_SAFE_API + startCanvasServer's `routes` map. A GET from the
        // canvas origin must 403 at the gate (not 405 from a reached handler),
        // proving the route is unreachable on this origin. Guards the dual-
        // allowlist invariant for the token-bearing publish/get-latest endpoints.
        '/_api/git/status',
        '/_api/git/log',
        '/_api/git/diff',
        '/_api/git/commit',
        '/_api/git/discard',
        '/_api/git/push',
        '/_api/git/pull',
        '/_api/git/resolve',
        // Phase 29 (E4) — drafts: list + create + switch + fold are MAIN-ORIGIN ONLY.
        '/_api/git/branches',
        '/_api/git/branch',
        '/_api/git/checkout',
        '/_api/git/fold',
        // Remote drafts: token-bearing fetch — MAIN-ORIGIN ONLY.
        '/_api/git/fetch',
        // Phase 28 (E3) — every /_api/github/* route is MAIN-ORIGIN ONLY (absent
        // from CANVAS_SAFE_API + startCanvasServer's `routes` map) and token-bearing.
        // The untrusted canvas iframe origin must never reach identity/create-repo/
        // invite/repos — a request from this origin 403s at the gate. This is also
        // the guard that the GitHub token (server-held, keychain) can never be
        // exfiltrated to the canvas realm.
        '/_api/github/identity',
        '/_api/github/repos',
        '/_api/github/create-repo',
        '/_api/github/invite',
        '/_api/github/clone',
        '/_api/github/create-project',
        // DDR-216 D3 — every /_api/figma/* route is MAIN-ORIGIN ONLY (absent from
        // CANVAS_SAFE_API + startCanvasServer's `routes` map). A canvas-reachable
        // Figma route would be a token-exfiltration primitive AND an SSRF
        // primitive at once: `connect` stores the user's PAT, `probe` spends it,
        // and `status` would leak whether one exists. A request from this origin
        // 403s at the gate rather than reaching a handler. (The complementary
        // cross-SITE guard — `isTrustedRequestHost` + `sameOriginWrite` on the
        // MAIN origin, which allowlist omission does nothing about — lives in
        // figma-routes.test.ts; both halves are required, neither is sufficient.)
        '/_api/figma/status',
        '/_api/figma/connect',
        '/_api/figma/probe',
        '/_api/figma/import',
        // DDR-219 D2 — the codegen route is privileged-origin only. From the
        // canvas it would be a read primitive over the user's OPEN Figma
        // document plus a write into the design root.
        '/_api/figma/explode',
        // Local-only project create (mkdir + git init + scaffold) — writes to disk,
        // no token; MAIN-ORIGIN ONLY, so the canvas origin must 403 at the gate.
        '/_api/project/create-local',
        '/_api/design/init',
        // Phase 29 (E4) Door C — the hub-link credential write is MAIN-ORIGIN ONLY;
        // the untrusted canvas origin must never reach it (it writes the global
        // ~/.config/maude/hubs.json token store).
        '/_api/hub/link',
        // feature-sync-resync-and-out-of-process-sweep — the Resync control and
        // the sweep cancel are MAIN-ORIGIN ONLY (absent from CANVAS_SAFE_API +
        // startCanvasServer's routes). From the canvas origin, resync would be
        // an amplification primitive driven by untrusted content: one request
        // re-authenticates every document against the person's own hub and
        // re-runs a whole-project upload, spending their DDR-102 rate-limit
        // budget. A GET here 403s at the gate, never 405 from a reached handler.
        '/_api/sync/resync',
        '/_api/sync/cancel-assets',
        // feature-before-first-external-users Task 2 — the sync toggles write
        // `.design/config.json` linkedHub and can restart the sync runtime.
        // From the canvas origin this would let untrusted content turn
        // delete-propagation on or settle a first-anchor hold against the
        // user — MAIN-ORIGIN ONLY, absent from both allowlists.
        '/_api/sync/settings',
        // Ownership mutations (adopt/detach) rewrite `.gitignore` + the git
        // index and can drop the hub link — MAIN-ORIGIN ONLY, same posture.
        '/_api/sync/ownership',
        // Task 3 (F-6) — restore MOVES parked files into the live project and
        // prune DELETES them; untrusted canvas content gets neither primitive.
        '/_api/sync/trash',
        // ACP chat attachments (POST upload + GET thumbnail serve) are MAIN-ORIGIN
        // ONLY — absent from CANVAS_SAFE_API + startCanvasServer's routes. The
        // untrusted canvas origin must never read (or write) the user's pasted
        // chat images; a GET here 403s at the gate, not 404 from the handler.
        '/_api/acp/attachment',
        // feature-acp-turn-notifications Task 3 — the native shell's poller
        // reads this to decide whether to notify for a non-visible project.
        // MAIN-ORIGIN ONLY, same posture as /_api/acp/attachment right above:
        // absent from CANVAS_SAFE_API + startCanvasServer's routes, so the
        // untrusted canvas iframe origin must never learn ANY project's chat
        // activity — including, per Decision D, its own.
        '/_api/acp/activity',
        // Phase 4 (feature-whiteboard-annotation-improvements) — the sticker
        // catalogue + bundled sticker PNGs are MAIN-ORIGIN ONLY, same posture
        // as /_api/assets above: the StickerPicker is shell UI, absent from
        // CANVAS_SAFE_API + startCanvasServer's routes. A GET here 403s at
        // the gate on both — the catalogue route and the static PNG serve.
        '/_api/stickers',
        '/_stickers/some-pack/some-sticker.png',
        // DDR-166 Phase 1 / T2 — the bundled intro-video media serve is
        // MAIN-ORIGIN ONLY, same posture as /_stickers above: a Maude-product
        // asset, absent from CANVAS_SAFE_API + startCanvasServer's routes.
        '/_media/intro.mp4',
        // feature-footage-analysis-director — the footage-analysis + EDL sidecar
        // route is MAIN-ORIGIN ONLY (written by the analyst/director agents over
        // loopback; absent from CANVAS_SAFE_API + startCanvasServer's routes). The
        // untrusted canvas origin must never read/write the director's analysis —
        // a GET here 403s at the gate, not 405 from a reached handler.
        '/_api/footage',
        // feature-ai-media-generation (DDR-16x) — the generation job queue +
        // provider catalogue + key routes are MAIN-ORIGIN ONLY (they resolve a
        // provider KEY and make outbound provider calls). The untrusted canvas
        // origin must never reach them — it sees only the produced /assets/<sha8>.
        // A GET here 403s at the gate, not 405/200 from a reached handler.
        '/_api/generate-jobs',
        '/_api/generate/providers',
        '/_api/generate/keys',
        // Task 2.6 — the non-secret transcription-engine preference writes into
        // .design/config.json + hot-reloads; still MAIN-ORIGIN ONLY (the canvas
        // must not steer the user's engine choice).
        '/_api/generate/prefs',
        // Task 2.5 — reuse-before-you-pay audio search + history re-download
        // resolve the provider key server-side; MAIN-ORIGIN ONLY.
        '/_api/generate/audio-search',
        '/_api/generate/audio-reuse',
        // Task 2.7 — managed whisper-model download (egress + local disk write);
        // MAIN-ORIGIN ONLY.
        '/_api/generate/whisper-model',
        // DDR-166 plan, Phase 2 (T6) — the design-setup readiness probe (project/
        // design-system/first-canvas/brand-assets progress) is a shell/onboarding
        // concern, same posture as /_api/preflight above; MAIN-ORIGIN ONLY.
        '/_api/setup-readiness',
        // DDR-167 (Phase 3 / T10) — local-file SVG/PDF ingestion is a
        // file-write + local-file-adjacent surface (Decision 4); MAIN-ORIGIN
        // ONLY, same posture as /_api/asset's containment but privileged
        // rather than canvas-reachable — the untrusted canvas iframe must
        // never drive an import.
        '/_api/import-asset',
        // DDR-173 (Phase 3 / T12) — brand-file typed-cue extraction is a
        // file-write surface (writes assets/logos/*), same privileged
        // posture as /_api/import-asset above; MAIN-ORIGIN ONLY.
        '/_api/import-brand',
        '/package.json',
      ]) {
        expect(await code(p)).toBe(403);
      }

      // (3) Legit surfaces still serve.
      expect(await code('/_health')).toBe(200);
      expect(await code('/_canvas-shell.html')).toBe(200);
      // A real .tsx canvas under designRoot transpiles + serves (200).
      expect(await code('/.design/ui/Gate.tsx')).toBe(200);
      // DDR-210 — the two halves of the narrowed underscore rule, pinned.
      // First-segment runtime state stays refused AT DEPTH…
      expect(await code('/.design/_history/gate/snap.tsx')).toBe(403);
      // …and a NESTED underscore that is versioned design-system content is
      // served. This one is the reason the rule was narrowed: it 403'd, so
      // every canvas in every project rendered without its component styles.
      expect(await code('/.design/system/ds/preview/_components.css')).toBe(200);
      // Phase 23 — the capped image-upload route IS reachable from the canvas
      // origin (it must be — drag-drop/paste/picker run inside the iframe). A GET
      // returns 405 (method-not-allowed) which proves the route is REACHED via
      // the canvas server's explicit `routes` allowlist — NOT 403 (gate-blocked)
      // or 404 (fell through to file-serve). Guards the dual-allowlist invariant:
      // CANVAS_SAFE_API + the startCanvasServer `routes` map must stay in sync.
      expect(await code('/_api/asset')).toBe(405);

      // (4) The shell carries the hardened CSP (A6).
      const shell = await fetch(`${canvas}/_canvas-shell.html`);
      const csp = shell.headers.get('content-security-policy') ?? '';
      expect(csp).toContain("connect-src 'self'");
      // DDR-148 — media-src must be present so a video-comp's <Video>/<Audio>
      // isn't blocked by default-src 'none' (black video / silent audio).
      expect(csp).toContain("media-src 'self'");
      expect(csp).toContain("webrtc 'block'");
      expect(csp).toContain('frame-ancestors');
      expect(csp).toContain(`http://localhost:${port}`);

      // (5) DDR-148 attacker F1 — the EXPORT/CAPTURE render (?hide-chrome=1) on
      // the MAIN origin (where the normal shell CSP is off) MUST carry the
      // network-locked capture CSP, else a canvas <Video src="http://internal">
      // or comp fetch() turns ⌘E into read-SSRF + exfil-via-artifact.
      const capMain = await fetch(`http://localhost:${port}/_canvas-shell.html?hide-chrome=1`);
      const capCsp = capMain.headers.get('content-security-policy') ?? '';
      expect(capCsp).toContain("media-src 'self'"); // <Video src=external> blocked
      expect(capCsp).toContain("connect-src 'self'"); // comp fetch(external) blocked
      expect(capCsp).toContain("img-src 'self'");
      expect(capCsp).toContain("object-src 'none'");
      // A normal main-origin shell (no capture flag) stays CSP-off (back-compat).
      const plainMain = await fetch(`http://localhost:${port}/_canvas-shell.html`);
      expect(plainMain.headers.get('content-security-policy')).toBeNull();
    } finally {
      await killProc(proc);
    }
  });
});

describe('an SVG served from the canvas origin is not a scripting document', () => {
  test('.svg carries an inert CSP; other static types are untouched', async () => {
    // The canvas origin serves the TENANT's own SVGs. `image/svg+xml` is inert
    // as an <img>, a CSS url() or a <use> target — none of those are browsing
    // contexts — but navigate to one and it is a page, with <script> in it,
    // running on this origin. Only the shell HTML ever got a CSP, so that was a
    // stored-XSS primitive on a `*.<zone>` origin: step one of a three-link
    // cross-tenant chain (an adversarial pass found it; DDR-210 names the other
    // two links). `default-src 'none'; sandbox` costs the legitimate uses
    // nothing, because the policy never applies to them.
    const { root, designRoot } = makeSandbox();
    mkdirSync(join(designRoot, 'system', 'ds', 'assets'), { recursive: true });
    writeFileSync(
      join(designRoot, 'system', 'ds', 'assets', 'mark.svg'),
      '<svg xmlns="http://www.w3.org/2000/svg"><script>1</script></svg>\n'
    );
    writeFileSync(join(designRoot, 'system', 'ds', 'assets', 'tokens.css'), ':root{}\n');

    const port = nextPort();
    const proc = await bootServer(root, port, { MAUDE_CANVAS_ORIGIN_SPLIT: '1' });
    try {
      const canvas = await readCanvasOrigin(designRoot);
      const head = async (p: string) =>
        (await fetch(canvas + p, { signal: AbortSignal.timeout(2000) })).headers;

      const svg = await head('/.design/system/ds/assets/mark.svg');
      expect(svg.get('content-type')).toContain('image/svg+xml');
      expect(svg.get('content-security-policy')).toBe("default-src 'none'; sandbox");

      // …and only SVG. A stylesheet under a CSP that forbids everything is a
      // stylesheet that does not apply.
      const css = await head('/.design/system/ds/assets/tokens.css');
      expect(css.get('content-security-policy')).toBeNull();
    } finally {
      killProc(proc);
    }
  });
});
