// clip-ops.ts — composed timeline clip operations (feature-enhanced-video-editing).
//
// The verbs the iMovie-style editor speaks: each is a pure `applyX(source, …)
// → { source', … }` built from the canvas-edit primitives + the Phase-0 ripple
// engine, plus a disk wrapper (atomic write + cross-process lock). Lives in its
// own module because ripple.ts already imports canvas-edit.ts — composing here
// keeps the import graph acyclic.

import MagicString from 'magic-string';
import { parseSync } from 'oxc-parser';

import {
  applyRemoveClip,
  assertCompSemantics,
  CanvasEditError,
  type ClipInfo,
  enumerateClips,
  escapeAttr,
  lineStartInfo,
  spanWithFraming,
  withLock,
} from './canvas-edit.ts';
import { applyRippleAfterClip, collectConsts, resolveNum } from './ripple.ts';

/** Parse a `<TransitionSeries.Transition>`'s duration out of its source span
 *  (`timing={linearTiming({ durationInFrames: XF })}` — the attr the AST-level
 *  numAttr can't see because it nests inside the timing call). */
export function transitionDurationFrames(
  source: string,
  transition: ClipInfo,
  consts?: Record<string, number>
): number | null {
  const text = source.slice(transition.start, transition.end);
  const m = text.match(/durationInFrames:\s*([^,}\s)]+)/);
  if (!m) return null;
  return resolveNum(m[1] as string, consts ?? collectConsts(source));
}

/** The transition applyRemoveClip will drop alongside a series clip (its NEXT
 *  transition, else its PREVIOUS — the same preference order). */
function adjacentTransition(clips: ClipInfo[], idx: number): ClipInfo | null {
  const next = clips[idx + 1];
  const prev = clips[idx - 1];
  if (next?.kind === 'transition') return next;
  if (prev?.kind === 'transition') return prev;
  return null;
}

/**
 * Remove a clip WITH ripple (the iMovie Delete): a series beat's removal
 * shrinks the comp TOTAL by (clip duration − the dropped transition's overlap)
 * so the cut stays truthful; a standalone `<Sequence>` (overlay/audio band) is
 * removed WITHOUT ripple — overlays are absolutely positioned by design and
 * deleting one must not move the rest of the cut. Pure.
 */
export function applyRemoveClipRippled(
  canvasAbsPath: string,
  source: string,
  artboardId: string | undefined,
  stableId: string,
  expectedHash: string | undefined
): { source: string; rippled: boolean } {
  const { clips } = enumerateClips(canvasAbsPath, source, artboardId);
  const idx = clips.findIndex((c) => c.stableId === stableId);
  const clip = idx >= 0 ? (clips[idx] as ClipInfo) : null;
  let mid = source;
  let rippled = false;
  if (
    clip &&
    clip.kind === 'sequence' &&
    (clip.tag.startsWith('TransitionSeries.') || clip.tag.startsWith('Series.')) &&
    clip.durationInFrames != null
  ) {
    const t = adjacentTransition(clips, idx);
    const overlap = t ? (transitionDurationFrames(source, t) ?? 0) : 0;
    const delta = -(clip.durationInFrames - overlap);
    if (delta !== 0) {
      // TOTAL only — series siblings position themselves, and overlay-band
      // standalone clips deliberately stay put on a storyline delete.
      const r = applyRippleAfterClip(canvasAbsPath, mid, artboardId, stableId, delta, {
        shiftFroms: false,
      });
      mid = r.source;
      rippled = r.totalEdited;
    }
  }
  // Ripple never touches the clip's own span text, so the caller's contentHash
  // still fingerprints it — applyRemoveClip re-verifies on the rippled source.
  const out = applyRemoveClip(canvasAbsPath, mid, artboardId, stableId, expectedHash);
  return { source: out.source, rippled };
}

/** Remove-with-ripple on disk (atomic write + cross-process lock). */
export async function removeClipRippled(
  canvasAbsPath: string,
  artboardId: string | undefined,
  stableId: string,
  expectedHash: string | undefined
): Promise<{ source: string; rippled: boolean }> {
  return withLock(canvasAbsPath, async () => {
    const file = Bun.file(canvasAbsPath);
    if (!(await file.exists())) {
      throw new CanvasEditError(`Canvas not found: ${canvasAbsPath}`, {
        canvas: canvasAbsPath,
        id: stableId,
      });
    }
    const source = await file.text();
    const next = applyRemoveClipRippled(canvasAbsPath, source, artboardId, stableId, expectedHash);
    if (next.source === source) return next;
    const tmp = `${canvasAbsPath}.tmp.${Math.random().toString(36).slice(2, 10)}`;
    await Bun.write(tmp, next.source);
    const { rename } = await import('node:fs/promises');
    await rename(tmp, canvasAbsPath);
    return next;
  });
}

// ---------------------------------------------------------------------------
// Task 6 — magnetic storyline reorder (a real MOVE, not the ▲▼ adjacent swap).

/** Resolve a clip by stableId + optional fingerprint (local mirror of
 *  canvas-edit's resolveClip, against an already-enumerated list). */
function mustResolve(
  canvasAbsPath: string,
  clips: ClipInfo[],
  stableId: string,
  expectedHash: string | undefined
): { clip: ClipInfo; idx: number } {
  const idx = clips.findIndex((c) => c.stableId === stableId);
  if (idx < 0) {
    throw new CanvasEditError(`clip "${stableId}" not found`, {
      canvas: canvasAbsPath,
      id: stableId,
    });
  }
  const clip = clips[idx] as ClipInfo;
  if (expectedHash != null && expectedHash !== clip.contentHash) {
    throw new CanvasEditError(
      `clip "${stableId}" changed since it was read (concurrent edit); reload and retry`,
      { canvas: canvasAbsPath, id: stableId }
    );
  }
  return { clip, idx };
}

const isSeriesSeq = (c: ClipInfo) =>
  c.kind === 'sequence' && (c.tag.startsWith('TransitionSeries.') || c.tag.startsWith('Series.'));

/**
 * Move a series beat before/after another beat — the drag-to-reorder commit.
 * Cuts the beat plus ONE companion transition (its preceding one when it has
 * one, else the following) and reinserts the pair at the target so the
 * S/T/S/T alternation survives any distance: inserting BEFORE a beat emits
 * `B T`, inserting AFTER emits `T B`. Pure; semantic-gated.
 */
export function applySeriesMove(
  canvasAbsPath: string,
  source: string,
  artboardId: string | undefined,
  movedStableId: string,
  movedHash: string | undefined,
  refStableId: string,
  refHash: string | undefined,
  position: 'before' | 'after'
): { source: string; stableId: string } {
  if (movedStableId === refStableId) {
    throw new CanvasEditError('cannot move a clip relative to itself', {
      canvas: canvasAbsPath,
      id: movedStableId,
    });
  }
  const { clips } = enumerateClips(canvasAbsPath, source, artboardId);
  const { clip: moved, idx } = mustResolve(canvasAbsPath, clips, movedStableId, movedHash);
  const { clip: ref } = mustResolve(canvasAbsPath, clips, refStableId, refHash);
  if (!isSeriesSeq(moved) || !isSeriesSeq(ref)) {
    throw new CanvasEditError('series move needs two series beats', {
      canvas: canvasAbsPath,
      id: movedStableId,
    });
  }
  const prev = clips[idx - 1];
  const next = clips[idx + 1];
  const companion = prev?.kind === 'transition' ? prev : next?.kind === 'transition' ? next : null;

  const movedSpan = spanWithFraming(source, moved.start, moved.end);
  const companionSpan = companion ? spanWithFraming(source, companion.start, companion.end) : null;
  const beatText = source.slice(movedSpan[0], movedSpan[1]);
  const transitionText = companionSpan ? source.slice(companionSpan[0], companionSpan[1]) : '';

  const s = new MagicString(source);
  s.remove(movedSpan[0], movedSpan[1]);
  if (companionSpan) s.remove(companionSpan[0], companionSpan[1]);
  const insertText =
    position === 'before' ? `${beatText}${transitionText}` : `${transitionText}${beatText}`;
  if (position === 'before') {
    const [rs] = spanWithFraming(source, ref.start, ref.end);
    s.appendLeft(rs, insertText);
  } else {
    s.appendRight(ref.end, insertText);
  }
  const out = s.toString();
  assertParses(canvasAbsPath, out, movedStableId);
  assertCompSemantics(canvasAbsPath, out);
  const after = enumerateClips(canvasAbsPath, out, artboardId);
  const settled = after.clips.find((c) => c.contentHash === moved.contentHash);
  return { source: out, stableId: settled?.stableId ?? movedStableId };
}

/** Series move on disk (atomic write + cross-process lock). */
export async function seriesMove(
  canvasAbsPath: string,
  artboardId: string | undefined,
  movedStableId: string,
  movedHash: string | undefined,
  refStableId: string,
  refHash: string | undefined,
  position: 'before' | 'after'
): Promise<{ source: string; stableId: string }> {
  return withLock(canvasAbsPath, async () => {
    const source = await Bun.file(canvasAbsPath).text();
    const next = applySeriesMove(
      canvasAbsPath,
      source,
      artboardId,
      movedStableId,
      movedHash,
      refStableId,
      refHash,
      position
    );
    if (next.source === source) return next;
    const tmp = `${canvasAbsPath}.tmp.${Math.random().toString(36).slice(2, 10)}`;
    await Bun.write(tmp, next.source);
    const { rename } = await import('node:fs/promises');
    await rename(tmp, canvasAbsPath);
    return next;
  });
}

// ---------------------------------------------------------------------------
// Task 6 — positional insert (the drop caret): storyline index-aware insert,
// or a standalone overlay/audio clip that lands OUTSIDE the series.

const INSERTABLE_MEDIA = new Set(['Video', 'Audio', 'Img', 'OffthreadVideo']);

function assertContainedSrc(canvasAbsPath: string, src: string, id: string): void {
  // Allowlist, not blocklist (security review 2026-07-30): the src the export
  // renderer fetches must be a contained asset — a relative path or a `/`-rooted
  // path under the design root — never a scheme (`javascript:`/`data:`/`http(s):`)
  // and never a protocol-relative `//host/...` (which the blocklist let slip →
  // SSRF residue in the server-side render). `/\...` (a single leading slash) is
  // allowed; `//...` is not.
  const t = src.trim();
  const contained =
    t.length > 0 &&
    !/\.\./.test(t) &&
    !/^[a-z][a-z0-9+.-]*:/i.test(t) && // any URI scheme
    !t.startsWith('//'); // protocol-relative
  if (!contained) {
    throw new CanvasEditError(
      'media src must be a contained asset path (no ../, schemes, or //host)',
      {
        canvas: canvasAbsPath,
        id,
      }
    );
  }
}

export interface InsertAtOptions {
  lane: 'storyline' | 'overlay' | 'audio';
  /** storyline only: beat position 0..N (N = append at the end). */
  index?: number;
  /** overlay/audio only: start frame. */
  from?: number;
  durationInFrames: number;
  mediaTag?: string | null;
  src?: string | null;
  /** Task 22 — a prompt-carrying AI slate instead of media. Prompt is USER
   *  TEXT → JSON.stringify into the JSX (DDR-150 P1). */
  placeholder?: { prompt: string; kind: string } | null;
  /** p8-t-video-2 — the clip's name (the dropped file's, sans extension): the timeline label and its
   *  `name:<name>` identity. Cleaned to what a comp carries and made unique in the comp (" 2", " 3", …). */
  name?: string | null;
}

/** A clip name as the comp can carry it — the same rule as an AI cut's shot names (video/reel-place.ts). */
const CLIP_NAME_MAX = 60;
const CLIP_NAME_UNSAFE = /[^\p{L}\p{N} ._'()-]+/gu;

/** ` name="…"` for a new clip, unique among the comp's named clips; '' when there is no usable name. */
function clipNameAttr(cc: { clips: Array<{ stableId: string }> }, raw: unknown): string {
  const base = (typeof raw === 'string' ? raw : '')
    .replace(CLIP_NAME_UNSAFE, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, CLIP_NAME_MAX)
    .trim();
  if (!base) return '';
  const taken = new Set(
    cc.clips.filter((c) => c.stableId.startsWith('name:')).map((c) => c.stableId.slice(5))
  );
  let name = base;
  for (let k = 2; taken.has(name); k++) name = `${base.slice(0, CLIP_NAME_MAX - 4)} ${k}`;
  return ` name="${escapeAttr(name)}"`;
}

const PLACEHOLDER_KINDS = new Set(['veo', 'motion', 'image']);

function placeholderChildText(
  canvasAbsPath: string,
  artboardId: string | undefined,
  p: { prompt: string; kind: string },
  indent: string,
  dur: number
): string {
  const kind = PLACEHOLDER_KINDS.has(p.kind) ? p.kind : 'veo';
  const prompt = String(p.prompt ?? '').slice(0, 2000);
  if (!prompt.trim()) {
    throw new CanvasEditError('an AI placeholder needs a prompt', {
      canvas: canvasAbsPath,
      id: artboardId ?? '',
    });
  }
  // Paired-tag form: the prompt lives in a plain <span> child (a stamped,
  // data-cd-editable leaf — double-click in the artboard edits it in place;
  // the modal-prompt flow is gone). JSON.stringify keeps DDR-150 P1 discipline.
  return (
    `\n${indent}  <AIPlaceholder kind="${kind}" durationInFrames={${dur}}>` +
    `\n${indent}    <span>{${JSON.stringify(prompt)}}</span>` +
    `\n${indent}  </AIPlaceholder>\n${indent}`
  );
}

/**
 * Insert a clip at a POSITION (unlike canvas-edit's append-only insert):
 *   • `lane: 'storyline'` inserts a series beat at `index`, cloning an existing
 *     transition to keep the alternation (B T at the head, T B elsewhere) and
 *     bumping the comp TOTAL by (duration − transition overlap);
 *   • `lane: 'overlay' | 'audio'` inserts a standalone `<Sequence from>` as a
 *     SIBLING after the series (never inside it), no TOTAL change.
 * Pure; returns the new clip's stableId.
 */
export function applyInsertClipAt(
  canvasAbsPath: string,
  source: string,
  artboardId: string | undefined,
  opts: InsertAtOptions
): { source: string; stableId: string | null } {
  const cc = enumerateClips(canvasAbsPath, source, artboardId);
  if (!cc.compName) {
    // A `kind="video"` artboard without a comp is the user saying "this is a
    // video" — upgrade it in place and retry, instead of refusing.
    if (opts.lane === 'storyline') {
      const ensured = applyEnsureVideoComp(canvasAbsPath, source, artboardId);
      if (ensured) {
        return applyInsertClipAt(canvasAbsPath, ensured.source, ensured.artboardId, opts);
      }
    }
    throw new CanvasEditError(
      'no video-comp for this artboard — set an artboard’s Kind to "Video" in the Inspector and drop again, or use ⌘K → New video…',
      { canvas: canvasAbsPath, id: artboardId ?? '' }
    );
  }
  const dur = Math.max(1, Math.round(opts.durationInFrames));
  const nameAttr = clipNameAttr(cc, opts.name);
  const srcTrim = (opts.src ?? '').trim();
  const media: { tag: string; src: string; importName: string; specifier: string } | null =
    opts.mediaTag && INSERTABLE_MEDIA.has(opts.mediaTag) && srcTrim
      ? { tag: opts.mediaTag, src: srcTrim, importName: opts.mediaTag, specifier: 'remotion' }
      : null;
  if (media) {
    assertContainedSrc(canvasAbsPath, media.src, artboardId ?? '');
    // This used to rewrite <Video> → <OffthreadVideo> as "house spelling", to
    // dodge a collision with a canvas component named `Video`. That trade was
    // wrong in one direction nobody noticed: <OffthreadVideo> is rejected by
    // @remotion/web-renderer, so the editor was silently converting the
    // audio-capable element into the audio-killing one behind the author's
    // back — every inserted clip exported muted (RCA
    // issue-mp4-audio-export-html5audio-silent-degrade). The collision is real,
    // so it is now solved where it belongs: in the import (see resolveMediaTag).
    const resolved = resolveMediaTag(source, media.tag);
    media.tag = resolved.emitTag;
    media.importName = resolved.importName;
    media.specifier = resolved.specifier;
  }

  const seqs = cc.clips.filter((c) => c.kind === 'sequence');
  const s = new MagicString(source);

  if (opts.lane === 'storyline') {
    const beats = seqs.filter(isSeriesSeq);
    if (beats.length === 0) {
      // Greenfield first drop (Task 20, default-container rule): author the
      // <TransitionSeries> storyline around the first beat, inside the comp's
      // root <AbsoluteFill>.
      if (!media && !opts.placeholder) {
        throw new CanvasEditError('the first storyline insert needs media', {
          canvas: canvasAbsPath,
          id: artboardId ?? '',
        });
      }
      const bodyM = source.match(
        new RegExp(`(?:const\\s+${cc.compName}\\s*=|function\\s+${cc.compName}\\b)`)
      );
      if (!bodyM || bodyM.index == null) {
        throw new CanvasEditError(`could not locate component ${cc.compName}`, {
          canvas: canvasAbsPath,
          id: artboardId ?? '',
        });
      }
      const rootClose = source.indexOf('</AbsoluteFill>', bodyM.index);
      if (rootClose < 0) {
        throw new CanvasEditError(
          'greenfield insert needs a root <AbsoluteFill> in the comp — add one, then drop again',
          { canvas: canvasAbsPath, id: artboardId ?? '' }
        );
      }
      const indent = `${lineStartInfo(source, rootClose).indent}  `;
      const s2 = new MagicString(source);
      // Placeholder wins over media (same precedence as the append path below),
      // then media, then nothing. The old two-arm form read `media.tag` in the
      // else, where only the `needs media` throw above ruled out null — a
      // disjunction the checker cannot carry. Spelled as three arms it needs no
      // assertion, and the unreachable third arm is honest rather than absent.
      const gfChild = opts.placeholder
        ? placeholderChildText(
            canvasAbsPath,
            artboardId,
            opts.placeholder,
            `${indent}  `,
            dur
          ).trimEnd()
        : media
          ? `\n${indent}    <${media.tag} src="${escapeAttr(media.src)}" />`
          : '';
      s2.appendLeft(
        rootClose,
        `  <TransitionSeries>\n${indent}  <TransitionSeries.Sequence${nameAttr} durationInFrames={${dur}}>` +
          `${gfChild}\n` +
          `${indent}  </TransitionSeries.Sequence>\n${indent}</TransitionSeries>\n${indent.slice(2)}`
      );
      ensureImportPublic(s2, source, 'TransitionSeries', '@remotion/transitions');
      if (opts.placeholder) ensureNamedImport(s2, source, 'AIPlaceholder', '@maude/canvas-lib');
      if (media) ensureNamedImport(s2, source, media.importName, media.specifier);
      const out2 = s2.toString();
      assertParses(canvasAbsPath, out2, artboardId ?? '');
      assertCompSemantics(canvasAbsPath, out2);
      const after2 = enumerateClips(canvasAbsPath, out2, artboardId);
      const beat = after2.clips.find((c) => isSeriesSeq(c));
      return { source: out2, stableId: beat?.stableId ?? null };
    }
    // A transition proto is cloned when the series has one; a series of hard
    // cuts (no transitions — valid Remotion) inserts a bare beat.
    const proto = cc.clips.find((c) => c.kind === 'transition') ?? null;
    const protoOverlap = proto ? (transitionDurationFrames(source, proto) ?? 0) : 0;
    const index = Math.max(0, Math.min(beats.length, Math.round(opts.index ?? beats.length)));
    const seriesPrefix = (beats[0] as ClipInfo).tag.split('.')[0]; // TransitionSeries | Series
    const anchor = (index === 0 ? beats[0] : beats[index - 1]) as ClipInfo;
    const indent = lineStartInfo(source, anchor.start).indent;
    const transitionText = proto ? `\n${indent}${source.slice(proto.start, proto.end)}` : '';
    const mediaText = opts.placeholder
      ? placeholderChildText(canvasAbsPath, artboardId, opts.placeholder, indent, dur)
      : media
        ? `\n${indent}  <${media.tag} src="${escapeAttr(media.src)}" />\n${indent}`
        : '';
    if (opts.placeholder) ensureNamedImport(s, source, 'AIPlaceholder', '@maude/canvas-lib');
    if (media) ensureNamedImport(s, source, media.importName, media.specifier);
    const beatText = `<${seriesPrefix}.Sequence${nameAttr} durationInFrames={${dur}}>${mediaText}</${seriesPrefix}.Sequence>`;
    if (index === 0) {
      // Head insert: B (T) before the first beat.
      const [rs] = spanWithFraming(source, anchor.start, anchor.end);
      s.appendLeft(rs, `\n${indent}${beatText}${transitionText}`);
    } else {
      // Insert after the anchor beat: (T) B.
      s.appendRight(anchor.end, `${transitionText}\n${indent}${beatText}`);
    }
    let out = s.toString();
    assertParses(canvasAbsPath, out, artboardId ?? '');
    assertCompSemantics(canvasAbsPath, out);
    // The cut grew — bump the comp TOTAL (const-preferring) by dur − overlap.
    const mid = enumerateClips(canvasAbsPath, out, artboardId);
    const midBeats = mid.clips.filter((c) => c.kind === 'sequence' && isSeriesSeq(c));
    const inserted = midBeats[index] as ClipInfo | undefined;
    if (inserted && dur - protoOverlap !== 0) {
      out = applyRippleAfterClip(
        canvasAbsPath,
        out,
        artboardId,
        inserted.stableId,
        dur - protoOverlap,
        {
          shiftFroms: false,
        }
      ).source;
    }
    const after = enumerateClips(canvasAbsPath, out, artboardId);
    const afterBeats = after.clips.filter((c) => c.kind === 'sequence' && isSeriesSeq(c));
    return { source: out, stableId: (afterBeats[index] as ClipInfo | undefined)?.stableId ?? null };
  }

  // overlay / audio — a standalone <Sequence from> sibling, never inside the series.
  const from = Math.max(0, Math.round(opts.from ?? 0));
  const lastSeries = [...cc.clips].reverse().find((c) => isSeriesSeq(c) || c.kind === 'transition');
  let insertAt: number;
  let indent: string;
  if (lastSeries) {
    const closeTag = lastSeries.tag.startsWith('Series.') ? '</Series>' : '</TransitionSeries>';
    const closeIdx = source.indexOf(closeTag, lastSeries.end);
    if (closeIdx < 0) {
      throw new CanvasEditError('could not locate the series close tag', {
        canvas: canvasAbsPath,
        id: artboardId ?? '',
      });
    }
    insertAt = closeIdx + closeTag.length;
    indent = lineStartInfo(source, closeIdx).indent;
  } else {
    const last = seqs[seqs.length - 1];
    if (last) {
      insertAt = last.end;
      indent = lineStartInfo(source, last.start).indent;
    } else {
      // Empty comp (greenfield) — anchor inside the comp's root <AbsoluteFill>,
      // exactly like the storyline greenfield insert.
      const bodyM = source.match(
        new RegExp(`(?:const\\s+${cc.compName}\\s*=|function\\s+${cc.compName}\\b)`)
      );
      const rootClose = bodyM ? source.indexOf('</AbsoluteFill>', bodyM.index) : -1;
      if (rootClose < 0) {
        throw new CanvasEditError(
          'comp has no clip and no root <AbsoluteFill> to anchor the insert — drop onto the storyline instead',
          { canvas: canvasAbsPath, id: artboardId ?? '' }
        );
      }
      insertAt = rootClose;
      indent = `${lineStartInfo(source, rootClose).indent}  `;
    }
  }
  // Task 19 — "+ Title": a literal text block instead of a media child. The
  // caption is USER TEXT → JSON.stringify (DDR-150 P1 quoted-string discipline).
  const titleText =
    opts.mediaTag === 'Title'
      ? `\n${indent}  <AbsoluteFill style={{ display: 'grid', placeItems: 'center', pointerEvents: 'none' }}>` +
        `\n${indent}    <div style={{ color: 'white', fontSize: 64, fontWeight: 700, textShadow: '0 2px 24px rgba(0,0,0,0.55)', pointerEvents: 'auto' }}>{${JSON.stringify(String(opts.src || 'Title'))}}</div>` +
        `\n${indent}  </AbsoluteFill>\n${indent}`
      : null;
  const mediaText = opts.placeholder
    ? placeholderChildText(canvasAbsPath, artboardId, opts.placeholder, indent, dur)
    : titleText
      ? titleText
      : media
        ? `\n${indent}  <${media.tag} src="${escapeAttr(media.src)}" />\n${indent}`
        : '';
  if (opts.placeholder) ensureNamedImport(s, source, 'AIPlaceholder', '@maude/canvas-lib');
  if (media) ensureNamedImport(s, source, media.importName, media.specifier);
  if (titleText) ensureNamedImport(s, source, 'AbsoluteFill', 'remotion');
  ensureNamedImport(s, source, 'Sequence', 'remotion');
  const clipText = `\n${indent}<Sequence${nameAttr} from={${from}} durationInFrames={${dur}}>${mediaText}</Sequence>`;
  s.appendRight(insertAt, clipText);
  let out = s.toString();
  try {
    assertParses(canvasAbsPath, out, artboardId ?? '');
  } catch {
    // A comp whose body is the bare series (`() => (<TransitionSeries>…`)
    // can't take a sibling — wrap series + new clip in a fragment.
    if (!lastSeries)
      throw new CanvasEditError('insert produced invalid source', {
        canvas: canvasAbsPath,
        id: artboardId ?? '',
      });
    // The container's OWN open tag — never a `<TransitionSeries.Sequence>`
    // member tag (a bare lastIndexOf prefix-matched those).
    const openRe = lastSeries.tag.startsWith('Series.')
      ? /<Series(?![.\w])/g
      : /<TransitionSeries(?![.\w])/g;
    let openStart = -1;
    for (const m of source.matchAll(openRe)) {
      if ((m.index as number) < lastSeries.start) openStart = m.index as number;
    }
    if (openStart < 0) {
      throw new CanvasEditError('insert produced invalid source', {
        canvas: canvasAbsPath,
        id: artboardId ?? '',
      });
    }
    const s2 = new MagicString(source);
    s2.appendLeft(openStart, '<>');
    s2.appendRight(insertAt, `${clipText}\n${indent}</>`);
    if (opts.placeholder) ensureNamedImport(s2, source, 'AIPlaceholder', '@maude/canvas-lib');
    if (media) ensureNamedImport(s2, source, media.importName, media.specifier);
    if (titleText) ensureNamedImport(s2, source, 'AbsoluteFill', 'remotion');
    ensureNamedImport(s2, source, 'Sequence', 'remotion');
    out = s2.toString();
    assertParses(canvasAbsPath, out, artboardId ?? '');
  }
  assertCompSemantics(canvasAbsPath, out);
  // A clip landing past the current comp end stretches the timeline to it.
  out = applyFitTotalToContent(canvasAbsPath, out, artboardId).source;
  const after = enumerateClips(canvasAbsPath, out, artboardId);
  const standalone = after.clips.filter((c) => c.kind === 'sequence' && c.tag === 'Sequence');
  return {
    source: out,
    stableId: (standalone[standalone.length - 1] as ClipInfo | undefined)?.stableId ?? null,
  };
}

/** Positional insert on disk (atomic write + cross-process lock). */
export async function insertClipAt(
  canvasAbsPath: string,
  artboardId: string | undefined,
  opts: InsertAtOptions
): Promise<{ source: string; stableId: string | null }> {
  return withLock(canvasAbsPath, async () => {
    const file = Bun.file(canvasAbsPath);
    if (!(await file.exists())) {
      throw new CanvasEditError(`Canvas not found: ${canvasAbsPath}`, {
        canvas: canvasAbsPath,
        id: artboardId ?? '',
      });
    }
    const source = await file.text();
    const next = applyInsertClipAt(canvasAbsPath, source, artboardId, opts);
    if (next.source === source) return next;
    const tmp = `${canvasAbsPath}.tmp.${Math.random().toString(36).slice(2, 10)}`;
    await Bun.write(tmp, next.source);
    const { rename } = await import('node:fs/promises');
    await rename(tmp, canvasAbsPath);
    return next;
  });
}

// ---------------------------------------------------------------------------
// Phase 2 (Tasks 10–15) — parametric clip verbs. All text-surgical on ONE
// opening tag (media element / clip tag / transition), reparse + semantic
// gated, composed with the ripple engine for anything that changes length.

/** End index (exclusive) of the opening tag starting at `tagStart` — brace-aware
 *  so `style={{ … }}` doesn't fool the `>` scan. */
function openTagEnd(source: string, tagStart: number): number {
  let depth = 0;
  for (let i = tagStart; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') depth -= 1;
    else if (ch === '>' && depth <= 0) return i + 1;
  }
  return source.length;
}

/** Span of `name=<value>` (incl. leading space) inside the opening tag at
 *  `tagStart`, brace-matching the value. Null when absent. */
function attrSpanInTag(
  source: string,
  tagStart: number,
  name: string
): { start: number; end: number; valueText: string | null } | null {
  const end = openTagEnd(source, tagStart);
  const tag = source.slice(tagStart, end);
  const re = new RegExp(`\\s${name}(?=[\\s/>=])`);
  const m = tag.match(re);
  if (!m || m.index == null) return null;
  const attrStart = tagStart + m.index;
  let i = attrStart + m[0].length;
  if (source[i] !== '=') return { start: attrStart, end: i, valueText: null }; // bare attr
  i += 1;
  if (source[i] === '"' || source[i] === "'") {
    const q = source[i];
    const close = source.indexOf(q, i + 1);
    const vEnd = close < 0 ? end : close + 1;
    return { start: attrStart, end: vEnd, valueText: source.slice(i, vEnd) };
  }
  if (source[i] === '{') {
    let depth = 0;
    for (let k = i; k < end; k += 1) {
      if (source[k] === '{') depth += 1;
      else if (source[k] === '}') {
        depth -= 1;
        if (depth === 0) {
          return { start: attrStart, end: k + 1, valueText: source.slice(i, k + 1) };
        }
      }
    }
  }
  return null;
}

/** Set (`next` = full JSX value text like `{2}` or `"x"` or '' for bare) or
 *  remove (`next` = null) an attribute on the opening tag at `tagStart`. */
function setTagAttr(
  s: MagicString,
  source: string,
  tagStart: number,
  name: string,
  next: string | null
): void {
  const existing = attrSpanInTag(source, tagStart, name);
  if (next == null) {
    if (existing) s.remove(existing.start, existing.end);
    return;
  }
  const text = next === '' ? ` ${name}` : ` ${name}=${next}`;
  if (existing) {
    s.overwrite(existing.start, existing.end, text);
  } else {
    const nameM = source.slice(tagStart).match(/^<[A-Za-z][\w.]*/);
    if (!nameM) return;
    s.appendLeft(tagStart + nameM[0].length, text);
  }
}

/** The clip's DIRECT media element open-tag start, or null (wrapper/array-fed
 *  media is refused by the callers — editing a shared component would leak). */
function directMediaTagStart(
  source: string,
  clip: ClipInfo,
  tags = ['Video', 'OffthreadVideo', 'Audio', 'Img', 'MaudeVideo', 'MaudeAudio', 'MaudeImg']
): number | null {
  const span = source.slice(clip.start, clip.end);
  const m = span.match(new RegExp(`<(${tags.join('|')})\\b`));
  if (!m || m.index == null) return null;
  return clip.start + m.index;
}

function numAttrText(source: string, tagStart: number, name: string): number | null {
  const a = attrSpanInTag(source, tagStart, name);
  if (!a?.valueText) return null;
  const inner = a.valueText.replace(/^\{|\}$/g, '').trim();
  return resolveNum(inner, collectConsts(source));
}

/** Overwrite a clip tag's durationInFrames with a literal (a shared const must
 *  not absorb a per-clip change). Throws when the attr is missing. */
function setClipDurationLiteral(
  s: MagicString,
  source: string,
  canvasAbsPath: string,
  clip: ClipInfo,
  frames: number
): void {
  const a = attrSpanInTag(source, clip.start, 'durationInFrames');
  if (!a) {
    throw new CanvasEditError(`clip "${clip.stableId}" has no durationInFrames to rewrite`, {
      canvas: canvasAbsPath,
      id: clip.stableId,
    });
  }
  s.overwrite(a.start, a.end, ` durationInFrames={${Math.max(1, Math.round(frames))}}`);
}

interface SpeedResult {
  source: string;
  rate: number;
  newDuration: number | null;
}

/**
 * Task 10 — set/remove a clip's playback speed. Writes `playbackRate` on the
 * clip's DIRECT media element, recomputes the clip's `durationInFrames`
 * (source frames consumed stay constant: d1 = d0 × r0 / r1), and ripples the
 * length delta (downstream `from`s + TOTAL). `rate === 1` removes the attr.
 */
export function applySetPlaybackRate(
  canvasAbsPath: string,
  source: string,
  artboardId: string | undefined,
  stableId: string,
  expectedHash: string | undefined,
  rate: number
): SpeedResult {
  if (!(rate > 0.01 && rate <= 16)) {
    throw new CanvasEditError('playbackRate must be between 0.01 and 16', {
      canvas: canvasAbsPath,
      id: stableId,
    });
  }
  const { clips } = enumerateClips(canvasAbsPath, source, artboardId);
  const { clip } = mustResolve(canvasAbsPath, clips, stableId, expectedHash);
  const mediaStart = directMediaTagStart(source, clip, [
    'Video',
    'OffthreadVideo',
    'Audio',
    'MaudeVideo',
    'MaudeAudio',
  ]);
  if (mediaStart == null) {
    throw new CanvasEditError(
      `clip "${stableId}" has no direct media element — speed applies to <Video>/<Audio> clips (shared/wrapper media would change every user)`,
      { canvas: canvasAbsPath, id: stableId }
    );
  }
  const oldRate = numAttrText(source, mediaStart, 'playbackRate') ?? 1;
  const oldDur = clip.durationInFrames;
  const s = new MagicString(source);
  setTagAttr(s, source, mediaStart, 'playbackRate', rate === 1 ? null : `{${rate}}`);
  let newDur: number | null = null;
  if (oldDur != null) {
    newDur = Math.max(1, Math.round((oldDur * oldRate) / rate));
    setClipDurationLiteral(s, source, canvasAbsPath, clip, newDur);
  }
  let out = s.toString();
  assertParses(canvasAbsPath, out, stableId);
  assertCompSemantics(canvasAbsPath, out);
  if (oldDur != null && newDur != null && newDur !== oldDur) {
    out = applyRippleAfterClip(canvasAbsPath, out, artboardId, stableId, newDur - oldDur, {
      fromFrame: clipAbsoluteStart(source, canvasAbsPath, artboardId, stableId) + oldDur,
    }).source;
  }
  return { source: out, rate, newDuration: newDur };
}

/**
 * Task 11 — in-point trim (the left-edge drag). `deltaFrames > 0` trims INTO
 * the clip (later in-point, shorter clip); negative restores. Writes
 * `trimBefore` on the media element (reads legacy `startFrom` too), shortens
 * the clip, moves a standalone clip's `from` (the left edge follows), and
 * ripples downstream.
 */
export function applyTrimIn(
  canvasAbsPath: string,
  source: string,
  artboardId: string | undefined,
  stableId: string,
  expectedHash: string | undefined,
  deltaFrames: number
): { source: string; trimBefore: number; newDuration: number } {
  const delta = Math.round(deltaFrames);
  const { clips } = enumerateClips(canvasAbsPath, source, artboardId);
  const { clip } = mustResolve(canvasAbsPath, clips, stableId, expectedHash);
  const mediaStart = directMediaTagStart(source, clip, [
    'Video',
    'OffthreadVideo',
    'Audio',
    'MaudeVideo',
    'MaudeAudio',
  ]);
  if (mediaStart == null) {
    throw new CanvasEditError(
      `clip "${stableId}" has no direct media element — in-point trim applies to media clips`,
      { canvas: canvasAbsPath, id: stableId }
    );
  }
  const oldDur = clip.durationInFrames;
  if (oldDur == null) {
    throw new CanvasEditError(`clip "${stableId}" has no resolvable durationInFrames`, {
      canvas: canvasAbsPath,
      id: stableId,
    });
  }
  const rate = numAttrText(source, mediaStart, 'playbackRate') ?? 1;
  const oldTrim =
    numAttrText(source, mediaStart, 'trimBefore') ??
    numAttrText(source, mediaStart, 'startFrom') ??
    0;
  const newTrim = Math.max(0, Math.round(oldTrim + delta * rate));
  const effDelta = Math.round((newTrim - oldTrim) / rate); // clamped at trim 0
  const newDur = oldDur - effDelta;
  if (newDur < 1) {
    throw new CanvasEditError('trim would leave the clip shorter than 1 frame', {
      canvas: canvasAbsPath,
      id: stableId,
    });
  }
  const s = new MagicString(source);
  setTagAttr(s, source, mediaStart, 'trimBefore', newTrim === 0 ? null : `{${newTrim}}`);
  // Emit trimBefore, retire the legacy spelling if present.
  if (attrSpanInTag(source, mediaStart, 'startFrom')) {
    setTagAttr(s, source, mediaStart, 'startFrom', null);
  }
  setClipDurationLiteral(s, source, canvasAbsPath, clip, newDur);
  if (clip.tag === 'Sequence' && clip.from != null) {
    const a = attrSpanInTag(source, clip.start, 'from');
    if (a) s.overwrite(a.start, a.end, ` from={${Math.max(0, clip.from + effDelta)}}`);
  }
  let out = s.toString();
  assertParses(canvasAbsPath, out, stableId);
  assertCompSemantics(canvasAbsPath, out);
  if (effDelta !== 0) {
    out = applyRippleAfterClip(canvasAbsPath, out, artboardId, stableId, -effDelta, {
      fromFrame: clipAbsoluteStart(source, canvasAbsPath, artboardId, stableId) + oldDur,
    }).source;
  }
  return { source: out, trimBefore: newTrim, newDuration: newDur };
}

/**
 * Task 12 — per-clip audio: mute toggle + constant volume on the clip's direct
 * media element. `muted: true` writes the bare attr; `volume` writes
 * `volume={n}` (0–1); null/1 removes it.
 */
export function applyClipAudio(
  canvasAbsPath: string,
  source: string,
  artboardId: string | undefined,
  stableId: string,
  expectedHash: string | undefined,
  opts: { muted?: boolean; volume?: number | null }
): { source: string } {
  const { clips } = enumerateClips(canvasAbsPath, source, artboardId);
  const { clip } = mustResolve(canvasAbsPath, clips, stableId, expectedHash);
  const mediaStart = directMediaTagStart(source, clip, [
    'Video',
    'OffthreadVideo',
    'Audio',
    'MaudeVideo',
    'MaudeAudio',
  ]);
  if (mediaStart == null) {
    throw new CanvasEditError(`clip "${stableId}" has no direct media element to set audio on`, {
      canvas: canvasAbsPath,
      id: stableId,
    });
  }
  const s = new MagicString(source);
  if (opts.muted != null) setTagAttr(s, source, mediaStart, 'muted', opts.muted ? '' : null);
  if (opts.volume !== undefined) {
    const v = opts.volume;
    if (v != null && !(v >= 0 && v <= 1)) {
      throw new CanvasEditError('volume must be between 0 and 1', {
        canvas: canvasAbsPath,
        id: stableId,
      });
    }
    setTagAttr(s, source, mediaStart, 'volume', v == null || v === 1 ? null : `{${v}}`);
  }
  const out = s.toString();
  assertParses(canvasAbsPath, out, stableId);
  assertCompSemantics(canvasAbsPath, out);
  return { source: out };
}

/**
 * Task 12 — detach audio: mute the video clip AND add an audio-band
 * `<Sequence from><Audio src={same} trimBefore={same} playbackRate={same}>`
 * (same file, two elements, zero preprocessing).
 */
export function applyDetachAudio(
  canvasAbsPath: string,
  source: string,
  artboardId: string | undefined,
  stableId: string,
  expectedHash: string | undefined
): { source: string; audioStableId: string | null } {
  const cc = enumerateClips(canvasAbsPath, source, artboardId);
  const { clip } = mustResolve(canvasAbsPath, cc.clips, stableId, expectedHash);
  const mediaStart = directMediaTagStart(source, clip, ['Video', 'OffthreadVideo', 'MaudeVideo']);
  if (mediaStart == null || !clip.mediaSrc) {
    throw new CanvasEditError(
      `clip "${stableId}" has no direct video media with a literal src to detach`,
      { canvas: canvasAbsPath, id: stableId }
    );
  }
  if (clip.durationInFrames == null) {
    throw new CanvasEditError(`clip "${stableId}" has no resolvable duration`, {
      canvas: canvasAbsPath,
      id: stableId,
    });
  }
  const trim = numAttrText(source, mediaStart, 'trimBefore') ?? 0;
  const rate = numAttrText(source, mediaStart, 'playbackRate') ?? 1;
  // Mute the video in place…
  const s = new MagicString(source);
  setTagAttr(s, source, mediaStart, 'muted', '');
  const muted = s.toString();
  // …then insert the audio clip at the clip's absolute start.
  const startFrame = clipAbsoluteStart(muted, canvasAbsPath, artboardId, stableId);
  const inserted = applyInsertClipAt(canvasAbsPath, muted, artboardId, {
    lane: 'audio',
    from: startFrame,
    durationInFrames: clip.durationInFrames,
    mediaTag: 'Audio',
    src: clip.mediaSrc,
  });
  // applyInsertClipAt writes a plain `<Audio src>`; graft trim/rate onto it.
  let out = inserted.source;
  if (trim || rate !== 1) {
    const after = enumerateClips(canvasAbsPath, out, artboardId);
    const audioClip = after.clips.find((c) => c.stableId === inserted.stableId);
    const audioMedia = audioClip ? directMediaTagStart(out, audioClip, ['Audio']) : null;
    if (audioMedia != null) {
      const s2 = new MagicString(out);
      if (trim) setTagAttr(s2, out, audioMedia, 'trimBefore', `{${trim}}`);
      if (rate !== 1) setTagAttr(s2, out, audioMedia, 'playbackRate', `{${rate}}`);
      out = s2.toString();
      assertParses(canvasAbsPath, out, stableId);
    }
  }
  assertCompSemantics(canvasAbsPath, out);
  return { source: out, audioStableId: inserted.stableId };
}

/** Absolute start frame of a clip: explicit `from`, or the series cursor walk
 *  (sum of prior beat durations minus transition overlaps). */
export function clipAbsoluteStart(
  source: string,
  canvasAbsPath: string,
  artboardId: string | undefined,
  stableId: string
): number {
  const { clips } = enumerateClips(canvasAbsPath, source, artboardId);
  const consts = collectConsts(source);
  let cursor = 0;
  for (const c of clips) {
    if (c.kind === 'transition') {
      cursor -= transitionDurationFrames(source, c, consts) ?? 0;
      continue;
    }
    const start = c.tag === 'Sequence' && c.from != null ? c.from : cursor;
    if (c.stableId === stableId) return Math.max(0, Math.round(start));
    cursor = start + (c.durationInFrames ?? 0);
  }
  return 0;
}

/** Task 14 — grade parameter vocabulary (the PhotoEdit subset that compiles to
 *  a CSS filter chain — deterministic in Player + both export paths). */
export interface GradeParams {
  brightness?: number; // 1 = neutral
  contrast?: number; // 1 = neutral
  saturation?: number; // 1 = neutral
  hue?: number; // deg, 0 = neutral
  sepia?: number; // 0 = neutral
  grayscale?: number; // 0 = neutral
  invert?: number; // 0 = neutral
}

export function gradeToFilter(p: GradeParams): string {
  const parts: string[] = [];
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const b = num(p.brightness);
  if (b != null && b !== 1) parts.push(`brightness(${b})`);
  const c = num(p.contrast);
  if (c != null && c !== 1) parts.push(`contrast(${c})`);
  const s = num(p.saturation);
  if (s != null && s !== 1) parts.push(`saturate(${s})`);
  const h = num(p.hue);
  if (h != null && h !== 0) parts.push(`hue-rotate(${h}deg)`);
  const se = num(p.sepia);
  if (se != null && se !== 0) parts.push(`sepia(${se})`);
  const g = num(p.grayscale);
  if (g != null && g !== 0) parts.push(`grayscale(${g})`);
  const i = num(p.invert);
  if (i != null && i !== 0) parts.push(`invert(${i})`);
  return parts.join(' ');
}

/** Round-trip: parse a filter chain back to params. Unrecognized functions →
 *  null (the UI shows a read-only badge instead of clobbering hand-written CSS). */
export function filterToGrade(filter: string): GradeParams | null {
  const out: GradeParams = {};
  let rest = String(filter).trim();
  const fnRe = /^([a-z-]+)\(([^)]*)\)\s*/;
  while (rest.length) {
    const m = rest.match(fnRe);
    if (!m) return null;
    const val = Number.parseFloat(m[2] as string);
    if (!Number.isFinite(val)) return null;
    switch (m[1]) {
      case 'brightness':
        out.brightness = val;
        break;
      case 'contrast':
        out.contrast = val;
        break;
      case 'saturate':
        out.saturation = val;
        break;
      case 'hue-rotate':
        out.hue = val;
        break;
      case 'sepia':
        out.sepia = val;
        break;
      case 'grayscale':
        out.grayscale = val;
        break;
      case 'invert':
        out.invert = val;
        break;
      default:
        return null;
    }
    rest = rest.slice(m[0].length);
  }
  return out;
}

/**
 * Task 14 — set/clear a clip's color grade: ONE CSS `filter` string on the
 * media element's `style` (literal object only). `params === null` clears it.
 */
export function applyClipGrade(
  canvasAbsPath: string,
  source: string,
  artboardId: string | undefined,
  stableId: string,
  expectedHash: string | undefined,
  params: GradeParams | null
): { source: string; filter: string } {
  const { clips } = enumerateClips(canvasAbsPath, source, artboardId);
  const { clip } = mustResolve(canvasAbsPath, clips, stableId, expectedHash);
  const mediaStart = directMediaTagStart(source, clip, [
    'Video',
    'OffthreadVideo',
    'Img',
    'MaudeVideo',
    'MaudeImg',
  ]);
  if (mediaStart == null) {
    throw new CanvasEditError(`clip "${stableId}" has no direct media element to grade`, {
      canvas: canvasAbsPath,
      id: stableId,
    });
  }
  const filter = params ? gradeToFilter(params) : '';
  const styleAttr = attrSpanInTag(source, mediaStart, 'style');
  const s = new MagicString(source);
  if (!styleAttr) {
    if (filter) setTagAttr(s, source, mediaStart, 'style', `{{ filter: '${filter}' }}`);
  } else {
    const v = styleAttr.valueText ?? '';
    if (!v.startsWith('{{')) {
      throw new CanvasEditError(
        `clip "${stableId}"'s media style is not a literal object — edit it by hand`,
        { canvas: canvasAbsPath, id: stableId }
      );
    }
    const filterProp = v.match(/(['"]?)filter\1\s*:\s*(['"])((?:\\.|(?!\2).)*)\2\s*,?\s*/);
    if (filterProp && filterProp.index != null) {
      const abs = styleAttr.start + (styleAttr.end - styleAttr.start - v.length) + filterProp.index;
      if (filter) {
        s.overwrite(
          abs,
          abs + filterProp[0].length,
          `filter: '${filter}'${filterProp[0].trimEnd().endsWith(',') ? ', ' : ' '}`
        );
      } else {
        s.remove(abs, abs + filterProp[0].length);
      }
    } else if (filter) {
      const openIdx = styleAttr.end - v.length + 2; // after `{{`
      s.appendLeft(openIdx, ` filter: '${filter}',`);
    }
  }
  const out = s.toString();
  assertParses(canvasAbsPath, out, stableId);
  assertCompSemantics(canvasAbsPath, out);
  return { source: out, filter };
}

/**
 * Task 13 — crop/reposition: an idempotent framing wrapper around the media
 * element (`overflow:hidden` outer + scaled/translated inner), marked with
 * `data-mframe` for lossless round-trip. `framing === null` unwraps.
 */
export function applyClipFraming(
  canvasAbsPath: string,
  source: string,
  artboardId: string | undefined,
  stableId: string,
  expectedHash: string | undefined,
  framing: { scale: number; x: number; y: number } | null
): { source: string } {
  const { clips } = enumerateClips(canvasAbsPath, source, artboardId);
  const { clip } = mustResolve(canvasAbsPath, clips, stableId, expectedHash);
  const mediaStart = directMediaTagStart(source, clip, [
    'Video',
    'OffthreadVideo',
    'Img',
    'MaudeVideo',
    'MaudeImg',
  ]);
  if (mediaStart == null) {
    throw new CanvasEditError(`clip "${stableId}" has no direct media element to frame`, {
      canvas: canvasAbsPath,
      id: stableId,
    });
  }
  // Existing wrapper? (marker on the OUTER div, inside this clip's span)
  const span = source.slice(clip.start, clip.end);
  const marker = span.match(/<div data-mframe="[^"]*"[^>]*>/);
  const s = new MagicString(source);
  if (marker && marker.index != null) {
    const outerStart = clip.start + marker.index;
    // The wrapper is exactly: <div data-mframe …><div …>MEDIA</div></div>
    const outerEnd = matchTagEnd(source, outerStart);
    if (outerEnd == null) {
      throw new CanvasEditError('framing wrapper is malformed — fix the JSX by hand', {
        canvas: canvasAbsPath,
        id: stableId,
      });
    }
    const inner = source.slice(outerStart, outerEnd);
    const mediaM = inner.match(/<(?:Video|OffthreadVideo|Img)\b[\s\S]*?\/>/);
    if (!mediaM || mediaM.index == null) {
      throw new CanvasEditError('framing wrapper holds no media — fix the JSX by hand', {
        canvas: canvasAbsPath,
        id: stableId,
      });
    }
    const mediaText = mediaM[0];
    if (framing == null) {
      s.overwrite(outerStart, outerEnd, mediaText);
    } else {
      s.overwrite(outerStart, outerEnd, framingWrapper(mediaText, framing));
    }
  } else if (framing != null) {
    const mEnd = matchSelfClosing(source, mediaStart);
    if (mEnd == null) {
      throw new CanvasEditError(
        'framing needs a self-closing media element (`<Video … />`) — adjust the JSX',
        { canvas: canvasAbsPath, id: stableId }
      );
    }
    s.overwrite(mediaStart, mEnd, framingWrapper(source.slice(mediaStart, mEnd), framing));
  }
  const out = s.toString();
  assertParses(canvasAbsPath, out, stableId);
  assertCompSemantics(canvasAbsPath, out);
  return { source: out };
}

function framingWrapper(mediaText: string, f: { scale: number; x: number; y: number }): string {
  const scale = Math.max(1, Math.min(8, f.scale || 1));
  const x = Math.max(-100, Math.min(100, f.x || 0));
  const y = Math.max(-100, Math.min(100, f.y || 0));
  return (
    `<div data-mframe="${scale},${x},${y}" style={{ overflow: 'hidden', width: '100%', height: '100%' }}>` +
    `<div style={{ width: '100%', height: '100%', transform: 'scale(${scale}) translate(${x}%, ${y}%)' }}>` +
    mediaText +
    `</div></div>`
  );
}

/** End index (exclusive) of the `<div …>…</div>` element starting at `start`
 *  (depth-counted on <div/</div> only — the wrapper contains no other divs
 *  except its own inner). */
function matchTagEnd(source: string, start: number): number | null {
  const re = /<div\b|<\/div>/g;
  re.lastIndex = start;
  let depth = 0;
  let m: RegExpExecArray | null = re.exec(source);
  while (m) {
    if (m[0] === '<div') depth += 1;
    else {
      depth -= 1;
      if (depth === 0) return m.index + m[0].length;
    }
    m = re.exec(source);
  }
  return null;
}

/** End (exclusive) of a self-closing tag starting at `start`, or null. */
function matchSelfClosing(source: string, start: number): number | null {
  const end = openTagEnd(source, start);
  return source.slice(end - 2, end) === '/>' ? end : null;
}

// Task 15 / 17 — the 6 bundled transition presentations.
const PRESENTATIONS: Record<string, { factory: string; specifier: string; importName: string }> = {
  fade: { factory: 'fade()', specifier: '@remotion/transitions/fade', importName: 'fade' },
  slide: { factory: 'slide()', specifier: '@remotion/transitions/slide', importName: 'slide' },
  wipe: { factory: 'wipe()', specifier: '@remotion/transitions/wipe', importName: 'wipe' },
  flip: { factory: 'flip()', specifier: '@remotion/transitions/flip', importName: 'flip' },
  'clock-wipe': {
    factory: 'clockWipe({ width: 1920, height: 1080 })',
    specifier: '@remotion/transitions/clock-wipe',
    importName: 'clockWipe',
  },
  none: { factory: 'none()', specifier: '@remotion/transitions/none', importName: 'none' },
};

export const PRESENTATION_KEYS = Object.keys(PRESENTATIONS);

/** Ensure `import { name } from 'specifier';` exists (inserted after the last
 *  import when absent). */
function ensureImport(s: MagicString, source: string, importName: string, specifier: string): void {
  if (new RegExp(`from ['"]${specifier.replace(/[/]/g, '\\/')}['"]`).test(source)) return;
  const imports = [...source.matchAll(/^import [^\n]*\n/gm)];
  const last = imports[imports.length - 1];
  const at = last ? (last.index as number) + last[0].length : 0;
  s.appendLeft(at, `import { ${importName} } from '${specifier}';\n`);
}

/**
 * Task 15 — edit an existing seam: presentation (among the 6 bundled) and/or
 * duration (TOTAL-rippled). The transition is addressed by ITS stableId from
 * the enumerator.
 */
export function applyEditTransition(
  canvasAbsPath: string,
  source: string,
  artboardId: string | undefined,
  transitionId: string,
  expectedHash: string | undefined,
  opts: { presentation?: string; durationInFrames?: number }
): { source: string } {
  const { clips } = enumerateClips(canvasAbsPath, source, artboardId);
  const { clip: t } = mustResolve(canvasAbsPath, clips, transitionId, expectedHash);
  if (t.kind !== 'transition') {
    throw new CanvasEditError(`"${transitionId}" is not a transition`, {
      canvas: canvasAbsPath,
      id: transitionId,
    });
  }
  const s = new MagicString(source);
  if (opts.presentation != null) {
    const p = PRESENTATIONS[opts.presentation];
    if (!p) {
      throw new CanvasEditError(
        `unknown presentation "${opts.presentation}" — one of: ${PRESENTATION_KEYS.join(', ')}`,
        { canvas: canvasAbsPath, id: transitionId }
      );
    }
    const attr = attrSpanInTag(source, t.start, 'presentation');
    if (!attr) {
      throw new CanvasEditError('transition has no presentation attr to rewrite', {
        canvas: canvasAbsPath,
        id: transitionId,
      });
    }
    // clockWipe sizes itself to the comp when we can read it.
    let factory = p.factory;
    if (opts.presentation === 'clock-wipe') {
      const wh = compDimensions(source);
      if (wh) factory = `clockWipe({ width: ${wh.width}, height: ${wh.height} })`;
    }
    s.overwrite(attr.start, attr.end, ` presentation={${factory}}`);
    ensureImport(s, source, p.importName, p.specifier);
  }
  let out: string;
  let delta = 0;
  if (opts.durationInFrames != null) {
    const next = Math.max(1, Math.round(opts.durationInFrames));
    const span = source.slice(t.start, t.end);
    const m = span.match(/durationInFrames:\s*([^,}\s)]+)/);
    if (!m || m.index == null) {
      throw new CanvasEditError('transition has no timing durationInFrames to rewrite', {
        canvas: canvasAbsPath,
        id: transitionId,
      });
    }
    const old = resolveNum(m[1] as string, collectConsts(source));
    const valStart = t.start + m.index + m[0].indexOf(m[1] as string);
    s.overwrite(valStart, valStart + (m[1] as string).length, String(next));
    if (old != null) delta = -(next - old); // longer overlap ⇒ SHORTER comp
    out = s.toString();
  } else {
    out = s.toString();
  }
  assertParses(canvasAbsPath, out, transitionId);
  assertCompSemantics(canvasAbsPath, out);
  if (delta !== 0) {
    out = applyRippleAfterClip(canvasAbsPath, out, artboardId, transitionId, delta, {
      shiftFroms: false,
    }).source;
  }
  return { source: out };
}

/** The comp's VideoComp width/height (for clockWipe), when resolvable. */
function compDimensions(source: string): { width: number; height: number } | null {
  const m = source.match(/<VideoComp\b[^>]*>/);
  if (!m || m.index == null) return null;
  const w = numAttrText(source, m.index, 'width');
  const h = numAttrText(source, m.index, 'height');
  return w && h ? { width: w, height: h } : null;
}

// ---------------------------------------------------------------------------
// Phase 3 — structural ops: split at playhead, transition insert/remove.

/** Rewrite/insert/remove an attr on the FIRST tag of a detached text fragment. */
function textWithAttr(text: string, name: string, next: string | null): string {
  const s = new MagicString(text);
  setTagAttr(s, text, 0, name, next);
  return s.toString();
}

/** Rewrite an attr on the first MEDIA tag inside a detached clip text. */
function textWithMediaAttr(text: string, name: string, next: string | null): string {
  const m = text.match(/<(?:Video|OffthreadVideo|Audio|Img)\b/);
  if (!m || m.index == null) return text;
  const s = new MagicString(text);
  setTagAttr(s, text, m.index, name, next);
  return s.toString();
}

/**
 * Task 16 — split a clip at an absolute comp frame. Two literal halves: the
 * first keeps the in-point and takes `offset` frames; the second starts at the
 * cut (`trimBefore += offset × rate`) and takes the remainder. Both inherit
 * every other attr (grade, crop wrapper, audio props ride along verbatim).
 *
 * Scope fence (DDR-150 deferral): standalone `<Sequence>` clips, and series
 * beats NOT adjacent to a transition — at a seam the overlap math makes the
 * halves lie, so the engine refuses with guidance instead.
 */
export function applySplitClip(
  canvasAbsPath: string,
  source: string,
  artboardId: string | undefined,
  stableId: string,
  expectedHash: string | undefined,
  atFrame: number
): { source: string; firstStableId: string | null; secondStableId: string | null } {
  const { clips } = enumerateClips(canvasAbsPath, source, artboardId);
  const { clip, idx } = mustResolve(canvasAbsPath, clips, stableId, expectedHash);
  if (clip.kind !== 'sequence') {
    throw new CanvasEditError(`"${stableId}" is a transition, not a splittable clip`, {
      canvas: canvasAbsPath,
      id: stableId,
    });
  }
  if (isSeriesSeq(clip)) {
    const prev = clips[idx - 1];
    const next = clips[idx + 1];
    if (prev?.kind === 'transition' || next?.kind === 'transition') {
      throw new CanvasEditError(
        'this beat touches a transition — remove the transition first (or move the clip out of it), then split',
        { canvas: canvasAbsPath, id: stableId }
      );
    }
  }
  const dur = clip.durationInFrames;
  if (dur == null) {
    throw new CanvasEditError(`clip "${stableId}" has no resolvable durationInFrames`, {
      canvas: canvasAbsPath,
      id: stableId,
    });
  }
  const start = clipAbsoluteStart(source, canvasAbsPath, artboardId, stableId);
  const offset = Math.round(atFrame - start);
  if (offset < 1 || offset > dur - 1) {
    throw new CanvasEditError(
      `split point is ${offset <= 0 ? 'at/before the clip start' : 'at/after the clip end'} — scrub inside the clip first`,
      { canvas: canvasAbsPath, id: stableId }
    );
  }
  const clipText = source.slice(clip.start, clip.end);
  const mediaM = clipText.match(/<(?:Video|OffthreadVideo|Audio|Img)\b/);
  const rate = mediaM ? (numAttrText(clipText, mediaM.index as number, 'playbackRate') ?? 1) : 1;
  const oldTrim = mediaM
    ? (numAttrText(clipText, mediaM.index as number, 'trimBefore') ??
      numAttrText(clipText, mediaM.index as number, 'startFrom') ??
      0)
    : 0;
  const nameM = clipText.match(/^<[A-Za-z][\w.]*\s[^>]*?name="([^"]*)"/);

  // First half — duration only.
  const first = textWithAttr(clipText, 'durationInFrames', `{${offset}}`);
  // Second half — remainder + shifted in-point (+ shifted `from` when standalone).
  let second = textWithAttr(clipText, 'durationInFrames', `{${dur - offset}}`);
  if (mediaM) {
    const newTrim = Math.round(oldTrim + offset * rate);
    second = textWithMediaAttr(second, 'startFrom', null);
    second = textWithMediaAttr(second, 'trimBefore', newTrim === 0 ? null : `{${newTrim}}`);
  }
  if (clip.tag === 'Sequence' && clip.from != null) {
    second = textWithAttr(second, 'from', `{${clip.from + offset}}`);
  }
  if (nameM) {
    // Duplicate names would collide the stableId — suffix the second half.
    second = second.replace(`name="${nameM[1]}"`, `name="${nameM[1]}-${atFrame}"`);
  }
  const indent = lineStartInfo(source, clip.start).indent;
  const s = new MagicString(source);
  s.overwrite(clip.start, clip.end, `${first}\n${indent}${second}`);
  const out = s.toString();
  assertParses(canvasAbsPath, out, stableId);
  assertCompSemantics(canvasAbsPath, out);
  // No ripple: the halves sum to the original (a hard cut between them).
  const after = enumerateClips(canvasAbsPath, out, artboardId);
  const seqIdxBefore = clips.slice(0, idx).filter((c) => c.kind === 'sequence').length;
  const seqs = after.clips.filter((c) => c.kind === 'sequence');
  return {
    source: out,
    firstStableId: seqs[seqIdxBefore]?.stableId ?? null,
    secondStableId: seqs[seqIdxBefore + 1]?.stableId ?? null,
  };
}

/** Ensure `name` is among the named imports from `specifier` (extends an
 *  existing import line, else adds one after the last import). */
/**
 * Where an inserted media element must come from.
 *
 * `Video` and `Audio` MUST resolve to `@remotion/media` — those are the only
 * media elements `@remotion/web-renderer` can render, and importing them from
 * `remotion` (where `Audio` IS `Html5Audio`) makes the export drop its audio
 * track and fall back to a ~40× slower capture. RCA
 * `issue-mp4-audio-export-html5audio-silent-degrade`.
 */
const MEDIA_SPECIFIER: Record<string, string> = {
  Video: '@remotion/media',
  Audio: '@remotion/media',
  Img: 'remotion',
  OffthreadVideo: 'remotion',
};

/**
 * Import an inserted media element from the right package, aliasing it when the
 * canvas already declares a component of that name.
 *
 * The collision is real — a canvas with its own `const Video = …` would have the
 * emitted `<Video>` resolve to itself. The old fix was to emit
 * `<OffthreadVideo>` instead, which silently cost the audio track. Aliasing
 * keeps the collision solved AND the audio intact. Returns the tag to emit.
 */
function resolveMediaTag(
  source: string,
  tag: string
): { emitTag: string; importName: string; specifier: string } {
  const specifier = MEDIA_SPECIFIER[tag] ?? 'remotion';
  const declaresLocally = new RegExp(
    `(?:const|let|var|function|class)\\s+${tag}\\b|\\b${tag}\\s*[:=]\\s*\\(`
  ).test(source);
  if (!declaresLocally) return { emitTag: tag, importName: tag, specifier };
  const alias = `Maude${tag}`;
  return { emitTag: alias, importName: `${tag} as ${alias}`, specifier };
}

function ensureNamedImport(s: MagicString, source: string, name: string, specifier: string): void {
  const esc = specifier.replace(/[/]/g, '\\/');
  const line = source.match(new RegExp(`import \\{([^}]*)\\} from ['"]${esc}['"]`));
  if (line && line.index != null) {
    if (new RegExp(`\\b${name}\\b`).test(line[1] as string)) return;
    const braceOpen = line.index + (line[0] as string).indexOf('{') + 1;
    s.appendLeft(braceOpen, ` ${name},`);
    return;
  }
  const imports = [...source.matchAll(/^import [^\n]*\n/gm)];
  const last = imports[imports.length - 1];
  const at = last ? (last.index as number) + last[0].length : 0;
  s.appendLeft(at, `import { ${name} } from '${specifier}';\n`);
}

/**
 * Task 17 — insert a transition into a hard cut AFTER `afterStableId` (a
 * series beat whose next sibling is another beat). TOTAL shrinks by the new
 * overlap (ripple). Refuses standalone pairs and already-transitioned seams.
 */
export function applyInsertTransition(
  canvasAbsPath: string,
  source: string,
  artboardId: string | undefined,
  afterStableId: string,
  expectedHash: string | undefined,
  presentation: string,
  frames: number
): { source: string; transitionStableId: string | null } {
  const p = PRESENTATIONS[presentation];
  if (!p) {
    throw new CanvasEditError(
      `unknown presentation "${presentation}" — one of: ${PRESENTATION_KEYS.join(', ')}`,
      { canvas: canvasAbsPath, id: afterStableId }
    );
  }
  const dur = Math.max(1, Math.round(frames));
  const { clips } = enumerateClips(canvasAbsPath, source, artboardId);
  const { clip, idx } = mustResolve(canvasAbsPath, clips, afterStableId, expectedHash);
  if (!isSeriesSeq(clip)) {
    throw new CanvasEditError(
      'transitions live between series beats — standalone clips take a hard cut (convert to a series first)',
      { canvas: canvasAbsPath, id: afterStableId }
    );
  }
  const next = clips[idx + 1];
  if (!next || !isSeriesSeq(next)) {
    throw new CanvasEditError(
      next?.kind === 'transition'
        ? 'this seam already has a transition — click its ⧓ chip to edit it'
        : 'no following beat — a transition needs a clip on both sides',
      { canvas: canvasAbsPath, id: afterStableId }
    );
  }
  let factory = p.factory;
  if (presentation === 'clock-wipe') {
    const wh = compDimensionsPublic(source);
    if (wh) factory = `clockWipe({ width: ${wh.width}, height: ${wh.height} })`;
  }
  const indent = lineStartInfo(source, clip.start).indent;
  const s = new MagicString(source);
  s.appendRight(
    clip.end,
    `\n${indent}<${clip.tag.split('.')[0]}.Transition presentation={${factory}} timing={linearTiming({ durationInFrames: ${dur} })} />`
  );
  ensureNamedImport(s, source, 'linearTiming', '@remotion/transitions');
  ensureImportPublic(s, source, p.importName, p.specifier);
  let out = s.toString();
  assertParses(canvasAbsPath, out, afterStableId);
  assertCompSemantics(canvasAbsPath, out);
  // New overlap ⇒ the comp SHRINKS by `dur`.
  out = applyRippleAfterClip(canvasAbsPath, out, artboardId, afterStableId, -dur, {
    shiftFroms: false,
  }).source;
  const after = enumerateClips(canvasAbsPath, out, artboardId);
  const afterIdx = after.clips.findIndex((c) => c.stableId === afterStableId);
  const t = after.clips[afterIdx + 1];
  return { source: out, transitionStableId: t?.kind === 'transition' ? t.stableId : null };
}

/**
 * Task 17 — remove a transition (the seam becomes a hard cut). TOTAL grows by
 * the removed overlap (ripple).
 */
export function applyRemoveTransition(
  canvasAbsPath: string,
  source: string,
  artboardId: string | undefined,
  transitionId: string,
  expectedHash: string | undefined
): { source: string } {
  const { clips } = enumerateClips(canvasAbsPath, source, artboardId);
  const { clip: t, idx } = mustResolve(canvasAbsPath, clips, transitionId, expectedHash);
  if (t.kind !== 'transition') {
    throw new CanvasEditError(`"${transitionId}" is not a transition`, {
      canvas: canvasAbsPath,
      id: transitionId,
    });
  }
  const overlap = transitionDurationFrames(source, t) ?? 0;
  const prevBeat = clips[idx - 1];
  const span = spanWithFraming(source, t.start, t.end);
  const s = new MagicString(source);
  s.remove(span[0], span[1]);
  let out = s.toString();
  assertParses(canvasAbsPath, out, transitionId);
  assertCompSemantics(canvasAbsPath, out);
  if (overlap !== 0 && prevBeat) {
    out = applyRippleAfterClip(canvasAbsPath, out, artboardId, prevBeat.stableId, overlap, {
      shiftFroms: false,
    }).source;
  }
  return { source: out };
}

// Small public shims so Task-17 code can reuse the Task-15 internals.
function compDimensionsPublic(source: string): { width: number; height: number } | null {
  const m = source.match(/<VideoComp\b[^>]*>/);
  if (!m || m.index == null) return null;
  const w = numAttrText(source, m.index, 'width');
  const h = numAttrText(source, m.index, 'height');
  return w && h ? { width: w, height: h } : null;
}
function ensureImportPublic(
  s: MagicString,
  source: string,
  importName: string,
  specifier: string
): void {
  if (new RegExp(`from ['"]${specifier.replace(/[/]/g, '\\/')}['"]`).test(source)) return;
  const imports = [...source.matchAll(/^import [^\n]*\n/gm)];
  const last = imports[imports.length - 1];
  const at = last ? (last.index as number) + last[0].length : 0;
  s.appendLeft(at, `import { ${importName} } from '${specifier}';\n`);
}

/**
 * Task 22 — resolve an AI placeholder: swap the `<AIPlaceholder …/>` slate for
 * the generated media IN PLACE (the clip tag — and with it the stableId slot,
 * timing, and any name — survives).
 */
export function applyResolvePlaceholder(
  canvasAbsPath: string,
  source: string,
  artboardId: string | undefined,
  stableId: string,
  expectedHash: string | undefined,
  src: string,
  mediaKind: 'video' | 'image'
): { source: string } {
  const { clips } = enumerateClips(canvasAbsPath, source, artboardId);
  const { clip } = mustResolve(canvasAbsPath, clips, stableId, expectedHash);
  const srcTrim = String(src ?? '').trim();
  if (!srcTrim) {
    throw new CanvasEditError('resolve needs a generated asset src', {
      canvas: canvasAbsPath,
      id: stableId,
    });
  }
  assertContainedSrc(canvasAbsPath, srcTrim, stableId);
  const span = source.slice(clip.start, clip.end);
  const m = span.match(/<AIPlaceholder\b/);
  if (!m || m.index == null) {
    throw new CanvasEditError(`clip "${stableId}" has no <AIPlaceholder> to resolve`, {
      canvas: canvasAbsPath,
      id: stableId,
    });
  }
  const phStart = clip.start + m.index;
  let phEnd = openTagEnd(source, phStart);
  if (source.slice(phEnd - 2, phEnd) !== '/>') {
    // Paired-tag form (`<AIPlaceholder …><span>{"…"}</span></AIPlaceholder>`,
    // the inline-editable emit) — swap the WHOLE element, close tag included.
    // Security (adversarial review 2026-07-30): a prompt of `foo</AIPlaceholder>`
    // emits a FAKE close tag inside the `{"…"}` string literal. `indexOf` would
    // match that fake first and overwrite through it (assertParses then fails
    // closed, but the placeholder becomes permanently un-resolvable). One
    // placeholder per clip span ⇒ the REAL closer is the LAST `</AIPlaceholder>`
    // before clip.end; a string-embedded fake always precedes it. Scan backwards.
    const closeTag = '</AIPlaceholder>';
    const close = source.lastIndexOf(closeTag, clip.end - 1);
    if (close < phEnd || close + closeTag.length > clip.end) {
      throw new CanvasEditError(
        'placeholder element has no matching close tag — fix the JSX by hand',
        {
          canvas: canvasAbsPath,
          id: stableId,
        }
      );
    }
    phEnd = close + closeTag.length;
  }
  const tag = mediaKind === 'image' ? 'Img' : 'OffthreadVideo';
  const s = new MagicString(source);
  s.overwrite(phStart, phEnd, `<${tag} src="${escapeAttr(srcTrim)}" />`);
  const out = s.toString();
  assertParses(canvasAbsPath, out, stableId);
  assertCompSemantics(canvasAbsPath, out);
  return { source: out };
}

/**
 * Dogfood fix — an artboard marked `kind="video"` in the Inspector IS the
 * user's "this is a video" intent, but without a `<VideoComp>` inside it the
 * timeline can't see it and every drop dead-ended in a new canvas. This
 * injects the missing comp IN PLACE: a minimal component + a `<VideoComp>`
 * mounted as the artboard's last child (paints over the brief content), sized
 * to the artboard. Returns null when the canvas has no eligible artboard
 * (an explicit `artboardId`, else the first `kind="video"` one).
 */
export function applyEnsureVideoComp(
  canvasAbsPath: string,
  source: string,
  artboardId: string | undefined
): { source: string; artboardId: string } | null {
  const re = /<DCArtboard\b[^>]*>/g;
  let target: { start: number; tag: string } | null = null;
  for (const m of source.matchAll(re)) {
    const start = m.index as number;
    const idAttr = attrSpanInTag(source, start, 'id');
    const id = idAttr?.valueText?.replace(/^["']|["']$/g, '') ?? null;
    const kindAttr = attrSpanInTag(source, start, 'kind');
    const kind = kindAttr?.valueText?.replace(/^["']|["']$/g, '') ?? null;
    if ((artboardId && id === artboardId) || (!artboardId && kind === 'video')) {
      if (artboardId && kind !== 'video') return null; // explicit target must opt in
      target = { start, tag: m[0] as string };
      break;
    }
  }
  if (!target) return null;
  const idAttr = attrSpanInTag(source, target.start, 'id');
  const targetId = idAttr?.valueText?.replace(/^["']|["']$/g, '') ?? '';
  const width = numAttrText(source, target.start, 'width') ?? 1280;
  const height = numAttrText(source, target.start, 'height') ?? 720;
  const closeIdx = source.indexOf('</DCArtboard>', target.start);
  if (closeIdx < 0) return null;
  // Unique component name.
  let compName = 'VideoCut';
  for (let i = 2; new RegExp(`\\b${compName}\\b`).test(source); i += 1) compName = `VideoCut${i}`;
  const indent = lineStartInfo(source, closeIdx).indent;
  const s = new MagicString(source);
  s.appendLeft(
    closeIdx,
    `  <VideoComp component={${compName}} durationInFrames={150} fps={30} width={${width}} height={${height}} />\n${indent}`
  );
  // The comp body — an AbsoluteFill root so the first storyline drop can
  // author its <TransitionSeries> inside (the greenfield insert contract).
  const exportM = source.match(/^export default function\b/m) ?? source.match(/^export default\b/m);
  const at = exportM?.index ?? 0;
  s.appendLeft(
    at,
    `const ${compName} = () => (\n  <AbsoluteFill style={{ background: '#000' }}>\n  </AbsoluteFill>\n);\n\n`
  );
  ensureNamedImport(s, source, 'VideoComp', '@maude/canvas-lib');
  ensureNamedImport(s, source, 'AbsoluteFill', 'remotion');
  const out = s.toString();
  assertParses(canvasAbsPath, out, targetId);
  return { source: out, artboardId: targetId };
}

/**
 * Dogfood — edit the text a clip carries: a Title overlay's literal child or an
 * AIPlaceholder's `prompt`. Both are authored as a JSON-stringified expression
 * (`{"…"}`, DDR-150 P1), so ONE rewrite covers them: replace the clip's first
 * quoted-string expression with the new JSON literal.
 */
export function applySetClipText(
  canvasAbsPath: string,
  source: string,
  artboardId: string | undefined,
  stableId: string,
  expectedHash: string | undefined,
  text: string
): { source: string } {
  const { clips } = enumerateClips(canvasAbsPath, source, artboardId);
  const { clip } = mustResolve(canvasAbsPath, clips, stableId, expectedHash);
  const t = String(text ?? '').slice(0, 2000);
  if (!t.trim()) {
    throw new CanvasEditError('text must not be empty', { canvas: canvasAbsPath, id: stableId });
  }
  const span = source.slice(clip.start, clip.end);
  const m = span.match(/\{"(?:[^"\\]|\\.)*"\}/);
  if (!m || m.index == null) {
    throw new CanvasEditError(
      'this clip has no editable text literal (Title overlays and AI placeholders do)',
      { canvas: canvasAbsPath, id: stableId }
    );
  }
  const start = clip.start + m.index;
  const s = new MagicString(source);
  s.overwrite(start, start + m[0].length, `{${JSON.stringify(t)}}`);
  const out = s.toString();
  assertParses(canvasAbsPath, out, stableId);
  assertCompSemantics(canvasAbsPath, out);
  return { source: out };
}

/**
 * Dogfood (2026-07-30) — vertical layer reorder. Standalone overlay clips are
 * SIBLINGS whose document order IS their paint order (later paints on top).
 * Move one to `toIndex` in that ladder (audio-kind standalones are excluded —
 * they have no z-order). One-pass span permutation, then reparse + gate.
 */
export function applyReorderOverlayLayer(
  canvasAbsPath: string,
  source: string,
  artboardId: string | undefined,
  stableId: string,
  expectedHash: string | undefined,
  toIndex: number
): { source: string } {
  const { clips } = enumerateClips(canvasAbsPath, source, artboardId);
  const { clip } = mustResolve(canvasAbsPath, clips, stableId, expectedHash);
  if (isSeriesSeq(clip)) {
    throw new CanvasEditError('storyline beats reorder horizontally — drag the beat instead', {
      canvas: canvasAbsPath,
      id: stableId,
    });
  }
  const ladder = clips.filter(
    (c) => c.kind === 'sequence' && !isSeriesSeq(c) && c.mediaTag !== 'Audio'
  ) as ClipInfo[];
  const from = ladder.findIndex((c) => c.stableId === clip.stableId);
  if (from < 0) {
    throw new CanvasEditError('this clip has no layer order (audio clips stack freely)', {
      canvas: canvasAbsPath,
      id: stableId,
    });
  }
  const to = Math.max(0, Math.min(ladder.length - 1, Math.round(toIndex)));
  if (to === from) return { source };
  const order = ladder.map((_, k) => k);
  order.splice(from, 1);
  order.splice(to, 0, from);
  const texts = ladder.map((c) => source.slice(c.start, c.end));
  const s = new MagicString(source);
  order.forEach((srcIdx, slot) => {
    const at = ladder[slot] as ClipInfo;
    if (srcIdx !== slot) s.overwrite(at.start, at.end, texts[srcIdx] as string);
  });
  const out = s.toString();
  assertParses(canvasAbsPath, out, stableId);
  assertCompSemantics(canvasAbsPath, out);
  return { source: out };
}

/** Graft trim/rate onto a freshly-inserted clip's media element. */
function graftMediaAttrs(
  canvasAbsPath: string,
  source: string,
  artboardId: string | undefined,
  stableId: string | null,
  trim: number,
  rate: number
): string {
  if (!stableId || (trim === 0 && rate === 1)) return source;
  const after = enumerateClips(canvasAbsPath, source, artboardId);
  const clip = after.clips.find((c) => c.stableId === stableId);
  const mediaStart = clip ? directMediaTagStart(source, clip) : null;
  if (mediaStart == null) return source;
  const s = new MagicString(source);
  if (trim) setTagAttr(s, source, mediaStart, 'trimBefore', `{${trim}}`);
  if (rate !== 1) setTagAttr(s, source, mediaStart, 'playbackRate', `{${rate}}`);
  const out = s.toString();
  assertParses(canvasAbsPath, out, stableId);
  return out;
}

/**
 * Layers model (dogfood) — move a storyline beat OUT into its own overlay
 * layer (a standalone `<Sequence from>` at the beat's absolute start), or a
 * standalone overlay clip INTO the storyline (appended as a beat). Media-
 * carrying clips only; timing (trimBefore/playbackRate) rides along.
 * Insert-first, then remove the original (found again by content hash), so
 * the "cannot remove the only clip" guard never blocks the move.
 */
export function applyMoveClipToOverlay(
  canvasAbsPath: string,
  source: string,
  artboardId: string | undefined,
  stableId: string,
  expectedHash: string | undefined
): { source: string; stableId: string | null } {
  const { clips } = enumerateClips(canvasAbsPath, source, artboardId);
  const { clip } = mustResolve(canvasAbsPath, clips, stableId, expectedHash);
  if (!isSeriesSeq(clip)) {
    throw new CanvasEditError('already an overlay/standalone clip', {
      canvas: canvasAbsPath,
      id: stableId,
    });
  }
  const mediaStart = directMediaTagStart(source, clip);
  const isPlaceholder = clip.placeholder != null;
  if (!isPlaceholder && (mediaStart == null || !clip.mediaSrc || clip.durationInFrames == null)) {
    throw new CanvasEditError(
      'only a media clip with a direct source, or an AI placeholder, can move between layers',
      { canvas: canvasAbsPath, id: stableId }
    );
  }
  if (isPlaceholder && clip.durationInFrames == null) {
    throw new CanvasEditError(
      'only a media clip with a direct source, or an AI placeholder, can move between layers',
      { canvas: canvasAbsPath, id: stableId }
    );
  }
  const start = clipAbsoluteStart(source, canvasAbsPath, artboardId, stableId);
  // A placeholder slate has no media element to graft trim/rate onto — it
  // rides over as-is (prompt + kind), never as media.
  const ins = isPlaceholder
    ? applyInsertClipAt(canvasAbsPath, source, artboardId, {
        lane: 'overlay',
        from: start,
        durationInFrames: clip.durationInFrames as number,
        placeholder: {
          prompt: clip.placeholder?.prompt ?? '',
          kind: clip.placeholder?.kind ?? 'veo',
        },
      })
    : applyInsertClipAt(canvasAbsPath, source, artboardId, {
        lane: 'overlay',
        from: start,
        durationInFrames: clip.durationInFrames as number,
        mediaTag: clip.mediaTag === 'Audio' ? 'Audio' : 'Video',
        src: clip.mediaSrc,
      });
  let out = isPlaceholder
    ? ins.source
    : graftMediaAttrs(
        canvasAbsPath,
        ins.source,
        artboardId,
        ins.stableId,
        numAttrText(source, mediaStart as number, 'trimBefore') ??
          numAttrText(source, mediaStart as number, 'startFrom') ??
          0,
        numAttrText(source, mediaStart as number, 'playbackRate') ?? 1
      );
  const again = enumerateClips(canvasAbsPath, out, artboardId);
  const insertedHash = again.clips.find((c) => c.stableId === ins.stableId)?.contentHash ?? null;
  const original = again.clips.find(
    (c) => c.contentHash === clip.contentHash && c.stableId !== ins.stableId
  );
  if (original) {
    out = applyRemoveClipRippled(
      canvasAbsPath,
      out,
      artboardId,
      original.stableId,
      undefined
    ).source;
  }
  // The storyline shrank under the overlay — stretch the comp back to it.
  out = applyFitTotalToContent(canvasAbsPath, out, artboardId).source;
  assertCompSemantics(canvasAbsPath, out);
  // Positional ids shift when the original leaves — re-address the moved clip.
  const settled = insertedHash
    ? enumerateClips(canvasAbsPath, out, artboardId).clips.find(
        (c) => c.contentHash === insertedHash
      )
    : null;
  return { source: out, stableId: settled?.stableId ?? ins.stableId };
}

export function applyMoveClipToStoryline(
  canvasAbsPath: string,
  source: string,
  artboardId: string | undefined,
  stableId: string,
  expectedHash: string | undefined
): { source: string; stableId: string | null } {
  const { clips } = enumerateClips(canvasAbsPath, source, artboardId);
  const { clip } = mustResolve(canvasAbsPath, clips, stableId, expectedHash);
  if (clip.tag !== 'Sequence') {
    throw new CanvasEditError('already a storyline beat', { canvas: canvasAbsPath, id: stableId });
  }
  const mediaStart = directMediaTagStart(source, clip);
  const isPlaceholder = clip.placeholder != null;
  if (!isPlaceholder && (mediaStart == null || !clip.mediaSrc || clip.durationInFrames == null)) {
    throw new CanvasEditError(
      'only a media clip with a direct source, or an AI placeholder, can move between layers',
      { canvas: canvasAbsPath, id: stableId }
    );
  }
  if (isPlaceholder && clip.durationInFrames == null) {
    throw new CanvasEditError(
      'only a media clip with a direct source, or an AI placeholder, can move between layers',
      { canvas: canvasAbsPath, id: stableId }
    );
  }
  // A placeholder slate has no media element to graft trim/rate onto — it
  // rides over as-is (prompt + kind), never as media.
  const ins = isPlaceholder
    ? applyInsertClipAt(canvasAbsPath, source, artboardId, {
        lane: 'storyline',
        durationInFrames: clip.durationInFrames as number,
        placeholder: {
          prompt: clip.placeholder?.prompt ?? '',
          kind: clip.placeholder?.kind ?? 'veo',
        },
      })
    : applyInsertClipAt(canvasAbsPath, source, artboardId, {
        lane: 'storyline',
        durationInFrames: clip.durationInFrames as number,
        mediaTag: clip.mediaTag === 'Audio' ? 'Audio' : 'Video',
        src: clip.mediaSrc,
      });
  let out = isPlaceholder
    ? ins.source
    : graftMediaAttrs(
        canvasAbsPath,
        ins.source,
        artboardId,
        ins.stableId,
        numAttrText(source, mediaStart as number, 'trimBefore') ??
          numAttrText(source, mediaStart as number, 'startFrom') ??
          0,
        numAttrText(source, mediaStart as number, 'playbackRate') ?? 1
      );
  const again = enumerateClips(canvasAbsPath, out, artboardId);
  const insertedHash = again.clips.find((c) => c.stableId === ins.stableId)?.contentHash ?? null;
  const original = again.clips.find(
    (c) => c.contentHash === clip.contentHash && c.stableId !== ins.stableId
  );
  if (original) {
    out = applyRemoveClipRippled(
      canvasAbsPath,
      out,
      artboardId,
      original.stableId,
      undefined
    ).source;
  }
  // Exact-fit the comp end (the storyline insert over-bumped while the overlay
  // still existed).
  out = applyFitTotalToContent(canvasAbsPath, out, artboardId).source;
  assertCompSemantics(canvasAbsPath, out);
  // Positional ids shift when the original leaves — re-address the moved clip.
  const settled = insertedHash
    ? enumerateClips(canvasAbsPath, out, artboardId).clips.find(
        (c) => c.contentHash === insertedHash
      )
    : null;
  return { source: out, stableId: settled?.stableId ?? ins.stableId };
}

/**
 * "The timeline always reaches the last clip" (dogfood rule): compute the real
 * content end — storyline cursor end, every standalone clip's from+duration —
 * and set the comp duration to it exactly — the timeline always ends where
 * the last clip ends (grows AND shrinks with the content).
 */
export function applyFitTotalToContent(
  canvasAbsPath: string,
  source: string,
  artboardId: string | undefined
): { source: string; total: number | null } {
  const cc = enumerateClips(canvasAbsPath, source, artboardId);
  if (!cc.compName || cc.durationInFrames == null) return { source, total: cc.durationInFrames };
  const consts = collectConsts(source);
  let cursor = 0;
  let maxEnd = 0;
  for (const c of cc.clips) {
    if (c.kind === 'transition') {
      cursor -= transitionDurationFrames(source, c, consts) ?? 0;
      continue;
    }
    const start = c.tag === 'Sequence' && c.from != null ? c.from : cursor;
    const end = start + (c.durationInFrames ?? 0);
    if (c.tag !== 'Sequence') cursor = end;
    if (end > maxEnd) maxEnd = end;
  }
  const delta = maxEnd - cc.durationInFrames;
  if (delta === 0 || maxEnd <= 0 || cc.clips.length === 0) {
    return { source, total: cc.durationInFrames };
  }
  const anchor = cc.clips.find((c) => c.kind === 'sequence');
  if (!anchor) return { source, total: cc.durationInFrames };
  const out = applyRippleAfterClip(canvasAbsPath, source, artboardId, anchor.stableId, delta, {
    shiftFroms: false,
  }).source;
  return { source: out, total: maxEnd };
}

/** Run a pure source-op on disk (atomic write + cross-process lock). */
export async function applyOnDisk<T extends { source: string }>(
  canvasAbsPath: string,
  fn: (source: string) => T
): Promise<T> {
  return withLock(canvasAbsPath, async () => {
    const file = Bun.file(canvasAbsPath);
    if (!(await file.exists())) {
      throw new CanvasEditError(`Canvas not found: ${canvasAbsPath}`, {
        canvas: canvasAbsPath,
        id: '',
      });
    }
    const source = await file.text();
    const next = fn(source);
    if (next.source === source) return next;
    const tmp = `${canvasAbsPath}.tmp.${Math.random().toString(36).slice(2, 10)}`;
    await Bun.write(tmp, next.source);
    const { rename } = await import('node:fs/promises');
    await rename(tmp, canvasAbsPath);
    return next;
  });
}

/** Re-parse gate shared by ops in this module (parse-clean before semantics). */
export function assertParses(canvasAbsPath: string, source: string, id: string): void {
  const parsed = parseSync(canvasAbsPath, source, { sourceType: 'module' });
  if (parsed.errors && parsed.errors.length > 0) {
    throw new CanvasEditError(
      `edit produced invalid source: ${parsed.errors[0]?.message ?? 'parse error'}`,
      { canvas: canvasAbsPath, id }
    );
  }
}
