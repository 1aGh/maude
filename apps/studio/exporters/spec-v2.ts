// spec-v2.ts — ExportSpec v2: the one shape the export sheet, the CLI, Export again and every
// neighbour's entry point share (contract client/v2/contracts/S8-export-spec.md §5.1, S8.1).
//
// The v2 body rides BESIDE v1 on the existing routes: `{v:2, spec}` next to the v1
// `{format, scope, options}` (which keeps working byte for byte). `validateSpecV2` is
// server-authoritative; the client reuses it, so it stays a leaf: no `node:*`, no imports
// beyond the pure runtime-state classifier.

import { isRuntimeStateRel } from '../sync/file-membership.ts';

export type ExportScopeV2 = 'selection' | 'canvas' | 'folder' | 'project';
export type ExportFormatV2 =
  | 'png'
  | 'jpg'
  | 'pdf'
  | 'svg'
  | 'html'
  | 'pptx'
  | 'canva'
  | 'zip'
  | 'mp4'
  | 'webm'
  | 'gif'
  | 'audio';
/** The artboard `kind` (digital, print, video, web, …). */
export type ArtboardKindKey = string;

export interface ExportOptionsV2 {
  size?: { scale: number } | { dpi: number };
  colorProfile?: 'srgb' | 'display-p3';
  jpgQuality?: number;
  background?: 'artboard' | 'transparent' | 'white';
  annotations?: boolean;
  print?: {
    bleed?: boolean;
    marks?: 'none' | 'crop';
    back?: boolean;
    /** S8.7 — registration marks beside the crop marks (A-crop-and-registration-marks) */
    registration?: boolean;
    /** S8.7 — what happens to the text (A-pdf-quality-and-text-outlines): keep · embed · outline */
    text?: 'keep' | 'embed' | 'outline';
  };
  video?: {
    fps?: number;
    quality?: 'draft' | 'standard' | 'high';
    captions?: boolean;
    linked?: boolean;
    allowLonger?: boolean;
    /** P8 c7 (09 ex-advanced) — how many colours a GIF keeps, 2–256 (the engine's `gifColors`) */
    gifColors?: number;
  };
  audio?: { codec: 'm4a' | 'wav' };
  nameTemplate?: string;
  saveTo?: 'downloads' | 'remembered' | 'ask';
  lane?: 'auto' | 'this-mac' | 'cloud';
}

export interface ExportSpecV2 {
  v: 2;
  scope: ExportScopeV2;
  canvas?: string;
  folder?: string;
  /**
   * P8 c7 (09 ex-huge) — the Include row on Whole project: top-level folders (design-root-relative) and/or the
   * loose canvases at the top level that the expansion leaves out. Whole project only.
   */
  exclude?: { folders?: string[]; loose?: boolean };
  selection?: { artboards?: string[]; elements?: string[] };
  region?: { rect: { x: number; y: number; w: number; h: number } };
  unit?: 'each' | 'one';
  format: ExportFormatV2;
  byKind?: Record<ArtboardKindKey, { format: ExportFormatV2; options?: Partial<ExportOptionsV2> }>;
  options?: ExportOptionsV2;
  at?: { sha: string };
  wait?: 'ai';
}

export const SCOPES_V2: readonly ExportScopeV2[] = ['selection', 'canvas', 'folder', 'project'];
export const FORMATS_V2: readonly ExportFormatV2[] = [
  'png',
  'jpg',
  'pdf',
  'svg',
  'html',
  'pptx',
  'canva',
  'zip',
  'mp4',
  'webm',
  'gif',
  'audio',
];

/** Scope, unit and the project-class pair (V2-1.16 L7): Folder and Whole project. */
export const PROJECT_CLASS_SCOPES: ReadonlySet<ExportScopeV2> = new Set(['folder', 'project']);

/** Caps (contract §5.1): selection ids, region side, name template. */
export const MAX_SELECTION_IDS = 256;
export const MAX_EXCLUDE_FOLDERS = 64;
export const MAX_REGION_SIDE = 32768;
export const MAX_NAME_TEMPLATE = 400;
const ID_RE = /^[A-Za-z0-9_.:-]{1,128}$/;
const SHA_RE = /^[0-9a-f]{7,40}$/;
const MAX_REL = 1024;

export type SpecError = { error: 'bad-spec'; field: string; message: string };
export type SpecVerdict = { ok: true; spec: ExportSpecV2 } | { ok: false; error: SpecError };

/** True when a request body is the v2 shape (`{v:2, spec}`), never a v1 one. */
export function isV2Body(body: unknown): body is { v: 2; spec: unknown } {
  return (
    !!body && typeof body === 'object' && !Array.isArray(body) && (body as { v?: unknown }).v === 2
  );
}

const isObj = (x: unknown): x is Record<string, unknown> =>
  !!x && typeof x === 'object' && !Array.isArray(x);

class Bad extends Error {
  constructor(
    readonly field: string,
    message: string
  ) {
    super(message);
  }
}

function keysOnly(o: Record<string, unknown>, allowed: readonly string[], at: string): void {
  for (const k of Object.keys(o))
    if (!allowed.includes(k)) throw new Bad(at ? `${at}.${k}` : k, `unknown key "${k}"`);
}

function num(v: unknown, field: string, min: number, max: number, int = false): number {
  if (
    typeof v !== 'number' ||
    !Number.isFinite(v) ||
    v < min ||
    v > max ||
    (int && !Number.isInteger(v))
  )
    throw new Bad(field, `${field} must be a number from ${min} to ${max}`);
  return v;
}

function oneOf<const T extends string>(v: unknown, field: string, values: readonly T[]): T {
  if (typeof v !== 'string' || !(values as readonly string[]).includes(v))
    throw new Bad(field, `${field} must be one of ${values.join(', ')}`);
  return v as T;
}

function bool(v: unknown, field: string): boolean {
  if (typeof v !== 'boolean') throw new Bad(field, `${field} must be true or false`);
  return v;
}

/**
 * A designRoot-relative path (`ui/a.tsx`, `ui/2026`): no `..`/`.`/empty segment, no
 * backslash, no leading `/`, no control character, and never a runtime-state path (DDR-115).
 */
export function cleanDesignRel(v: unknown, field: string, opts: { canvas?: boolean } = {}): string {
  if (typeof v !== 'string' || v === '' || v.length > MAX_REL)
    throw new Bad(field, `${field} must be a path in the project`);
  // biome-ignore lint/suspicious/noControlCharactersInRegex: refusing control characters is the point
  if (v.includes('\\') || v.startsWith('/') || /[\x00-\x1f\x7f]/.test(v))
    throw new Bad(field, `${field} must be a path in the project`);
  const p = v.replace(/\/+$/, '');
  if (!p || p.split('/').some((s) => s === '' || s === '.' || s === '..'))
    throw new Bad(field, `${field} must be a path in the project`);
  if (isRuntimeStateRel(p)) throw new Bad(field, `${field} is not part of the project`);
  if (opts.canvas && !p.endsWith('.tsx')) throw new Bad(field, `${field} must name a .tsx canvas`);
  return p;
}

function ids(v: unknown, field: string): string[] {
  if (!Array.isArray(v) || v.length > MAX_SELECTION_IDS)
    throw new Bad(field, `${field} must be a list of at most ${MAX_SELECTION_IDS} ids`);
  return v.map((x, i) => {
    if (typeof x !== 'string' || !ID_RE.test(x)) throw new Bad(`${field}[${i}]`, 'not an id');
    return x;
  });
}

function options(v: unknown, at: string): ExportOptionsV2 {
  if (!isObj(v)) throw new Bad(at, `${at} must be an object`);
  keysOnly(
    v,
    [
      'size',
      'colorProfile',
      'jpgQuality',
      'background',
      'annotations',
      'print',
      'video',
      'audio',
      'nameTemplate',
      'saveTo',
      'lane',
    ],
    at
  );
  const out: ExportOptionsV2 = {};
  if (v.size !== undefined) {
    const s = v.size;
    if (!isObj(s)) throw new Bad(`${at}.size`, 'size must be {scale} or {dpi}');
    if ('scale' in s) {
      keysOnly(s, ['scale'], `${at}.size`);
      out.size = { scale: num(s.scale, `${at}.size.scale`, 0.25, 4) };
    } else if ('dpi' in s) {
      keysOnly(s, ['dpi'], `${at}.size`);
      out.size = { dpi: num(s.dpi, `${at}.size.dpi`, 72, 600, true) };
    } else throw new Bad(`${at}.size`, 'size must be {scale} or {dpi}');
  }
  if (v.colorProfile !== undefined)
    out.colorProfile = oneOf(v.colorProfile, `${at}.colorProfile`, ['srgb', 'display-p3']);
  if (v.jpgQuality !== undefined)
    out.jpgQuality = num(v.jpgQuality, `${at}.jpgQuality`, 1, 100, true);
  if (v.background !== undefined)
    out.background = oneOf(v.background, `${at}.background`, ['artboard', 'transparent', 'white']);
  if (v.annotations !== undefined) out.annotations = bool(v.annotations, `${at}.annotations`);
  if (v.print !== undefined) {
    const p = v.print;
    if (!isObj(p)) throw new Bad(`${at}.print`, 'print must be an object');
    keysOnly(p, ['bleed', 'marks', 'back', 'registration', 'text'], `${at}.print`);
    out.print = {};
    if (p.bleed !== undefined) out.print.bleed = bool(p.bleed, `${at}.print.bleed`);
    if (p.marks !== undefined)
      out.print.marks = oneOf(p.marks, `${at}.print.marks`, ['none', 'crop']);
    if (p.back !== undefined) out.print.back = bool(p.back, `${at}.print.back`);
    if (p.registration !== undefined)
      out.print.registration = bool(p.registration, `${at}.print.registration`);
    if (p.text !== undefined)
      out.print.text = oneOf(p.text, `${at}.print.text`, ['keep', 'embed', 'outline']);
  }
  if (v.video !== undefined) {
    const p = v.video;
    if (!isObj(p)) throw new Bad(`${at}.video`, 'video must be an object');
    keysOnly(
      p,
      ['fps', 'quality', 'captions', 'linked', 'allowLonger', 'gifColors'],
      `${at}.video`
    );
    out.video = {};
    if (p.fps !== undefined) out.video.fps = num(p.fps, `${at}.video.fps`, 1, 120, true);
    if (p.quality !== undefined)
      out.video.quality = oneOf(p.quality, `${at}.video.quality`, ['draft', 'standard', 'high']);
    if (p.gifColors !== undefined)
      out.video.gifColors = num(p.gifColors, `${at}.video.gifColors`, 2, 256, true);
    if (p.captions !== undefined) out.video.captions = bool(p.captions, `${at}.video.captions`);
    if (p.linked !== undefined) out.video.linked = bool(p.linked, `${at}.video.linked`);
    if (p.allowLonger !== undefined)
      out.video.allowLonger = bool(p.allowLonger, `${at}.video.allowLonger`);
  }
  if (v.audio !== undefined) {
    const p = v.audio;
    if (!isObj(p)) throw new Bad(`${at}.audio`, 'audio must be an object');
    keysOnly(p, ['codec'], `${at}.audio`);
    out.audio = { codec: oneOf(p.codec, `${at}.audio.codec`, ['m4a', 'wav']) };
  }
  if (v.nameTemplate !== undefined) {
    if (typeof v.nameTemplate !== 'string' || v.nameTemplate.length > MAX_NAME_TEMPLATE)
      throw new Bad(
        `${at}.nameTemplate`,
        `nameTemplate must be text of at most ${MAX_NAME_TEMPLATE} characters`
      );
    out.nameTemplate = v.nameTemplate;
  }
  if (v.saveTo !== undefined)
    out.saveTo = oneOf(v.saveTo, `${at}.saveTo`, ['downloads', 'remembered', 'ask']);
  if (v.lane !== undefined) out.lane = oneOf(v.lane, `${at}.lane`, ['auto', 'this-mac', 'cloud']);
  return out;
}

function validate(raw: unknown): ExportSpecV2 {
  if (!isObj(raw)) throw new Bad('spec', 'spec must be an object');
  keysOnly(
    raw,
    [
      'v',
      'scope',
      'canvas',
      'folder',
      'exclude',
      'selection',
      'region',
      'unit',
      'format',
      'byKind',
      'options',
      'at',
      'wait',
    ],
    ''
  );
  if (raw.v !== 2) throw new Bad('v', 'v must be 2');
  const spec: ExportSpecV2 = {
    v: 2,
    scope: oneOf(raw.scope, 'scope', SCOPES_V2),
    format: oneOf(raw.format, 'format', FORMATS_V2),
  };
  if (raw.canvas !== undefined)
    spec.canvas = cleanDesignRel(raw.canvas, 'canvas', { canvas: true });
  if (raw.folder !== undefined) spec.folder = cleanDesignRel(raw.folder, 'folder');
  if (spec.scope === 'folder' && spec.folder === undefined)
    throw new Bad('folder', 'folder is required for the Folder scope');
  if (spec.scope !== 'folder' && spec.folder !== undefined)
    throw new Bad('folder', 'folder is only for the Folder scope');
  if (raw.exclude !== undefined) {
    const x = raw.exclude;
    if (spec.scope !== 'project')
      throw new Bad('exclude', 'exclude is only for the Whole project scope');
    if (!isObj(x)) throw new Bad('exclude', 'exclude must be an object');
    keysOnly(x, ['folders', 'loose'], 'exclude');
    spec.exclude = {};
    if (x.folders !== undefined) {
      if (!Array.isArray(x.folders) || x.folders.length > MAX_EXCLUDE_FOLDERS)
        throw new Bad(
          'exclude.folders',
          `exclude.folders must be a list of at most ${MAX_EXCLUDE_FOLDERS} folders`
        );
      spec.exclude.folders = x.folders.map((f, i) => cleanDesignRel(f, `exclude.folders[${i}]`));
    }
    if (x.loose !== undefined) {
      if (typeof x.loose !== 'boolean')
        throw new Bad('exclude.loose', 'exclude.loose must be true or false');
      spec.exclude.loose = x.loose;
    }
  }
  if (PROJECT_CLASS_SCOPES.has(spec.scope) && spec.canvas !== undefined)
    throw new Bad('canvas', 'canvas is only for the Selection and This canvas scopes');
  if (raw.selection !== undefined) {
    const s = raw.selection;
    if (!isObj(s)) throw new Bad('selection', 'selection must be an object');
    keysOnly(s, ['artboards', 'elements'], 'selection');
    spec.selection = {};
    if (s.artboards !== undefined)
      spec.selection.artboards = ids(s.artboards, 'selection.artboards');
    if (s.elements !== undefined) spec.selection.elements = ids(s.elements, 'selection.elements');
    const n = (spec.selection.artboards?.length ?? 0) + (spec.selection.elements?.length ?? 0);
    if (n > MAX_SELECTION_IDS) throw new Bad('selection', `at most ${MAX_SELECTION_IDS} ids`);
  }
  if (spec.scope !== 'selection' && spec.selection !== undefined)
    throw new Bad('selection', 'selection is only for the Selection scope');
  if (raw.region !== undefined) {
    const r = raw.region;
    if (!isObj(r)) throw new Bad('region', 'region must be {rect}');
    keysOnly(r, ['rect'], 'region');
    const rect = r.rect;
    if (!isObj(rect)) throw new Bad('region.rect', 'region.rect must be {x,y,w,h}');
    keysOnly(rect, ['x', 'y', 'w', 'h'], 'region.rect');
    const big = 1e7;
    spec.region = {
      rect: {
        x: num(rect.x, 'region.rect.x', -big, big),
        y: num(rect.y, 'region.rect.y', -big, big),
        w: num(rect.w, 'region.rect.w', Number.MIN_VALUE, MAX_REGION_SIDE),
        h: num(rect.h, 'region.rect.h', Number.MIN_VALUE, MAX_REGION_SIDE),
      },
    };
    if (PROJECT_CLASS_SCOPES.has(spec.scope))
      throw new Bad('region', 'region is only for the Selection and This canvas scopes');
  }
  if (raw.unit !== undefined) spec.unit = oneOf(raw.unit, 'unit', ['each', 'one']);
  if (raw.byKind !== undefined) {
    const b = raw.byKind;
    if (!isObj(b) || Object.keys(b).length > 32)
      throw new Bad('byKind', 'byKind must be an object');
    spec.byKind = {};
    for (const [kind, entry] of Object.entries(b)) {
      if (!/^[a-z][a-z0-9-]{0,31}$/.test(kind)) throw new Bad(`byKind.${kind}`, 'not a kind');
      if (!isObj(entry)) throw new Bad(`byKind.${kind}`, 'must be {format, options?}');
      keysOnly(entry, ['format', 'options'], `byKind.${kind}`);
      spec.byKind[kind] = {
        format: oneOf(entry.format, `byKind.${kind}.format`, FORMATS_V2),
        ...(entry.options !== undefined
          ? { options: options(entry.options, `byKind.${kind}.options`) }
          : {}),
      };
    }
  }
  if (raw.options !== undefined) spec.options = options(raw.options, 'options');
  if (raw.at !== undefined) {
    const a = raw.at;
    if (!isObj(a)) throw new Bad('at', 'at must be {sha}');
    keysOnly(a, ['sha'], 'at');
    if (typeof a.sha !== 'string' || !SHA_RE.test(a.sha))
      throw new Bad('at.sha', 'at.sha must be a commit id');
    spec.at = { sha: a.sha };
  }
  if (raw.wait !== undefined) spec.wait = oneOf(raw.wait, 'wait', ['ai']);
  return spec;
}

/** The server-authoritative check (contract §5.1). Unknown key → `bad-spec` naming it. */
export function validateSpecV2(raw: unknown): SpecVerdict {
  try {
    return { ok: true, spec: validate(raw) };
  } catch (err) {
    if (err instanceof Bad)
      return { ok: false, error: { error: 'bad-spec', field: err.field, message: err.message } };
    throw err;
  }
}
