// agent-journeys/graders.mjs — the deterministic graders of an agent journey (S12.15, D14).
//
// A grader reads what the run LEFT, never what the model SAID:
//   - files under the design root (canvas TSX, `.meta.json`, `*.annotations.json`, `_comments/`),
//   - the project store `_state/project-store.sqlite` (Version history: the actions log, its
//     effects, names, the derived Trash) through the hub's own readers (store-core.mjs),
//   - the trial's logs, which the lanes write from machine events, not prose:
//       denies.jsonl   one line per tool call a hook or the studio refused {lane, tool, code, reason}
//       ui-open.jsonl  one line per `ui-open` frame the harness's stand-in shell received {open}
//       tools.jsonl    one line per tool call the agent made {lane, name, input}
//   - the baseline (the fixture's git HEAD) for "kept" / "untouched" checks.
//
// `observe()` gathers that once; every grader is a pure function of (params, observation).

import { Database } from 'bun:sqlite';
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { createStoreCore } from '../../../hub/src/project-transactions/store-core.mjs';
import { parseBoard } from '../../annotations/schema.ts';
import { canvasSlugFromRel } from '../../canvas-slug.ts';
import { initialModel } from '../../client/v2/present/order-notes-model.js';
import { attributeArtboards, scanCanvas } from '../agent-evals/lib/tsx.mjs';

export const DESIGN = '.design';
export const STORE_REL = '_state/project-store.sqlite';

const readOr = (abs) => {
  try {
    return readFileSync(abs, 'utf8');
  } catch {
    return null;
  }
};
const jsonOr = (abs, dflt = null) => {
  const t = readOr(abs);
  if (t === null) return dflt;
  try {
    return JSON.parse(t);
  } catch {
    return dflt;
  }
};
export const readJsonl = (abs) =>
  (readOr(abs) ?? '')
    .split('\n')
    .filter(Boolean)
    .flatMap((l) => {
      try {
        return [JSON.parse(l)];
      } catch {
        return [];
      }
    });

/** Store paths may be repo-relative (`.design/ui/X.tsx`) or design-relative; compare design-relative. */
export const designRelOf = (p) =>
  typeof p === 'string' ? p.replace(/^\.\//, '').replace(/^\.design\//, '') : null;

/** The bun:sqlite adapter store-core takes (same shape as sync/local-kernel.ts bunSqliteAdapter). */
export function sqlAdapter(db) {
  return {
    exec(query, ...params) {
      const s = db.query(query);
      if (s.columnNames.length > 0) return s.all(...params);
      s.run(...params);
      return [];
    },
    transaction(fn) {
      return db.transaction(fn)();
    },
  };
}

function readStore(designRoot) {
  const file = join(designRoot, STORE_REL);
  if (!existsSync(file))
    return {
      present: false,
      actions: [],
      trash: { canvases: [], artboards: [] },
      docs: [],
      names: [],
    };
  const db = new Database(file, { readonly: true });
  try {
    db.exec('PRAGMA busy_timeout = 2000');
    const core = createStoreCore(sqlAdapter(db));
    const actions = [];
    let before = null;
    for (let i = 0; i < 20; i++) {
      const page = core.history({ limit: 200, before });
      actions.push(...page);
      if (page.length < 200) break;
      before = page[page.length - 1].revision;
    }
    actions.sort((a, b) => a.revision - b.revision);
    const docs = core.manifest().docs ?? [];
    const names = [...new Set(docs.map((d) => d.entry))].flatMap((e) => core.names(e));
    return { present: true, actions, trash: core.trash({}), docs, names };
  } finally {
    db.close();
  }
}

function headOf(project, path) {
  try {
    return execFileSync('git', ['show', `HEAD:${path}`], {
      cwd: project,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch {
    return null;
  }
}

/** Gather everything the graders read, once. `trialDir` holds the lane logs (may be absent). */
export function observe({ project, trialDir = null }) {
  const designRoot = join(project, DESIGN);
  const log = (name) => (trialDir ? readJsonl(join(trialDir, name)) : []);
  return {
    project,
    designRoot,
    store: readStore(designRoot),
    denies: log('denies.jsonl'),
    uiOpen: log('ui-open.jsonl'),
    tools: log('tools.jsonl'),
    text: (rel) => readOr(join(designRoot, rel)),
    /** file names directly under a design-root folder (S12.16: assets/, …); [] when it is not there */
    list: (rel) => {
      try {
        return readdirSync(join(designRoot, rel));
      } catch {
        return [];
      }
    },
    json: (rel, dflt = null) => jsonOr(join(designRoot, rel), dflt),
    baseline: (rel) => headOf(project, `${DESIGN}/${rel}`),
    comments: (rel) =>
      jsonOr(join(designRoot, '_comments', `${canvasSlugFromRel(rel, DESIGN)}.json`), []),
    board: (rel) => {
      const t = readOr(join(designRoot, `${canvasSlugFromRel(rel, DESIGN)}.annotations.json`));
      return t === null ? [] : parseBoard(t).elements;
    },
  };
}

// ───────────────────────────── helpers over the observation ─────────────────────────────

/** An action is the AI's when the kernel stamped it `ai` or its origin names a run (V2-1.5 §5.2). */
export const byAi = (a) => a.kind === 'ai' || !!a.origin?.runId;

/** Every entry id a path has had (create / move target / live doc), so a rename keeps the history. */
function entriesOf(o, rel) {
  const out = new Set();
  for (const d of o.store.docs) if (designRelOf(d.path) === rel) out.add(d.entry);
  for (const a of o.store.actions)
    for (const e of a.effects ?? [])
      if (e.entry && (designRelOf(e.afterPath) === rel || designRelOf(e.beforePath) === rel))
        out.add(e.entry);
  return out;
}
const touchesEntry = (a, entries) => (a.effects ?? []).some((e) => e.entry && entries.has(e.entry));

const ids = (src) => [...String(src ?? '').matchAll(/data-cd-id="([^"]+)"/g)].map((m) => m[1]);
const re = (s) => (s instanceof RegExp ? s : new RegExp(s, 'i'));
const ok = (pass, why = '') => ({ pass: !!pass, why: pass ? '' : why });

function artboardSlice(rel, src, artboard) {
  if (src === null) return null;
  const s = scanCanvas(rel, src);
  const ab = s.artboards.find((a) => a.id === artboard);
  return ab ? src.slice(ab.start, ab.end) : null;
}

// ───────────────────────────── the graders ─────────────────────────────
// Each: (params, observation) → { pass, why }. Params come from the journey JSON.

/**
 * JSX elements an artboard gets from the local components it renders (`<Page />` -> `function Page`),
 * transitively. An artboard is filled by what it renders, not only by what is written inside its tag
 * (the same reading as the run lease's helper-component zones). Components defined elsewhere count 0.
 */
function componentElements(src, slice, seen = new Set(), depth = 0) {
  if (depth > 4) return 0;
  let n = 0;
  for (const [, name] of slice.matchAll(/<([A-Z][A-Za-z0-9]*)\b/g)) {
    if (seen.has(name) || name.startsWith('DC')) continue;
    seen.add(name);
    const def = new RegExp(
      `^(?:export\\s+)?(?:function\\s+${name}\\b|const\\s+${name}\\s*=)`,
      'm'
    ).exec(src);
    if (!def) continue;
    const rest = src.slice(def.index + def[0].length);
    const end = rest.search(/\n(?:export\s+(?:default\s+)?)?(?:function|const|class)\s/);
    const body = end < 0 ? rest : rest.slice(0, end);
    n += (body.match(/<[A-Za-z]/g) ?? []).length + componentElements(src, body, seen, depth + 1);
  }
  return n;
}

export const GRADERS = {
  /** A canvas file exists (or, `exists:false`, does not). */
  'canvas-exists'({ path, exists = true }, o) {
    const has = o.text(path) !== null;
    return ok(has === exists, `${path} ${has ? 'exists' : 'is missing'}`);
  },

  /**
   * A canvas parses and holds at least `min` artboards; `sized`: each has a literal width and height;
   * `kinds`: at least one artboard carries one of these `kind="…"`s; `minElements`: each artboard
   * holds that many JSX elements (the artboard itself counts), so a draft is not empty shells.
   */
  artboards({ path, min = 1, sized = false, kinds, minElements = 0 }, o) {
    const src = o.text(path);
    if (src === null) return ok(false, `${path} is missing`);
    const s = scanCanvas(path, src);
    if (!s.ok) return ok(false, `${path} does not parse: ${s.error}`);
    const why = [];
    if (s.artboards.length < min) why.push(`${s.artboards.length} artboard(s), want ${min}`);
    const open = (a) => src.slice(a.start, a.end).split('>')[0];
    if (sized) {
      const bare = s.artboards.filter(
        (a) => !/\bwidth=/.test(open(a)) || !/\bheight=/.test(open(a))
      );
      if (bare.length) why.push(`no width/height on ${bare.map((a) => a.id).join(', ')}`);
    }
    if (kinds && !s.artboards.some((a) => kinds.some((k) => open(a).includes(`kind="${k}"`))))
      why.push(`no artboard of kind ${kinds.join(' | ')}`);
    if (minElements) {
      const thin = s.artboards.filter(
        (a) =>
          s.elements.filter((e) => e.artboard === a.id).length +
            componentElements(src, src.slice(a.start, a.end)) <
          minElements
      );
      if (thin.length)
        why.push(`under ${minElements} elements: ${thin.map((a) => a.id).join(', ')}`);
    }
    return ok(!why.length, why.join('; '));
  },

  /**
   * At least `min` files directly under the design-root folder `dir` whose name matches `match`,
   * each containing every `has` and none of `lacks` (regexes). `assets/` after an import, say.
   */
  files({ dir, match, has = [], lacks = [], min = 1 }, o) {
    const names = o.list(dir).filter((n) => re(match).test(n));
    const good = names.filter((n) => {
      const t = o.text(`${dir}/${n}`) ?? '';
      return has.every((h) => re(h).test(t)) && !lacks.some((h) => re(h).test(t));
    });
    return ok(
      good.length >= min,
      `${good.length}/${names.length} file(s) in ${dir}/ match /${match}/ with the wanted content (want ${min})`
    );
  },

  /** The agent made a tool call matching `tool` (regex on the name) whose input matches `input` (regex on the JSON). */
  'tool-used'({ tool, input, min = 1 }, o) {
    const hits = o.tools.filter(
      (t) =>
        re(`^(?:${tool})$`).test(String(t.name)) &&
        (input === undefined || re(input).test(JSON.stringify(t.input ?? {})))
    );
    return ok(
      hits.length >= min,
      `${hits.length} call(s) of ${tool}${input ? ` matching /${input}/` : ''} (${o.tools.length} tool call(s) in all)`
    );
  },

  /** The file's text matches every `has` and none of `lacks` (regexes). */
  text({ path, has = [], lacks = [] }, o) {
    const t = o.text(path);
    if (t === null) return ok(false, `${path} is missing`);
    const miss = has.filter((h) => !re(h).test(t));
    const extra = lacks.filter((h) => re(h).test(t));
    return ok(
      !miss.length && !extra.length,
      [...miss.map((m) => `no /${m}/`), ...extra.map((m) => `still /${m}/`)].join('; ')
    );
  },

  /**
   * Version history holds [min, max] actions on `path`'s entry matching `kind` (string or list),
   * `by` ('ai' | 'person'), `op` (an effect op, e.g. create / move / delete / restore) and `label`.
   */
  history({ path, kind, by, op, label, first = false, min = 1, max = Infinity }, o) {
    if (!o.store.present) return ok(false, 'no project store (_state/project-store.sqlite)');
    const entries = path ? entriesOf(o, path) : null;
    const kinds = kind === undefined ? null : [kind].flat();
    let hits = o.store.actions.filter(
      (a) =>
        (!entries || touchesEntry(a, entries)) &&
        (!kinds || kinds.includes(a.kind)) &&
        (op === undefined || (a.effects ?? []).some((e) => e.op === op)) &&
        (label === undefined || re(label).test(String(a.label ?? '')))
    );
    // `first`: only the earliest such action counts (who CREATED it, not who later restored it)
    if (first) hits = hits.slice(0, 1);
    hits = hits.filter((a) => by === undefined || (by === 'ai') === byAi(a));
    return ok(
      hits.length >= min && hits.length <= max,
      `${hits.length} matching action(s) on ${path ?? 'the project'} (want ${min}…${max === Infinity ? '∞' : max}; kind ${kinds ?? 'any'}, by ${by ?? 'any'}, op ${op ?? 'any'})`
    );
  },

  /** The canvas was renamed / moved from `from` to `to` (one `@manifest move` effect; the entry survives). */
  moved({ from, to }, o) {
    const hit = o.store.actions.some((a) =>
      (a.effects ?? []).some(
        (e) =>
          e.lane === '@manifest' &&
          e.op === 'move' &&
          designRelOf(e.beforePath) === from &&
          designRelOf(e.afterPath) === to
      )
    );
    return ok(
      hit && o.text(to) !== null && o.text(from) === null,
      `no move ${from} → ${to} in Version history (or the files disagree)`
    );
  },

  /**
   * The Trash state of a canvas. `state:'restored'`: it was moved to the trash (a `@manifest delete`
   * effect) and is live again, not listed. `state:'in-trash'`: it is listed.
   */
  trash({ path, state }, o) {
    const listed = o.store.trash.canvases.some((c) => designRelOf(c.path) === path);
    const wasTrashed = o.store.actions.some((a) =>
      (a.effects ?? []).some(
        (e) => e.lane === '@manifest' && e.op === 'delete' && designRelOf(e.beforePath) === path
      )
    );
    const live = o.store.docs.some((d) => !d.retired && designRelOf(d.path) === path);
    if (state === 'in-trash') return ok(listed, `${path} is not in the Trash`);
    return ok(
      wasTrashed && live && !listed && o.text(path) !== null,
      `${path}: trashed ${wasTrashed}, live ${live}, still listed ${listed}`
    );
  },

  /** Every `data-cd-id` the baseline canvas had is still there (V2-1.4: ids are kept). */
  'ids-kept'({ path }, o) {
    const before = ids(o.baseline(path));
    const after = new Set(ids(o.text(path)));
    const lost = before.filter((i) => !after.has(i));
    return ok(
      before.length > 0 && !lost.length,
      before.length ? `lost ids: ${lost.slice(0, 8).join(', ')}` : 'baseline has no ids'
    );
  },

  /** An element (optionally `element`) carries `data-cd-link="<target>"` next to its literal `data-cd-id` (S3 links). */
  link({ path, target, element }, o) {
    const t = o.text(path) ?? '';
    const tags = [...t.matchAll(/<[A-Za-z][^<>]*?data-cd-link="([^"]+)"[^<>]*>/g)];
    const hit = tags.some((m) => {
      const cd = /data-cd-id="([^"]+)"/.exec(m[0])?.[1];
      return m[1] === target && !!cd && (element === undefined || cd === element);
    });
    return ok(hit, `no element${element ? ` ${element}` : ''} links to ${target}`);
  },

  /**
   * What Present plays (`run`: `present.order` + `present.skip` of `<canvas>.meta.json` over the
   * canvas's artboards, through Present's own `initialModel`) equals `run`; `notes` (artboard →
   * regex) are in `artboardMeta.<id>.notes`.
   */
  present({ path, run, notes = {} }, o) {
    const meta = o.json(path.replace(/\.tsx$/, '.meta.json'), {});
    const why = [];
    if (run) {
      const artboards = scanCanvas(path, o.text(path) ?? '').artboards.map((a) => ({
        id: a.id,
        label: a.label,
      }));
      const model = initialModel(artboards, { present: meta?.present ?? null });
      const got = model.rows.filter((r) => !r.skipped).map((r) => r.id);
      if (JSON.stringify(got) !== JSON.stringify(run))
        why.push(`Present plays ${JSON.stringify(got)} ≠ ${JSON.stringify(run)}`);
    }
    for (const [ab, n] of Object.entries(notes))
      if (!re(n).test(String(meta?.artboardMeta?.[ab]?.notes ?? '')))
        why.push(`${ab} notes don't match /${n}/`);
    return ok(!why.length, why.join('; '));
  },

  /** The stand-in shell received a `ui-open` for `canvas` in `mode` (`maude design open`, UI ≡ verb). */
  'ui-open'({ canvas, mode, panel }, o) {
    const hit = o.uiOpen.some((f) => {
      const x = f.open ?? {};
      if (panel !== undefined) return x.panel === panel;
      return (
        designRelOf(x.canvas ?? x.rel ?? x.file) === canvas &&
        (mode === undefined || x.mode === mode)
      );
    });
    return ok(
      hit,
      `no ui-open ${panel ? `panel ${panel}` : `${canvas} ${mode ?? ''}`} (${o.uiOpen.length} frame(s))`
    );
  },

  /** A sticky the AI wrote on `path`'s annotations (text /textRe/), resolved by AI when `resolved`. */
  sticky({ path, text, resolved }, o) {
    const s = o
      .board(path)
      .filter(
        (e) => e.type === 'sticky' && e.author?.kind === 'ai' && re(text).test(String(e.text ?? ''))
      );
    if (!s.length) return ok(false, `no AI sticky /${text}/ on ${path}`);
    if (resolved === undefined) return ok(true);
    const r = s.some((e) => (resolved ? !!e.resolved : !e.resolved));
    return ok(r, `the sticky is ${resolved ? 'not resolved' : 'resolved'}`);
  },

  /** A sticker (a gallery picture: `sticker:{pack,id}`) the AI placed on `path`'s annotations. */
  sticker({ path, min = 1 }, o) {
    const n = o.board(path).filter((e) => e.sticker && e.author?.kind === 'ai').length;
    return ok(n >= min, `${n} AI sticker(s) on ${path}`);
  },

  /**
   * Each comment thread `ids` on `path` is `status` and carries a reply by `replyBy` ('ai').
   * `replyHas` ({ id: regex }) also wants one of those replies to say it (what changed).
   */
  comments({ path, ids: want, status = 'resolved', replyBy = 'ai', replyHas = {} }, o) {
    const threads = o.comments(path);
    const why = [];
    for (const id of want) {
      const t = threads.find((x) => x.id === id);
      if (!t) {
        why.push(`${id} missing`);
        continue;
      }
      if (t.status !== status) why.push(`${id} is ${t.status}`);
      const replies = (t.thread ?? []).filter((r) =>
        replyBy === 'ai' ? r.authorKind === 'ai' : r.authorKind !== 'ai'
      );
      if (!replies.length) why.push(`${id} has no ${replyBy} reply`);
      else if (replyHas[id] && !replies.some((r) => re(replyHas[id]).test(String(r.body ?? ''))))
        why.push(`${id}: no reply says /${replyHas[id]}/`);
    }
    return ok(!why.length, why.join('; '));
  },

  /**
   * One run = one undo step (V2-1.5): every AI run that touched `path` shows up as exactly ONE
   * action, and there are [minRuns, maxRuns] such runs.
   */
  'one-undo-step'({ path, minRuns = 1, maxRuns = Infinity }, o) {
    if (!o.store.present) return ok(false, 'no project store');
    const entries = entriesOf(o, path);
    const runs = new Map();
    for (const a of o.store.actions) {
      if (!byAi(a) || !touchesEntry(a, entries) || a.kind === 'undo' || a.kind === 'redo') continue;
      const k = a.origin?.runId ?? `no-run:${a.actionId}`;
      runs.set(k, (runs.get(k) ?? 0) + 1);
    }
    const split = [...runs.entries()].filter(([, n]) => n !== 1);
    const noRun = [...runs.keys()].filter((k) => k.startsWith('no-run:'));
    return ok(
      runs.size >= minRuns && runs.size <= maxRuns && !split.length && !noRun.length,
      `${runs.size} AI run(s) on ${path}; split: ${split.map(([k, n]) => `${k}×${n}`).join(', ') || 'none'}; unattributed: ${noRun.length}`
    );
  },

  /** A tool call was refused with `code` (`artboard-busy`, `soft-locked`, `out-of-scope`, …). */
  denied({ code, min = 1 }, o) {
    const n = o.denies.filter((d) => d.code === code).length;
    return ok(
      n >= min,
      `${n} '${code}' denial(s) (denies: ${[...new Set(o.denies.map((d) => d.code))].join(', ') || 'none'})`
    );
  },

  /**
   * Without `artboard`: the file is byte-equal to the baseline. With it: no change since the
   * baseline reaches that artboard — its own JSX and every shared declaration it renders
   * (`attributeArtboards`, V2-1.5 §5.7, lenient as the eval graders use it); a whole-file change
   * reaches every artboard.
   */
  untouched({ path, artboard }, o) {
    const base = o.baseline(path);
    const cur = o.text(path);
    if (base === null) return ok(false, `${path} has no baseline`);
    if (!artboard) return ok(base === cur, `${path} changed`);
    if (cur === null) return ok(false, `${path} is gone`);
    if (artboardSlice(path, cur, artboard) === null)
      return ok(false, `artboard ${artboard} is gone`);
    const r = attributeArtboards(path, base, cur, { lenient: true });
    const reached = r.scope === 'file' || r.artboards.includes(artboard);
    return ok(
      !reached,
      `a change reaches ${artboard} (${r.scope}${r.reason ? `: ${r.reason}` : ''})`
    );
  },

  /**
   * The agent made no tool call matching `tool` (regex on the name) with an input matching `input`
   * (regex on the JSON). Used for "through the verb, not by hand" (no Edit of `_comments/`, no `rm`).
   */
  'no-tool'({ tool, input }, o) {
    const hits = o.tools.filter(
      (t) =>
        re(`^(?:${tool})$`).test(String(t.name)) &&
        (input === undefined || re(input).test(JSON.stringify(t.input ?? {})))
    );
    return ok(
      !hits.length,
      `${hits.length} call(s): ${hits
        .slice(0, 2)
        .map((h) => `${h.name} ${JSON.stringify(h.input).slice(0, 120)}`)
        .join(' | ')}`
    );
  },
};

/** Grade one journey on one observation → { pass, results: [{id, kind, pass, why}] }. */
export function gradeJourney(journey, o) {
  const results = journey.graders.map((g) => {
    const fn = GRADERS[g.grader];
    if (!fn) return { id: g.id, grader: g.grader, pass: false, why: `unknown grader ${g.grader}` };
    try {
      return { id: g.id, grader: g.grader, ...fn(g, o) };
    } catch (e) {
      return { id: g.id, grader: g.grader, pass: false, why: `grader threw: ${e?.message ?? e}` };
    }
  });
  return { journey: journey.id, pass: results.every((r) => r.pass), results };
}
