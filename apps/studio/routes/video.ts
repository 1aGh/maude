// Video intelligence routes — S7.4 (contract V2-1.10 §5.4; decision maude/v2-S7.4-comp-media-read).
//
// `GET /_api/comp-media?canvas=<rel>&artboard=<id>` → `{ fps, clips, words, speech, beats, unresolved }`:
// the comp's clips crossed with the transcripts and beat grids of their sources (video/derive.ts).
// It feeds the Timeline's text lane, the beat ticks, the duck line and the Transcript panel.
//
//   - READ-ONLY: it writes nothing and reads only the canvas and the `assets/<sha8>.{transcript,beats}.json`
//     sidecars of the sources that canvas names;
//   - MAIN ORIGIN ONLY (`origin: 'main'`): in neither canvas allowlist, so the untrusted canvas
//     origin answers 403 (V2-1.10 #15) — the canvas gets its words injected at build, never by a
//     fetch. Transcript text is what the speaker said, and speech can say anything;
//   - MINIMUM ROLE COMMENT: the transcript is the project's content, not chrome, so a session that
//     only holds Can view is refused (the same copy as every refusal), and a canvas-only session is
//     served only for a canvas it was granted — one answer, byte for byte, for "not granted" and
//     "does not exist" (V2-1.7 §5.7, `notInScopeResponse`).
//
// Warm cost: the answer is cached on (canvas, artboard) + the size and mtime of every file it was
// built from, so a repeat read is a few `stat`s. A change to the canvas or to any sidecar it read
// changes the signature, so the next read recomputes — nothing is invalidated by hand.

import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import { currentAccess, notInScopeResponse, toDesignRel } from '../access/request.ts';
import { CanvasEditError } from '../canvas-edit.ts';
import {
  type CaptionFix,
  type CaptionsProps,
  type CompClips,
  type CompWord,
  captionFixesOf,
  captionsOf,
  compBeats,
  compClips,
  compMusic,
  compSpeech,
  compWords,
  duckedSrcOf,
  type MusicInfo,
} from '../video/derive.ts';
import { type LinkedFormats, linkedFormats } from '../video/linked-formats.ts';
import {
  BEATS_MAX_BYTES,
  type BeatGrid,
  readBeats,
  readTranscript,
  sidecarRelFor,
  TRANSCRIPT_MAX_BYTES,
  type Transcript,
} from '../video/schema.ts';
import type { RouteSpec } from './table.ts';

const json = (status: number, body: unknown) =>
  Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

const ARTBOARD_RE = /^[A-Za-z0-9_-]{1,64}$/;
/** More than this many cached answers and the oldest goes. */
const CACHE_MAX = 64;

export interface VideoRouteDeps {
  designRoot: string;
  /** the design root relative to the repo root (`.design`) */
  designRel: string;
}

export interface CompMedia {
  fps: number;
  clips: CompClips['clips'];
  words: CompWord[];
  speech: Array<[number, number]>;
  beats: number[];
  /** S7.12 — each Music-track clip with its grid (beats, bars, bpm), volume and `<Duck>` */
  music: MusicInfo[];
  unresolved: string[];
  /** S7.11: the source words of each clip's source (the Transcript panel strikes the ones no clip covers) */
  transcripts: Record<
    string,
    {
      durationSec?: number;
      lang?: string;
      words: Array<{
        id: string;
        t0: number;
        t1: number;
        text: string;
        p?: number;
        flags?: string[];
      }>;
    }
  >;
  /** S7.11: the comp's <Captions> props (null = no captions yet) */
  captions: CaptionsProps | null;
  /** S7.13: the video's linked formats (derived from the canvas source, never stored); null = no such video artboard */
  formats: LinkedFormats | null;
}

/** `canvas` (repo- or designRoot-relative) → the canvas under the design root, or null. Runtime
 *  directories (`_*`, dotfiles) are never canvases. */
function canvasRel(deps: VideoRouteDeps, raw: string | null): string | null {
  if (!raw || raw.length > 1024 || raw.includes('\0')) return null;
  const rel = toDesignRel(raw, deps.designRel);
  if (!rel || !rel.endsWith('.tsx')) return null;
  if (rel.split('/').some((s) => s.startsWith('_') || s.startsWith('.'))) return null;
  return rel;
}

/** One sidecar read: the value (null when absent, oversize or unreadable) and the stat signature
 *  the cache vouches with (`size:mtimeMs`, `-` when the file is absent). */
function readSidecar<T>(
  abs: string,
  rel: string,
  maxBytes: number,
  parse: (text: string, rel: string) => { ok: true; value: T } | { ok: false }
): { value: T | null; sig: string } {
  try {
    const st = statSync(abs);
    const sig = `${st.size}:${st.mtimeMs}`;
    if (!st.isFile() || st.size > maxBytes) return { value: null, sig };
    const r = parse(readFileSync(abs, 'utf8'), rel);
    return { value: r.ok ? r.value : null, sig };
  } catch {
    return { value: null, sig: '-' };
  }
}

export function createVideoRoutes(deps: VideoRouteDeps): RouteSpec[] {
  const cache = new Map<string, { sig: string; body: string }>();

  function compute(
    abs: string,
    artboard: string | undefined
  ): { out: CompMedia; sidecars: string } | Response {
    let source: string;
    try {
      source = readFileSync(abs, 'utf8');
    } catch {
      return json(404, { error: 'no-such-canvas' });
    }
    let c: CompClips;
    try {
      c = compClips(abs, source, artboard);
    } catch (e) {
      if (e instanceof CanvasEditError) return json(422, { error: 'canvas-unparseable' });
      throw e;
    }
    const transcripts: Record<string, Transcript> = {};
    const grids: Record<string, BeatGrid> = {};
    const sigs: string[] = [];
    for (const src of new Set(c.clips.map((s) => s.src))) {
      const tRel = sidecarRelFor(src, 'transcript');
      if (tRel) {
        const r = readSidecar(
          path.join(deps.designRoot, tRel),
          tRel,
          TRANSCRIPT_MAX_BYTES,
          (t, p) => readTranscript(t, p)
        );
        sigs.push(`${tRel}=${r.sig}`);
        if (r.value) transcripts[src] = r.value;
      }
      const bRel = sidecarRelFor(src, 'beats');
      if (bRel) {
        const r = readSidecar(path.join(deps.designRoot, bRel), bRel, BEATS_MAX_BYTES, (t, p) =>
          readBeats(t, p)
        );
        sigs.push(`${bRel}=${r.sig}`);
        if (r.value) grids[src] = r.value;
      }
    }
    const fixes: CaptionFix[] = captionFixesOf(source);
    // The duck line is for the bed `<Duck>` wraps (else the first music bed): its own speech never
    // ducks itself.
    const bed = c.clips.find((s) => s.track === 'music' || s.track === 'music2');
    const except = duckedSrcOf(source) ?? bed?.src;
    const speech = compSpeech(c, transcripts, except ? { exceptSrc: except } : {});
    return {
      out: {
        fps: c.fps,
        clips: c.clips,
        words: compWords(c, transcripts, fixes),
        speech,
        beats: compBeats(c, grids),
        music: compMusic(c, grids, source),
        unresolved: c.unresolved,
        transcripts: Object.fromEntries(
          Object.entries(transcripts).map(([src, t]) => [
            src,
            {
              ...(t.durationSec !== undefined ? { durationSec: t.durationSec } : {}),
              ...(t.lang !== undefined ? { lang: t.lang } : {}),
              words: t.words.map((w) => ({
                id: w.id,
                t0: w.t0,
                t1: w.t1,
                text: w.text,
                ...(w.p !== undefined ? { p: w.p } : {}),
                ...(w.flags?.length ? { flags: [...w.flags] } : {}),
              })),
            },
          ])
        ),
        captions: captionsOf(source),
        formats: linkedFormats(abs, source, artboard),
      },
      sidecars: sigs.join(';'),
    };
  }

  return [
    {
      method: 'GET',
      path: '/_api/comp-media',
      origin: 'main',
      readOnly: 'allowed',
      handle: (req) => {
        const url = new URL(req.url);
        const rel = canvasRel(deps, url.searchParams.get('canvas'));
        const access = currentAccess();
        // A canvas-only session is served for a granted canvas only; not granted and missing are
        // one answer.
        if (access.canvasOnly && (rel === null || !access.seesCanvas(rel)))
          return notInScopeResponse();
        if (rel === null) return json(400, { error: 'bad-canvas' });
        if (!access.can('comment', rel))
          return json(403, {
            error: 'read-only',
            reason: 'read-only',
            message: 'Ask the owner to change this.',
          });
        const artboard = url.searchParams.get('artboard') ?? undefined;
        if (artboard !== undefined && !ARTBOARD_RE.test(artboard))
          return json(400, { error: 'bad-artboard' });
        const abs = path.join(deps.designRoot, rel);
        // containment: the join must stay under the design root
        const back = path.relative(deps.designRoot, abs);
        if (back.startsWith('..') || path.isAbsolute(back))
          return json(400, { error: 'bad-canvas' });
        if (!existsSync(abs)) return json(404, { error: 'no-such-canvas' });

        const key = `${rel}\u0000${artboard ?? ''}`;
        let canvasSig: string;
        try {
          const st = statSync(abs);
          canvasSig = `${st.size}:${st.mtimeMs}`;
        } catch {
          return json(404, { error: 'no-such-canvas' });
        }
        const hit = cache.get(key);
        // The cached signature carries the sidecar stats too; re-check them cheaply before trusting it.
        if (hit && hit.sig.startsWith(`${canvasSig}|`) && sidecarsUnchanged(deps, hit.sig)) {
          return new Response(hit.body, {
            headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
          });
        }
        const made = compute(abs, artboard);
        if (made instanceof Response) return made;
        const body = JSON.stringify(made.out);
        cache.set(key, { sig: `${canvasSig}|${made.sidecars}`, body });
        if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value as string);
        return new Response(body, {
          headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
        });
      },
    },
  ];
}

function statSig(abs: string): string {
  try {
    const st = statSync(abs);
    return `${st.size}:${st.mtimeMs}`;
  } catch {
    return '-';
  }
}

function sidecarsUnchanged(deps: VideoRouteDeps, sig: string): boolean {
  const rest = sig.slice(sig.indexOf('|') + 1);
  if (!rest) return true;
  for (const part of rest.split(';')) {
    const eq = part.lastIndexOf('=');
    if (statSig(path.join(deps.designRoot, part.slice(0, eq))) !== part.slice(eq + 1)) return false;
  }
  return true;
}
