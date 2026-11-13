// The release pipeline's invariants, as assertions.
//
// WHY THIS FILE EXISTS. v0.57.0 deployed a cell image whose hub layer was built
// from v0.56.0, and every workflow was green. Three separate properties had to
// be true at once for that to happen, and none of them was written down
// anywhere a change could violate. Two of the three — "a branch push never
// builds, pushes or deploys" and "the cell derives from a VERSION-PINNED hub,
// never `:latest`" — moved with the deploy workflows to the private repo
// 1aGh/maude-deploy (2026-11; `test/deploy-invariants.test.mjs` there). What
// is still asserted HERE is the public half:
//
//   (b) the image publishes the deploy repo pins to exist, on stable tags only
//       and never from a branch (a branch trigger would publish `maude-hub:vmain`).
//   (c) every surface that tells a releaser how to tag must say the ANNOTATED
//       form. `git push --follow-tags` pushes annotated tags only, so a
//       lightweight `git tag vX.Y.Z` stays local and NO workflow fires. Two of
//       the three surfaces said the wrong thing, and that is how a release
//       reached `main` with nothing deployed.
//   (d) NO public workflow reads a FLEET credential. The deploy lanes (and the
//       D1 precheck) left this repo so that the account tokens and the deploy
//       logs are not in a public tree that fork PRs, Dependabot and third-party
//       actions reach (security review 2026-11-03). `CLOUDFLARE_API_TOKEN` or
//       `MAUDE_CONTAINERS_TOKEN` in a public workflow is that credential coming
//       back. The site's own, zone-scoped `CLOUDFLARE_SITE_API_TOKEN`
//       (site-deploy.yml) is deliberately NOT in this list — it can edit one
//       Worker and its routes, nothing in the fleet.
//
// These are text-level assertions on purpose. The failure they exist to catch
// is a maintainer editing a workflow, not a runtime bug, so they read the same
// bytes the maintainer edits.

import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

// ---------------------------------------------------------------------------
// A deliberately small YAML reader.
//
// The repo has no YAML dependency and this is not the place to add one — these
// workflows use a narrow, indentation-regular subset, and a purpose-built
// reader that understands exactly `jobs → steps` is easier to trust than a
// parser whose behaviour on the rest of the spec nobody here checks.
// ---------------------------------------------------------------------------

/** Split a block into top-level `key:` sections (indent 0). */
function topLevelSections(text) {
  const lines = text.split('\n');
  const out = {};
  let key = null;
  let buf = [];
  for (const line of lines) {
    const m = /^([A-Za-z_][\w-]*):(.*)$/.exec(line);
    if (m) {
      if (key) out[key] = buf.join('\n');
      key = m[1];
      buf = [m[2]];
    } else if (key) {
      buf.push(line);
    }
  }
  if (key) out[key] = buf.join('\n');
  return out;
}

const WORKFLOWS = '.github/workflows';
const HUB = `${WORKFLOWS}/hub-image.yml`;
const RENDER = `${WORKFLOWS}/render-image.yml`;

// ---------------------------------------------------------------------------
// (b) The images the deploy repo pins to are published on stable tags only.
// ---------------------------------------------------------------------------

for (const [rel, what] of [
  [HUB, 'the cell image is built FROM maude-hub:<tag>'],
  [RENDER, 'the Cloudflare render container is the amd64 child of maude-render:<tag>'],
]) {
  test(`(b) ${rel} publishes the tag 1aGh/maude-deploy pins to`, () => {
    const text = read(rel);
    // If this ever gains a branch trigger, the tag is derived from
    // GITHUB_REF_NAME and a run from main publishes `:vmain`. Recorded here
    // so the trap is a failing test rather than a paragraph in a plan.
    const on = topLevelSections(text).on ?? '';
    // Stable release tags only since V2-2.0 — a prerelease must not move
    // `:latest` (scripts/test/release-channel.test.mjs evaluates the filter).
    assert.ok(
      /tags:\s*\['v\*\.\*\.\*', '!v\*\.\*\.\*-\*'\]/.test(on),
      `${rel} no longer triggers on stable v*.*.* tags — ${what}`
    );
    assert.ok(
      !/branches:/.test(on),
      `${rel} gained a branch trigger — the tag is derived from GITHUB_REF_NAME and a run from main would publish \`:vmain\``
    );
  });
}

// ---------------------------------------------------------------------------
// (d) No public workflow reads a fleet credential.
// ---------------------------------------------------------------------------

/** The two account-wide tokens the private deploy repo holds. Exact names. */
const FLEET_SECRET_RE = /secrets\.(CLOUDFLARE_API_TOKEN|MAUDE_CONTAINERS_TOKEN)\b/;

test('(d) no public workflow reads a fleet credential', () => {
  const hits = [];
  for (const name of readdirSync(join(ROOT, WORKFLOWS))
    .filter((n) => /\.ya?ml$/.test(n))
    .sort()) {
    read(`${WORKFLOWS}/${name}`)
      .split('\n')
      .forEach((line, i) => {
        if (FLEET_SECRET_RE.test(line)) hits.push(`${name}:${i + 1}: ${line.trim()}`);
      });
  }
  assert.deepEqual(
    hits,
    [],
    'a public workflow reads a fleet token. The deploy lanes live in the private 1aGh/maude-deploy so that no fork PR, Dependabot merge or third-party action in this tree can reach the account tokens — add the lane there, not here. (A Worker with its own zone-scoped token, like the site, is fine — give it its own secret name.)'
  );
});

// ---------------------------------------------------------------------------
// (c) Every release surface instructs an ANNOTATED tag.
// ---------------------------------------------------------------------------

/**
 * `git tag` occurrences that create a LIGHTWEIGHT tag.
 *
 * Deletions (`git tag -d`) and annotated creations (`git tag -a`) are fine, so
 * any flag disqualifies a match; the next token must also LOOK like a tag name
 * (`v…`, `"v…`, `$…`), which is what keeps prose such as "delete the git tag
 * from GitHub" out.
 *
 * The one deliberate exemption is a line carrying the word "lightweight" — that
 * is how `.ai/release-guide.md` NAMES the anti-pattern while warning against
 * it, and a test that forbade documenting the wrong form would delete the
 * warning that makes the right form make sense.
 */
function lightweightTagLines(text) {
  return text
    .split('\n')
    .map((line, i) => ({ line, n: i + 1 }))
    .filter(({ line }) => /\bgit tag\s+(?!-)["']?[v$]/.test(line))
    .filter(({ line }) => !/lightweight/i.test(line));
}

for (const rel of ['scripts/bump-version.sh', 'CLAUDE.md', 'README.md']) {
  test(`(c) ${rel} instructs an annotated tag`, () => {
    const hits = lightweightTagLines(read(rel));
    assert.deepEqual(
      hits.map(({ n, line }) => `${rel}:${n}: ${line.trim()}`),
      [],
      '`git push --follow-tags` pushes ANNOTATED tags only — a lightweight `git tag vX.Y.Z` stays local and no release workflow fires. Use the form .ai/release-guide.md documents: `git tag -a "vX.Y.Z" -m "vX.Y.Z"`.'
    );
  });
}

test('(c) the release guide still documents the annotated form these copy', () => {
  const guide = read('.ai/release-guide.md');
  assert.match(guide, /git tag -a "v\$\{VER\}" -m "v\$\{VER\}"/);
  assert.deepEqual(lightweightTagLines(guide), []);
});
