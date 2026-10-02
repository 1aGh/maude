// `PUT /api/project-config` — the project OWNER tells a cell what its project
// is called and where its design systems live.
//
// WHY THIS EXISTS. A cell reads `<designRoot>/config.json` from its checkout.
// A project seeded from git has one; a project that came into being by a
// desktop syncing into an empty cell does not, because the file plane never
// carries `config.json` (file-membership: `never` — it names the linked hub,
// and a hub must not be able to rewrite a peer's trust anchors). Such a cell
// ran on the studio's DEFAULTS: no design systems, `tokensCssRel` pointing at
// `system/colors_and_type.css`, so every canvas that relied on the shell's
// tokens stylesheet for `--font-display` rendered in a fallback serif
// (2026-10-02, alligators).
//
// THE TRUST DIRECTION IS THE OTHER ONE. `never` protects the RECEIVER of a
// config from the hub. Here the receiver is the hub and the sender is the
// person who owns the project — the same person the file door already lets
// write executable code modules. So: owner-role tokens only, project-wide
// scope only, and only a SANITIZED SUBSET travels — names and contained
// relative paths. Nothing that names a hub, a token, a URL or a command.
//
// MERGED, NEVER REPLACED. A git-seeded checkout's config.json is the tenant's
// versioned file and carries keys this door knows nothing about; only the
// subset's keys are set, everything else stays as it was.

import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { verifyToken } from './tokens.mjs';

export const PROJECT_CONFIG_PATH = '/api/project-config';

/** A request body larger than this is not a project config. */
const MAX_BODY_BYTES = 32 * 1024;

const containedRel = (p) =>
  typeof p === 'string' &&
  p.length > 0 &&
  p.length <= 256 &&
  !p.startsWith('/') &&
  !/(^|\/)\.\.(\/|$)/.test(p) &&
  !/[\\\0]/.test(p);

const label = (s, max = 64) =>
  typeof s === 'string' && s.trim().length > 0 && s.length <= max && !/[\0\r\n]/.test(s);

/**
 * The part of a project config that may cross from an owner to a cell, or
 * `null` when there is nothing usable in it. Keys absent from the input are
 * absent from the output, so a merge never invents a value.
 */
export function sanitizeProjectConfigSubset(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const out = {};
  if (label(raw.name)) out.name = raw.name;
  if (label(raw.projectLabel, 120)) out.projectLabel = raw.projectLabel;
  if (containedRel(raw.tokensCssRel)) out.tokensCssRel = raw.tokensCssRel;
  if (raw.componentsCssRel === null || containedRel(raw.componentsCssRel)) {
    out.componentsCssRel = raw.componentsCssRel;
  }
  if (Array.isArray(raw.canvasGroups)) {
    out.canvasGroups = raw.canvasGroups
      .filter((g) => g && typeof g === 'object' && label(g.label) && containedRel(g.path))
      .slice(0, 32)
      .map((g) => ({ label: g.label, path: g.path.replace(/\/+$/, '') }));
    if (out.canvasGroups.length === 0) delete out.canvasGroups;
  }
  if (Array.isArray(raw.designSystems)) {
    out.designSystems = raw.designSystems
      .filter((d) => d && typeof d.name === 'string' && /^[\w .-]{1,64}$/.test(d.name))
      .filter((d) => containedRel(d.path))
      .filter((d) => d.tokensCssRel == null || containedRel(d.tokensCssRel))
      .slice(0, 16)
      .map((d) => ({
        name: d.name,
        path: d.path.replace(/\/+$/, ''),
        ...(typeof d.tokensCssRel === 'string' ? { tokensCssRel: d.tokensCssRel } : {}),
      }));
  }
  if (
    typeof raw.defaultDesignSystem === 'string' &&
    /^[\w .-]{1,64}$/.test(raw.defaultDesignSystem) &&
    (out.designSystems ?? []).some((d) => d.name === raw.defaultDesignSystem)
  ) {
    out.defaultDesignSystem = raw.defaultDesignSystem;
  }
  return Object.keys(out).length > 0 ? out : null;
}

/** The subset as it stands in `config.json` now (`null` when unreadable). */
export function currentProjectConfigSubset(designRoot) {
  try {
    return sanitizeProjectConfigSubset(
      JSON.parse(readFileSync(join(designRoot, 'config.json'), 'utf8'))
    );
  } catch {
    return null;
  }
}

function respond(response, status, payload) {
  const body = JSON.stringify(typeof payload === 'string' ? { error: payload } : payload);
  response
    .writeHead(status, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'Content-Length': Buffer.byteLength(body),
      'X-Content-Type-Options': 'nosniff',
    })
    .end(body);
}

async function readBody(request, max) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > max) return null;
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * Handle `PUT /api/project-config`. Returns `false` for any other path.
 *
 * @param {object} ctx
 * @param {import('node:http').IncomingMessage} ctx.request
 * @param {import('node:http').ServerResponse} ctx.response
 * @param {string} ctx.pathname
 * @param {string} ctx.method
 * @param {string} ctx.dataDir
 * @param {string} ctx.secret
 * @param {string|null} ctx.designRoot
 * @param {(req: unknown) => boolean} [ctx.checkRateLimit]
 * @param {() => void} [ctx.onChanged]  told after config.json was rewritten
 */
export async function handleProjectConfigDoor(ctx) {
  const { request, response, pathname, method, dataDir, secret } = ctx;
  if (pathname !== PROJECT_CONFIG_PATH) return false;
  if (method !== 'PUT') {
    respond(response, 405, 'method not allowed');
    return true;
  }
  const auth = request.headers?.authorization;
  const token = typeof auth === 'string' ? auth.replace(/^Bearer\s+/i, '').trim() : '';
  const match = token ? verifyToken(dataDir, token, secret) : null;
  if (!match) {
    if (ctx.checkRateLimit && !ctx.checkRateLimit(request)) {
      respond(response, 429, 'too many requests');
      return true;
    }
    respond(response, 401, 'unauthorized');
    return true;
  }
  // The same bar as a code module at the file door — and project-wide: a
  // token scoped to one canvas does not get to rename the project.
  if (match.readOnly || match.role !== 'owner' || (match.scope && match.scope !== '*')) {
    respond(response, 403, 'only the project owner can set the project config');
    return true;
  }
  if (!ctx.designRoot || !existsSync(ctx.designRoot)) {
    respond(response, 405, 'this hub has no project to configure');
    return true;
  }

  const text = await readBody(request, MAX_BODY_BYTES);
  if (text === null) {
    respond(response, 413, 'too large');
    return true;
  }
  let subset;
  try {
    subset = sanitizeProjectConfigSubset(JSON.parse(text));
  } catch {
    subset = null;
  }
  if (!subset) {
    respond(response, 400, 'nothing usable in that project config');
    return true;
  }

  const file = join(ctx.designRoot, 'config.json');
  let existing = {};
  if (existsSync(file)) {
    try {
      const parsed = JSON.parse(readFileSync(file, 'utf8'));
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) existing = parsed;
    } catch {
      // An unparseable config is replaced by one that parses — it was not
      // being read as anything but defaults anyway.
    }
  }
  const next = { ...existing, ...subset };
  const before = JSON.stringify(existing);
  if (JSON.stringify(next) === before) {
    respond(response, 200, { ok: true, changed: false, config: subset });
    return true;
  }
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`);
  renameSync(tmp, file);
  ctx.onChanged?.();
  respond(response, 200, { ok: true, changed: true, config: subset });
  return true;
}
