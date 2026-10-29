import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { stat, writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { parseArgs } from '../lib/argv.mjs';
import { copyTree } from '../lib/copy-tree.mjs';

// Thin STATE.md written under --kg: the knowledge graph is the history authority,
// so STATE.md shrinks to a human breadcrumb (Open fork #2 — stub, not removal).
const KG_STATE_STUB = `# Workflow State

> **kgai-active repo** — decision history + working context live in the knowledge graph, not this file.
> The \`flow:workflow-state\` skill reads/writes the graph via \`flow:kgai-backend\`.

**Status:** ready
**Active plan:** —

## Where the history went

- **Decisions / "why is X so":** \`maude kg context --about "<area>"\`
- **Recent movements:** \`maude kg query "MATCH (d:Decision) WHERE d.author='<you>' RETURN d.title, d.recorded_at ORDER BY d.recorded_at DESC LIMIT 10"\`
- **Conflicts:** \`maude kg conflicts\`

The old \`.ai/decisions/\` archive (if any) is preserved read-only — never auto-deleted.
`;

const PLACEHOLDER = 'PROJECT_NAME';
// Files in the skeleton that contain the project-name placeholder and should
// be templated on copy.
const TEMPLATED = [
  'workflows.config.json',
  'README.md',
  'INDEX.md',
  'release-guide.md',
  'scenario-guide.md',
];

// Per-provider command substitutions for release-guide.md. Keys map to the
// `# CHANGELOG_PROVIDER_*_CMD` placeholders inside the skeleton's bash blocks.
// `null` = leave the placeholder + a "# TODO" comment in place.
const CHANGELOG_STUBS = {
  changesets: {
    VERSION:
      'pnpm changeset version   # bumps package.json versions + writes CHANGELOG.md from .changeset/*.md',
    TAG: 'git tag "v$(jq -r .version package.json)" && git push --follow-tags',
    PUBLISH:
      'pnpm changeset publish   # or: CI handles publish on tag — see .github/workflows/publish.yml',
  },
  'git-cliff': {
    VERSION: 'git cliff --bump --tag --output CHANGELOG.md',
    TAG: 'git push --follow-tags',
    PUBLISH: '# TODO: fill in your publish command (npm publish / cargo publish / …)',
  },
  conventional: {
    VERSION:
      'npm version <major|minor|patch>   # writes CHANGELOG.md if conventional-changelog wired',
    TAG: 'git push --follow-tags',
    PUBLISH: 'npm publish',
  },
  custom: null,
  none: null,
};

const VALID_PROVIDERS = new Set(['changesets', 'git-cliff', 'conventional', 'custom', 'none']);

export async function run({ args, pkgRoot }) {
  const { flags } = parseArgs(args, { booleans: ['force', 'dry-run', 'help', 'kg'] });
  if (flags.help) {
    process.stdout.write(
      'maude init [--name <project>] [--provider <changesets|git-cliff|conventional|custom|none>] [--kg] [--force] [--dry-run]\n' +
        '  --kg   opt into the kgai knowledge-graph backend: write a thin STATE.md pointer-stub\n' +
        '         and bootstrap a local store via `kg init` (no-op when `kg` is not installed).\n'
    );
    return;
  }

  const cwd = process.cwd();
  const aiDir = resolve(cwd, '.ai');
  const skeleton = resolve(pkgRoot, 'plugins', 'flow', 'templates', 'ai-skeleton');
  const projectName = (flags.name || basename(cwd)).trim();
  if (!isValidName(projectName)) {
    throw new Error(`invalid --name "${projectName}" (must match [a-z0-9._-]+)`);
  }
  const provider = (flags.provider || 'none').trim();
  if (!VALID_PROVIDERS.has(provider)) {
    throw new Error(
      `invalid --provider "${provider}" (must be one of: ${[...VALID_PROVIDERS].join(', ')})`
    );
  }

  const skeletonExists = await pathExists(skeleton);
  if (!skeletonExists) {
    throw new Error(`skeleton not found at ${skeleton}. Reinstall maude.`);
  }

  process.stdout.write('maude init\n');
  process.stdout.write(`  project name: ${projectName}\n`);
  process.stdout.write(`  scaffold target: ${aiDir}\n`);
  process.stdout.write(`  changelog provider: ${provider}\n`);
  if (flags['dry-run']) process.stdout.write('  mode: dry-run\n');
  if (flags.force) process.stdout.write('  mode: force (overwrites)\n');

  const result = await copyTree(skeleton, aiDir, {
    force: !!flags.force,
    dryRun: !!flags['dry-run'],
    // npm strips `.gitignore` from published tarballs, so the cache-ignore
    // template ships as `gitignore` and is renamed to `.gitignore` on copy.
    rename: (name) => (name === 'gitignore' ? '.gitignore' : name),
    transformMatch: (p) => TEMPLATED.some((t) => p.endsWith(t)),
    transform: ({ srcPath, contents }) => {
      let out = contents.replaceAll(PLACEHOLDER, projectName);
      // workflows.config.json — also rewrite the relative schema path,
      // since after install the schema lives in the published package's
      // plugins/flow/.claude-plugin/ rather than at a fixed relative path
      // from .ai/ in the user's repo.
      if (srcPath.endsWith('workflows.config.json')) {
        out = out.replace(
          '"$schema": "../../plugins/flow/.claude-plugin/config.schema.json"',
          '"$schema": "https://raw.githubusercontent.com/1aGh/maude/main/plugins/flow/.claude-plugin/config.schema.json"'
        );
        // Propagate --provider into integrations.changelog.provider so the
        // first /flow:init run doesn't have to ask for what the user
        // already told us at CLI time.
        if (provider !== 'none') {
          out = out.replace(
            '"changelog": { "provider": "none" }',
            `"changelog": { "provider": "${provider}" }`
          );
        }
      }
      // release-guide.md — swap in provider-specific bash for the version /
      // tag / publish steps. `custom` / `none` leave the placeholders + TODO
      // comments intact so the user fills them in by hand.
      if (srcPath.endsWith('release-guide.md')) {
        const stub = CHANGELOG_STUBS[provider];
        if (stub) {
          out = out
            .replace('# CHANGELOG_PROVIDER_VERSION_CMD', stub.VERSION)
            .replace('# CHANGELOG_PROVIDER_TAG_CMD', stub.TAG)
            .replace('# CHANGELOG_PROVIDER_PUBLISH_CMD', stub.PUBLISH);
        } else {
          // custom / none — keep placeholders, append explicit TODO
          out = out.replaceAll(
            /# CHANGELOG_PROVIDER_(\w+)_CMD/g,
            '# CHANGELOG_PROVIDER_$1_CMD\n# TODO: fill in for your project'
          );
        }
      }
      return out;
    },
  });

  // Note: we do NOT scaffold CLAUDE.md here. That's the job of Claude Code's
  // built-in `/init` command, which analyzes the codebase and writes a
  // <200-line CLAUDE.md tailored to the project. `mdcc init` only owns
  // .ai/ — the second-brain workspace. Legacy `mdcc init` alias still works.

  const claudeMdExists =
    (await pathExists(resolve(cwd, 'CLAUDE.md'))) ||
    (await pathExists(resolve(cwd, '.claude', 'CLAUDE.md')));

  // --kg (opt-in): the knowledge graph becomes the history authority. Replace the
  // scaffolded STATE.md with a thin pointer-stub and bootstrap a local store.
  // The `knowledgeGraph` config block stays ABSENT (bias-free skeleton ⇒ auto via
  // the schema default — onboarding / `maude doctor --fix` fills store + scope).
  if (flags.kg && !flags['dry-run']) {
    const statePath = resolve(aiDir, 'state', 'STATE.md');
    await writeFile(statePath, KG_STATE_STUB, 'utf8');
    process.stdout.write('  kgai: wrote thin STATE.md pointer-stub (history lives in the graph)\n');
    const kgBin = resolveKgBin();
    if (kgBin) {
      // No --root: kgai defaults the store to `<cwd>/.kgai/store` (which the
      // resolver auto-detects and the gitignore block ignores). Passing --root
      // would place the store's loose files at cwd root instead.
      const r = spawnSync(kgBin, ['init'], {
        cwd,
        stdio: 'ignore',
        env: kgInitEnv(),
      });
      process.stdout.write(
        r.status === 0
          ? '  kgai: bootstrapped local store via `kg init` (git-author actor captured)\n'
          : '  kgai: `kg init` did not complete — run it manually (see docs/kgai-onboarding.md)\n'
      );
    } else {
      process.stdout.write(
        '  kgai: `kg` not installed — store not bootstrapped. See docs/kgai-onboarding.md.\n'
      );
    }
    process.stdout.write(
      '  kgai: set `knowledgeGraph.store` + `scope` per docs/kgai-onboarding.md\n'
    );
  } else if (flags.kg) {
    process.stdout.write('  kgai: (dry-run) would write STATE.md stub + bootstrap the store\n');
  }

  printSummary(result);
  printNextSteps(projectName, claudeMdExists, Boolean(resolveKgBin()), Boolean(flags.kg));
}

/** KGAI_BIN (desktop-staged sidecar) → `kg` on PATH → null. Mirrors kg.mjs. */
function resolveKgBin() {
  if (process.env.KGAI_BIN && existsSync(process.env.KGAI_BIN)) return process.env.KGAI_BIN;
  const probe = spawnSync('sh', ['-c', 'command -v kg'], { encoding: 'utf8' });
  const found = (probe.stdout || '').trim();
  return probe.status === 0 && found ? found : null;
}

/** Fold KGAI_LIB into DYLD_LIBRARY_PATH so a staged libkuzu resolves (desktop). */
function kgInitEnv() {
  const env = { ...process.env };
  if (process.env.KGAI_LIB) {
    env.DYLD_LIBRARY_PATH = [process.env.KGAI_LIB, process.env.DYLD_LIBRARY_PATH]
      .filter(Boolean)
      .join(':');
  }
  return env;
}

function isValidName(s) {
  return /^[a-z0-9._-]+$/i.test(s);
}

async function pathExists(p) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

function printSummary({ created, replaced, skipped }) {
  process.stdout.write(`\n  ${created.length} created`);
  if (replaced.length) process.stdout.write(`, ${replaced.length} replaced`);
  if (skipped.length) process.stdout.write(`, ${skipped.length} skipped`);
  process.stdout.write('\n');
  if (process.env.MAUDE_DEBUG || process.env.MDCC_DEBUG) {
    for (const c of created) process.stdout.write(`    + ${c}\n`);
    for (const r of replaced) process.stdout.write(`    ~ ${r}\n`);
    for (const s of skipped) process.stdout.write(`    = ${s}\n`);
  }
}

function printNextSteps(name, claudeMdExists, kgAvailable = false, usedKg = false) {
  process.stdout.write('\nNext steps:\n');
  process.stdout.write('  1. In Claude Code: /plugin marketplace add 1aGh/maude\n');
  process.stdout.write('                     /plugin install flow@maude\n');
  if (!claudeMdExists) {
    process.stdout.write('  2. /init — generate a CLAUDE.md tailored to your codebase\n');
    process.stdout.write(
      `     (Anthropic's built-in command — analyzes stack, writes <200 lines).\n`
    );
    process.stdout.write('  3. /flow:init — populates .ai/workflows.config.json with detected\n');
    process.stdout.write('     stack (platforms, tracker, language, …).\n');
  } else {
    process.stdout.write('  2. /flow:init — populates .ai/workflows.config.json with detected\n');
    process.stdout.write(
      '     stack. CLAUDE.md already exists; /init would suggest improvements.\n'
    );
  }
  process.stdout.write(`  4. Create .ai/${name}-prd.md with your product brief.\n`);
  process.stdout.write('  5. /flow:run --status to see where you are; /flow:plan to start work.\n');
  printKgOffer(kgAvailable, usedKg);
}

/**
 * Surface the knowledge-graph choice at scaffold time.
 *
 * Without this, `--kg` is discoverable only by reading `--help` — so a fresh
 * user never learns the option exists at the one moment it is cheapest to take
 * (an empty `.ai/` needs no migration). Deliberately NOT shown when `kg` is
 * absent: advertising a backend the user would first have to go install is
 * noise, and `mode:auto` picks it up by itself if they ever do.
 */
function printKgOffer(kgAvailable, usedKg) {
  if (!kgAvailable) return;
  if (usedKg) {
    process.stdout.write(
      '\nkgai: this workspace uses the knowledge graph as its decision memory.\n' +
        '      `maude kg doctor` to confirm · `maude kg search "<topic>"` to read it back.\n'
    );
    return;
  }
  process.stdout.write(
    '\nkgai: `kg` is installed on this machine, and this workspace was scaffolded\n' +
      '      CLASSIC (markdown decisions + STATE.md history). Both work; the graph\n' +
      '      makes "what did we decide about X" a query instead of a grep, and gives\n' +
      '      the gitignored .ai/logs/ verdicts a copy that travels.\n' +
      '      To switch now (empty workspace — nothing to migrate):\n' +
      '        maude init --kg --force\n' +
      '      Later, once you have decisions on disk, use the migration instead:\n' +
      '        maude kg import --dry-run --archive     (then drop --dry-run)\n'
  );
}
