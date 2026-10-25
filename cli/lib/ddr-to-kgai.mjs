// ddr-to-kgai — productionized importer (port of scripts/kgai-smoke/ddr2kgai.py,
// feature-kgai-ecosystem-integration Task 11). Turns this repo's
// `.ai/archive/decisions/DDR-*.md` into a kgai `{decisions:[…]}` batch and ingests it via
// `kg ingest --file`, so an existing file-based decision store migrates into the
// graph in one pass.
//
// Reached via `maude kg import [--dry-run] [--force] [--root PATH]` (DDR-062).
// Model A (DDR-189 scope decision): every decision is tagged `repo:`/`dept:` from
// `config.knowledgeGraph.scope` so one shared store hosts many repos.
//
// Edge model (mirrors kgai's "few stable domain elements shaped by many decisions"):
//   - each DDR → a `decision:DDR-NNN` element + shapes an `area:<primary-tag>`
//   - remaining tags → `topic:` elements, `area —TOUCHES→ topic`
//   - typed cross-refs FIRST (**Supersedes:**/**Related:**/**Extends:**/**Amends:**),
//     then bare `DDR-\d+` body mentions as weak `references`, deduped — so the
//     graph doesn't drown in the thousands of loose name-drops (plan caution #2).

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { parseArgs } from './argv.mjs';

const REF_RANK = { references: 0, extends: 1, overrides: 2, supersedes: 3 };

/** Pull a `**Label:** value` (or list-form `- **Label:** value`) field. */
function field(text, label) {
  const m = text.match(new RegExp(`^\\s*(?:[-*]\\s*)?\\*\\*${label}:\\*\\*\\s*(.+)$`, 'm'));
  return m ? m[1].trim() : '';
}

/** First paragraph under a `## Header`, whitespace-collapsed, capped. */
function firstPara(text, header) {
  const m = text.match(new RegExp(`^##+\\s*${header}\\s*$([\\s\\S]+?)(^##\\s|$(?![\\s\\S]))`, 'm'));
  if (!m) return '';
  const para = m[1]
    .trim()
    .split(/\n\s*\n/)[0]
    .trim();
  return para.replace(/\s+/g, ' ').slice(0, 400);
}

function normDate(d) {
  const m = (d || '').match(/(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : '';
}

function parseTags(raw) {
  return raw
    .split(/[,/]/)
    .map((x) =>
      x
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9\- ]/g, '')
        .trim()
        .replace(/ +/g, '-')
    )
    .filter((x) => x && x !== '—' && x !== '-')
    .slice(0, 6);
}

/**
 * Classify cross-refs. Typed markers win over bare mentions; strongest kind per
 * target is kept. Returns { 'NNN': 'supersedes'|'overrides'|'extends'|'references' }.
 */
// DDR numbering is PER-REPO, but kgai identity is `hash(kind:name)` and therefore
// GLOBAL. On a shared company store every repo's `decision:DDR-001` collapses into
// ONE node, so two unrelated decisions become competing heads on it (`kg conflicts`).
// Namespacing the name by `scope.repo` keeps each repo's numbering intact while
// making the node unique. `area:`/`topic:` are deliberately NOT namespaced — a
// concept like `area:security` SHOULD converge across repos; that is the whole
// point of a cross-repo graph.
function ddrRef(num, scope = {}) {
  return scope.repo ? `${scope.repo}/DDR-${num}` : `DDR-${num}`;
}

// Same collision class as ddrRef, one level up: milestone slugs are built from a
// DATE (`progress-2026-07-02`) or a date+phase, both of which repeat across repos.
// Two teams shipping on the same day would otherwise share one milestone node.
function scopedSlug(slug, scope = {}) {
  return scope.repo ? `${scope.repo}/${slug}` : slug;
}

function crossRefs(text, selfNum) {
  const out = {};
  const reversed = [];
  const put = (tgt, kind) => {
    if (tgt === selfNum) return;
    if (!(tgt in out) || REF_RANK[kind] > REF_RANK[out[tgt]]) out[tgt] = kind;
  };
  // Typed markers first (Appendix A.3).
  const marker = (label, kind) => {
    const re = new RegExp(`^\\s*(?:[-*]\\s*)?\\*\\*${label}:\\*\\*(.+)$`, 'gim');
    for (const line of text.matchAll(re)) {
      for (const d of line[1].matchAll(/DDR-(\d+)/g)) put(d[1].padStart(3, '0'), kind);
    }
  };
  marker('Supersedes', 'supersedes');
  marker('Related', 'references');
  marker('Relates', 'references');
  marker('Extends', 'extends');
  marker('Amends', 'extends');
  // Then bare mentions. NOT blindly `references`: a supersede is often declared
  // in prose rather than a typed marker — e.g. DDR-006's `**Status:** Superseded
  // by [DDR-191](…)`, or DDR-191's `**Related:** [DDR-006] (superseded by this
  // DDR)`. Marker-only classification silently downgrades both to `references`
  // and the supersede chain — the single most useful edge in the graph — is lost.
  // So sniff a ±80-char window around each bare mention for intent keywords
  // (restores the behavior of the scripts/kgai-smoke prototype).
  for (const d of text.matchAll(/DDR-(\d+)/g)) {
    const tgt = d[1].padStart(3, '0');
    // A typed marker is an EXPLICIT statement of intent — never let a keyword
    // that merely happens to sit within the window override it. (Caught by test:
    // "We replace the earlier approach. See … DDR-003" hijacked DDR-003's
    // `**Related:**` REFERENCES into OVERRIDES.)
    // Also skip a target already captured as a REVERSED edge — otherwise a
    // later, non-passive mention in the same file adds the opposite direction
    // too and we are back to an unusable bidirectional pair.
    if (tgt in out || reversed.some(([t]) => t === tgt)) continue;
    const before = text.slice(Math.max(0, d.index - 80), d.index).toLowerCase();
    const ctx = text.slice(Math.max(0, d.index - 80), d.index + d[0].length + 80).toLowerCase();
    // DIRECTION matters, and prose states it both ways: DDR-006 says "Superseded
    // by DDR-191" (the MENTION is the superseder) while DDR-191 says it
    // supersedes DDR-006 (SELF is). Without this the graph gets a bidirectional
    // SUPERSEDES pair and "what replaced X" becomes unanswerable. Passive voice
    // right before the mention ⇒ emit the edge reversed.
    const passive = /(superseded|replaced|overridden|retired|deprecated)\s+(by|in)\s*\[?$/.test(
      before
    );
    let kind = 'references';
    if (/supersed/.test(ctx)) kind = 'supersedes';
    else if (/\b(override|reverse[sd]?|replaces?|retire[sd]?|deprecat)/.test(ctx))
      kind = 'overrides';
    else if (/\bextend|amend/.test(ctx)) kind = 'extends';
    // Self-guard applies to BOTH branches: `put()` has one, and the reversed
    // path needs it too — DDR-025's own body says "partially superseded by
    // DDR-025", which produced a `DDR-025 ⇒ DDR-025` self-loop and made "what
    // superseded DDR-025" answer itself.
    if (tgt === selfNum) continue;
    if (passive && kind !== 'references') reversed.push([tgt, kind]);
    else put(tgt, kind);
  }
  return { out, reversed };
}

/** Build the kgai batch from a decisions dir. Pure. */
export function buildDdrBatch(decisionsDir, scope = {}, only = null) {
  const files = readdirSync(decisionsDir)
    .filter((f) => /^DDR-\d+.*\.md$/.test(f))
    // `only` = incremental mode: ingest just these (substring match on the
    // filename, so `DDR-191` or a full path both work). Re-ingesting an existing
    // DDR is SAFE and is how you refresh one whose file changed — deterministic
    // `hash(kind:name)` converges the element and props merge on re-upsert; it
    // only appends one more decision event, which is the honest record of "this
    // was re-recorded". Bulk re-import is what you must not do casually.
    .filter(
      (f) => !only || only.some((o) => f.includes(o.replace(/^.*\//, '').replace(/\.md$/, '')))
    )
    .sort();
  const decisions = [];
  const stats = { files: 0, withDate: 0, withTags: 0, crossrefs: 0, tags: new Set() };
  const scopeMuts = (name) => {
    const m = [];
    if (scope.repo) {
      m.push({ op: 'upsert_element', kind: 'repo', name: scope.repo });
      m.push({
        op: 'add_link',
        from: `decision:${name}`,
        to: `repo:${scope.repo}`,
        link: 'IN_REPO',
      });
    }
    if (scope.dept) {
      m.push({ op: 'upsert_element', kind: 'dept', name: scope.dept });
      m.push({
        op: 'add_link',
        from: `decision:${name}`,
        to: `dept:${scope.dept}`,
        link: 'IN_DEPT',
      });
    }
    return m;
  };

  for (const f of files) {
    const t = readFileSync(join(decisionsDir, f), 'utf8');
    stats.files++;
    const num = (f.match(/DDR-(\d+)/) || [null, '000'])[1];
    const title = (t.match(/^#\s*DDR-\d+:\s*(.+)$/m) || [null, f])[1].trim();
    const date = normDate(field(t, 'Date')) || normDate(field(t, 'Status'));
    const tags = parseTags(field(t, 'Tags'));
    // FULL body, not an excerpt. The goal is a real switch: the graph must hold
    // the whole decision — alternatives, consequences, revisit-when — so nothing
    // has to be read out of the .md to understand WHY. An earlier cut stored only
    // the lead paragraph (~3% of the file), which quietly made the graph an index
    // that could not stand on its own. The committed log grows to ~5 MB for this
    // corpus; that is the correct price for self-sufficiency.
    const rationale = t.trim();
    const { out: refs, reversed: revRefs } = crossRefs(t, num);
    if (date) stats.withDate++;
    if (tags.length) {
      stats.withTags++;
      for (const tg of tags) stats.tags.add(tg);
    }
    stats.crossrefs += Object.keys(refs).length;

    // A real tag (`security`, `infra`) SHOULD converge across repos — that is the
    // cross-repo value. The `general` FALLBACK is not a concept, it means "this DDR
    // had no tags", which is repo-local noise; left shared it makes every untagged
    // decision in the company a competing head on one junk node.
    const primary = tags[0] || scopedSlug('general', scope);
    const self = ddrRef(num, scope);
    const muts = [
      { op: 'upsert_element', kind: 'area', name: primary, props: { last_ddr: self } },
      {
        op: 'upsert_element',
        kind: 'decision',
        name: self,
        // `path` makes the graph an INDEX INTO the archive rather than a lossy
        // copy of it: the migration keeps only title + the first Decision/Context
        // paragraph (~3% of the file), so a hit has to be able to say WHICH file
        // holds the alternatives/consequences. `.ai/archive/decisions/*.md` IS committed,
        // so the pointer always resolves.
        props: {
          title: title.slice(0, 120),
          path: `.ai/archive/decisions/${f}`,
          ...(date ? { date } : {}),
          ...(tags.length ? { tags: tags.join(',') } : {}),
        },
      },
      { op: 'add_link', from: `decision:${self}`, to: `area:${primary}`, link: 'ABOUT' },
      ...scopeMuts(self),
    ];
    for (const tg of tags.slice(1)) {
      muts.push({ op: 'upsert_element', kind: 'topic', name: tg });
      muts.push({ op: 'add_link', from: `area:${primary}`, to: `topic:${tg}`, link: 'TOUCHES' });
    }
    for (const [tgt, kind] of Object.entries(refs)) {
      muts.push({ op: 'upsert_element', kind: 'decision', name: ddrRef(tgt, scope) });
      muts.push({
        op: 'add_link',
        from: `decision:${self}`,
        to: `decision:${ddrRef(tgt, scope)}`,
        link: kind.toUpperCase(),
      });
    }
    // Passive-voice mentions ("Superseded by DDR-191") — the MENTION supersedes
    // SELF, so the edge points the other way.
    for (const [tgt, kind] of revRefs) {
      muts.push({ op: 'upsert_element', kind: 'decision', name: ddrRef(tgt, scope) });
      muts.push({
        op: 'add_link',
        from: `decision:${ddrRef(tgt, scope)}`,
        to: `decision:${self}`,
        link: kind.toUpperCase(),
      });
    }
    const d = { title, mutations: muts };
    if (date) d.date = date;
    if (rationale) d.rationale = rationale;
    decisions.push(d);
  }
  stats.tags = stats.tags.size;
  return { batch: { decisions }, stats };
}

/**
 * `.ai/logs/**` → dated verdict/finding decisions.
 *
 * These are a DIFFERENT case from DDRs and the extraction reflects it: `.ai/logs/`
 * is **gitignored** (the repo files it under "AI workflow runtime" beside
 * device/browser/cache), so unlike `.ai/archive/decisions/*.md` these 123 files exist only
 * on the machine that produced them — while 164 committed references point AT them.
 * Once ingested, the graph (whose log IS committed) becomes the only inheritable
 * copy, so we keep a much larger excerpt than the DDR path does (which can afford
 * to be a thin index because its prose is versioned).
 */
/**
 * Directory name → node kind. Exported because `maude kg record-log` infers the
 * kind from a file's parent dir, and an inference that disagreed with the bulk
 * importer would fork the corpus in two (`rca:x` from migration, `logs:x` from
 * a live run) — the whole point is that a verdict recorded today lands on the
 * same shelf as the 120 the migration put there.
 */
export const LOG_KINDS = {
  rca: 'rca',
  'system-reviews': 'system-review',
  'code-reviews': 'code-review',
  'security-reviews': 'security-review',
  'execution-reports': 'execution-report',
  a11y: 'a11y-audit',
  visual: 'visual-review',
  '.': 'log', // loose .md sitting at the logs root (e.g. a one-off perf note)
};

/** repo:/dept: anchors + their edges — identical for every node kind. */
function scopeMutations(name, kind, scope = {}) {
  const m = [];
  if (scope.repo) {
    m.push({ op: 'upsert_element', kind: 'repo', name: scope.repo });
    m.push({ op: 'add_link', from: `${kind}:${name}`, to: `repo:${scope.repo}`, link: 'IN_REPO' });
  }
  if (scope.dept) {
    m.push({ op: 'upsert_element', kind: 'dept', name: scope.dept });
    m.push({ op: 'add_link', from: `${kind}:${name}`, to: `dept:${scope.dept}`, link: 'IN_DEPT' });
  }
  return m;
}

/**
 * Build ONE decision envelope from ONE verdict file.
 *
 * The single source of truth for "a markdown verdict becomes a graph node",
 * shared by the bulk importer (`maude kg import`) and the per-file recorder
 * (`maude kg record-log`, which the flow/design commands call as they write).
 * Keeping one function is what guarantees a `/flow:bug-rca` run tomorrow
 * produces a node shaped exactly like the ones migration created — same slug
 * rule, same props, same ABOUT/scope/EVIDENCE_FOR edges.
 *
 * @param {string} absPath   file on disk (read in full — see the full-body note above)
 * @param {string} kind      node kind (see LOG_KINDS)
 * @param {object} scope     { repo, dept }
 * @param {object} [opts]
 * @param {string} [opts.pathRel]  the `path` prop; defaults to absPath
 * @param {string} [opts.about]    attach to this element instead of `area:<kind>`
 *                                 (design verdicts hang off `canvas:<slug>`)
 * @param {string} [opts.link]     edge kind to `about` (default `ABOUT`)
 * @param {string} [opts.slug]     override the derived slug
 */
export function buildLogDecision(absPath, kind, scope = {}, opts = {}) {
  const body = readFileSync(absPath, 'utf8');
  const base = basename(absPath);
  // Log slugs come from FILENAMES (`rc-1.3.3.md`), which repeat across repos.
  const slug = scopedSlug(opts.slug ?? base.replace(/\.md$/, '').replace(/\//g, '-'), scope);
  const title = (body.match(/^#\s*(.+)$/m) || [null, slug])[1].trim();
  // `**Date:**` when the author supplied one, else the file's own mtime — these
  // files are gitignored, so git has no creation date to fall back on either.
  const explicitDate = normDate(field(body, 'Date'));
  const date = explicitDate || statSync(absPath).mtime.toISOString().slice(0, 10);
  const about = opts.about ?? `area:${kind}`;
  const [aboutKind, ...aboutRest] = about.split(':');

  const mutations = [
    {
      op: 'upsert_element',
      kind,
      name: slug,
      props: { title: title.slice(0, 160), path: opts.pathRel ?? absPath, date },
    },
    { op: 'upsert_element', kind: aboutKind, name: aboutRest.join(':') },
    { op: 'add_link', from: `${kind}:${slug}`, to: about, link: opts.link ?? 'ABOUT' },
    ...scopeMutations(slug, kind, scope),
  ];

  // Evidence edges — a review/RCA that cites a DDR is evidence ABOUT it.
  const cited = new Set([...body.matchAll(/DDR-(\d+)/g)].map((m) => m[1].padStart(3, '0')));
  for (const num of cited) {
    mutations.push({ op: 'upsert_element', kind: 'decision', name: ddrRef(num, scope) });
    mutations.push({
      op: 'add_link',
      from: `${kind}:${slug}`,
      to: `decision:${ddrRef(num, scope)}`,
      link: 'EVIDENCE_FOR',
    });
  }
  // Full body — these files are gitignored, so the graph is the ONLY copy;
  // truncating would destroy the evidence it exists to preserve.
  return {
    decision: { title, date, rationale: body.trim(), mutations },
    slug,
    citedCount: cited.size,
    hasExplicitDate: Boolean(explicitDate),
  };
}

export function buildLogBatch(logsDir, scope = {}) {
  const logsRel = logsDir.includes('/archive/') ? '.ai/archive/logs' : '.ai/logs';
  const KINDS = LOG_KINDS;
  const decisions = [];
  const stats = { files: 0, withDate: 0, cited: 0, byKind: {} };

  for (const [dir, kind] of Object.entries(KINDS)) {
    const abs = join(logsDir, dir);
    if (!existsSync(abs)) continue;
    // Recurse one level into nested dirs (a `rca/archive/` holds real verdicts —
    // a flat readdir silently skipped them). `.`-rooted loose files stay flat so
    // the pseudo-kind doesn't re-walk every sibling category.
    const listing =
      dir === '.'
        ? readdirSync(abs).filter((x) => x.endsWith('.md') && x !== 'README.md')
        : readdirSync(abs, { withFileTypes: true }).flatMap((e) =>
            e.isDirectory()
              ? readdirSync(join(abs, e.name))
                  .filter((x) => x.endsWith('.md'))
                  .map((x) => `${e.name}/${x}`)
              : e.name.endsWith('.md') && e.name !== 'README.md'
                ? [e.name]
                : []
          );
    for (const f of listing.sort()) {
      const path = join(abs, f);
      stats.files++;
      stats.byKind[kind] = (stats.byKind[kind] ?? 0) + 1;
      // Slug is derived from the path RELATIVE to the kind dir, so a nested
      // `archive/foo.md` stays `archive-foo` — buildLogDecision's basename-only
      // default would collapse it onto a sibling. Everything else is shared.
      const built = buildLogDecision(path, kind, scope, {
        pathRel: `${logsRel}/${dir}/${f}`,
        slug: f.replace(/\.md$/, '').replace(/\//g, '-'),
      });
      if (built.hasExplicitDate) stats.withDate++;
      stats.cited += built.citedCount;
      decisions.push(built.decision);
    }
  }
  return { batch: { decisions }, stats };
}

/**
 * The thin STATE.md a migrated repo keeps. Byte-identical to the stub
 * `maude init --kg` writes (cli/commands/init.mjs KG_STATE_STUB) — a repo that
 * migrated and a repo that started on the graph must not end up with two
 * different-looking breadcrumbs.
 */
const KG_STATE_STUB = `# Workflow State

> **kgai-active repo** — decision history + working context live in the knowledge graph, not this file.
> The \`flow:workflow-state\` skill reads/writes the graph via \`flow:kgai-backend\`.

**Status:** ready
**Active plan:** —

## Where the history went

- **Decisions / "why is X so":** \`maude kg search "<topic>"\` (start here) · \`maude kg context --about "<element>"\`
- **Recent movements:** \`maude kg query "MATCH (d:Decision) WHERE d.author='<you>' RETURN d.title, d.recorded_at ORDER BY d.recorded_at DESC LIMIT 10"\`
- **Conflicts:** \`maude kg conflicts\`

The pre-migration file is preserved verbatim under \`.ai/archive/state/\` — never auto-deleted.
`;

/**
 * `--archive` — the cleanup half of a migration.
 *
 * Ingest alone leaves the repo carrying both stores: the graph AND the tree it
 * replaced. This moves what the graph took over under `.ai/archive/`, which is
 * what makes "switching to kgai simplifies `.ai/`" true rather than aspirational.
 *
 * Rules it will not break:
 *  - **Never deletes.** Every source is MOVED under `.ai/archive/` (DDR-044).
 *  - **Only what the graph replaced.** `plans/`, `scenarios/`, `docs/`,
 *    `context/`, `dev-logs/`, `business/` stay live — they are narrative or
 *    procedural, not an append-only event stream the graph now owns.
 *  - **STATE.md is snapshotted, not moved.** Flow commands still read the path,
 *    so the original goes to `archive/state/` and a pointer-stub takes its place.
 *  - **Idempotent.** A second run finds the sources gone and reports "nothing to
 *    archive" instead of clobbering the archive with an empty tree.
 */
function archiveMigratedSources(projectRoot, { dryRun = false, today } = {}) {
  const ai = join(projectRoot, '.ai');
  const arch = join(ai, 'archive');
  const moved = [];
  const plan = [];

  const moveInto = (srcDir, destDir, filter = () => true) => {
    if (!existsSync(srcDir)) return;
    const entries = readdirSync(srcDir, { withFileTypes: true }).filter((e) => filter(e));
    if (!entries.length) return;
    for (const e of entries) {
      const from = join(srcDir, e.name);
      const to = join(destDir, e.name);
      plan.push(`${from.replace(`${projectRoot}/`, '')} → ${to.replace(`${projectRoot}/`, '')}`);
      if (dryRun) continue;
      mkdirSync(destDir, { recursive: true });
      // An entry already in the archive (a re-run, or a name collision across
      // nested dirs) must not be silently overwritten — keep both.
      renameSync(from, existsSync(to) ? `${to}.${Date.now()}` : to);
      moved.push(e.name);
    }
  };

  // A — decisions + their index. Under an active graph the README index has no
  // job left: `maude kg search` answers what it answered, and /flow:record-ddr no
  // longer appends to it.
  moveInto(join(ai, 'decisions'), join(arch, 'decisions'));
  // A — log verdicts (gitignored, so the graph is now their only inheritable copy).
  moveInto(join(ai, 'logs'), join(arch, 'logs'), (e) => e.name !== 'README.md');
  // A — template seeds that only exist to scaffold the two files the graph
  // replaced. PROJECT.md rides along: it had zero references even classically.
  moveInto(
    join(ai, 'templates'),
    join(arch, 'templates'),
    (e) => e.isFile() && ['STATE.md', 'HANDOFF.md', 'PROJECT.md'].includes(e.name)
  );

  // STATE.md — snapshot + stub, because the path stays live.
  const statePath = join(ai, 'state', 'STATE.md');
  if (existsSync(statePath)) {
    const body = readFileSync(statePath, 'utf8');
    const alreadyStub = body.includes('kgai-active repo');
    if (!alreadyStub) {
      const dest = join(arch, 'state', `STATE-pre-kgai-${today}.md`);
      plan.push(
        `${statePath.replace(`${projectRoot}/`, '')} → ${dest.replace(`${projectRoot}/`, '')} (+ pointer-stub)`
      );
      if (!dryRun) {
        mkdirSync(join(arch, 'state'), { recursive: true });
        writeFileSync(dest, body);
        writeFileSync(statePath, KG_STATE_STUB);
        moved.push('STATE.md');
      }
    }
  }
  // A stale HANDOFF.md would be read by `/flow:run --resume` as if it were current,
  // and under the graph it never gets refreshed again — the worst kind of stale.
  const handoff = join(ai, 'state', 'HANDOFF.md');
  if (existsSync(handoff)) {
    const dest = join(arch, 'state', `HANDOFF-pre-kgai-${today}.md`);
    plan.push(`${handoff.replace(`${projectRoot}/`, '')} → ${dest.replace(`${projectRoot}/`, '')}`);
    if (!dryRun) {
      mkdirSync(join(arch, 'state'), { recursive: true });
      renameSync(handoff, dest);
      moved.push('HANDOFF.md');
    }
  }

  return { plan, moved };
}

/** Entry — `maude kg import`. Dispatched from cli/commands/kg.mjs verbImport. */
export async function run({ args, state, projectRoot, runKg }) {
  // `args` here is already the verb's args (kg.mjs stripped the `import` token).
  const { flags } = parseArgs(args, {
    booleans: ['dry-run', 'design', 'force', 'no-logs', 'no-state', 'no-docs', 'archive'],
  });
  const only = flags.only
    ? String(flags.only)
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean)
    : null;
  // Prefer `.ai/archive/decisions` — where the prose moved once the graph became
  // the source of truth (2026-07-28) — and fall back to the classic location so
  // the importer still works on a repo that hasn't archived (every other repo).
  const decisionsDir =
    [join(projectRoot, '.ai', 'archive', 'decisions'), join(projectRoot, '.ai', 'decisions')].find(
      (d) => existsSync(d)
    ) ?? join(projectRoot, '.ai', 'decisions');
  if (!existsSync(decisionsDir)) {
    process.stderr.write(
      `maude kg import: no .ai/archive/decisions/ under ${projectRoot}. Nothing to migrate.\n`
    );
    return 1;
  }
  if (flags.design) {
    process.stderr.write(
      'maude kg import --design: the .design/ importer (canvas:/ds:/footage:/reel:) is a follow-up — not yet implemented.\n'
    );
    return 1;
  }

  const marker = join(projectRoot, '.ai', '.kgai-migrated');
  if (existsSync(marker) && !flags.force && !flags['dry-run'] && !only) {
    process.stderr.write(
      `maude kg import: already migrated (${marker} exists). Re-run with --force to ingest again (adds duplicate decision events).\n`
    );
    return 1;
  }

  // Scope is MANDATORY on a shared store, not decorative. `repo` is what makes
  // `decision:<repo>/DDR-NNN` unique (see ddrRef) and `dept` is the search bias
  // every read leans on; importing without either produces nodes that collide
  // with a sibling repo's and cannot be filtered back apart afterwards — and the
  // log is append-only, so there is no cleanup. Fail loudly instead.
  const missingScope = ['repo', 'dept'].filter((k) => !state.scope?.[k]);
  if (missingScope.length) {
    process.stderr.write(
      `maude kg import: knowledgeGraph.scope.${missingScope.join(' + .')} missing in .ai/workflows.config.json.\n` +
        `  Every decision must carry repo + dept scope before it reaches a shared store.\n` +
        `  Add e.g. "scope": { "repo": "<this-repo>", "dept": "dev" } and re-run.\n`
    );
    return 1;
  }

  const { batch, stats } = buildDdrBatch(decisionsDir, state.scope, only);

  // `.ai/logs/**` rides the same import unless --no-logs. Deliberately NOT a
  // separate opt-in verb: these files are gitignored, so leaving them out is how
  // the RCA/security-review knowledge stays machine-local and dies on a clone.
  const logsDir = [
    join(projectRoot, '.ai', 'archive', 'logs'),
    join(projectRoot, '.ai', 'logs'),
  ].find((d) => existsSync(d));
  let logStats = null;
  if (!only && !flags['no-logs'] && logsDir) {
    const logs = buildLogBatch(logsDir, state.scope);
    logStats = logs.stats;
    batch.decisions.push(...logs.batch.decisions);
  }

  // Narrative docs (B-class) — node + full body so `kg search "PRD"` resolves.
  let docsStats = null;
  if (!only && !flags['no-docs']) {
    const dcs = buildDocsBatch(join(projectRoot, '.ai'), state.scope);
    if (dcs.batch.decisions.length) {
      docsStats = dcs.stats;
      batch.decisions.push(...dcs.batch.decisions);
    }
  }

  // STATE.md rides the same import — it is an event stream, not a document.
  let stateStats = null;
  if (!only && !flags['no-state']) {
    // Prefer the ARCHIVED pre-migration STATE (the live one is a pointer-stub
    // once the graph took over); fall back to the live file on a repo that
    // hasn't migrated yet.
    const archState = join(projectRoot, '.ai', 'archive', 'state');
    const statePath =
      [
        ...(existsSync(archState) ? readdirSync(archState, { withFileTypes: true }) : [])
          .filter((e) => e.isFile() && e.name.endsWith('.md'))
          .map((e) => join(archState, e.name))
          .sort(),
      ][0] ?? join(projectRoot, '.ai', 'state', 'STATE.md');
    const st = buildStateBatch(statePath, state.scope);
    if (st.batch.decisions.length) {
      stateStats = st.stats;
      batch.decisions.push(...st.batch.decisions);
    }
  }

  const totalMuts = batch.decisions.reduce((n, d) => n + d.mutations.length, 0);

  process.stdout.write(
    `maude kg import${flags['dry-run'] ? ' (dry-run)' : ''}\n` +
      `  source:     ${decisionsDir}\n` +
      `  scope:      ${JSON.stringify(state.scope)}\n` +
      `  decisions:  ${batch.decisions.length}\n` +
      `  mutations:  ${totalMuts}\n` +
      `  with date:  ${stats.withDate}   with tags: ${stats.withTags}   cross-refs: ${stats.crossrefs}   distinct tags: ${stats.tags}\n` +
      (logStats
        ? `  logs:       ${logStats.files} (${Object.entries(logStats.byKind)
            .map(([k, n]) => `${k}:${n}`)
            .join(' ')}), ${logStats.cited} evidence edges\n`
        : '  logs:       skipped (--no-logs)\n') +
      (stateStats
        ? `  state:      ${stateStats.progress} progress blocks + ${stateStats.history} history rows (STATE.md event stream)\n`
        : '  state:      skipped\n') +
      (docsStats ? `  docs:       ${docsStats.files} narrative docs (doc: nodes)\n` : '')
  );

  if (flags['dry-run']) {
    const sample = batch.decisions[0];
    if (sample) {
      process.stdout.write(
        `  sample:     ${sample.title}\n              ${JSON.stringify(sample.mutations.slice(0, 4))}\n`
      );
    }
    if (flags.archive) {
      const { plan } = archiveMigratedSources(projectRoot, {
        dryRun: true,
        today: new Date().toISOString().slice(0, 10),
      });
      process.stdout.write(
        plan.length
          ? `  archive:    ${plan.length} moves planned —\n${plan.map((l) => `              ${l}\n`).join('')}`
          : '  archive:    nothing to move (already archived)\n'
      );
    }
    process.stdout.write(
      '  (dry-run — nothing written. `.ai/archive/decisions/` is preserved as archive.)\n'
    );
    return 0;
  }

  if (!state.active) {
    process.stderr.write(
      'maude kg import: kgai is inactive here (mode/off or no kg/store). Run `maude kg doctor`.\n'
    );
    return 1;
  }

  // Write the batch to a temp file and ingest via `kg ingest --file` (avoids stdin plumbing).
  const tmp = join(
    tmpdir(),
    `kg-import-${state.scope.repo || 'repo'}-${batch.decisions.length}.json`
  );
  writeFileSync(tmp, JSON.stringify(batch));
  const status = runKg(['ingest', '--file', tmp]);
  if (status === 0) {
    writeFileSync(
      marker,
      `migrated ${batch.decisions.length} decisions on ${new Date().toISOString()}\n`
    );
    process.stdout.write(
      `  ✓ ingested. Marker: ${marker} (re-import needs --force). Archive kept: ${decisionsDir}\n`
    );
    // ONLY after a clean ingest. Archiving on a failed one would move the
    // sources out from under a graph that never received them — the one way
    // this migration could actually lose someone's decisions.
    if (flags.archive) {
      const { plan, moved } = archiveMigratedSources(projectRoot, {
        today: new Date().toISOString().slice(0, 10),
      });
      if (moved.length) {
        process.stdout.write(`  ✓ archived ${moved.length} sources under .ai/archive/:\n`);
        for (const line of plan) process.stdout.write(`      ${line}\n`);
        process.stdout.write(
          '    Nothing was deleted. `plans/`, `scenarios/`, `docs/`, `context/` stay live.\n' +
            '    Grep the repo for the old paths — this does NOT rewrite references.\n'
        );
      } else {
        process.stdout.write('  · archive: nothing left to move (already archived).\n');
      }
    }
  }
  return status;
}

/**
 * `.ai/state/STATE.md` → dated milestone events.
 *
 * STATE.md is an EVENT STREAM, not a document: 88 `## Execution Progress` blocks
 * and 127 `| date | phase | note |` History rows on this repo — 930 KB that grows
 * forever and that nothing but a human ever reads end-to-end. Each entry is
 * already dated and already describes one movement, so it maps 1:1 onto a kgai
 * decision. Once ingested, STATE.md can shrink to a pointer-stub (`maude init
 * --kg` writes one) and the history is queryable instead of scrollable.
 */
export function buildStateBatch(statePath, scope = {}) {
  const decisions = [];
  const stats = { progress: 0, history: 0 };
  if (!existsSync(statePath)) return { batch: { decisions }, stats };
  const t = readFileSync(statePath, 'utf8');
  const scopeMuts = (ref) => {
    const m = [];
    if (scope.repo) {
      m.push({ op: 'upsert_element', kind: 'repo', name: scope.repo });
      m.push({ op: 'add_link', from: ref, to: `repo:${scope.repo}`, link: 'IN_REPO' });
    }
    if (scope.dept) {
      m.push({ op: 'upsert_element', kind: 'dept', name: scope.dept });
      m.push({ op: 'add_link', from: ref, to: `dept:${scope.dept}`, link: 'IN_DEPT' });
    }
    return m;
  };

  // `## Execution Progress — <feature> — <prose>` blocks, body = up to the next `## `.
  const blocks = t.split(/^## (?=Execution Progress)/m).slice(1);
  for (const raw of blocks) {
    const body = raw.split(/^## /m)[0].trim();
    const header = body.split('\n')[0];
    const feature = (header.match(/(feature-[a-z0-9.-]+|phase-[a-z0-9.-]+)/i) || [])[1] || null;
    const date = (body.match(/(\d{4}-\d{2}-\d{2})/) || [])[1];
    const slug = scopedSlug(
      `${feature || 'progress'}-${date || String(decisions.length).padStart(3, '0')}`,
      scope
    );
    const ref = `milestone:${slug}`;
    const muts = [
      {
        op: 'upsert_element',
        kind: 'milestone',
        name: slug,
        props: { source: '.ai/state/STATE.md', ...(date ? { date } : {}) },
      },
      ...scopeMuts(ref),
    ];
    if (feature) {
      const planName = scopedSlug(feature, scope);
      muts.push({ op: 'upsert_element', kind: 'plan', name: planName });
      muts.push({ op: 'add_link', from: ref, to: `plan:${planName}`, link: 'PROGRESS_ON' });
    }
    const d = {
      title: header.replace(/\*\*/g, '').slice(0, 160),
      rationale: body,
      mutations: muts,
    };
    if (date) d.date = date;
    decisions.push(d);
    stats.progress++;
  }

  // History table rows: | YYYY-MM-DD | phase | note |
  for (const row of t.matchAll(/^\|\s*(\d{4}-\d{2}-\d{2})\s*\|([^|]*)\|([^|]*)\|(.*)$/gm)) {
    const [, date, phase, status, note] = row;
    const slug = scopedSlug(
      `history-${date}-${phase
        .trim()
        .replace(/[^a-z0-9.-]+/gi, '-')
        .toLowerCase()}`.slice(0, 90),
      scope
    );
    const ref = `milestone:${slug}`;
    decisions.push({
      title: `${date} · ${phase.trim()} · ${status.trim()}`.slice(0, 160),
      date,
      rationale: `${phase.trim()} — ${status.trim()}: ${note.trim()}`.slice(0, 4000),
      mutations: [
        {
          op: 'upsert_element',
          kind: 'milestone',
          name: slug,
          props: { source: '.ai/state/STATE.md', date },
        },
        ...scopeMuts(ref),
      ],
    });
    stats.history++;
  }
  return { batch: { decisions }, stats };
}

/**
 * Narrative docs (`docs/`, `dev-logs/`, `context/`) → `doc:` nodes, full body.
 *
 * B-class in the plan's taxonomy: prose a human reads start-to-finish (PRD,
 * patterns, research notes), not a dated decision. They still belong in the graph
 * — the PRD is the single most-referenced piece of context in the repo and
 * `kg search "PRD"` returning nothing is a hole. Indexes (`README.md`) and
 * regenerable snapshots (`codebase-map.md`) stay out: D-class.
 */
export function buildDocsBatch(aiDir, scope = {}) {
  const SKIP = new Set(['README.md', 'INDEX.md', 'codebase-map.md']);
  const decisions = [];
  const stats = { files: 0 };
  for (const sub of ['docs', 'dev-logs', 'context']) {
    const abs = join(aiDir, sub);
    if (!existsSync(abs)) continue;
    for (const f of readdirSync(abs)
      .filter((x) => x.endsWith('.md') && !SKIP.has(x))
      .sort()) {
      const t = readFileSync(join(abs, f), 'utf8');
      // Doc names are filenames — every repo has a `PRD.md`.
      const slug = scopedSlug(f.replace(/\.md$/, ''), scope);
      const title = (t.match(/^#\s*(.+)$/m) || [null, slug])[1].trim();
      const ref = `doc:${slug}`;
      const muts = [
        {
          op: 'upsert_element',
          kind: 'doc',
          name: slug,
          props: { title: title.slice(0, 160), path: `.ai/${sub}/${f}`, area: sub },
        },
      ];
      if (scope.repo) {
        muts.push({ op: 'upsert_element', kind: 'repo', name: scope.repo });
        muts.push({ op: 'add_link', from: ref, to: `repo:${scope.repo}`, link: 'IN_REPO' });
      }
      if (scope.dept) {
        muts.push({ op: 'upsert_element', kind: 'dept', name: scope.dept });
        muts.push({ op: 'add_link', from: ref, to: `dept:${scope.dept}`, link: 'IN_DEPT' });
      }
      // A doc that cites DDRs is context ABOUT them.
      for (const num of new Set([...t.matchAll(/DDR-(\d+)/g)].map((m) => m[1].padStart(3, '0')))) {
        muts.push({ op: 'upsert_element', kind: 'decision', name: ddrRef(num, scope) });
        muts.push({
          op: 'add_link',
          from: ref,
          to: `decision:${ddrRef(num, scope)}`,
          link: 'REFERENCES',
        });
      }
      decisions.push({
        title: `Doc: ${title}`.slice(0, 160),
        rationale: t.trim(),
        mutations: muts,
      });
      stats.files++;
    }
  }
  return { batch: { decisions }, stats };
}
