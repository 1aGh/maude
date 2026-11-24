// Hub operator settings — the editable identity bits the admin console exposes
// (hub name + description). Persisted to settings.json beside admin.json with
// the same atomic-write + 0600 discipline (DDR-053). Everything else the
// Settings surface shows (public URL, transport, storage, version, uptime) is
// READ from the existing /identity + /status payloads — not stored here.
//
// settings.json layout:
//   { "name": "Studio Hub", "description": "", "whoCanJoin": "ask", "updatedAt": 1716800000000 }
//
// `whoCanJoin` — what happens to someone who signs in through the identity
// provider WITHOUT an invitation (an invitation always lets its person in):
//   'invite-only'  turned away; nothing is queued
//   'ask'          queued under "Asks to join" for an admin to let in (the
//                  default, and what every hub did before this setting existed)
//   'domain'       a verified address from HUB_OIDC_ALLOWED_DOMAINS becomes a
//                  member account at once
// A hub has two account roles, admin and member (users.mjs). There is no
// view-only or comment-only ACCOUNT, so 'domain' admits as member ("Can edit")
// — the lowest account role there is. It never admits an admin.

import {
  chmodSync,
  existsSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

export const DEFAULT_HUB_NAME = 'Studio Hub';
export const JOIN_POLICIES = Object.freeze(['invite-only', 'ask', 'domain']);
export const DEFAULT_JOIN_POLICY = 'ask';
const policyOf = (v) => (JOIN_POLICIES.includes(v) ? v : DEFAULT_JOIN_POLICY);
// Same character class as token labels (DDR-053 §5) — blocks log-forging /
// HTML-metacharacter names from reaching the console chrome.
const NAME_REGEX = /^[A-Za-z0-9 _.-]{1,64}$/;
const DESC_MAX = 120;

export function settingsFilePath(dataDir) {
  return join(dataDir, 'settings.json');
}

/** Read settings, falling back to defaults. Never throws. */
export function readSettings(dataDir) {
  const path = settingsFilePath(dataDir);
  const fallback = { name: DEFAULT_HUB_NAME, description: '', whoCanJoin: DEFAULT_JOIN_POLICY };
  if (!existsSync(path)) return fallback;
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    return {
      name: typeof parsed?.name === 'string' && parsed.name ? parsed.name : DEFAULT_HUB_NAME,
      description: typeof parsed?.description === 'string' ? parsed.description : '',
      // Anything unreadable is the default — never the most open rule.
      whoCanJoin: policyOf(parsed?.whoCanJoin),
    };
  } catch {
    return fallback;
  }
}

/** Strip control chars (CR/LF/etc.) and clamp; defends against log-forging. */
function stripControl(value) {
  let out = '';
  const s = String(value ?? '');
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    if (code >= 0x20 && code !== 0x7f) out += s[i];
  }
  return out;
}

/**
 * Validate + atomically persist settings. Throws on invalid input so the route
 * can surface a 400. `description` is optional; control chars are stripped.
 *
 * @param {string} dataDir
 * `whoCanJoin` is optional: left out, the stored rule is kept (a client that
 * predates it must not reset it by saving the name).
 *
 * @param {{ name?: unknown, description?: unknown, whoCanJoin?: unknown }} input
 * @returns {{ name: string, description: string, whoCanJoin: string }}
 */
export function writeSettings(dataDir, input) {
  const name = String(input?.name ?? '').trim();
  if (!NAME_REGEX.test(name)) {
    throw new Error('invalid hub name (allowed: letters, digits, space, _ . -; 1-64 chars)');
  }
  const before = readSettings(dataDir);
  const description =
    input?.description === undefined
      ? before.description
      : stripControl(input.description).slice(0, DESC_MAX);
  let whoCanJoin = before.whoCanJoin;
  if (input?.whoCanJoin !== undefined && input.whoCanJoin !== null) {
    if (!JOIN_POLICIES.includes(input.whoCanJoin)) {
      throw new Error(`invalid "who can join" rule (one of: ${JOIN_POLICIES.join(', ')})`);
    }
    whoCanJoin = input.whoCanJoin;
  }

  const path = settingsFilePath(dataDir);
  const tmp = `${path}.tmp`;
  const payload = `${JSON.stringify({ name, description, whoCanJoin, updatedAt: Date.now() }, null, 2)}\n`;
  writeFileSync(tmp, payload, { encoding: 'utf8', mode: 0o600 });
  try {
    chmodSync(tmp, 0o600);
  } catch {
    /* Windows / read-only fs — best effort. */
  }
  try {
    renameSync(tmp, path);
  } catch {
    try {
      unlinkSync(path);
    } catch {
      /* ignore */
    }
    renameSync(tmp, path);
  }
  return { name, description, whoCanJoin };
}
