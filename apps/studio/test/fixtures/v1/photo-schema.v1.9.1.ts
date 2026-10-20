// FROZEN — apps/studio/photo/schema.ts at v1.9.1: the strict v1 PhotoEdit reader a 1.x peer runs.
// S8.15 checks every per-use file against it. Never edit.
/**
 * @file       photo/schema.ts — PhotoEdit sidecar data model (Stage A, Task 1)
 * @scope      apps/studio/photo/schema.ts
 * @purpose    The single source of truth for the non-destructive photo-edit
 *             object persisted next to a source asset as `assets/<sha8>.photo.json`
 *             (DDR-115 taxonomy: VERSIONED, alongside the asset it edits).
 *
 *             A `PhotoEdit` is *parameters only* — never pixels. The live
 *             compositor (`photo/pipeline.ts` → canvas-lib `<PhotoLayer>`) and
 *             the headless CLI (`bin/photo-*.sh`) both read this shape and
 *             reproduce the identical WebGL render. An absent sidecar, or one
 *             that `isDefaultEdit()` reports as neutral, renders as the plain
 *             untouched `<img>` / `<image>` with ZERO pixi.js cost.
 *
 * @invariant  DEPENDENCY-FREE. This module is imported by BOTH the server
 *             (`photo-store.ts`, the `/_api/photo-edit` route) and the client
 *             WebGL compositor. It MUST NOT `import 'pixi.js'` or any browser /
 *             native lib — the server bundle must never pull in a WebGL runtime.
 *             Pure TS types + plain-object helpers + a hand-rolled structural
 *             validator (no Ajv) only.
 *
 *             Field naming/style mirrors `annotations-model.ts`'s flat explicit
 *             per-type interfaces (`ImageStroke`, :245-260).
 */

/**
 * Schema version. Bumped when the shape changes incompatibly so a stored
 * sidecar authored by an older Studio can be detected + migrated rather than
 * mis-rendered. (BREAKER's flagged risk: a new versioned data-model type needs
 * an explicit version marker — this is it.)
 */
export const PHOTO_EDIT_VERSION = 1 as const;

/** Pattern-overlay texture families (built via `PIXI.TilingSprite`, Task 4). */
export type PatternType = 'dots' | 'grid' | 'lines' | 'diagonal' | 'crosshatch';
export const PATTERN_TYPES: readonly PatternType[] = [
  'dots',
  'grid',
  'lines',
  'diagonal',
  'crosshatch',
];

/** Blend modes the pattern overlay may composite with (pixi v8 BLEND_MODES subset). */
export type PatternBlend = 'normal' | 'multiply' | 'screen' | 'overlay' | 'soft-light';
export const PATTERN_BLENDS: readonly PatternBlend[] = [
  'normal',
  'multiply',
  'screen',
  'overlay',
  'soft-light',
];

/** Preset alpha masks (built via `PIXI.Graphics`, Task 4). */
export type MaskPreset = 'none' | 'vignette' | 'radial-reveal' | 'edge-fade';
export const MASK_PRESETS: readonly MaskPreset[] = [
  'none',
  'vignette',
  'radial-reveal',
  'edge-fade',
];

/**
 * Basic tonal adjustments. Every field is a NORMALIZED delta with a neutral
 * origin so an all-zero object is a no-op (renders identical to the source):
 *   - brightness / contrast / saturation / exposure: −1 … +1, 0 = neutral.
 *   - hue: −180 … +180 degrees, 0 = neutral.
 *   - sepia / grayscale / invert: 0 … 1 amount, 0 = off.
 * `filters.ts` maps these onto `PIXI.ColorMatrixFilter`'s convenience methods.
 */
export interface PhotoAdjustments {
  brightness?: number;
  contrast?: number;
  saturation?: number;
  exposure?: number;
  hue?: number;
  sepia?: number;
  grayscale?: number;
  invert?: number;
}

/**
 * Duotone remap — luminance → two-color gradient-map lerp. Needs a hand-authored
 * GLSL fragment shader (`DuotoneFilter`, Task 4) because a two-point gradient map
 * is a per-pixel remap that `ColorMatrixFilter`'s linear affine transform cannot
 * express. `colorA`/`colorB` are `#rrggbb` hex (shadow → highlight).
 */
export interface PhotoDuotone {
  enabled?: boolean;
  colorA?: string;
  colorB?: string;
  /** 0 … 1 — crossfade between original and full duotone. */
  intensity?: number;
}

/** Film grain via `PIXI.NoiseFilter`. `amount` 0…1, `size` a px grain scale ≥ 1. */
export interface PhotoGrain {
  enabled?: boolean;
  amount?: number;
  size?: number;
}

/** Repeating pattern overlay via `PIXI.TilingSprite` + blend mode. */
export interface PhotoPattern {
  enabled?: boolean;
  type?: PatternType;
  /** Tile scale multiplier (1 = native). */
  scale?: number;
  /** 0 … 1 overlay opacity. */
  opacity?: number;
  blend?: PatternBlend;
  /** `#rrggbb` ink color the pattern is drawn in (default white). Load-bearing
   *  for the blend modes: a WHITE pattern under `multiply` is a no-op (white ×
   *  base = base) so the pattern "vanishes" — a dark color makes multiply darken. */
  color?: string;
}

/** Preset alpha mask + its strength (0 … 1). */
export interface PhotoMask {
  preset?: MaskPreset;
  strength?: number;
}

/**
 * Non-destructive background removal. When `enabled`, `maskAsset` is the
 * content-addressed `assets/<sha8>.png` cutout/alpha-matte produced client-side
 * by `@imgly/background-removal` and uploaded through the existing
 * `POST /_api/asset` route (Task 10). Turning `enabled` off restores the
 * original — the matte asset is retained, never deleted.
 */
export interface PhotoBackgroundRemoved {
  enabled?: boolean;
  /** `assets/<sha8>.png` — absent until the removal has actually run. */
  maskAsset?: string;
}

/**
 * The full non-destructive edit for one source photo. Every field is optional;
 * an empty object is a valid "unedited" sidecar. `source` is the
 * `assets/<sha8>.<ext>` the edit applies to (redundant with the sidecar's own
 * filename, but self-describing for the CLI + audit).
 */
export interface PhotoEdit {
  /** Schema version of THIS object (defaults to PHOTO_EDIT_VERSION on write). */
  version?: number;
  /** `assets/<sha8>.<ext>` — the source the edit targets. */
  source?: string;
  adjustments?: PhotoAdjustments;
  duotone?: PhotoDuotone;
  grain?: PhotoGrain;
  pattern?: PhotoPattern;
  mask?: PhotoMask;
  backgroundRemoved?: PhotoBackgroundRemoved;
}

/**
 * Pipeline order is FIXED and load-bearing — filters are not commutative.
 * `filters.ts` MUST build its graph in exactly this sequence. Exported so the
 * compositor + tests share one source of truth.
 */
export const PHOTO_PIPELINE_ORDER = ['adjustments', 'duotone', 'grain', 'pattern', 'mask'] as const;

const EPS = 1e-6;
const near = (v: number | undefined, origin: number): boolean =>
  v == null || Math.abs(v - origin) < EPS;

/** True when the adjustments block has no visible effect. */
function adjustmentsAreNeutral(a?: PhotoAdjustments): boolean {
  if (!a) return true;
  return (
    near(a.brightness, 0) &&
    near(a.contrast, 0) &&
    near(a.saturation, 0) &&
    near(a.exposure, 0) &&
    near(a.hue, 0) &&
    near(a.sepia, 0) &&
    near(a.grayscale, 0) &&
    near(a.invert, 0)
  );
}

/**
 * True when the edit produces a render identical to the untouched source, so
 * `<PhotoLayer>` can skip mounting pixi.js entirely (the lazy-bundle guarantee).
 * "Neutral" = every section either absent, disabled, or at its no-op value.
 */
export function isDefaultEdit(edit?: PhotoEdit | null): boolean {
  if (!edit) return true;
  if (!adjustmentsAreNeutral(edit.adjustments)) return false;
  if (edit.duotone?.enabled && (edit.duotone.intensity ?? 1) > EPS) return false;
  if (edit.grain?.enabled && (edit.grain.amount ?? 1) > EPS) return false;
  if (edit.pattern?.enabled && (edit.pattern.opacity ?? 1) > EPS) return false;
  if (edit.mask?.preset && edit.mask.preset !== 'none' && (edit.mask.strength ?? 1) > EPS)
    return false;
  if (edit.backgroundRemoved?.enabled && edit.backgroundRemoved.maskAsset) return false;
  return true;
}

/** A fresh, fully-neutral edit for `source` (used when opening the Photo tab). */
export function emptyPhotoEdit(source?: string): PhotoEdit {
  return { version: PHOTO_EDIT_VERSION, ...(source ? { source } : {}) };
}

// ── Structural validation (dependency-free — no Ajv) ─────────────────────────
// The `/_api/photo-edit` route (Task 8) validates untrusted JSON with this
// before persisting. Reject anything unexpected: unknown top-level keys, wrong
// types, out-of-range numbers, non-hex colors, non-relative asset paths. This
// is a security surface (DDR-088) — a crafted field must not round-trip to disk.

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

const HEX_RE = /^#[0-9a-fA-F]{6}$/;
// Relative content-addressed asset path only — mirrors the annotation-layer
// `<image>` href allowlist; NEVER a data:/blob:/absolute/traversing path.
const ASSET_REL_RE = /^assets\/[0-9a-f]{8,}[A-Za-z0-9._-]*$/;

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

function num(errors: string[], obj: Record<string, unknown>, key: string, lo: number, hi: number) {
  if (!(key in obj) || obj[key] == null) return;
  const v = obj[key];
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    errors.push(`${key}: must be a finite number`);
    return;
  }
  if (v < lo || v > hi) errors.push(`${key}: ${v} out of range [${lo}, ${hi}]`);
}

function bool(errors: string[], obj: Record<string, unknown>, key: string) {
  if (key in obj && obj[key] != null && typeof obj[key] !== 'boolean')
    errors.push(`${key}: must be a boolean`);
}

function assertKeys(
  errors: string[],
  obj: Record<string, unknown>,
  allowed: string[],
  where: string
) {
  for (const k of Object.keys(obj))
    if (!allowed.includes(k)) errors.push(`${where}: unknown key "${k}"`);
}

/**
 * Structurally validate an untrusted value as a `PhotoEdit`. Returns collected
 * errors (empty ⇒ valid). Unknown keys, wrong types, out-of-range numbers,
 * malformed colors, and non-relative asset paths all fail.
 */
export function validatePhotoEdit(input: unknown): ValidationResult {
  const errors: string[] = [];
  if (!isPlainObject(input)) return { ok: false, errors: ['root: must be an object'] };

  assertKeys(
    errors,
    input,
    [
      'version',
      'source',
      'adjustments',
      'duotone',
      'grain',
      'pattern',
      'mask',
      'backgroundRemoved',
    ],
    'root'
  );

  if ('version' in input && input.version != null && typeof input.version !== 'number')
    errors.push('version: must be a number');
  if ('source' in input && input.source != null) {
    if (typeof input.source !== 'string' || !ASSET_REL_RE.test(input.source))
      errors.push('source: must be a relative assets/<sha8>.<ext> path');
  }

  if (input.adjustments != null) {
    const a = input.adjustments;
    if (!isPlainObject(a)) errors.push('adjustments: must be an object');
    else {
      assertKeys(
        errors,
        a,
        ['brightness', 'contrast', 'saturation', 'exposure', 'hue', 'sepia', 'grayscale', 'invert'],
        'adjustments'
      );
      num(errors, a, 'brightness', -1, 1);
      num(errors, a, 'contrast', -1, 1);
      num(errors, a, 'saturation', -1, 1);
      num(errors, a, 'exposure', -1, 1);
      num(errors, a, 'hue', -180, 180);
      num(errors, a, 'sepia', 0, 1);
      num(errors, a, 'grayscale', 0, 1);
      num(errors, a, 'invert', 0, 1);
    }
  }

  if (input.duotone != null) {
    const d = input.duotone;
    if (!isPlainObject(d)) errors.push('duotone: must be an object');
    else {
      assertKeys(errors, d, ['enabled', 'colorA', 'colorB', 'intensity'], 'duotone');
      bool(errors, d, 'enabled');
      for (const c of ['colorA', 'colorB'] as const)
        if (c in d && d[c] != null && (typeof d[c] !== 'string' || !HEX_RE.test(d[c] as string)))
          errors.push(`duotone.${c}: must be a #rrggbb hex color`);
      num(errors, d, 'intensity', 0, 1);
    }
  }

  if (input.grain != null) {
    const g = input.grain;
    if (!isPlainObject(g)) errors.push('grain: must be an object');
    else {
      assertKeys(errors, g, ['enabled', 'amount', 'size'], 'grain');
      bool(errors, g, 'enabled');
      num(errors, g, 'amount', 0, 1);
      num(errors, g, 'size', 1, 32);
    }
  }

  if (input.pattern != null) {
    const p = input.pattern;
    if (!isPlainObject(p)) errors.push('pattern: must be an object');
    else {
      assertKeys(errors, p, ['enabled', 'type', 'scale', 'opacity', 'blend', 'color'], 'pattern');
      bool(errors, p, 'enabled');
      if ('type' in p && p.type != null && !PATTERN_TYPES.includes(p.type as PatternType))
        errors.push(`pattern.type: must be one of ${PATTERN_TYPES.join(', ')}`);
      if ('blend' in p && p.blend != null && !PATTERN_BLENDS.includes(p.blend as PatternBlend))
        errors.push(`pattern.blend: must be one of ${PATTERN_BLENDS.join(', ')}`);
      if ('color' in p && p.color != null && (typeof p.color !== 'string' || !HEX_RE.test(p.color)))
        errors.push('pattern.color: must be a #rrggbb hex color');
      num(errors, p, 'scale', 0.1, 16);
      num(errors, p, 'opacity', 0, 1);
    }
  }

  if (input.mask != null) {
    const m = input.mask;
    if (!isPlainObject(m)) errors.push('mask: must be an object');
    else {
      assertKeys(errors, m, ['preset', 'strength'], 'mask');
      if ('preset' in m && m.preset != null && !MASK_PRESETS.includes(m.preset as MaskPreset))
        errors.push(`mask.preset: must be one of ${MASK_PRESETS.join(', ')}`);
      num(errors, m, 'strength', 0, 1);
    }
  }

  if (input.backgroundRemoved != null) {
    const b = input.backgroundRemoved;
    if (!isPlainObject(b)) errors.push('backgroundRemoved: must be an object');
    else {
      assertKeys(errors, b, ['enabled', 'maskAsset'], 'backgroundRemoved');
      bool(errors, b, 'enabled');
      if ('maskAsset' in b && b.maskAsset != null) {
        if (typeof b.maskAsset !== 'string' || !ASSET_REL_RE.test(b.maskAsset))
          errors.push('backgroundRemoved.maskAsset: must be a relative assets/<sha8>.png path');
      }
    }
  }

  return { ok: errors.length === 0, errors };
}
