// routes/generate.ts — Generate with N takes (S8.16; 12 · ia-gen-ask, ia-gen-placed).
//
//   POST /_api/generate-takes/quote { canvas, artboard, prompt?, provider?, model?, n?, size? }
//        200 { quote, provider, model, n, aspect, artboard:{id,label}, seconds, lines:{time, licence} }
//        409 { reason: 'no-provider' }      no image provider is ready (no key, none registered)
//   POST /_api/generate-takes { quote, canvas, artboard, prompt, provider, model, n, aspect }
//        202 { group, jobIds }              N parallel jobs on the generation queue
//        409 { reason: 'no-consent' }       no live quote for exactly these parameters — nothing is sent
//        429                                 the generation queue is full
//   GET  /_api/generate-takes?group=&canvas=        the group: status, takes, best (the client places best)
//   GET  /_api/generate-takes/of?asset=&canvas=     a placed picture's takes + its Made by AI line
//
// The two POSTs are Can edit on the target canvas (the table gate judges `canvas`, and the handler
// again): a viewer, a Can comment session or a canvas-only session on another canvas gets no quote and
// starts nothing. The GETs are reads of that canvas (seen + read). MAIN ORIGIN ONLY — like
// /_api/generate-jobs, the untrusted canvas iframe must never reach a route that resolves a provider
// key and makes an outbound call (DDR-054/164). `.gen.json` is written here and nowhere else
// (S8-asset-sidecars §5.6).

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { notInScopeResponse } from '../access/request.ts';
import type { Access } from '../access/scope.ts';
import { type LocalizeDeps, localizeGenAsset } from '../generation/download.ts';
import { readGen } from '../generation/gen-sidecar.ts';
import { type GenerationJobQueue, GenerationQueueFullError } from '../generation/jobs.ts';
import { configuredProviders, getProviderKey } from '../generation/keys.ts';
import { createAdapter, getProviderModels, providersForModality } from '../generation/registry.ts';
import {
  aspectFor,
  COMMON_RATIOS,
  consentLines,
  createQuotes,
  createTakeGroups,
  estimateSeconds,
  type Quotes,
  sha8Of,
  TAKES_DEFAULT,
  TAKES_MAX,
  type TakeGroup,
  type TakeGroups,
  takeLabel,
} from '../generation/takes.ts';
import type { GenRequest, ModelDescriptor, ProviderDescriptor } from '../generation/types.ts';
import { resolveCanvasRel } from './edit.ts';
import type { RouteSpec } from './table.ts';

const MAX_BODY = 16 * 1024;
const PROMPT_MAX = 4000;
const ID_RE = /^[A-Za-z0-9._/-]{1,80}$/;
const ARTBOARD_RE = /^[A-Za-z0-9_.:-]{1,120}$/;
const ASSET_RE = /^assets\/[0-9a-f]{8}\.[A-Za-z0-9]{1,8}$/;
const GROUP_RE = /^g_[0-9a-f]{12}$/;
const RATIO_RE = /^\d{1,3}:\d{1,3}$/;

const json = (status: number, body: unknown) =>
  Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

export interface ImageProvider {
  descriptor: ProviderDescriptor;
  /** its image models (the first is the default) */
  models: readonly ModelDescriptor[];
  /** a key is set, or it needs none */
  ready: boolean;
}

export interface GenerateRouteDeps {
  /** THIS request's session (http.ts `accessOf`) */
  access(req: Request): Access;
  /** a canvas the request names → its designRoot-relative `.tsx`, or null (routes/edit.ts `resolveCanvasRel`) */
  resolveCanvas(file: string): string | null;
  /** the artboard as the index has it (size + name), or null when the canvas has no such artboard */
  artboard(
    canvas: string,
    id: string
  ): { w: number | null; h: number | null; label: string | null } | null;
  /** every provider that makes images */
  imageProviders(): readonly ImageProvider[];
  /** finished jobs of this provider + model, for the time estimate */
  past(provider: string, model: string): ReadonlyArray<{ ms: number }>;
  /** the generation queue's concurrency */
  concurrency: number;
  quotes: Quotes;
  groups: TakeGroups;
  /** run ONE take: resolve the key at run time, submit, land the result in assets/ */
  submit(req: GenRequest, signal: AbortSignal): Promise<{ assets: string[] }>;
  /** read a designRoot-relative text file (`assets/<sha8>.gen.json`), or null */
  readText(rel: string): string | null;
  /** the names in `assets/` */
  assetNames(): readonly string[];
  /** who asks, as a display name (V2-1.5 attribution) — never an e-mail */
  displayName?(req: Request): string | null;
}

async function readBody(req: Request): Promise<Record<string, unknown> | Response> {
  if (Number(req.headers.get('content-length')) > MAX_BODY)
    return json(413, { ok: false, reason: 'too-large' });
  const text = await req.text();
  if (text.length > MAX_BODY) return json(413, { ok: false, reason: 'too-large' });
  try {
    const body = JSON.parse(text) as unknown;
    if (body && typeof body === 'object' && !Array.isArray(body))
      return body as Record<string, unknown>;
  } catch {
    /* below */
  }
  return json(400, { ok: false, reason: 'bad-json' });
}

type Target = {
  canvas: string;
  artboard: string;
  label: string | null;
  w: number | null;
  h: number | null;
};

/** The canvas + artboard a write names, judged for Can edit. */
function editTarget(
  deps: GenerateRouteDeps,
  req: Request,
  body: Record<string, unknown>
): Target | Response {
  const access = deps.access(req);
  const file = body.canvas;
  const id = body.artboard;
  if (typeof file !== 'string' || typeof id !== 'string' || !ARTBOARD_RE.test(id))
    return json(400, { ok: false, reason: 'bad-target' });
  const canvas = deps.resolveCanvas(file);
  if (!canvas)
    return access.canvasOnly ? notInScopeResponse() : json(404, { ok: false, reason: 'no-canvas' });
  if (!access.seesCanvas(canvas)) return notInScopeResponse();
  if (!access.can('edit', canvas)) return json(403, { ok: false, reason: 'forbidden' });
  const ab = deps.artboard(canvas, id);
  if (!ab) return json(404, { ok: false, reason: 'no-artboard' });
  return { canvas, artboard: id, label: ab.label, w: ab.w, h: ab.h };
}

/** The provider + model a body asks for, or the first ready one. */
function pick(
  deps: GenerateRouteDeps,
  body: Record<string, unknown>
): { p: ImageProvider; model: ModelDescriptor } | null {
  const ready = deps.imageProviders().filter((p) => p.ready && p.models.length > 0);
  const want = typeof body.provider === 'string' ? body.provider : null;
  const p = want ? ready.find((x) => x.descriptor.id === want) : ready[0];
  if (!p) return null;
  const wantModel = typeof body.model === 'string' ? body.model : null;
  const model = wantModel ? p.models.find((m) => m.id === wantModel) : p.models[0];
  return model ? { p, model } : null;
}

const countOf = (v: unknown) =>
  v === undefined
    ? TAKES_DEFAULT
    : Number.isInteger(v) && (v as number) >= 1 && (v as number) <= TAKES_MAX
      ? (v as number)
      : null;

/** A read of `canvas` (seen + read), from `?canvas=`. */
function readCanvas(deps: GenerateRouteDeps, req: Request, url: URL): string | Response {
  const access = deps.access(req);
  const file = url.searchParams.get('canvas');
  if (!file) return json(400, { ok: false, reason: 'bad-target' });
  const canvas = deps.resolveCanvas(file);
  if (!canvas || !access.seesCanvas(canvas) || !access.can('read', canvas))
    return access.canvasOnly || canvas
      ? notInScopeResponse()
      : json(404, { ok: false, reason: 'no-canvas' });
  return canvas;
}

export function createGenerateRoutes(deps: GenerateRouteDeps): RouteSpec[] {
  return [
    {
      method: 'POST',
      path: '/_api/generate-takes/quote',
      origin: 'main',
      readOnly: 'refused',
      handle: async (req) => {
        const body = await readBody(req);
        if (body instanceof Response) return body;
        const t = editTarget(deps, req, body);
        if (t instanceof Response) return t;
        const n = countOf(body.n);
        if (n === null) return json(400, { ok: false, reason: 'bad-count' });
        const chosen = pick(deps, body);
        if (!chosen) return json(409, { ok: false, reason: 'no-provider' });
        const { p, model } = chosen;
        const size = body.size as { w?: unknown; h?: unknown } | undefined;
        const w = typeof size?.w === 'number' ? size.w : (t.w ?? 0);
        const h = typeof size?.h === 'number' ? size.h : (t.h ?? 0);
        const aspect = aspectFor(w, h, model.aspectRatios ?? COMMON_RATIOS);
        const seconds = estimateSeconds(deps.past(p.descriptor.id, model.id), n, deps.concurrency);
        const quote = deps.quotes.issue({
          provider: p.descriptor.id,
          model: model.id,
          n,
          aspect,
          canvas: t.canvas,
          artboard: t.artboard,
        });
        return json(200, {
          ok: true,
          quote,
          provider: p.descriptor.id,
          providerLabel: p.descriptor.label,
          model: model.id,
          modelLabel: model.label,
          models: p.models.map((m) => ({ id: m.id, label: m.label })),
          n,
          aspect,
          artboard: { id: t.artboard, label: t.label },
          seconds: Math.round(seconds),
          lines: consentLines(p.descriptor, seconds),
        });
      },
    },
    {
      method: 'POST',
      path: '/_api/generate-takes',
      origin: 'main',
      readOnly: 'refused',
      handle: async (req) => {
        const body = await readBody(req);
        if (body instanceof Response) return body;
        const t = editTarget(deps, req, body);
        if (t instanceof Response) return t;
        const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
        if (!prompt || prompt.length > PROMPT_MAX)
          return json(400, { ok: false, reason: 'bad-prompt' });
        const n = countOf(body.n);
        const { provider, model, aspect } = body;
        if (
          n === null ||
          typeof provider !== 'string' ||
          !ID_RE.test(provider) ||
          typeof model !== 'string' ||
          !ID_RE.test(model) ||
          typeof aspect !== 'string' ||
          !RATIO_RE.test(aspect)
        )
          return json(400, { ok: false, reason: 'bad-request' });
        // the consent line first: no live quote for exactly these parameters → nothing is sent
        if (
          !deps.quotes.redeem(body.quote, {
            provider,
            model,
            n,
            aspect,
            canvas: t.canvas,
            artboard: t.artboard,
          })
        )
          return json(409, { ok: false, reason: 'no-consent' });
        const chosen = pick(deps, { provider, model });
        if (!chosen) return json(409, { ok: false, reason: 'no-provider' });
        try {
          const g = deps.groups.start({
            prompt,
            provider,
            model,
            n,
            aspect,
            target: { canvas: t.canvas, artboard: t.artboard },
            licence: chosen.p.descriptor.licence ?? null,
            by: deps.displayName?.(req) ?? null,
            run: (take, signal) =>
              deps.submit(
                {
                  modality: 'image',
                  provider,
                  model,
                  prompt,
                  aspectRatio: aspect,
                  params: { take },
                },
                signal
              ),
          });
          return json(202, { ok: true, group: g.group, jobIds: g.jobIds, n: g.n });
        } catch (err) {
          if (err instanceof GenerationQueueFullError)
            return json(429, { ok: false, reason: 'busy', message: err.message });
          throw err;
        }
      },
    },
    {
      method: 'GET',
      path: '/_api/generate-takes',
      origin: 'main',
      readOnly: 'allowed',
      handle: (req) => {
        const url = new URL(req.url);
        const canvas = readCanvas(deps, req, url);
        if (canvas instanceof Response) return canvas;
        const id = url.searchParams.get('group') ?? '';
        const g = GROUP_RE.test(id) ? deps.groups.get(id) : undefined;
        // another canvas's group answers like one that never existed
        if (!g || g.target.canvas !== canvas) return json(404, { ok: false, reason: 'no-group' });
        return json(200, { ok: true, ...g });
      },
    },
    {
      method: 'GET',
      path: '/_api/generate-takes/of',
      origin: 'main',
      readOnly: 'allowed',
      handle: (req) => {
        const url = new URL(req.url);
        const canvas = readCanvas(deps, req, url);
        if (canvas instanceof Response) return canvas;
        const asset = url.searchParams.get('asset') ?? '';
        if (!ASSET_RE.test(asset)) return json(400, { ok: false, reason: 'bad-asset' });
        const self = sha8Of(asset) as string;
        const text = deps.readText(`assets/${self}.gen.json`);
        const gen = text === null ? null : readGen(text, { self });
        // no sidecar, a newer one, a broken one: just a picture (no Made by AI line, no takes)
        if (!gen) return json(200, { ok: true, takes: [], madeByAi: null });
        const names = deps.assetNames();
        const takes: string[] = [];
        for (const sha of gen.takes) {
          if (sha === self) {
            takes.push(asset);
            continue;
          }
          const name = names.find(
            (n) =>
              n.startsWith(`${sha}.`) &&
              /^[0-9a-f]{8}\.[A-Za-z0-9]{1,8}$/.test(n) &&
              !n.endsWith('.json')
          );
          if (name) takes.push(`assets/${name}`);
        }
        const index = takes.indexOf(asset);
        return json(200, {
          ok: true,
          takes,
          index,
          of: takes.length,
          label: takes.length > 1 ? takeLabel(index, takes.length) : null,
          madeByAi: {
            prompt: gen.prompt,
            provider: gen.provider,
            model: gen.model,
            at: gen.at,
            licence: typeof gen.licence === 'string' ? gen.licence : null,
            by: typeof gen.by === 'string' ? gen.by : null,
          },
        });
      },
    },
  ];
}

// ── the live deps (http.ts builds them once; the tests build their own) ─────────────────────────

const SIDECAR_REL = /^assets\/[0-9a-f]{8}\.gen\.json$/;

export interface GenerateLiveDeps {
  designRoot: string;
  designRel: string;
  access(req: Request): Access;
  artboard: GenerateRouteDeps['artboard'];
  jobs: GenerationJobQueue;
  /** api.saveAsset — magic-byte sniff + content address (DDR-088) */
  saveAsset: LocalizeDeps['saveAsset'];
  emit?(g: TakeGroup): void;
}

/** The route's deps over the live studio: the provider registry, the key store, the generation queue. */
export function generateDepsFor(o: GenerateLiveDeps): GenerateRouteDeps {
  const assetsDir = path.join(o.designRoot, 'assets');
  const groups = createTakeGroups({
    enqueue: (a) => o.jobs.enqueue(a),
    writeSidecar: async (rel, text) => {
      if (!SIDECAR_REL.test(rel)) throw new Error('not a sidecar path');
      await Bun.write(path.join(o.designRoot, ...rel.split('/')), text);
    },
    emit: o.emit,
  });
  return {
    access: o.access,
    resolveCanvas: (file) => resolveCanvasRel(o.designRoot, o.designRel, file),
    artboard: o.artboard,
    imageProviders: () => {
      const keys = new Set(configuredProviders());
      return providersForModality('image').map((d) => ({
        descriptor: d,
        models: getProviderModels(d.id).filter((m) => m.modality === 'image'),
        ready: d.auth === 'none' || keys.has(d.id),
      }));
    },
    past: (provider, model) =>
      o.jobs
        .list()
        .filter(
          (j) =>
            j.status === 'done' &&
            j.provider === provider &&
            j.model === model &&
            !!j.startedAt &&
            !!j.finishedAt
        )
        .slice(0, 20)
        .map((j) => ({
          ms: Date.parse(j.finishedAt as string) - Date.parse(j.startedAt as string),
        })),
    concurrency: Math.max(1, Number(process.env.MAUDE_GENERATE_MAX_CONCURRENT) || 2),
    quotes: createQuotes(),
    groups,
    submit: async (req, signal) => {
      // the key is resolved AT RUN TIME, never cached; the adapter never touches the filesystem
      const apiKey = await getProviderKey(req.provider);
      const localize = (asset: Parameters<typeof localizeGenAsset>[0]) =>
        localizeGenAsset(asset, { saveAsset: o.saveAsset });
      const adapter = createAdapter(req.provider, { apiKey, signal, localize });
      const job = await adapter.submit(req);
      const result = await job.result();
      const assets: string[] = [];
      for (const asset of result.assets)
        if (asset.kind === 'image') assets.push(await localize(asset));
      return { assets };
    },
    readText: (rel) => {
      if (!SIDECAR_REL.test(rel)) return null;
      try {
        return readFileSync(path.join(o.designRoot, ...rel.split('/')), 'utf8');
      } catch {
        return null;
      }
    },
    assetNames: () => {
      try {
        return readdirSync(assetsDir);
      } catch {
        return [];
      }
    },
  };
}
