// agent-evals/lib/check.mjs — PROTOTYPE of the `maude design check` fast tier (V2-1.18 §5.2).
//
// The eval uses it twice: as a grader ("check green") and inside the prototype PostToolUse hook
// (harness/hook.mjs) so a bad write is rolled back and the reason goes back to the model. The
// real verb (V2-2.4b) owns the shipped implementation; this file is the measured reference for
// what the fast tier contains and what it costs.
//
//   checkFile(abs, { against?: string|null, designRoot }) → { ok, kind, errors: Finding[], infos: Finding[], ms }
//   Finding = { code, where, what, fix }
//
// Kinds: canvas-tsx · annotations · canvas-meta · json · other (no check).

import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

import { parseBoard } from '../../../annotations/schema.ts';
import { validateHandoff } from '../harness/handoff.mjs';
import { isAuthoredId, scanCanvas } from './tsx.mjs';

export function kindOf(path) {
  if (/(^|\/)_runs\/.+\/handoff\/[^/]+\.(in|out)\.json$/.test(path)) return 'handoff';
  if (/\.(tsx|jsx)$/.test(path)) return 'canvas-tsx';
  if (path.endsWith('.annotations.json')) return 'annotations';
  if (path.endsWith('.meta.json')) return 'canvas-meta';
  if (path.endsWith('.json')) return 'json';
  return 'other';
}

const f = (code, where, what, fix) => ({ code, where, what, fix });

/** TSX: parse; artboard ids unique; authored ids well-formed + unique; vs `against`: ids kept, locked untouched. */
export function checkCanvasTsx(path, src, against) {
  const errors = [];
  const infos = [];
  const s = scanCanvas(path, src);
  const name = basename(path);
  if (!s.ok) {
    errors.push(
      f(
        'parse',
        name,
        `the file does not parse: ${s.error}`,
        'fix the syntax error the edit introduced'
      )
    );
    return { errors, infos };
  }
  const abSeen = new Map();
  for (const ab of s.artboards) {
    if (abSeen.has(ab.id))
      errors.push(
        f(
          'artboard-duplicate',
          `${name} › ${ab.id}`,
          `two artboards have id="${ab.id}"`,
          'give the new artboard its own id'
        )
      );
    abSeen.set(ab.id, ab);
  }
  const idLines = new Map();
  for (const el of s.elements) {
    if (el.cdIdKind === 'expression') {
      errors.push(
        f(
          'id-expression',
          `${name}:${el.line}`,
          'data-cd-id must be a plain string',
          `write data-cd-id="…" (line ${el.line})`
        )
      );
      continue;
    }
    if (!el.cdId) continue;
    if (!isAuthoredId(el.cdId)) {
      errors.push(
        f(
          'id-format',
          `${name}:${el.line}`,
          `data-cd-id="${el.cdId}" is not a readable id`,
          'use lowercase words joined by "-" (not 8 hex characters)'
        )
      );
    }
    const prev = idLines.get(el.cdId);
    // The same source element can render several times (.map) — that is one element, one id.
    if (prev && prev.start !== el.start) {
      errors.push(
        f(
          'id-duplicate',
          `${name}:${prev.line},${el.line}`,
          `data-cd-id="${el.cdId}" is on two elements`,
          'give the copy a new id or drop it'
        )
      );
    }
    idLines.set(el.cdId, el);
  }
  if (against != null) {
    const a = scanCanvas(path, against);
    if (a.ok) {
      const nowIds = new Set(s.elements.map((e) => e.cdId).filter(Boolean));
      const nowArtboards = new Set(s.artboards.map((x) => x.id));
      for (const el of a.elements) {
        if (!el.cdId || nowIds.has(el.cdId)) continue;
        const label = el.text ? `"${el.text.slice(0, 40)}"` : el.tag;
        // Same tag + same own text still present without an id → the id was dropped from a kept element.
        const kept = s.elements.find(
          (x) => !x.cdId && x.tag === el.tag && x.text && x.text === el.text
        );
        if (kept) {
          errors.push(
            f(
              'id-lost',
              `${name}:${kept.line}`,
              `${el.tag} ${label} lost data-cd-id="${el.cdId}"`,
              `put it back — comments, locks and arrows point at it`
            )
          );
        } else if (el.artboard && !nowArtboards.has(el.artboard)) {
          infos.push(
            f('id-removed', name, `removed with artboard ${el.artboard}: ${label} (${el.cdId})`, '')
          );
        } else {
          infos.push(f('id-removed', name, `removed ${label} (${el.cdId})`, ''));
        }
      }
      for (const el of a.elements) {
        if (!el.locked) continue;
        const label = el.text ? `"${el.text.slice(0, 40)}"` : el.tag;
        const now = el.cdId
          ? s.elements.find((x) => x.cdId === el.cdId)
          : s.elements.find((x) => x.print === el.print);
        if (!now) {
          errors.push(
            f(
              'locked-changed',
              name,
              `${label} is locked and was removed`,
              'put it back — ask the person to unlock it (⇧⌘L) first'
            )
          );
        } else if (!now.locked) {
          errors.push(
            f(
              'locked-changed',
              `${name}:${now.line}`,
              `${label} lost its lock`,
              'keep data-cd-locked; only a person unlocks (⇧⌘L)'
            )
          );
        } else if (now.print !== el.print) {
          errors.push(
            f(
              'locked-changed',
              `${name}:${now.line}`,
              `${label} is locked — leave it as it is`,
              'undo the change to it, or ask the person to unlock it (⇧⌘L)'
            )
          );
        }
      }
    }
  }
  return { errors, infos };
}

/** Annotations: the lenient loader's drops are errors (strict, V2-1.11 §5.2); vs `against`: locked + author immutable; new elements carry author ai. */
export function checkAnnotations(path, text, against) {
  const errors = [];
  const infos = [];
  const name = basename(path);
  let raw;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    errors.push(f('json', name, `not valid JSON: ${e.message}`, 'fix the JSON syntax'));
    return { errors, infos };
  }
  const r = parseBoard(text);
  for (const d of r.dropped) {
    errors.push(
      f(
        'element-invalid',
        `${name} › ${d.id ?? '?'}`,
        d.reason,
        'fix the element so the board accepts it — an invalid element would be dropped'
      )
    );
  }
  const rawById = new Map(
    (Array.isArray(raw?.elements) ? raw.elements : [])
      .filter((e) => e && typeof e === 'object')
      .map((e) => [e.id, e])
  );
  for (const el of r.elements) {
    const rawEl = rawById.get(el.id);
    if (!rawEl) continue;
    const extra = Object.keys(rawEl).filter(
      (k) => !(k in el) && rawEl[k] !== undefined && rawEl[k] !== null
    );
    // Default-valued fields are omitted from the canonical form; only keys the registry doesn't know are errors.
    const unknown = extra.filter((k) => !isDefaultish(rawEl[k]) && !knownField(el.type, k));
    if (unknown.length)
      errors.push(
        f(
          'unknown-field',
          `${name} › ${el.id}`,
          `unknown field(s): ${unknown.join(', ')}`,
          'use only the fields `maude design annotate --help` lists'
        )
      );
  }
  if (against != null) {
    const before = parseBoard(against).elements;
    const now = new Map(r.elements.map((e) => [e.id, e]));
    const was = new Map(before.map((e) => [e.id, e]));
    for (const e of before) {
      const n = now.get(e.id);
      if (e.locked && (!n || JSON.stringify(n) !== JSON.stringify(e))) {
        errors.push(
          f(
            'locked-changed',
            `${name} › ${e.id}`,
            `${e.type} ${e.id} is locked and was ${n ? 'changed' : 'removed'}`,
            'leave it; only change it when the person asked to unlock it'
          )
        );
      }
      if (n && JSON.stringify(e.author ?? null) !== JSON.stringify(n.author ?? null)) {
        errors.push(
          f(
            'author-changed',
            `${name} › ${e.id}`,
            'author is set once and never changes',
            'restore the original author'
          )
        );
      }
    }
    for (const n of r.elements) {
      if (!was.has(n.id) && n.author?.kind !== 'ai') {
        errors.push(
          f(
            'author-missing',
            `${name} › ${n.id}`,
            `new ${n.type} ${n.id} has no AI author`,
            'add "author":{"kind":"ai"} — or write it with `maude design annotate --ops`, which stamps it'
          )
        );
      }
    }
  }
  return { errors, infos };
}

let knownFieldsOf = null;
function knownField(type, key) {
  if (!knownFieldsOf) return true;
  return knownFieldsOf(type)?.has(key) ?? true;
}
function isDefaultish(v) {
  return v === false || v === 0 || v === '' || (Array.isArray(v) && v.length === 0);
}
export async function primeRegistry() {
  const reg = await import('../../../annotations/registry.ts');
  knownFieldsOf = (type) => {
    const spec = reg.specOf(type);
    return spec ? new Set(Object.keys(spec)) : null;
  };
}

export function checkMeta(path, text) {
  const errors = [];
  const name = basename(path);
  let m;
  try {
    m = JSON.parse(text);
  } catch (e) {
    errors.push(f('json', name, `not valid JSON: ${e.message}`, 'fix the JSON syntax'));
    return { errors, infos: [] };
  }
  if (!m || typeof m !== 'object' || Array.isArray(m))
    errors.push(f('meta-shape', name, 'a .meta.json is one JSON object', 'restore the object'));
  else if ('viewport' in m)
    errors.push(
      f(
        'meta-viewport',
        name,
        'the camera (viewport) never lives in .meta.json (DDR-115)',
        'remove "viewport"'
      )
    );
  return { errors, infos: [] };
}

/** A sub-agent hand-off (`_runs/<run>/handoff/*.in|out.json`) against maude.agent-handoff/1. */
export function checkHandoff(path, text) {
  let doc;
  try {
    doc = JSON.parse(text);
  } catch (e) {
    return {
      errors: [f('json', basename(path), `not valid JSON: ${e.message}`, 'fix the JSON syntax')],
      infos: [],
    };
  }
  return {
    errors: validateHandoff(doc).map((m) =>
      f('handoff', basename(path), m, 'match maude.agent-handoff/1')
    ),
    infos: [],
  };
}

export function checkJson(path, text) {
  try {
    JSON.parse(text);
    return { errors: [], infos: [] };
  } catch (e) {
    return {
      errors: [f('json', basename(path), `not valid JSON: ${e.message}`, 'fix the JSON syntax')],
      infos: [],
    };
  }
}

/** Check one file. `against` = the content before the edit (or the run's base), or null for a new file. */
export function checkFile(abs, { against = null, text } = {}) {
  const t0 = performance.now();
  const kind = kindOf(abs);
  let body = text;
  if (body === undefined) {
    try {
      body = readFileSync(abs, 'utf8');
    } catch {
      return {
        ok: true,
        kind,
        errors: [],
        infos: [{ code: 'gone', where: basename(abs), what: 'file does not exist', fix: '' }],
        ms: 0,
      };
    }
  }
  let r = { errors: [], infos: [] };
  if (kind === 'canvas-tsx') r = checkCanvasTsx(abs, body, against);
  else if (kind === 'annotations') r = checkAnnotations(abs, body, against);
  else if (kind === 'canvas-meta') r = checkMeta(abs, body);
  else if (kind === 'json') r = checkJson(abs, body);
  else if (kind === 'handoff') r = checkHandoff(abs, body);
  return {
    ok: r.errors.length === 0,
    kind,
    errors: r.errors,
    infos: r.infos,
    ms: +(performance.now() - t0).toFixed(2),
  };
}

export function formatFindings(file, res) {
  const lines = res.errors.map((e) => `- [${e.code}] ${e.where} · ${e.what} · ${e.fix}`);
  return `maude design check ${file}: ${res.errors.length} error(s)\n${lines.join('\n')}`;
}
