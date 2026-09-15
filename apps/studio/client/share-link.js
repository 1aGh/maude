// Shell addresses use the same design-root-relative file identity as canvas URLs.
// RETURN_RULES twin: apps/hub/src/return-to.mjs; native: project_resolve.rs.
const PROJECT_RE = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;

/** Validate an already decoded file identity. Never decode a filesystem path. */
export function normalizeOpenPath(raw, designRel = '.design') {
  if (typeof raw !== 'string' || !raw || raw.length > 512) return null;
  if (/^[a-z]:/i.test(raw) || raw.includes('\\')) return null;
  if ([...raw].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)) return null;
  const prefix = `${designRel.replace(/^\.\//, '').replace(/\/$/, '')}/`;
  const rel = raw.startsWith(prefix) ? raw.slice(prefix.length) : raw;
  return rel.split('/').some((s) => s === '' || s === '.' || s === '..') ? null : rel;
}

/** Decode a URL value exactly once, then validate. */
export function normalizeOpenParam(raw, designRel = '.design') {
  if (typeof raw !== 'string') return null;
  try {
    return normalizeOpenPath(decodeURIComponent(raw), designRel);
  } catch {
    return null;
  }
}

export function readOpenParam(location, designRel = '.design') {
  const values = new URLSearchParams(location.search).getAll('open');
  // URLSearchParams already decoded the value; a second decode changes filenames.
  return values.length === 1 ? normalizeOpenPath(values[0], designRel) : null;
}

export const encodeOpenPath = (rel) => rel.split('/').map(encodeURIComponent).join('/');

export function withOpenParam(location, rel) {
  const path = normalizeOpenPath(rel);
  return path ? `?open=${encodeOpenPath(path)}` : location.pathname;
}

function httpUrl(raw) {
  try {
    const u = new URL(raw);
    return /^https?:$/.test(u.protocol) && !u.username && !u.password ? u : null;
  } catch {
    return null;
  }
}

export function projectIdFromHubUrl(raw) {
  const host = httpUrl(raw)?.hostname;
  if (!host || host.includes(':') || /^[\d.]+$/.test(host) || host.endsWith('.localhost')) return null;
  const labels = host.split('.');
  return labels.length >= 3 && PROJECT_RE.test(labels[0]) ? labels[0] : null;
}

export function projectSlug(name) {
  const slug = String(name ?? '').split('/').pop().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40).replace(/-$/, '');
  return PROJECT_RE.test(slug) ? slug : null;
}

/** A configured hub identity takes precedence over the folder's fallback name. */
export function localIdentityMatches(local, project) {
  const linked = projectIdFromHubUrl(local.linkedHub?.url);
  return linked ? linked === project : projectSlug(local.project) === project;
}

export function buildShareLinks({ rel, shell, location, linkedHubUrl, project, localUrl }) {
  const path = normalizeOpenPath(rel);
  const result = { web: null, app: null, local: null, projectLabel: project ?? '', appIsLocalOnly: false };
  if (!path) return result;
  const query = `?open=${encodeOpenPath(path)}`;
  const publicUrl = (value) => {
    const url = httpUrl(value);
    return url && !/^(localhost|127\.[\d.]+|\[::1\])$/.test(url.hostname) && !url.hostname.endsWith('.localhost') ? url : null;
  };
  const hub = publicUrl(linkedHubUrl);
  const cloud = shell === 'cloud' ? publicUrl(location?.origin) : null;
  const publicId = projectIdFromHubUrl(cloud?.origin ?? hub?.origin);
  const id = publicId ?? projectSlug(project);
  result.projectLabel = id ?? project ?? '';
  result.web = cloud ? `${cloud.origin}${location.pathname}${query}` : hub ? `${hub.origin}/${query}` : null;
  result.app = id ? `maude://open/${id}${query}` : null;
  result.appIsLocalOnly = !!id && !publicId;
  const local = shell !== 'cloud' && httpUrl(localUrl);
  result.local = local ? `${local.origin}/${query}` : null;
  return result;
}

export function parseFileDeepLink(raw) {
  const m = /^maude:\/\/open\/([a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?)\/?\?([^#]*)$/.exec(String(raw ?? ''));
  if (!m) return null;
  const params = new URLSearchParams(m[2]);
  if ([...params.keys()].some((key) => key !== 'open')) return null;
  const rel = readOpenParam({ search: m[2] });
  return rel ? { project: m[1], rel } : null;
}
