// Which account profile this server runs as — V2-3.4 (old T9), `/_config.profile`.
//
// A profile is chosen by the desktop shell, per project, and handed to the spawned server as
// env: `MAUDE_PROFILE_ID` (+ `MAUDE_PROFILE_LABEL` for the chip). The server never picks one
// and never reads `profiles.json`; the files a profile owns are already routed by
// `MAUDE_CLOUD_CONFIG` / `HUBS_CONFIG_PATH` (cloud/config-path.ts, sync/hubs-config.ts). This
// module only says WHICH, so the client can show it.
//
// `/_config` reaches the browser (and, in cloud mode, a cell's members), so both values are
// treated as untrusted display input: the id must be `[a-z0-9-]{1,32}` (the charset the shell
// uses for `profiles/<id>/`) or it becomes `default` with one warning; the label loses control
// and bidi-override characters and is capped at 64 characters. Absent env ⇒ `{ id: 'default' }`
// — every cell, every plain `maude design serve`, every install from before profiles.

export interface ProfileInfo {
  id: string;
  label?: string;
}

export const PROFILE_ID_RE = /^[a-z0-9-]{1,32}$/;
export const PROFILE_LABEL_MAX = 64;
// C0 + DEL + C1 controls, and the bidi embedding/override/isolate controls (a label that
// reorders the chip's text is a spoof, not a name).
// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping them is the point
const STRIP_RE = /[\u0000-\u001f\u007f-\u009f‎‏‪-‮⁦-⁩]/g;

let warnedFor: string | null = null;

/** Clean a display label: no controls, trimmed, ≤ 64 code points. Empty ⇒ undefined. */
export function sanitizeProfileLabel(raw: string | undefined): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const cleaned = Array.from(raw.replace(STRIP_RE, '').trim())
    .slice(0, PROFILE_LABEL_MAX)
    .join('')
    .trim();
  return cleaned.length ? cleaned : undefined;
}

/** The profile this process runs as, from its env. Read per call (env is set at spawn). */
export function resolveProfile(
  env: Record<string, string | undefined> = process.env,
  warn: (msg: string) => void = (m) => console.warn(m)
): ProfileInfo {
  const rawId = env.MAUDE_PROFILE_ID;
  let id = 'default';
  let invalid = false;
  if (rawId !== undefined && rawId !== '') {
    if (PROFILE_ID_RE.test(rawId)) id = rawId;
    else {
      invalid = true;
      if (warnedFor !== rawId) {
        warnedFor = rawId;
        // The value itself is not echoed: it came from the environment and may be anything.
        warn('[maude] MAUDE_PROFILE_ID is not [a-z0-9-]{1,32}; running as profile "default".');
      }
    }
  }
  // A label names the profile the id named; when that id was refused, it names nothing here.
  const label = invalid ? undefined : sanitizeProfileLabel(env.MAUDE_PROFILE_LABEL);
  return label ? { id, label } : { id };
}
