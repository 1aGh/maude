// video/inject.ts — S7.5: the canvas build's comp-media injection (contract V2-1.10 §5.3 rules).
//
// "Derived data is injected at build, never written to the file." After pass 1 (data-cd-id), the
// canvas build hands the TSX it is about to bundle to `injectCompMedia`, which adds ONE hidden prop
// to each canvas-lib `<Captions>` (`__words`) and `<Duck>` (`__speech`), computed from the ENCLOSING
// comp's clips (derive.ts `compClips`, the Timeline's own enumerator, on the file as it is on disk)
// crossed with the transcripts of their sources. The file on disk never changes: a trim, split,
// move or speed change re-derives the words and the dip on the next build.
//
// The transcripts the build reads are BUILD INPUTS: `videoDepsFor` lists them for the canvas's
// freshness signature (access/closure.ts `localDepsFromSource`), so a new or changed
// `assets/<sha8>.transcript.json` rebuilds exactly the canvases whose comps play that source — and
// nothing else (a canvas with no `<Captions>`/`<Duck>` lists none).
//
// Only the canvas-lib components are touched: a comp's own local `Captions` (today's CUES pattern,
// §5.10 "Existing comps … stay as they are") is left alone, because the import decides.
//
// Escaping (V2-1.10 #11 half): a word is speech, i.e. anybody's text. It enters the module as a JSON
// value inside a JSX expression — `<` `\u2028` `\u2029` escaped on top of JSON.stringify — and the
// component renders it as a React child, so `'` `` ` `` `${` `</script>` stay text.

import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { parseSync } from 'oxc-parser';

import { jsxElements, literalProp, type Node, tagOf } from '../edit-ops/clip/jsx.ts';
import {
  type CaptionFix,
  type CompClips,
  captionFixesOf,
  compClips,
  compSpeech,
  compWords,
} from './derive.ts';
import { type CaptionWordFrames, DUCK_DEFAULTS, msToFrames } from './framing.ts';
import { readTranscript, sidecarRelFor, TRANSCRIPT_MAX_BYTES, type Transcript } from './schema.ts';

/** The hidden props the build adds; `maude design check` refuses them in a file (check/video.ts). */
export const INJECTED_PROPS = ['__words', '__speech'] as const;

const LIB = '@maude/canvas-lib';
const QUICK = /@maude\/canvas-lib/;
const QUICK_NAMES = /\b(?:Captions|Duck)\b/;

type SiteKind = 'captions' | 'duck';

interface Site {
  kind: SiteKind;
  /** the top-level component the element sits in */
  comp: string | null;
  /** where the hidden prop goes: before the opening tag's `>` / `/>` — last, so it wins */
  insertAt: number;
  fixes: CaptionFix[];
  db: number;
  attackMs: number;
  releaseMs: number;
  /** the literal `src` of the <Audio> a <Duck> wraps (its own speech never ducks it) */
  duckedSrc: string | null;
}

interface Plan {
  sites: Site[];
  /** comp name → the first video artboard that mounts it (linked formats share one cut) */
  artboardOf: Map<string, string>;
}

/** Local name → kind for the canvas-lib imports of Captions / Duck (aliases included). */
function vocabImports(program: Node): Map<string, SiteKind> {
  const out = new Map<string, SiteKind>();
  for (const st of program.body ?? []) {
    if (st.type !== 'ImportDeclaration' || st.source?.value !== LIB) continue;
    for (const sp of st.specifiers ?? []) {
      if (sp.type !== 'ImportSpecifier') continue;
      const imported = sp.imported?.name ?? sp.imported?.value;
      const local = sp.local?.name;
      if (!local) continue;
      if (imported === 'Captions') out.set(local, 'captions');
      else if (imported === 'Duck') out.set(local, 'duck');
    }
  }
  return out;
}

/** Top-level declarations with their span and declared name (function X / const X = …). */
function topLevelDecls(program: Node): Array<{ name: string; start: number; end: number }> {
  const out: Array<{ name: string; start: number; end: number }> = [];
  for (const st of program.body ?? []) {
    const inner =
      st.type === 'ExportNamedDeclaration' || st.type === 'ExportDefaultDeclaration'
        ? st.declaration
        : st;
    if (!inner) continue;
    if (inner.type === 'FunctionDeclaration' && inner.id?.name)
      out.push({ name: inner.id.name, start: st.start, end: st.end });
    else if (inner.type === 'VariableDeclaration')
      for (const d of inner.declarations ?? [])
        if (d.id?.type === 'Identifier')
          out.push({ name: d.id.name, start: d.start ?? st.start, end: d.end ?? st.end });
  }
  return out;
}

function safeLiteral(file: string, el: Node, name: string): unknown {
  try {
    return literalProp(file, el, name);
  } catch {
    return undefined;
  }
}

const num = (v: unknown, fallback: number) =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback;

/** Where the comp vocabulary sits in `text`, or null when there is none / the text does not parse
 *  (the bundler reports a syntax error itself). */
function planOf(file: string, text: string): Plan | null {
  if (!QUICK.test(text) || !QUICK_NAMES.test(text)) return null;
  let program: Node;
  try {
    const parsed = parseSync(file, text, { sourceType: 'module', lang: 'tsx' });
    if (parsed.errors?.length) return null;
    program = parsed.program;
  } catch {
    return null;
  }
  const names = vocabImports(program);
  if (names.size === 0) return null;
  const decls = topLevelDecls(program);
  const compAt = (at: number) => decls.find((d) => d.start <= at && at < d.end)?.name ?? null;
  const els = jsxElements(program);

  const artboardOf = new Map<string, string>();
  for (const { el } of els) {
    if (tagOf(el) !== 'DCArtboard') continue;
    const id = safeLiteral(file, el, 'id');
    if (typeof id !== 'string') continue;
    const vc = els.find(
      (e) => e.el.start > el.start && e.el.end <= el.end && tagOf(e.el) === 'VideoComp'
    )?.el;
    const cv = vc?.openingElement?.attributes?.find(
      (a: Node) => a.type === 'JSXAttribute' && a.name?.name === 'component'
    )?.value;
    const comp =
      cv?.type === 'JSXExpressionContainer' && cv.expression?.type === 'Identifier'
        ? (cv.expression.name as string)
        : null;
    if (comp && !artboardOf.has(comp)) artboardOf.set(comp, id);
  }

  const sites: Site[] = [];
  for (const { el } of els) {
    const tag = tagOf(el);
    const kind = tag ? names.get(tag) : undefined;
    if (!kind) continue;
    const open = el.openingElement;
    const insertAt = (open.end as number) - (open.selfClosing ? 2 : 1);
    let fixes: CaptionFix[] = [];
    let duckedSrc: string | null = null;
    if (kind === 'captions') {
      const attr = (open.attributes ?? []).find(
        (a: Node) => a.type === 'JSXAttribute' && a.name?.name === 'fixes'
      );
      if (attr) fixes = captionFixesOf(`<Captions ${text.slice(attr.start, attr.end)} />`);
    } else {
      const audio = (el.children ?? []).find(
        (c: Node) => c.type === 'JSXElement' && /^(?:Maude)?Audio$/.test(tagOf(c) ?? '')
      );
      const src = audio ? safeLiteral(file, audio, 'src') : undefined;
      duckedSrc = typeof src === 'string' ? src : null;
    }
    sites.push({
      kind,
      comp: compAt(el.start as number),
      insertAt,
      fixes,
      db: num(safeLiteral(file, el, 'db'), DUCK_DEFAULTS.db),
      attackMs: num(safeLiteral(file, el, 'attackMs'), DUCK_DEFAULTS.attackMs),
      releaseMs: num(safeLiteral(file, el, 'releaseMs'), DUCK_DEFAULTS.releaseMs),
      duckedSrc,
    });
  }
  return sites.length ? { sites, artboardOf } : null;
}

/** The clips of `comp` — only through a video artboard that mounts it; anything else has none. */
function clipsOf(canvasAbs: string, source: string, plan: Plan, comp: string | null) {
  const artboard = comp ? plan.artboardOf.get(comp) : undefined;
  if (!artboard) return null;
  try {
    const c = compClips(canvasAbs, source, artboard);
    return c;
  } catch {
    return null; // the disk file does not parse: no clips, the bundler speaks for the syntax
  }
}

/** The transcript sidecar path of `src`, absolute, kept inside the design root. */
function transcriptAbs(designRoot: string, src: string): { rel: string; abs: string } | null {
  const rel = sidecarRelFor(src, 'transcript');
  if (!rel) return null;
  const root = path.resolve(designRoot);
  const abs = path.resolve(root, rel);
  return abs.startsWith(root + path.sep) ? { rel, abs } : null;
}

function readTranscriptAt(abs: string, rel: string): Transcript | null {
  try {
    const st = statSync(abs);
    if (!st.isFile() || st.size > TRANSCRIPT_MAX_BYTES) return null;
    const r = readTranscript(readFileSync(abs, 'utf8'), rel);
    return r.ok ? r.value : null;
  } catch {
    return null;
  }
}

/** JSON that is safe as a JS expression in a module: JSON.stringify plus `<` and the two JS line
 *  separators escaped, so no word can close a script element or a string. */
export function safeJson(v: unknown): string {
  return JSON.stringify(v)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

export interface InjectOptions {
  /** where `assets/` lives; absent = no transcript is read (the props are injected empty) */
  designRoot?: string;
}

export interface InjectResult {
  code: string;
  /** designRoot-relative transcript paths the build looked at (present or not) */
  transcripts: string[];
}

/**
 * Add `__words` / `__speech` to every canvas-lib `<Captions>` / `<Duck>` in `transformed` (the
 * pass-1 TSX). `source` is the canvas as it is on disk — the clips are enumerated from it, so the
 * clip ids match `/_api/comp-media`'s. Never throws: anything unreadable injects an empty list.
 */
export function injectCompMedia(
  canvasAbs: string,
  source: string,
  transformed: string,
  opts: InjectOptions = {}
): InjectResult {
  const plan = planOf(canvasAbs, transformed);
  if (!plan) return { code: transformed, transcripts: [] };
  const clips = new Map<string | null, CompClips | null>();
  const transcripts: Record<string, Transcript> = {};
  const looked = new Set<string>();
  const ensure = (comp: string | null): CompClips | null => {
    if (!clips.has(comp)) {
      const c = clipsOf(canvasAbs, source, plan, comp);
      clips.set(comp, c);
      if (c && opts.designRoot)
        for (const span of c.clips) {
          if (transcripts[span.src] !== undefined) continue;
          const at = transcriptAbs(opts.designRoot, span.src);
          if (!at) continue;
          looked.add(at.rel);
          const t = readTranscriptAt(at.abs, at.rel);
          if (t) transcripts[span.src] = t;
        }
    }
    return clips.get(comp) ?? null;
  };

  const edits: Array<{ at: number; text: string }> = [];
  for (const site of plan.sites) {
    const c = ensure(site.comp);
    if (site.kind === 'captions') {
      const words: CaptionWordFrames[] = c
        ? compWords(c, transcripts, site.fixes).map((w) => ({
            wordId: w.wordId,
            clip: w.clip,
            f0: w.f0,
            f1: w.f1,
            text: w.text,
          }))
        : [];
      edits.push({ at: site.insertAt, text: ` __words={${safeJson(words)}}` });
    } else {
      let speech: Array<[number, number]> = [];
      if (c) {
        const bed = c.clips.find((s) => s.track === 'music' || s.track === 'music2');
        const except = site.duckedSrc ?? bed?.src;
        speech = compSpeech(c, transcripts, {
          ...(except ? { exceptSrc: except } : {}),
          mergeGapFrames: msToFrames(site.attackMs, c.fps) + msToFrames(site.releaseMs, c.fps),
        });
      }
      edits.push({ at: site.insertAt, text: ` __speech={${safeJson(speech)}}` });
    }
  }
  let code = transformed;
  for (const e of edits.sort((a, b) => b.at - a.at))
    code = code.slice(0, e.at) + e.text + code.slice(e.at);
  return { code, transcripts: [...looked].sort() };
}

/**
 * The transcript files the build of this canvas reads, absolute (present or not — one that appears
 * later must rebuild too). Empty for a canvas with no canvas-lib `<Captions>` / `<Duck>`.
 */
export function videoDepsFor(source: string, canvasAbs: string, designRoot: string): string[] {
  const plan = planOf(canvasAbs, source);
  if (!plan) return [];
  const out = new Set<string>();
  const comps = new Set(plan.sites.map((s) => s.comp));
  for (const comp of comps) {
    const c = clipsOf(canvasAbs, source, plan, comp);
    if (!c) continue;
    for (const span of c.clips) {
      const at = transcriptAbs(designRoot, span.src);
      if (at) out.add(at.abs);
    }
  }
  return [...out].sort();
}
