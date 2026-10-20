// Artboard-kind routes — S7.20 (decision maude/v2-S7.20-one-preset-catalogue).
//
// `GET /_api/kinds/presets?file=<canvas>` → `{ groups, custom, recent, kinds }`: the ONE preset catalogue
// (kinds/presets.ts) the F size picker draws, with the person's Recent chips (`recentSizes` in prefs.json, per Mac).
// The shell reads it; the write that follows is `artboard.insert-preset` through `/_api/edit-op` (minRole edit,
// judged there), and a pick is remembered with `PATCH /_api/ui-prefs { recentSizes }`.
//
//   - MINIMUM ROLE EDIT: the list exists to ADD an artboard to a canvas, so a viewer and a Can comment session
//     are refused here, not merely shown no panel (the way `GET /_api/ds/components` is);
//   - MAIN ORIGIN ONLY (`origin: 'main'`): in neither canvas allowlist, so the untrusted canvas origin answers 403 —
//     the canvas asks the shell to open the picker (`tool-panel-open`), it never fetches the list;
//   - READ-ONLY: writes nothing.
//
// S7.25 (decision maude/v2-S7.25-one-warning-style) adds two more reads:
//
//   `GET /_api/kinds/warnings?canvas=<rel>[&artboard=<id>]` → `{ ok, measured, artboards: [{ id, label, kind, count,
//   summary, warnings: [{ id, code, text, verb, fix }] }] }`: the things to check on each artboard (kinds/warnings.ts —
//   crosses the cut · longer than one export · not the paper size · wider than the page · a soft picture). The agent's
//   door to what the canvas shows live as a mark beside the label and a row in the inspector. The layers come from a
//   headless render (exporters/rects-runner.ts); with none, `measured` is false and only what the artboard's own props
//   say is raised. Anyone who can see the canvas may read it (minRole read, scope judged).
//   `GET /_api/kinds/convert-plan?canvas=&artboard=&paper=[&orientation=]` → `{ ok, measured, plan, check }`: what Change
//   kind will do and the "Check after" list (kinds/convert.ts), before the `artboard.convert-kind` edit-op does it.
//   It exists to convert, so below Can edit it is refused like the presets.

import { readFileSync } from 'node:fs';
import path from 'node:path';

import type { Access } from '../access/scope.ts';
import { readAllArtboardPrintProps } from '../canvas-edit.ts';
import { artboardFactsOf, scanArtboards } from '../edit-ops/artboard-facts.ts';
import type { RectsManifest } from '../exporters/print-preflight.ts';
import { defaultVideoFacts, type VideoFactsReader } from '../exporters/video-cap.ts';
import { checkAfter, planConvert } from '../kinds/convert.ts';
import {
  CUSTOM_PRINT_TILE,
  KIND_WORD,
  PRESET_GROUPS,
  type Preset,
  recentPresets,
} from '../kinds/presets.ts';
import {
  detectWarnings,
  summaryWords,
  type WarnArtboard,
  type WarnRects,
} from '../kinds/warnings.ts';
import { readUiPrefs } from '../ui-prefs.ts';
import { resolveCanvasRel } from './edit.ts';
import type { RouteSpec } from './table.ts';

const json = (status: number, body: unknown) =>
  Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

export interface KindRouteDeps {
  designRoot: string;
  /** the design root relative to the repo root (`.design`) */
  designRel: string;
  /** the session's access (http.ts `accessOf`); absent = nobody may list (fail closed) */
  access?: (req: Request) => Access;
  /** tests only: the Recent ids instead of prefs.json */
  recentIds?: () => unknown;
  /** S7.25 — the canvas's layer geometry (a headless render, exporters/rects-runner.ts); absent = unmeasured */
  rects?: (canvasRel: string) => Promise<RectsManifest | null>;
  /** S7.25 — a video artboard's length (default: read from the canvas source under `designRoot`) */
  videoFacts?: VideoFactsReader;
  /** tests only: the canvas source instead of the file under `designRoot` */
  readSource?: (rel: string) => string | null;
}

/** What a tile needs, nothing it does not (no aliases, no paper internals). */
const tile = (p: Preset) => ({
  id: p.id,
  name: p.name,
  label: p.label,
  kind: p.kind,
  sizeText: p.sizeText,
  widthPx: p.widthPx,
  heightPx: p.heightPx,
  top: p.top,
});

const forbidden = (message: string) => json(403, { ok: false, code: 'forbidden', message });

/** The WORLD rects of one artboard and its layers, in the shape the detectors read. */
function rectsOf(m: RectsManifest | null, id: string): WarnRects | null {
  const ab = m?.artboards.find((a) => a.id === id);
  if (!m || !ab) return null;
  return {
    artboard: { x: ab.x, y: ab.y, w: ab.w, h: ab.h },
    elements: m.elements
      .filter((e) => e.artboard === id)
      .map((e) => ({
        cdId: e.cdId,
        x: e.x,
        y: e.y,
        w: e.w,
        h: e.h,
        ...(e.tag ? { tag: e.tag } : {}),
        ...(e.text ? { text: e.text } : {}),
        ...(e.naturalW ? { naturalW: e.naturalW } : {}),
      })),
  };
}

export function createKindRoutes(deps: KindRouteDeps): RouteSpec[] {
  const sourceOf = (rel: string): string | null => {
    if (deps.readSource) return deps.readSource(rel);
    try {
      return readFileSync(path.join(deps.designRoot, ...rel.split('/')), 'utf8');
    } catch {
      return null;
    }
  };
  const videoFacts = deps.videoFacts ?? defaultVideoFacts(deps.designRoot);
  const canvasOf = (req: Request): string | null => {
    const file = new URL(req.url).searchParams.get('canvas');
    return file ? resolveCanvasRel(deps.designRoot, deps.designRel, file) : null;
  };
  return [
    {
      method: 'GET',
      path: '/_api/kinds/presets',
      origin: 'main',
      readOnly: 'allowed',
      handle: (req) => {
        const file = new URL(req.url).searchParams.get('file');
        const rel = file ? resolveCanvasRel(deps.designRoot, deps.designRel, file) : null;
        const access = deps.access?.(req);
        if (!access?.can('edit', rel))
          return json(403, {
            ok: false,
            code: 'forbidden',
            message: 'Only people who can edit can add artboards.',
          });
        const ids = deps.recentIds ? deps.recentIds() : readUiPrefs().recentSizes;
        return json(200, {
          kinds: KIND_WORD,
          groups: PRESET_GROUPS.map((g) => ({
            id: g.id,
            kind: g.kind,
            title: g.title,
            icon: g.icon,
            badge: g.badge,
            presets: g.presets.map(tile),
          })),
          custom: CUSTOM_PRINT_TILE,
          recent: recentPresets(ids).map(tile),
        });
      },
    },
    {
      method: 'GET',
      path: '/_api/kinds/warnings',
      origin: 'main',
      readOnly: 'allowed',
      handle: async (req) => {
        const rel = canvasOf(req);
        const access = deps.access?.(req);
        if (!rel || !access?.can('read', rel)) return forbidden('You can’t look at that canvas.');
        const source = sourceOf(rel);
        if (source === null)
          return json(404, { ok: false, code: 'not-found', message: 'That canvas is not here.' });
        const only = new URL(req.url).searchParams.get('artboard');
        const facts = scanArtboards(source).filter((a) => !only || a.id === only);
        const wantsLayers = facts.some((a) => a.kind === 'print' || a.kind === 'web');
        const manifest = wantsLayers && deps.rects ? await deps.rects(rel) : null;
        let prints: Record<string, Record<string, unknown>> = {};
        try {
          prints = readAllArtboardPrintProps(rel, source);
        } catch {
          /* an unparseable canvas has no print props to read */
        }
        const artboards = facts.map((a) => {
          const rects = rectsOf(manifest, a.id);
          const video = a.kind === 'video' ? videoFacts(rel, a.id) : null;
          const ab: WarnArtboard = {
            id: a.id,
            kind:
              (['digital', 'web', 'print', 'video'] as const).find((k) => k === a.kind) ??
              'digital',
            widthPx: rects?.artboard.w ?? a.widthPx ?? 0,
            heightPx: rects?.artboard.h ?? a.heightPx ?? 0,
            fixed: a.fixed,
            ...(prints[a.id] ? { print: prints[a.id] } : {}),
            ...(video
              ? { durationFrames: video.frames, fps: video.fps, maxFrames: video.stored }
              : {}),
          };
          const warnings = detectWarnings(ab, rects);
          return {
            id: a.id,
            label: a.label,
            kind: ab.kind,
            count: warnings.length,
            summary: warnings.length ? summaryWords(warnings.length) : '',
            warnings,
          };
        });
        return json(200, { ok: true, measured: manifest !== null, artboards });
      },
    },
    {
      method: 'GET',
      path: '/_api/kinds/convert-plan',
      origin: 'main',
      readOnly: 'allowed',
      handle: async (req) => {
        const rel = canvasOf(req);
        const access = deps.access?.(req);
        if (!rel || !access?.can('edit', rel))
          return forbidden('Only people who can edit can change an artboard’s kind.');
        const q = new URL(req.url).searchParams;
        const source = sourceOf(rel);
        const id = q.get('artboard') ?? '';
        const a = source === null ? null : artboardFactsOf(source, id);
        if (!a || a.widthPx === null || a.heightPx === null)
          return json(404, { ok: false, code: 'not-found', message: 'That artboard is not here.' });
        if (a.kind !== 'digital')
          return json(422, {
            ok: false,
            code: 'invalid',
            message: 'Only a fixed size can be made into a print.',
          });
        const o = q.get('orientation');
        const plan = planConvert(
          {
            id: a.id,
            label: a.label ?? a.id,
            widthPx: a.widthPx,
            heightPx: a.heightPx,
            background: a.background,
            safeZones: a.safeZones,
          },
          {
            paper: q.get('paper') ?? '',
            ...(o === 'portrait' || o === 'landscape' ? { orientation: o } : {}),
          }
        );
        if (!plan)
          return json(422, {
            ok: false,
            code: 'invalid',
            message: 'That is not a paper size Maude knows.',
          });
        const manifest = deps.rects ? await deps.rects(rel) : null;
        const rects = rectsOf(manifest, a.id);
        return json(200, {
          ok: true,
          measured: rects !== null,
          plan,
          check: checkAfter(plan, rects),
        });
      },
    },
  ];
}
