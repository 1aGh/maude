// sec-loopback-bearer §7.6 — every `apps/studio/bin/*` helper that calls the studio's MAIN origin sends
// the server's API key. A server the desktop app starts (and, §7.5, one started from a terminal) answers
// a key-less caller 401, so a helper that builds its own request silently stops working — or, worse,
// works only against a key-less dev server and ships broken.
//
// Static check, in the style of plugin-cli-reachability.test.mjs:
//   • bash: every `curl` to a studio port goes through `studio_curl` (_desktop-locate.sh), which hands
//     the key to curl through a config on stdin. A bare curl is allowed only to a path the server
//     answers without a credential (§7.3: /_health, /_canvas-runtime/*, the /_canvas-shell 307).
//   • JS: every `fetch` of a studio URL passes headers built by studioHeaders / studioHeadersFor.
// A browser navigation is not a request this test sees: the studio page opens through
// `studio_launch_url` (screenshot.sh, perf.sh), and canvases open on the canvas/capture origins.

import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const BIN = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'apps', 'studio', 'bin');

/** §7.3 — answered without a credential. */
const EXEMPT_PATH = /\/(_health|_canvas-runtime\/|_canvas-shell(\.html)?\b)/;
/** A studio address a helper builds: loopback + a port variable. */
const STUDIO_URL = /(127\.0\.0\.1|localhost):\$\{?(PORT|port|SERVER_PORT|p)\b/;

/** Files whose loopback calls are not the studio's main origin. Each with its reason. */
const NOT_THE_STUDIO = {
  'runtime-health.sh': 'HEAD-probes /_canvas-runtime/* bundles only (exempt, §7.3)',
  'to-lottie.sh': 'its own python http.server on a random port, not the studio',
  '_perf-probe-safari.mjs': 'talks to safaridriver; the studio page opens through --launch',
  '_perf-sweep.mjs': 'talks to safaridriver / Playwright; the canvas page is a browser navigation',
  '_smart-frames.mjs': 'a local Ollama, not the studio',
  '_curl-local.mjs': 'the loopback-only curl verb itself (DDR-185): the caller names the request',
  'curl-local.sh': 'front for _curl-local.mjs',
  '_desktop-locate.sh':
    'defines studio_curl: its own curl lines are the keyed call (pinned by the argv test below)',
};

const files = readdirSync(BIN).filter(
  (f) => (f.endsWith('.sh') || f.endsWith('.mjs')) && !f.endsWith('.test.mjs') && !NOT_THE_STUDIO[f]
);

const code = (line) => line.replace(/^\s*#.*$/, '').replace(/^\s*\/\/.*$/, '');

/** Lines of a bash helper that run `curl` against the studio without the key. */
export function bareStudioCurls(text) {
  const lines = text.split('\n');
  const usesStudioPort = lines.some((l) => STUDIO_URL.test(code(l)));
  if (!usesStudioPort) return [];
  const bad = [];
  lines.forEach((raw, i) => {
    const l = code(raw);
    if (!/(^|[\s$(|;&!])curl\s/.test(l)) return; // not a curl call (studio_curl has no space before)
    if (/https:\/\//.test(l) && !STUDIO_URL.test(l)) return; // an install hint / a remote download
    if (EXEMPT_PATH.test(l)) return;
    bad.push(`${i + 1}: ${raw.trim()}`);
  });
  return bad;
}

/** The text of each `fetch(` call (balanced parentheses). */
function fetchCalls(text) {
  const out = [];
  let at = text.indexOf('fetch(');
  while (at !== -1) {
    let depth = 0;
    let end = at + 5;
    for (; end < text.length; end++) {
      if (text[end] === '(') depth++;
      else if (text[end] === ')' && --depth === 0) break;
    }
    out.push({ line: text.slice(0, at).split('\n').length, call: text.slice(at, end + 1) });
    at = text.indexOf('fetch(', end);
  }
  return out;
}

/** `fetch` calls of a JS helper that reach the studio without keyed headers. */
export function bareStudioFetches(text) {
  const studioFile =
    /studio-locate\.mjs|_server\.json|_studio-verb\.mjs/.test(text) || STUDIO_URL.test(text);
  if (!studioFile) return [];
  return fetchCalls(text)
    .filter(({ call }) => {
      const studio =
        STUDIO_URL.test(call) ||
        /\$\{(studio\.base|base)\}/.test(call) ||
        /^fetch\((base|url|target)\b/.test(call);
      if (!studio || EXEMPT_PATH.test(call)) return false;
      return !/headers:\s*(await\s+)?(studioHeaders(For)?\(|keyed\b|headers\b|\{\s*\.\.\.keyed)|\bheaders\b,/.test(
        call
      );
    })
    .map(({ line, call }) => `${line}: ${call.split('\n')[0]}`);
}

test('every bash helper reaches the studio through studio_curl', () => {
  const bad = [];
  for (const f of files.filter((x) => x.endsWith('.sh')))
    for (const l of bareStudioCurls(readFileSync(join(BIN, f), 'utf8'))) bad.push(`${f}:${l}`);
  assert.deepEqual(bad, [], `a bare curl to the studio sends no API key:\n${bad.join('\n')}`);
});

test('every JS helper sends the API key on a studio fetch', () => {
  const bad = [];
  for (const f of files.filter((x) => x.endsWith('.mjs')))
    for (const l of bareStudioFetches(readFileSync(join(BIN, f), 'utf8'))) bad.push(`${f}:${l}`);
  assert.deepEqual(bad, [], `a studio fetch without the API key:\n${bad.join('\n')}`);
});

test('the checks see the shapes they are for', () => {
  assert.equal(bareStudioCurls('PORT=1\ncurl -s "http://127.0.0.1:$PORT/_api/x"\n').length, 1);
  assert.equal(
    bareStudioCurls('PORT=1\nstudio_curl "$R" "$PORT" -s "http://127.0.0.1:$PORT/_api/x"\n').length,
    0
  );
  assert.equal(bareStudioCurls('curl -fs "http://localhost:$PORT/_health"\n').length, 0);
  assert.equal(
    bareStudioFetches('const r = await fetch(`http://127.0.0.1:${port}/_api/index`);').length,
    1
  );
  assert.equal(
    bareStudioFetches(
      "import x from 'studio-locate.mjs';\nfetch(`${studio.base}/_x`, { headers: studioHeaders(studio) });"
    ).length,
    0
  );
  assert.equal(bareStudioFetches('fetch(`http://127.0.0.1:${port}/_health`)').length, 0);
});

test('the bash key helpers never put the key on argv or in the environment', () => {
  const text = readFileSync(join(BIN, '_desktop-locate.sh'), 'utf8');
  assert.match(text, /curl --config - "\$@"/);
  assert.doesNotMatch(text, /export\s+STUDIO_KEY/);
  assert.doesNotMatch(text, /-H\s+"x-maude-api-key/);
});
