// RETURN_RULES twin: apps/studio/client/share-link.js (normalizeReturnAddress).
// Only a shell file address is allowed, never an arbitrary redirect destination:
// `/?open=<rel>`, or — S3.7b, the presentation link's sign-in — exactly
// `/?open=<rel>&present=follow` (that one param, that one value, in that order).
export const RETURN_COOKIE = 'maude_return';
/** The one suffix a return address may carry (S3.7b). */
export const FOLLOW_SUFFIX = '&present=follow';
// A UTF-16 code unit needs at most nine characters after UTF-8 percent encoding.
const MAX_ADDRESS_LENGTH = '/?open='.length + 512 * 9 + FOLLOW_SUFFIX.length;
/** The follow form rides the cookie as this prefix (outside the base64url alphabet). */
const FOLLOW_COOKIE_PREFIX = 'f.';

export function validateReturnTo(value) {
  if (typeof value !== 'string' || value.length > MAX_ADDRESS_LENGTH) return null;
  const match = /^\/\?open=([^&#]+)(&present=follow)?$/.exec(value);
  if (!match) return null;
  let rel;
  try {
    rel = decodeURIComponent(match[1].replace(/\+/g, ' '));
  } catch {
    return null;
  }
  if (!rel || rel.length > 512 || /^[a-z]:/i.test(rel) || rel.includes('\\')) return null;
  if ([...rel].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)) return null;
  if (rel.startsWith('.design/')) rel = rel.slice(8);
  if (rel.split('/').some((s) => !s || s === '.' || s === '..')) return null;
  const canonical = `/?open=${rel.split('/').map(encodeURIComponent).join('/')}`;
  return match[2] ? `${canonical}${FOLLOW_SUFFIX}` : canonical;
}

function appendCookie(response, value) {
  const existing = response.getHeader('set-cookie');
  response.setHeader('set-cookie', [
    ...(Array.isArray(existing) ? existing : existing ? [existing] : []),
    value,
  ]);
}

export function setReturnTo(response, value) {
  const valid = validateReturnTo(value);
  if (!valid) return;
  // Store the decoded identity as base64url: <=2048 bytes even for 512 CJK
  // characters, comfortably inside the browser's cookie size limit.
  const follow = valid.endsWith(FOLLOW_SUFFIX);
  const address = follow ? valid.slice(0, -FOLLOW_SUFFIX.length) : valid;
  const identity = decodeURIComponent(address.slice('/?open='.length));
  const encoded = `${follow ? FOLLOW_COOKIE_PREFIX : ''}${Buffer.from(identity, 'utf8').toString('base64url')}`;
  appendCookie(
    response,
    `${RETURN_COOKIE}=${encoded}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`
  );
}

/** Called only at the unauthenticated studio door. API calls never set cookies. */
export function rememberReturnTo(request, response, pathname) {
  if (
    request.method !== 'GET' ||
    pathname !== '/' ||
    !(request.headers?.accept ?? '').includes('text/html')
  )
    return;
  const url = new URL(request.url, 'http://cell.invalid');
  setReturnTo(response, `${url.pathname}${url.search}`);
}

export function takeReturnTo(request, response) {
  const values = String(request.headers?.cookie ?? '')
    .split(';')
    .map((v) => v.trim())
    .filter((v) => v.startsWith(`${RETURN_COOKIE}=`));
  let target = null;
  if (values.length === 1) {
    try {
      const raw = values[0].slice(RETURN_COOKIE.length + 1);
      const follow = raw.startsWith(FOLLOW_COOKIE_PREFIX);
      const encoded = follow ? raw.slice(FOLLOW_COOKIE_PREFIX.length) : raw;
      if (/^[A-Za-z0-9_-]{1,2048}$/.test(encoded)) {
        const identity = Buffer.from(encoded, 'base64url').toString('utf8');
        if (Buffer.from(identity, 'utf8').toString('base64url') === encoded) {
          target = validateReturnTo(
            `/?open=${identity.split('/').map(encodeURIComponent).join('/')}${follow ? FOLLOW_SUFFIX : ''}`
          );
        }
      }
    } catch {
      /* malformed cookie */
    }
  }
  appendCookie(response, `${RETURN_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`);
  return target ?? '/';
}
