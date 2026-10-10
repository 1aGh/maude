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
// THE CHECKOUT IS TENANT-CONTROLLED (DDR-054). A peer with push access can
// commit `config.json` as a symlink — to `/data/admin.json`, say — or plant a
// link at a predictable temp name next to it. So this door never follows one:
// a `config.json` that is not a plain, singly-linked file is refused, the read
// opens with O_NOFOLLOW, and the new file is written to a RANDOM temp name
// with O_EXCL (which refuses an existing path, link or not) and renamed over
// the entry — rename replaces a link, it never writes through it.
//
// `canvasGroups` IS A PRIVILEGE BOUNDARY. Inside a group a `.tsx` is a canvas
// any editor may write; outside one it is an owner-only code module. That is
// why only the owner may set it — the same person who may write code modules.
//
// WHAT IT MAY CHANGE (security review F1). `canvasGroups` feeds the hub's own
// classifier — the code-module gate, journal replay, the media listing — so it
// is only ever FILLED when absent, never changed: two owners' desktops must not
// flip the project's classification back and forth on every reconnect. The
// display keys (name, label, tokens path, design systems) are overwritten
// only in a config.json this door itself created (recorded in the hub's data
// dir, outside the tenant's reach); a git-seeded, tenant-versioned config is
// only ever filled in. Keys this door knows nothing about are never touched.

import { randomBytes } from 'node:crypto';
import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

import { normalizeGroup } from './file-membership.mjs';
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

// P-5 (V2-1.13 §5.12): a system's design-system schema fields. `rootClass` and theme names land
// in CSS selectors (`.<rootClass>[data-theme="<t>"]`) and in an inline <style>, so they keep to
// the class charset; `schema` is the one version that exists. FILLED, NEVER CHANGED (see the merge).
const CLASS_NAME = /^[a-z][a-z0-9-]{0,63}$/;
const SCHEMA_FIELDS = ['schema', 'rootClass', 'themes', 'themeDefault'];
function schemaFields(d) {
  const out = {};
  if (d.schema === 1) out.schema = 1;
  if (typeof d.rootClass === 'string' && CLASS_NAME.test(d.rootClass)) out.rootClass = d.rootClass;
  if (Array.isArray(d.themes)) {
    const themes = [
      ...new Set(d.themes.filter((x) => typeof x === 'string' && CLASS_NAME.test(x))),
    ].slice(0, 8);
    if (themes.length) out.themes = themes;
  }
  if (
    typeof d.themeDefault === 'string' &&
    CLASS_NAME.test(d.themeDefault) &&
    (!out.themes || out.themes.includes(d.themeDefault))
  ) {
    out.themeDefault = d.themeDefault;
  }
  return out;
}

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
      // The HUB'S OWN group rule, not a looser one: a path the classifier
      // would drop (`.`, `web.v2`) would make the studio and the hub disagree
      // about what is a canvas — the two-lanes bug class (review F2).
      .filter(
        (g) => g && typeof g === 'object' && label(g.label) && normalizeGroup(g.path) === g.path
      )
      .slice(0, 32)
      .map((g) => ({ label: g.label, path: g.path }));
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
        ...schemaFields(d),
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

/**
 * A door-created config's systems follow the owner, but a schema field a system already has is
 * never changed (P-5): `schema` gates the critic's blockers and `rootClass` / `themes` decide what
 * a canvas wrapper matches, so two owners' desktops must not flip them on every reconnect.
 */
function keepSchemaFields(before, after) {
  const prev = new Map(
    (Array.isArray(before) ? before : [])
      .filter((d) => d && typeof d === 'object' && typeof d.name === 'string')
      .map((d) => [d.name, d])
  );
  return after.map((d) => {
    const old = prev.get(d.name);
    if (!old) return d;
    const kept = schemaFields(old);
    for (const f of SCHEMA_FIELDS) if (f in kept) d = { ...d, [f]: kept[f] };
    return d;
  });
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

/** The hub-side record that this door CREATED the checkout's config.json. */
const OWNED_MARKER = 'project-config-created.json';
function doorOwnsConfig(dataDir) {
  if (!dataDir) return false;
  try {
    return JSON.parse(readFileSync(join(dataDir, OWNED_MARKER), 'utf8'))?.createdByDoor === true;
  } catch {
    return false;
  }
}
function markDoorOwnsConfig(dataDir) {
  if (!dataDir) return;
  try {
    writeFileSync(
      join(dataDir, OWNED_MARKER),
      `${JSON.stringify({ createdByDoor: true, at: Date.now() })}\n`
    );
  } catch {
    /* without the marker the next push only fills in — the safe direction */
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
 * @param {(label: string) => boolean} [ctx.checkWriteRateLimit]
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

  if (ctx.checkWriteRateLimit && !ctx.checkWriteRateLimit(match.label)) {
    respond(response, 429, 'too many writes');
    return true;
  }

  let root;
  try {
    root = realpathSync(ctx.designRoot);
  } catch {
    respond(response, 405, 'this hub has no project to configure');
    return true;
  }
  const file = join(root, 'config.json');
  let existing = {};
  let present = false;
  try {
    const st = lstatSync(file);
    present = true;
    if (!st.isFile() || st.nlink > 1) {
      respond(response, 409, 'config.json is not a plain file here — fix it in the repository');
      return true;
    }
  } catch (err) {
    if (err?.code !== 'ENOENT') {
      respond(response, 500, 'could not read the project config');
      return true;
    }
  }
  if (present) {
    let fd = -1;
    try {
      fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
      if (!fstatSync(fd).isFile()) throw new Error('not a file');
      const parsed = JSON.parse(readFileSync(fd, 'utf8'));
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) existing = parsed;
    } catch {
      // An unparseable config is replaced by one that parses — it was not
      // being read as anything but defaults anyway. A link swapped in after
      // the lstat fails O_NOFOLLOW and lands here too: nothing was read.
    } finally {
      if (fd >= 0) closeSync(fd);
    }
  }
  const ours = present && doorOwnsConfig(ctx.dataDir);
  const next = { ...existing };
  for (const [k, v] of Object.entries(subset)) {
    if (!(k in existing)) next[k] = v;
    else if (ours && k === 'designSystems') next[k] = keepSchemaFields(existing[k], v);
    else if (ours && k !== 'canvasGroups') next[k] = v;
  }
  const before = JSON.stringify(existing);
  if (JSON.stringify(next) === before) {
    respond(response, 200, { ok: true, changed: false, config: subset });
    return true;
  }
  const tmp = join(root, `.config.json.${randomBytes(12).toString('hex')}.tmp`);
  try {
    writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`, { flag: 'wx', mode: 0o644 });
    renameSync(tmp, file);
    if (!present) markDoorOwnsConfig(ctx.dataDir);
  } catch {
    try {
      unlinkSync(tmp);
    } catch {
      /* never created, or already renamed */
    }
    respond(response, 500, 'could not write the project config');
    return true;
  }
  ctx.onChanged?.();
  respond(response, 200, { ok: true, changed: true, config: subset });
  return true;
}
