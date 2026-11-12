// generation/keys.ts — BYOK provider-key custody for AI media generation (DDR-16x).
//
// Keys live OUTSIDE the served `.design/` tree so a canvas file-route can never
// read them: `~/.config/maude/keys.json`, mode 0600 (XDG-aware, same location
// discipline as sync/hubs-config.ts's hubs.json). A provider key is resolved at
// REQUEST TIME and NEVER cached, logged, or returned to the canvas realm — the
// exact template is github/token.ts (fetch-at-request-time, null when absent).
//
// Native tier (Phase 5.1, DDR-16x): when the Tauri keychain bridge env is
// present (`MAUDE_GEN_KEY_ENDPOINT`/`_KEY`, mirroring MAUDE_TOKEN_ENDPOINT for
// GitHub), `getProviderKey` prefers the keychain over the file. The bridge is
// not wired in Phase 0 — the hook is here so `keys.ts` never has to change when
// the native keychain lands; the file store is the whole Phase-0 custody.
//
// The Settings panel POSTs a key to a PRIVILEGED main-origin route which calls
// `setProviderKey`; that route NEVER echoes a key back (it returns
// `{ configured: true }`, mirroring `github_is_signed_in`). `isConfigured` backs
// the GET status probe — it reveals only presence, never the value.

import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { homedir, platform } from 'node:os';
import { dirname, join } from 'node:path';

/** Slug-shaped provider id — the JSON key + keychain lookup. Never a path. */
const PROVIDER_ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** Resolve the on-disk path to keys.json (mirrors hubs-config.ts's XDG logic). */
export function keysConfigPath(): string {
  if (process.env.MAUDE_GEN_KEYS_PATH) return process.env.MAUDE_GEN_KEYS_PATH;
  const xdg = process.env.XDG_CONFIG_HOME;
  const base = xdg && xdg.length > 0 ? xdg : join(homedir(), '.config');
  return join(base, 'maude', 'keys.json');
}

interface KeysFile {
  keys: Record<string, string>;
  /**
   * B7 (DDR-252) — the LEGACY chat scope, before keys were per profile: one key per ACP agent id.
   * Read as the `default` profile's only (security review 2026-11-12, M3); the first chat-key write
   * moves it into `chatByProfile.default`.
   */
  chat?: Record<string, string>;
  /** The chat scope per profile: profile id → agent id (`codex`, `gemini`, …) → key, never Claude's. */
  chatByProfile?: Record<string, Record<string, string>>;
  /**
   * B7 — Claude's Anthropic key, per profile (DDR-252 amends DDR-123): present only after the
   * person turned on "Use an Anthropic API key for Claude" for that profile. `optIn` must be true.
   */
  claudeApiKey?: Record<string, { key: string; optIn: true; at: number }>;
}

let _modeWarnedFor: string | null = null;
function warnIfWorldOrGroupReadable(path: string): void {
  if (platform() === 'win32') return; // POSIX-mode semantics don't apply
  if (_modeWarnedFor === path) return;
  try {
    const mode = statSync(path).mode & 0o777;
    if ((mode & 0o077) !== 0) {
      console.warn(
        `[generation] ${path} is mode ${mode.toString(8)} — recommend 'chmod 600 ${path}' (only owner can read provider keys).`
      );
      _modeWarnedFor = path;
    }
  } catch {
    /* raced with a delete — next read retries */
  }
}

function readKeysFile(): KeysFile {
  const path = keysConfigPath();
  if (!existsSync(path)) return { keys: {} };
  warnIfWorldOrGroupReadable(path);
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    if (!parsed || typeof parsed.keys !== 'object' || parsed.keys === null) return { keys: {} };
    return parsed as KeysFile;
  } catch {
    return { keys: {} };
  }
}

/**
 * Write keys.json atomically with a hard 0600 mode: a 0600 temp file beside it, then rename (B7 —
 * the file now holds chat keys too, so a torn write must never leave a half file or a wider mode).
 */
function writeKeysFile(data: KeysFile): void {
  const path = keysConfigPath();
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  try {
    // `wx`: never through a planted file. writeFileSync's mode is masked by umask, so chmod 0600
    // explicitly before the rename (same guarantee cli/lib/hubs-config.mjs makes).
    writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
    if (platform() !== 'win32') chmodSync(tmp, 0o600);
    renameSync(tmp, path);
  } catch (err) {
    rmSync(tmp, { force: true });
    throw err;
  }
}

/** Whether the native keychain bridge is configured (Phase 5.1 / DDR-16x). */
function keychainBridgeAvailable(): boolean {
  return Boolean(process.env.MAUDE_GEN_KEY_ENDPOINT && process.env.MAUDE_GEN_KEY_KEY);
}

/** Fetch a key from the Tauri keychain bridge over loopback (Phase 5.1). */
async function getKeyFromBridge(providerId: string): Promise<string | null> {
  const endpoint = process.env.MAUDE_GEN_KEY_ENDPOINT;
  const key = process.env.MAUDE_GEN_KEY_KEY;
  if (!endpoint || !key) return null;
  try {
    const res = await fetch(`${endpoint}?provider=${encodeURIComponent(providerId)}`, {
      headers: { 'X-Maude-Token-Key': key },
      signal: AbortSignal.timeout(3000),
    });
    if (res.status !== 200) return null; // 404 = not set; 403 = bad key
    const token = (await res.text()).trim();
    return token.length > 0 ? token : null;
  } catch {
    return null;
  }
}

/**
 * Resolve a provider's API key at request time. Prefers the native keychain
 * bridge when present, otherwise the 0600 file. Returns null when unset (the
 * caller degrades to "add a key in Settings"). NEVER cache the result — a key
 * can be rotated in Settings and the store is the single source of truth.
 */
export async function getProviderKey(providerId: string): Promise<string | null> {
  if (!PROVIDER_ID_RE.test(providerId)) return null;
  if (keychainBridgeAvailable()) {
    const fromBridge = await getKeyFromBridge(providerId);
    if (fromBridge) return fromBridge;
    // Fall through to the file store even under the bridge, so a key added via
    // the browser Settings panel still resolves in the native app.
  }
  const key = readKeysFile().keys[providerId];
  return typeof key === 'string' && key.length > 0 ? key : null;
}

/** Persist a provider key to the 0600 file store (Settings panel write path). */
export function setProviderKey(providerId: string, value: string): void {
  if (!PROVIDER_ID_RE.test(providerId)) throw new Error('invalid provider id');
  const trimmed = value.trim();
  if (!trimmed) throw new Error('empty key');
  const file = readKeysFile();
  file.keys[providerId] = trimmed;
  writeKeysFile(file);
}

/** Remove a provider key (Settings "remove key"). No-op when absent. */
export function deleteProviderKey(providerId: string): void {
  if (!PROVIDER_ID_RE.test(providerId)) return;
  const file = readKeysFile();
  if (providerId in file.keys) {
    delete file.keys[providerId];
    writeKeysFile(file);
  }
}

/**
 * Presence-only check for the status GET. Reveals whether a key exists (file or
 * bridge) — NEVER the value. Synchronous file check + a cheap bridge-present
 * signal (the bridge itself is only queried at real request time).
 */
export function isConfigured(providerId: string): boolean {
  if (!PROVIDER_ID_RE.test(providerId)) return false;
  const key = readKeysFile().keys[providerId];
  return typeof key === 'string' && key.length > 0;
}

/** The set of provider ids that currently have a key configured (file store). */
export function configuredProviders(): string[] {
  return Object.entries(readKeysFile().keys)
    .filter(([, v]) => typeof v === 'string' && v.length > 0)
    .map(([id]) => id);
}

// ---------------------------------------------------------------- chat scope (B7, DDR-252)
//
// One key per ACP agent, injected by acp/agents/chat-key.ts into THAT agent's env only (after the
// shared scrub, spawn.ts). Nothing here hands a key to a route: routes read `chatKeyStatus` —
// presence and the last four characters — and only the spawn path reads the value (`getChatKey`).

/** An agent id a chat key may be stored under: a catalog slug. `claude` has its own slot below. */
const CHAT_AGENT_ID_RE = /^[a-z][a-z0-9-]{0,31}$/;
/** sidecar::profile_env's id shape (profiles.rs); anything else is the default profile. */
const PROFILE_ID_RE = /^[a-z0-9-]{1,32}$/;

/** A key as typed: trimmed, non-empty, at most 512 characters, no whitespace or control chars. */
export function normalizeChatKey(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const key = value.trim();
  if (key.length === 0 || key.length > 512) return null;
  if (/[\s\p{Cc}]/u.test(key)) return null;
  return key;
}

function chatAgentId(agentId: string): string {
  if (agentId === 'claude' || !CHAT_AGENT_ID_RE.test(agentId)) throw new Error('invalid agent id');
  return agentId;
}

/** The profile this server runs as — the server learns it only from env (`sidecar::profile_env`). */
export function currentProfileId(env: Record<string, string | undefined> = process.env): string {
  const id = env.MAUDE_PROFILE_ID;
  return id && PROFILE_ID_RE.test(id) ? id : 'default';
}

export interface ChatKeyStatus {
  set: boolean;
  /** The last four characters, only when set (Settings shows ••••last4). */
  last4: string | null;
}

const statusOf = (key: string | null | undefined): ChatKeyStatus =>
  typeof key === 'string' && key.length > 0
    ? { set: true, last4: key.slice(-4) }
    : { set: false, last4: null };

/**
 * Security review 2026-11-12 (defender M3) — chat keys are per profile, like Claude's opt-in key:
 * a work profile's chat never runs on the personal profile's key. The pre-profile `chat` map is the
 * `default` profile's (the legacy install IS the default profile, profiles.rs) and no other's.
 */
function chatKeysOf(file: KeysFile, profileId: string): Record<string, string> {
  const legacy = profileId === 'default' ? (file.chat ?? {}) : {};
  return { ...legacy, ...(file.chatByProfile?.[profileId] ?? {}) };
}

/** Move the legacy `chat` map into `chatByProfile.default` (before any chat-key write). */
function migrateLegacyChat(file: KeysFile): void {
  if (!file.chat) return;
  const byProfile = { ...(file.chatByProfile ?? {}) };
  byProfile.default = { ...file.chat, ...(byProfile.default ?? {}) };
  file.chatByProfile = byProfile;
  delete file.chat;
}

/** Store an agent's chat key for this profile (Settings › AI agents). Throws on a bad id or key. */
export function setChatKey(
  agentId: string,
  value: unknown,
  profileId: string = currentProfileId()
): ChatKeyStatus {
  const id = chatAgentId(agentId);
  const key = normalizeChatKey(value);
  if (!key) throw new Error('invalid key');
  if (!PROFILE_ID_RE.test(profileId)) throw new Error('invalid profile');
  const file = readKeysFile();
  migrateLegacyChat(file);
  file.chatByProfile = {
    ...(file.chatByProfile ?? {}),
    [profileId]: { ...(file.chatByProfile?.[profileId] ?? {}), [id]: key },
  };
  writeKeysFile(file);
  return statusOf(key);
}

/** Remove this profile's chat key for an agent. No-op when absent. */
export function clearChatKey(agentId: string, profileId: string = currentProfileId()): void {
  const id = chatAgentId(agentId);
  const file = readKeysFile();
  if (!(id in chatKeysOf(file, profileId))) return;
  migrateLegacyChat(file);
  const mine = file.chatByProfile?.[profileId];
  if (mine && id in mine) delete mine[id];
  writeKeysFile(file);
}

/** Presence + last four characters — never the key. Claude's reads this profile's opt-in slot. */
export function chatKeyStatus(agentId: string): ChatKeyStatus {
  if (agentId === 'claude') return claudeApiKeyStatus();
  if (!CHAT_AGENT_ID_RE.test(agentId)) return statusOf(null);
  return statusOf(normalizeChatKey(chatKeysOf(readKeysFile(), currentProfileId())[agentId]));
}

export function hasChatKey(agentId: string): boolean {
  return chatKeyStatus(agentId).set;
}

/**
 * The key itself — for the spawn path ONLY (acp/agents/chat-key.ts), into the owning agent's env.
 * Never returned by a route. Claude's answers only when this profile opted in.
 */
export function getChatKey(agentId: string): string | null {
  if (agentId === 'claude') return claudeApiKeyFor(currentProfileId());
  if (!CHAT_AGENT_ID_RE.test(agentId)) return null;
  return normalizeChatKey(chatKeysOf(readKeysFile(), currentProfileId())[agentId]);
}

/**
 * Turn on "Use an Anthropic API key for Claude instead of your Claude account" for this profile
 * (DDR-252 amends DDR-123). `optIn` must be literally `true`: the confirm card is the person's
 * choice, and nothing stores a Claude key without it.
 */
export function setClaudeApiKey(
  value: unknown,
  optIn: unknown,
  profileId: string = currentProfileId()
): ChatKeyStatus {
  if (optIn !== true) throw new Error('opt-in required');
  if (!PROFILE_ID_RE.test(profileId)) throw new Error('invalid profile');
  const key = normalizeChatKey(value);
  if (!key) throw new Error('invalid key');
  const file = readKeysFile();
  file.claudeApiKey = {
    ...(file.claudeApiKey ?? {}),
    [profileId]: { key, optIn: true, at: Date.now() },
  };
  writeKeysFile(file);
  return statusOf(key);
}

/** Turn the opt-in off for this profile: the key goes with it and Claude is back on the account. */
export function clearClaudeApiKey(profileId: string = currentProfileId()): void {
  const file = readKeysFile();
  if (file.claudeApiKey && profileId in file.claudeApiKey) {
    delete file.claudeApiKey[profileId];
    writeKeysFile(file);
  }
}

function claudeApiKeyFor(profileId: string): string | null {
  const rec = readKeysFile().claudeApiKey?.[profileId];
  if (!rec || typeof rec !== 'object' || rec.optIn !== true) return null;
  return normalizeChatKey(rec.key);
}

export function claudeApiKeyStatus(profileId: string = currentProfileId()): ChatKeyStatus {
  return statusOf(claudeApiKeyFor(profileId));
}

/** Whether this profile turned the Claude API-key opt-in on (with a key stored). */
export function claudeApiKeyOptedIn(profileId: string = currentProfileId()): boolean {
  return claudeApiKeyFor(profileId) !== null;
}
