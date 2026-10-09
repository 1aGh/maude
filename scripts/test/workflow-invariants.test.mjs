// The release pipeline's invariants, as assertions.
//
// WHY THIS FILE EXISTS. v0.57.0 deployed a cell image whose hub layer was built
// from v0.56.0, and every workflow was green. Three separate properties had to
// be true at once for that to happen, and none of them was written down
// anywhere a change could violate:
//
//   (a) a branch push must not build, tag, or push a cell image. It cannot roll
//       the fleet (a byte-identical container config never restarts an
//       instance) and it CAN produce two different images under one tag —
//       precisely the hazard `apps/hub/src/bundle-identity.mjs` was written
//       about.
//   (b) the release-tag path must derive from a VERSION-PINNED hub image. The
//       `:latest` fallback is what made the stale derivation possible, and the
//       "wait for the hub image" step cannot catch it: `docker manifest
//       inspect` tests EXISTENCE, and `:latest` always exists — so the wait is
//       satisfied instantly by the PREVIOUS image.
//   (c) every surface that tells a releaser how to tag must say the ANNOTATED
//       form. `git push --follow-tags` pushes annotated tags only, so a
//       lightweight `git tag vX.Y.Z` stays local and NO workflow fires. Two of
//       the three surfaces said the wrong thing, and that is how a release
//       reached `main` with nothing deployed.
//
// These are text-level assertions on purpose. The failure they exist to catch
// is a maintainer editing a workflow, not a runtime bug, so they read the same
// bytes the maintainer edits.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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

/**
 * Read `jobs:` into `[{ id, if, steps: [{ name, if, body }] }]`.
 *
 * `if` is captured for BOTH the job and the step because a guard may live at
 * either level — the fix for (a) is free to split the image build into its own
 * job, and an assertion that only looked at steps would then read as green
 * while asserting nothing.
 */
function parseJobs(text) {
  const jobsBlock = topLevelSections(text).jobs ?? '';
  const lines = jobsBlock.split('\n');
  const jobs = [];
  let job = null;
  let inSteps = false;
  let step = null;

  const pushStep = () => {
    if (job && step) job.steps.push(step);
    step = null;
  };

  for (const line of lines) {
    const jobHeader = /^ {2}([A-Za-z_][\w-]*):\s*$/.exec(line);
    if (jobHeader) {
      pushStep();
      job = { id: jobHeader[1], if: '', steps: [] };
      jobs.push(job);
      inSteps = false;
      continue;
    }
    if (!job) continue;

    // Job-level keys sit at indent 4.
    const jobKey = /^ {4}([A-Za-z_][\w-]*):(.*)$/.exec(line);
    if (jobKey) {
      pushStep();
      inSteps = jobKey[1] === 'steps';
      if (jobKey[1] === 'if') job.if += ` ${jobKey[2]}`;
      continue;
    }

    if (!inSteps) continue;

    // A step starts at `      - `.
    const stepStart = /^ {6}- (.*)$/.exec(line);
    if (stepStart) {
      pushStep();
      step = { name: '', if: '', body: `${stepStart[1]}\n` };
      const inlineIf = /^if:(.*)$/.exec(stepStart[1]);
      if (inlineIf) step.if += ` ${inlineIf[1]}`;
      const inlineName = /^name:\s*(.*)$/.exec(stepStart[1]);
      if (inlineName) step.name = inlineName[1].trim();
      continue;
    }
    if (step) {
      step.body += `${line}\n`;
      const key = /^ {8}([A-Za-z_][\w-]*):(.*)$/.exec(line);
      if (key?.[1] === 'if') step.if += ` ${key[2]}`;
      if (key?.[1] === 'name') step.name = key[2].trim();
    }
  }
  pushStep();
  return jobs;
}

/** Everything guarding a step: its own `if` plus its job's. */
const effectiveIf = (job, step) => `${job.if} ${step.if}`;

/**
 * A step's body with comment lines removed.
 *
 * These workflows carry long comment blocks BY DESIGN (a maintainer must not
 * have to re-derive the v0.57.0 race from the git log), and those comments name
 * the very commands these assertions look for — `wrangler deploy` appears in the
 * install step's comment explaining why the deps are needed. Matching raw bodies
 * flagged that comment as an ungated deploy. A detector that reads prose reports
 * on prose.
 */
const commandText = (step) =>
  step.body
    .split('\n')
    .filter((line) => !/^\s*#/.test(line))
    .join('\n');

/** Does this guard restrict the step to a release-tag run? */
const tagOnly = (guard) =>
  /ref_type\s*==\s*'tag'|startsWith\(github\.ref,\s*'refs\/tags\//.test(guard);

const CELLS = '.github/workflows/cells-deploy.yml';
const HUB = '.github/workflows/hub-image.yml';

// ---------------------------------------------------------------------------
// (a) No branch-push path can build or push a cell image.
// ---------------------------------------------------------------------------

test('(a) building the cell image is reachable only on a release tag', () => {
  const jobs = parseJobs(read(CELLS));
  const builds = [];
  for (const job of jobs) {
    for (const step of job.steps) {
      // The build is a docker build-push-action pointed at the cell Dockerfile.
      if (
        /docker\/build-push-action/.test(step.body) &&
        /infra\/cell\/Dockerfile/.test(step.body)
      ) {
        builds.push({ job, step });
      }
    }
  }
  assert.ok(builds.length > 0, 'no cell-image build step found — has the workflow moved?');
  for (const { job, step } of builds) {
    assert.ok(
      tagOnly(effectiveIf(job, step)),
      `step "${step.name || '(unnamed)'}" in job "${job.id}" builds the cell image with no release-tag guard — a branch push would build it`
    );
  }
});

test('(a) pushing the cell image is reachable only on a release tag', () => {
  const jobs = parseJobs(read(CELLS));
  const pushes = [];
  for (const job of jobs) {
    for (const step of job.steps) {
      if (/wrangler(@\d+)?\s+containers\s+push/.test(commandText(step))) pushes.push({ job, step });
    }
  }
  assert.ok(
    pushes.length > 0,
    'no `wrangler containers push` step found — has the workflow moved?'
  );
  for (const { job, step } of pushes) {
    assert.ok(
      tagOnly(effectiveIf(job, step)),
      `step "${step.name || '(unnamed)'}" in job "${job.id}" pushes an image with no release-tag guard — a branch push would overwrite the tag's bytes`
    );
  }
});

test('(a) deploying the data plane is reachable only on a release tag', () => {
  // Learned in v0.58.0, after the first cut of this rule kept the branch run's
  // `wrangler deploy` on the theory that "the Worker is not the image".
  // `wrangler.toml` NAMES the container image, so a deploy reconciles the
  // container configuration too — and on the release commit, where the bump has
  // moved the tag to a version only the tag run builds, it fails with
  // IMAGE_REGISTRY_DOESNT_CONTAIN_IMAGE after uploading the Worker. A half-state
  // plus a red run on every release.
  const jobs = parseJobs(read(CELLS));
  const deploys = [];
  for (const job of jobs) {
    for (const step of job.steps) {
      if (/wrangler(@\d+)?\s+deploy/.test(commandText(step))) deploys.push({ job, step });
    }
  }
  assert.ok(deploys.length > 0, 'no `wrangler deploy` step found — has the workflow moved?');
  for (const { job, step } of deploys) {
    assert.ok(
      tagOnly(effectiveIf(job, step)),
      `step "${step.name || '(unnamed)'}" in job "${job.id}" deploys the data plane with no release-tag guard — on a release commit it reconciles a container image that only the tag run builds`
    );
  }
});

// ---------------------------------------------------------------------------
// (b) The release-tag path derives from a version-pinned hub image.
// ---------------------------------------------------------------------------

test('(b) the cell image never derives from maude-hub:latest', () => {
  const text = read(CELLS);
  // The `workflow_dispatch` input may still MENTION :latest in its description —
  // the manual escape hatch is allowed to be told what it used to default to.
  // Everything below `jobs:` is the actual supply chain.
  const jobsBlock = topLevelSections(text).jobs ?? '';
  assert.ok(
    !/maude-hub:latest/.test(jobsBlock),
    'cells-deploy derives from `maude-hub:latest` somewhere under `jobs:`. `:latest` is only rebuilt on a release tag, and the "wait for the hub image" step tests EXISTENCE, not freshness — so a run that derives from it silently builds on the PREVIOUS release (the v0.57.0 failure).'
  );
});

test('(b) the hub image the cell derives from is pinned to the release tag', () => {
  const jobs = parseJobs(read(CELLS));
  const resolve = jobs
    .flatMap((job) => job.steps)
    .find((step) => /steps?\.?hub|hub=|HUB=/.test(step.body) && /maude-hub/.test(step.body));
  assert.ok(resolve, 'no step resolves the hub image to derive from');
  assert.match(
    resolve.body,
    /maude-hub:\$\{\{\s*github\.ref_name\s*\}\}/,
    'the hub image is not pinned to `github.ref_name` — the cell must be built FROM the hub of the same release'
  );
});

test('(b) hub-image.yml publishes the tag the cell build pins to', () => {
  const text = read(HUB);
  // If this ever gains a branch trigger, `Compute tags` derives VER from
  // GITHUB_REF_NAME and would publish `maude-hub:vmain`. Recorded here so the
  // trap is a failing test rather than a paragraph in a plan.
  const on = topLevelSections(text).on ?? '';
  // Stable release tags only since V2-2.0 — a prerelease must not move
  // `:latest` (scripts/test/release-channel.test.mjs evaluates the filter).
  assert.ok(
    /tags:\s*\['v\*\.\*\.\*', '!v\*\.\*\.\*-\*'\]/.test(on),
    'hub-image.yml no longer triggers on stable v*.*.* tags — the cell build pins to that tag'
  );
  assert.ok(
    !/branches:/.test(on),
    'hub-image.yml gained a branch trigger — `Compute tags` derives the tag from GITHUB_REF_NAME and would publish `maude-hub:vmain`'
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
