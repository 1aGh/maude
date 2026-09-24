// `maude hub workspace-up` — the pure planning layer. Cloud Phase 4 Task 1.
//
// Everything here is a FUNCTION OF ITS INPUTS: validate a config, render the
// files, decide what verification must pass, produce the operator card. No
// disk, no network, no Docker. The command module (`hub-workspace.mjs`) does
// the effects.
//
// That split is not tidiness. A provisioner's failure modes — a bad domain
// silently rendering a broken Caddyfile, a missing no-expiry policy quietly
// scheduling someone's media for deletion, an "it worked!" printed before
// anything round-tripped — are all decisions, and decisions are testable
// without a VPS. What genuinely needs Docker is then a thin, boring shell.
//
// THE BREAKER TRAP THIS FILE EXISTS TO AVOID: a one-command provisioner that
// prints "done" implies it owns the thing forever. It does not. It scaffolds
// and verifies once. Key rotation, backups, upgrades and the bill stay with
// the operator, and `operatorDuties()` says so on every successful run — a
// promise nobody made is a promise nobody breaks.

const DOMAIN_RE = /^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/;
const BUCKET_RE = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Normalize a backup namespace into a key-safe segment — Phase 0 F3.
 *
 * Deliberately narrow: this becomes an object-key prefix, so anything that
 * could re-enter the keyspace elsewhere (`/`, `..`, whitespace) has to be gone
 * rather than escaped. Mirrors the charset the cell validates its tenant id
 * with, for the same reason.
 */
export function sanitizeBackupPrefix(raw) {
  return String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 64);
}

/**
 * @typedef {object} WorkspaceConfig
 * @property {string} domain          public hostname, e.g. design.acme.com
 * @property {string} acmeEmail       Let's Encrypt contact
 * @property {string} adminEmail      the first user
 * @property {string} [adminPassword] omitted → the caller must supply one
 * @property {object} [s3]            { endpoint, bucket, accessKeyId, secretAccessKey, region }
 * @property {boolean} [devMinio]     run a local MinIO under the dev profile
 * @property {string} [seedRepo]      git URL to seed from; omitted → start fresh
 * @property {string} [imageTag]
 */

/**
 * Validate a workspace config. Returns `{ ok, errors, config }` — a LIST of
 * problems, not the first one: someone filling this in wants to fix everything
 * in one pass, not to play whack-a-mole with a wizard.
 */
/**
 * A seed URL with its credential masked, for anything an eye or a log can see.
 *
 * The recommended seed URL carries a live GitHub PAT in userinfo
 * (`https://x-access-token:<PAT>@github.com/org/repo.git` — `seed-repo.mjs`
 * accepts nothing else). The AWS spike printed it raw, and the token landed in
 * SSM command history, CloudTrail and a session transcript before anyone
 * noticed; it had to be revoked. `.env` is written `0600` — stdout has no such
 * thing, so nothing may print the configured value directly.
 *
 * The host and path survive, because those are what an operator reads the line
 * to confirm.
 */
export function safeSeedUrl(raw) {
  const value = String(raw ?? '').trim();
  if (!value) return null;
  try {
    const u = new URL(value);
    if (u.username || u.password) {
      u.username = '***';
      u.password = '';
    }
    return u.toString();
  } catch {
    // `git@host:org/repo.git` is not a URL but carries no secret; anything
    // else unparseable is not worth guessing at with a token possibly inside.
    return /^git@[^\s:]+:[^\s]+$/.test(value) ? value : '<unparseable seed url>';
  }
}

export function validateWorkspaceConfig(raw = {}) {
  const errors = [];
  const cfg = { ...raw };

  // Local mode serves plain HTTP and never talks to Let's Encrypt, so an ACME
  // contact is meaningless there. Requiring one anyway is how a verification
  // suite ends up needing a purchased domain before it can run even once.
  cfg.local = raw.local === true;

  // feature-cloud-export-render-workers (DDR-230) — the optional maude-render
  // sidecar. Opt-in: it is the one container in the stack that carries a
  // browser, and an operator must mean that. Without it the workspace still
  // works; browser-format exports refuse with a remedy (lane `none`).
  cfg.render = raw.render === true;

  cfg.domain = String(raw.domain ?? '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '');

  // A local workspace defaults to `localhost` and MUST stay a genuine loopback
  // NAME, not merely a name that happens to resolve to 127.0.0.1.
  //
  // The first cut used `ws.127.0.0.1.nip.io` to satisfy the fully-qualified
  // rule. It resolved fine and the whole stack came up — and then the studio's
  // sync agent refused to connect, because its plaintext guard allowlists
  // loopback names literally. That guard is RIGHT: `127.0.0.1.nip.io` is a
  // name somebody else registers and controls, so "it resolves to loopback
  // today" is a promise a third party can withdraw. Pattern-matching an
  // embedded IP would have opened exactly that hole (`127.0.0.1.evil.com`).
  //
  // So the fix belongs here, not in the guard: local mode uses names that ARE
  // loopback by specification — `localhost` and, per RFC 6761, anything under
  // `.localhost`.
  if (cfg.local && !cfg.domain) cfg.domain = 'localhost';

  const isLoopbackName = cfg.domain === 'localhost' || cfg.domain.endsWith('.localhost');
  if (!cfg.domain) errors.push('domain is required (the public hostname, e.g. design.acme.com)');
  else if (cfg.local && isLoopbackName) {
    // `localhost` has no dot, and that is the point — skip the FQDN rule.
  } else if (!DOMAIN_RE.test(cfg.domain))
    errors.push(`domain "${cfg.domain}" is not a valid hostname`);
  else if (!cfg.domain.includes('.')) errors.push('domain must be fully qualified');

  // A name that only LOOKS local is the trap: it passes every check here and
  // then fails at the one place that matters, after the operator has already
  // been told the workspace is up.
  if (cfg.local && !isLoopbackName) {
    errors.push(
      `--local requires a loopback name (localhost or *.localhost); "${cfg.domain}" is not one — ` +
        'a name that merely resolves to 127.0.0.1 is controlled by whoever owns the domain'
    );
  }

  // Spike finding M7 — the SECOND hostname, for the canvas origin. The studio
  // splits the canvas iframe onto its own origin (DDR-054), and without a
  // public name for it the iframe falls back to `http://localhost:<container
  // port>` — an address only the server itself can reach. The stack then comes
  // up, all eight verification steps pass, and every canvas renders as a blank
  // frame with ERR_CONNECTION_REFUSED in the console. The hub already routes
  // by Host (`isCanvasHost`), so all this needs is a name: DNS → Caddy block →
  // MAUDE_PUBLIC_CANVAS_ORIGIN, all rendered from this one value.
  cfg.canvasDomain = String(raw.canvasDomain ?? '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '');
  if (cfg.canvasDomain) {
    const canvasIsLoopback =
      cfg.canvasDomain === 'localhost' || cfg.canvasDomain.endsWith('.localhost');
    if (cfg.local && canvasIsLoopback) {
      // same carve-out as the main domain — `canvas.localhost` is loopback by RFC 6761
    } else if (!DOMAIN_RE.test(cfg.canvasDomain)) {
      errors.push(`canvasDomain "${cfg.canvasDomain}" is not a valid hostname`);
    } else if (!cfg.canvasDomain.includes('.')) {
      errors.push('canvasDomain must be fully qualified');
    }
    if (cfg.local && !canvasIsLoopback) {
      errors.push(
        `--local requires a loopback canvas name (*.localhost); "${cfg.canvasDomain}" is not one`
      );
    }
    // The SAME name would collapse the origin split this domain exists to
    // create — one origin again, cookies reachable from tenant code (DDR-054).
    if (cfg.canvasDomain === cfg.domain) {
      errors.push('canvasDomain must differ from domain — a same-origin canvas defeats the split');
    }
  } else {
    cfg.canvasDomain = null;
  }

  // DDR-242 — apps allowed to FRAME the studio for its read-only `?embed=1`
  // view (orbit showing a design next to a task). A FRAMING list, never a
  // writing one: the hub keeps it out of the canvas door's write allowlist,
  // which is why it is not more MAUDE_EXTRA_SHELL_ORIGINS. Each entry is
  // normalized to an origin; a wildcard or a non-https origin (other than a
  // loopback dev app) is an error here rather than a silently dropped entry
  // on the server.
  cfg.embedOrigins = [];
  const embedRaw = Array.isArray(raw.embedOrigins)
    ? raw.embedOrigins
    : String(raw.embedOrigins ?? '').split(/[\s,]+/);
  for (const entry of embedRaw.map((e) => String(e ?? '').trim()).filter(Boolean)) {
    let url = null;
    try {
      url = new URL(entry);
    } catch {
      /* reported below */
    }
    if (
      !url ||
      entry.includes('*') ||
      url.username ||
      url.password ||
      !/^https?:$/.test(url.protocol)
    ) {
      errors.push(`embedOrigin "${entry}" is not an origin (https://app.example.com)`);
      continue;
    }
    const loopback =
      url.hostname === 'localhost' ||
      url.hostname.endsWith('.localhost') ||
      url.hostname === '127.0.0.1' ||
      url.hostname === '[::1]';
    if (url.protocol === 'http:' && !loopback) {
      errors.push(
        `embedOrigin "${entry}" must be https — only a loopback dev app may be plain http`
      );
      continue;
    }
    if (!cfg.embedOrigins.includes(url.origin)) cfg.embedOrigins.push(url.origin);
  }

  cfg.acmeEmail = String(raw.acmeEmail ?? '').trim();
  if (!cfg.acmeEmail) {
    if (!cfg.local) errors.push('acmeEmail is required (Let’s Encrypt expiry notices)');
  } else if (!EMAIL_RE.test(cfg.acmeEmail))
    errors.push(`acmeEmail "${cfg.acmeEmail}" is not an email`);

  cfg.adminEmail = String(raw.adminEmail ?? '')
    .trim()
    .toLowerCase();
  if (!cfg.adminEmail) errors.push('adminEmail is required (the first person who can sign in)');
  else if (!EMAIL_RE.test(cfg.adminEmail))
    errors.push(`adminEmail "${cfg.adminEmail}" is not an email`);

  if (raw.adminPassword !== undefined) {
    if (typeof raw.adminPassword !== 'string' || raw.adminPassword.length < 12) {
      errors.push('adminPassword must be at least 12 characters');
    }
  }

  cfg.devMinio = raw.devMinio === true;
  if (raw.s3) {
    const s3 = { ...raw.s3 };
    s3.bucket = String(s3.bucket ?? '').trim();
    s3.endpoint = String(s3.endpoint ?? '')
      .trim()
      .replace(/\/+$/, '');
    if (!s3.bucket) errors.push('s3.bucket is required when s3 is configured');
    else if (!BUCKET_RE.test(s3.bucket))
      errors.push(`s3.bucket "${s3.bucket}" is not a valid name`);
    if (!s3.endpoint) errors.push('s3.endpoint is required when s3 is configured');
    else if (!/^https?:\/\//.test(s3.endpoint))
      errors.push('s3.endpoint must start with http:// or https://');
    if (!s3.accessKeyId) errors.push('s3.accessKeyId is required when s3 is configured');
    if (!s3.secretAccessKey) errors.push('s3.secretAccessKey is required when s3 is configured');
    s3.region = s3.region || 'auto';
    cfg.s3 = s3;
  } else if (cfg.devMinio) {
    // The dev profile stands up its own MinIO, so it can supply its own
    // credentials — but they are DEV credentials and the render says so.
    cfg.s3 = {
      endpoint: 'http://minio:9000',
      bucket: 'maude-assets',
      accessKeyId: 'maude-dev',
      secretAccessKey: 'maude-dev-secret',
      region: 'auto',
      dev: true,
    };
  }

  // BYO identity — Track C C6. Threaded through validation, .env AND compose;
  // a var written into one but not the other never reaches the container, which
  // already shipped once with MAUDE_ADMIN_PASSWORD (see renderCompose).
  if (raw.oidc) {
    const o = { ...raw.oidc };
    o.issuer = String(o.issuer ?? '')
      .trim()
      .replace(/\/+$/, '');
    o.mode = o.mode === 'strict' ? 'strict' : 'hybrid';
    o.domains = String(o.domains ?? '').trim();
    if (!o.issuer) errors.push('oidc.issuer is required when oidc is configured');
    else if (!/^https:\/\//.test(o.issuer)) errors.push('oidc.issuer must be https');
    if (!o.clientId) errors.push('oidc.clientId is required when oidc is configured');
    if (!o.clientSecret) errors.push('oidc.clientSecret is required when oidc is configured');
    // A filter, never a grant — but required, because without it every subject
    // at a public issuer can queue itself into the operator's pending list.
    if (!o.domains) errors.push('oidc.domains is required when oidc is configured');
    cfg.oidc = o;
  }

  // The backup namespace — Phase 0 F3.
  //
  // Until now nothing here mentioned MAUDE_BACKUP_PREFIX at all: the CELL
  // entrypoint sets it (derived from the tenant id) and a self-hosted
  // workspace therefore backed up to the bucket ROOT by construction. Two hubs
  // on one bucket then shared a keyspace, which is how their generations
  // interleaved and pruned across each other.
  //
  // NEW RENDERS ONLY — and that restriction is the point. Adding a prefix to a
  // deployment that already has generations at the root moves it to a DISJOINT
  // keyspace (`prefixedTarget` rewrites `list('backups/')` to
  // `list('<prefix>/backups/')`), so every existing generation goes invisible
  // in one config change: orphaned, unprunable, and — after the next volume
  // loss — a cold start that sees zero generations and seeds instead. The fix
  // would re-open the exact destruction it exists to close.
  //
  // Safe to leave off, because the WRITE-side identity refusal already stops
  // the destruction at the bare root without any prefix. Here the prefix is a
  // remedy, not the safety mechanism.
  //
  // `backupPrefix: null` is the caller saying "existing deployment, leave it
  // alone"; a string is an explicit choice; undefined derives one.
  if (raw.backupPrefix === null) {
    cfg.backupPrefix = null;
  } else if (raw.backupPrefix !== undefined && String(raw.backupPrefix).trim() !== '') {
    const explicit = sanitizeBackupPrefix(raw.backupPrefix);
    if (!explicit) errors.push(`backupPrefix "${raw.backupPrefix}" has no usable characters`);
    cfg.backupPrefix = explicit || null;
  } else {
    // Derived from the address, which is the one identifier the operator has
    // already had to make unique — DNS enforced it.
    cfg.backupPrefix = sanitizeBackupPrefix(cfg.domain) || null;
  }

  if (raw.seedRepo !== undefined && raw.seedRepo !== null && String(raw.seedRepo).trim() !== '') {
    const seed = String(raw.seedRepo).trim();
    if (!/^(https?:\/\/|git@|ssh:\/\/)/.test(seed)) {
      errors.push('seedRepo must be an https://, ssh:// or git@ URL');
    }
    cfg.seedRepo = seed;
  } else {
    cfg.seedRepo = null;
  }

  cfg.imageTag = String(raw.imageTag ?? 'latest').trim() || 'latest';

  return { ok: errors.length === 0, errors, config: cfg };
}

/**
 * The URL the workspace is reachable at.
 *
 * ONE definition, used by the compose render, the verification steps and every
 * message printed to the operator — a local run that verified `https://` while
 * Caddy served `http://` would fail every check for a reason that has nothing
 * to do with the workspace.
 */
export function workspaceBaseUrl(cfg) {
  return `${cfg.local ? 'http' : 'https'}://${cfg.domain}`;
}

/**
 * The `.env` a workspace deployment needs. Returned as an ordered array of
 * `{ key, value, comment }` so the renderer can annotate and a test can assert
 * a secret is present without string-matching a whole file.
 *
 * `HUB_TRUSTED_PROXIES` is set unconditionally: Caddy fronts the hub, so
 * without it every client shares one rate-limit bucket and a single attacker's
 * login flood limits everybody (DDR-194 §4).
 */
export function envEntries(cfg, { hubSecret, adminPassword, renderSecret }) {
  const entries = [
    {
      key: 'PUBLIC_DOMAIN',
      value: cfg.domain,
      comment: cfg.local
        ? 'hostname Caddy matches on; LOCAL MODE — plain HTTP, no certificate'
        : 'public hostname; Caddy fetches a cert for it',
    },
    {
      key: 'ACME_EMAIL',
      value: cfg.acmeEmail,
      comment: cfg.local ? 'unused in local mode' : "Let's Encrypt expiry notices",
    },
    {
      key: 'HUB_SECRET',
      value: hubSecret,
      comment: 'operator credential — rotate on staff change',
    },
    {
      key: 'HUB_TRUSTED_PROXIES',
      value: '172.16.0.0/12,10.0.0.0/8,192.168.0.0/16,fd00::/8',
      comment: 'Caddy fronts the hub; without this every client shares one rate-limit bucket',
    },
    { key: 'HUB_WORKSPACE_MODE', value: '1', comment: 'users required; permissive dev auth off' },
    ...(cfg.local
      ? [
          {
            key: 'HUB_INSECURE_HTTP',
            value: '1',
            comment:
              'LOCAL TESTING ONLY — lifts the hub’s refusal to serve over plaintext. ' +
              'Delete this line before this deployment is reachable by anyone else.',
          },
        ]
      : []),
    {
      key: 'MAUDE_WORKSPACE_MODE',
      value: '1',
      comment: 'containment invariant enforced (DDR-193 §2)',
    },
    {
      key: 'MAUDE_ADMIN_EMAIL',
      value: cfg.adminEmail,
      comment: 'first user, created on first boot',
    },
  ];
  if (adminPassword) {
    entries.push({
      key: 'MAUDE_ADMIN_PASSWORD',
      value: adminPassword,
      comment: 'first sign-in; change it after, then remove this line',
    });
  }
  if (cfg.s3) {
    entries.push(
      { key: 'MAUDE_S3_ENDPOINT', value: cfg.s3.endpoint },
      { key: 'MAUDE_S3_BUCKET', value: cfg.s3.bucket },
      { key: 'MAUDE_S3_ACCESS_KEY_ID', value: cfg.s3.accessKeyId },
      { key: 'MAUDE_S3_SECRET_ACCESS_KEY', value: cfg.s3.secretAccessKey },
      { key: 'MAUDE_S3_REGION', value: cfg.s3.region }
    );
    if (cfg.backupPrefix) {
      entries.push({
        key: 'MAUDE_BACKUP_PREFIX',
        value: cfg.backupPrefix,
        comment: 'this hub owns this keyspace; never point a second hub at it',
      });
    }
  }
  if (cfg.oidc) {
    entries.push(
      {
        key: 'HUB_OIDC_MODE',
        value: cfg.oidc.mode,
        comment: 'hybrid = password login still works; strict = OIDC only',
      },
      { key: 'HUB_OIDC_ISSUER', value: cfg.oidc.issuer },
      { key: 'HUB_OIDC_CLIENT_ID', value: cfg.oidc.clientId },
      { key: 'HUB_OIDC_CLIENT_SECRET', value: cfg.oidc.clientSecret },
      {
        key: 'HUB_OIDC_ALLOWED_DOMAINS',
        value: cfg.oidc.domains,
        comment: 'a filter, never a grant — a permitted domain still needs an account',
      }
    );
  }
  if (cfg.seedRepo) {
    entries.push({ key: 'MAUDE_SEED_REPO', value: cfg.seedRepo, comment: 'cloned on first boot' });
  }
  if (cfg.canvasDomain) {
    entries.push(
      {
        key: 'CANVAS_DOMAIN',
        value: cfg.canvasDomain,
        comment: 'second hostname for the canvas origin; Caddy serves it, DNS must point here too',
      },
      {
        key: 'MAUDE_PUBLIC_CANVAS_ORIGIN',
        value: `${cfg.local ? 'http' : 'https'}://${cfg.canvasDomain}`,
        comment: 'without this the canvas iframe points at a container-internal port (M7)',
      }
    );
  }
  if (cfg.embedOrigins?.length) {
    entries.push({
      key: 'MAUDE_EMBED_ORIGINS',
      value: cfg.embedOrigins.join(' '),
      comment:
        'apps that may FRAME the studio read-only (?embed=1) — framing only, never write access',
    });
  }
  if (cfg.render) {
    entries.push(
      {
        key: 'MAUDE_RENDER_SECRET',
        value: renderSecret,
        comment: 'hub ↔ render ingress bearer (DDR-230) — its own secret, never HUB_SECRET',
      },
      {
        key: 'MAUDE_RENDER_URL',
        value: 'http://render:8790',
        comment: 'compose-internal address the hub dispatches export jobs to',
      },
      {
        key: 'MAUDE_RENDER_CANVAS_BASE',
        value: 'http://hub:1234',
        comment: 'where the render service fetches canvases — the hub, over the compose network',
      }
    );
  }
  entries.push({
    key: 'MAUDE_IMAGE_TAG',
    value: cfg.imageTag,
    comment: 'pin this to a release before you rely on it',
  });
  return entries;
}

/** Render `.env`. Written at mode 0600 by the caller — it holds two secrets. */
export function renderEnv(entries) {
  const lines = [
    '# Maude workspace — generated by `maude hub workspace-up`.',
    '# Contains SECRETS. Mode 0600, never committed.',
    '',
  ];
  for (const e of entries) {
    if (e.comment) lines.push(`# ${e.comment}`);
    lines.push(`${e.key}=${renderEnvValue(e.value)}`);
    lines.push('');
  }
  return `${lines.join('\n').trimEnd()}\n`;
}

/**
 * Render one `.env` value safely (F8).
 *
 * Two failure modes a raw `${value}` opens, both with operator-pasted material
 * (an S3 secret, an OIDC client secret):
 *   - a NEWLINE injects an arbitrary extra line, which `readExistingEnv`'s
 *     `^KEY=…$` parser then accepts and PERSISTS across the "re-run is the
 *     upgrade path" flow — `secret\nHUB_INSECURE_HTTP=1` becomes real config.
 *   - a `$` is re-interpolated by `docker compose`, so the container silently
 *     gets a different value than the file shows — an unexplained lockout.
 * A control character is rejected outright (it cannot be meant); everything
 * else is single-quoted, and an embedded single quote is escaped the POSIX way.
 */
function renderEnvValue(raw) {
  const v = String(raw ?? '');
  if (/[\n\r\0]/.test(v)) {
    throw new Error('refusing to write a .env value containing a newline or control character');
  }
  if (v === '') return '';
  // Single-quote: inside single quotes the shell and compose interpolate
  // nothing. `'\''` is the POSIX way to embed a single quote.
  return `'${v.replace(/'/g, `'\\''`)}'`;
}

/**
 * The compose stack: hub + Caddy, MinIO only under the `dev` profile.
 *
 * MinIO is behind a profile rather than commented out, because a commented
 * service is one someone uncomments in production. `--profile dev` is a thing
 * you have to mean.
 */
export function renderCompose(cfg) {
  const envLines = (keys) => keys.map((k) => `      ${k}: \${${k}}`).join('\n');
  const hubEnv = [
    'HUB_SECRET',
    'HUB_TRUSTED_PROXIES',
    'HUB_WORKSPACE_MODE',
    ...(cfg.local ? ['HUB_INSECURE_HTTP'] : []),
    'MAUDE_WORKSPACE_MODE',
    'MAUDE_ADMIN_EMAIL',
    // The password has to cross into the container too, or the hub knows WHO
    // the first user is and has no way to create them — which is precisely the
    // half-wired state that shipped: `.env` held both, compose forwarded one.
    'MAUDE_ADMIN_PASSWORD',
    ...(cfg.s3
      ? [
          'MAUDE_S3_ENDPOINT',
          'MAUDE_S3_BUCKET',
          'MAUDE_S3_ACCESS_KEY_ID',
          'MAUDE_S3_SECRET_ACCESS_KEY',
          'MAUDE_S3_REGION',
          // Written into .env AND forwarded here. This list is hand-maintained,
          // and a var present in one but not the other never reaches the
          // container — which already shipped once, with MAUDE_ADMIN_PASSWORD.
          ...(cfg.backupPrefix ? ['MAUDE_BACKUP_PREFIX'] : []),
        ]
      : []),
    ...(cfg.oidc
      ? [
          'HUB_OIDC_MODE',
          'HUB_OIDC_ISSUER',
          'HUB_OIDC_CLIENT_ID',
          'HUB_OIDC_CLIENT_SECRET',
          'HUB_OIDC_ALLOWED_DOMAINS',
        ]
      : []),
    ...(cfg.seedRepo ? ['MAUDE_SEED_REPO'] : []),
    // Written into .env AND forwarded here — same hand-maintained pair as the
    // S3 block above, same failure mode when they drift (M7: the origin was
    // supported end to end and no deployment path ever set it).
    ...(cfg.canvasDomain ? ['MAUDE_PUBLIC_CANVAS_ORIGIN'] : []),
    ...(cfg.embedOrigins?.length ? ['MAUDE_EMBED_ORIGINS'] : []),
    ...(cfg.render ? ['MAUDE_RENDER_SECRET', 'MAUDE_RENDER_URL', 'MAUDE_RENDER_CANVAS_BASE'] : []),
  ];

  return `# Maude workspace — generated by \`maude hub workspace-up\`.
#
# Re-running the command regenerates this file; edit \`.env\` instead, or pass
# different flags. Bring it up with:
#
#   docker compose up -d
#
# MinIO is behind the \`dev\` profile ON PURPOSE. A commented-out service is one
# somebody uncomments in production; \`--profile dev\` is a thing you have to mean.

services:
  hub:
    image: ghcr.io/1agh/maude-hub:\${MAUDE_IMAGE_TAG:-latest}
    restart: unless-stopped
    environment:
      HUB_PUBLIC_URL: ${cfg.local ? 'http' : 'https'}://\${PUBLIC_DOMAIN}
      # The server-side checkout (Cloud Phase 16). In a workspace there is
      # nobody at a keyboard to commit, so the hub keeps the history itself —
      # without this the project's only record is its current bytes.
      MAUDE_REPO_DIR: /repo
${envLines(hubEnv)}
    volumes:
      - hub-data:/data
      # A SEPARATE volume from hub-data on purpose: the checkout is the one
      # thing here that can be reconstructed from a mirror, and keeping it
      # separable is what lets an operator reset it without touching the
      # documents, or vice versa.
      - hub-repo:/repo
    expose:
      - "1234"

${
  cfg.render
    ? `  # The maude-render sidecar (DDR-230) — the ONE container here that holds a
  # browser. It renders export jobs the hub dispatches; it holds no hub
  # secret, no volume, no tenant store, and it refuses to boot if a known
  # secret variable reaches it. Not exposed publicly — the hub talks to it
  # over the compose network only.
  render:
    image: ghcr.io/1agh/maude-render:\${MAUDE_IMAGE_TAG:-latest}
    restart: unless-stopped
    environment:
      MAUDE_RENDER_SECRET: \${MAUDE_RENDER_SECRET}
      # This service only fetches canvases from the hub next door.
      MAUDE_RENDER_CANVAS_ORIGINS: http://hub:1234
    expose:
      - "8790"

`
    : ''
}  caddy:
    image: caddy:2-alpine
    restart: unless-stopped
    ports:
      - "80:80"${cfg.local ? '' : '\n      - "443:443"'}
    environment:
      PUBLIC_DOMAIN: \${PUBLIC_DOMAIN}
      ACME_EMAIL: \${ACME_EMAIL}${cfg.canvasDomain ? '\n      CANVAS_DOMAIN: ${CANVAS_DOMAIN}' : ''}
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy-data:/data
      - caddy-config:/config
    depends_on:
      - hub
${
  cfg.devMinio
    ? `
  # DEV ONLY — object storage for local testing. Never expose this publicly and
  # never point a real workspace at it: the credentials below are in this file.
  minio:
    profiles: ["dev"]
    image: minio/minio:latest
    restart: unless-stopped
    command: server /data --console-address ":9001"
    environment:
      MINIO_ROOT_USER: \${MAUDE_S3_ACCESS_KEY_ID}
      MINIO_ROOT_PASSWORD: \${MAUDE_S3_SECRET_ACCESS_KEY}
    volumes:
      - minio-data:/data
    ports:
      - "9000:9000"
      - "9001:9001"
    healthcheck:
      test: ["CMD", "mc", "ready", "local"]
      interval: 3s
      timeout: 3s
      retries: 20

  # Creates the bucket the hub was just told to use. Without it, --dev-minio
  # renders a complete storage configuration pointing at a bucket that does not
  # exist — every write fails with NoSuchBucket, and the operator sees a
  # verification failure with no hint that the missing piece was never theirs
  # to supply. Same "looks configured, does nothing" shape as the admin
  # credentials and the seed repo before Cloud Phase 16 wired them.
  minio-init:
    profiles: ["dev"]
    image: minio/mc:latest
    depends_on:
      minio:
        condition: service_healthy
    entrypoint: >
      /bin/sh -c "
      mc alias set local http://minio:9000 \${MAUDE_S3_ACCESS_KEY_ID} \${MAUDE_S3_SECRET_ACCESS_KEY} &&
      mc mb --ignore-existing local/\${MAUDE_S3_BUCKET} &&
      echo 'bucket \${MAUDE_S3_BUCKET} ready'
      "
    restart: "no"
`
    : ''
}
volumes:
  hub-data:
  hub-repo:
  caddy-data:
  caddy-config:${cfg.devMinio ? '\n  minio-data:' : ''}
`;
}

/** Caddyfile with `trusted_proxies` wired, so XFF is honoured correctly. */
export function renderCaddyfile(cfg) {
  // LOCAL MODE: an explicit `http://` site address turns Caddy's automatic
  // HTTPS off entirely. The alternative — `tls internal` — mints a cert from a
  // CA nothing on the machine trusts, so every verification step would fail on
  // certificate validation rather than on anything about the workspace.
  //
  // This is a TESTING mode and the file says so, because a Caddyfile serving a
  // real workspace over plain HTTP would put every password on the wire.
  const site = cfg.local ? 'http://{$PUBLIC_DOMAIN}' : '{$PUBLIC_DOMAIN}';
  const header = cfg.local
    ? `# LOCAL TESTING ONLY — plain HTTP, no certificate. Never serve a real
# workspace from this file: sign-in passwords would travel in the clear.
`
    : `
{
  email {$ACME_EMAIL}
}
`;

  const canvasSite = cfg.canvasDomain
    ? `
# The CANVAS origin (M7) — a second hostname for the same hub. The hub routes
# by Host (isCanvasHost) and proxies to the studio's canvas listener itself, so
# this block needs no port knowledge; it exists so the name resolves and gets a
# certificate. Deliberately a separate ORIGIN, not a path: the split is what
# keeps studio cookies unreachable from tenant canvas code (DDR-054).
${cfg.local ? 'http://{$CANVAS_DOMAIN}' : '{$CANVAS_DOMAIN}'} {
  encode zstd gzip
  reverse_proxy hub:1234 {
    header_up X-Forwarded-For {remote_host}
    header_up X-Forwarded-Proto {scheme}
    header_up Host {host}
  }
}
`
    : '';

  return `# Maude workspace — generated by \`maude hub workspace-up\`.
${header}
${site} {
  encode zstd gzip

  # The hub reads X-Forwarded-For only from addresses it trusts
  # (HUB_TRUSTED_PROXIES). Caddy is on the compose network, so it must set the
  # header for per-client rate limiting to work at all — without it every
  # client shares one bucket and one attacker's login flood limits everybody.
  reverse_proxy hub:1234 {
    header_up X-Forwarded-For {remote_host}
    header_up X-Forwarded-Proto {scheme}
    header_up Host {host}
  }
}
${canvasSite}`;
}

/**
 * The checks that must pass before this command is allowed to say it worked.
 *
 * Returned as data so the runner executes them uniformly and reports each by
 * name. A provisioner that prints a URL without proving a round-trip has told
 * the operator something it does not know.
 */
export function verificationPlan(cfg) {
  const steps = [
    {
      id: 'health',
      title: 'the workspace answers',
      detail: `GET ${workspaceBaseUrl(cfg)}/health returns ok`,
    },
    {
      id: 'admin-claimed',
      title: 'the operator credential works',
      detail: 'the admin API accepts the generated HUB_SECRET',
    },
    {
      id: 'user-signin',
      title: 'the first person can sign in',
      detail: `${cfg.adminEmail} exchanges a password for a session`,
    },
    {
      id: 'canvas-roundtrip',
      title: 'a canvas survives a round trip',
      detail: 'a sentinel canvas syncs up and reads back byte-identical',
    },
    {
      id: 'git-commit',
      title: 'autosave produced a commit',
      detail: 'the sentinel edit exists in the workspace git history',
    },
  ];
  if (cfg.s3) {
    steps.push(
      {
        id: 's3-object',
        title: 'media reaches the bucket',
        detail: 'a sentinel asset is retrievable from object storage',
      },
      {
        id: 's3-no-expiry',
        title: 'nothing will expire the media',
        // The quiet catastrophe: a lifecycle rule on `assets/` deletes objects
        // that canvases in git history still point at, with no recovery path.
        detail: 'no lifecycle/expiry rule applies to the assets/ prefix',
      }
    );
  }
  if (cfg.render) {
    steps.push({
      id: 'render-health',
      title: 'the render service answers and is configured',
      detail: 'GET http://render:8790/_health (via the hub container) reports configured:true',
    });
  }
  steps.push({
    id: 'restore-drill',
    title: 'a backup can actually be restored',
    detail: '`maude hub restore-drill` passes against the configured target',
  });
  return steps;
}

/**
 * What the operator still owns. Printed on every successful run.
 *
 * The trap this avoids: a one-command provisioner that prints "done" implies it
 * owns the deployment forever. It scaffolded and verified it, once. Saying so
 * plainly is the difference between a tool that is trusted and one that is
 * blamed.
 */
export function operatorDuties(cfg) {
  const duties = [
    {
      title: 'Rotate HUB_SECRET when someone leaves',
      detail:
        'It is in .env and it is the operator credential. `maude hub token rotate` for peers.',
    },
    {
      title: 'Watch the restore drill, not the backup',
      detail:
        'Schedule `maude hub restore-drill`. A backup nobody has restored is a hypothesis, and an empty restore looks exactly like a working one.',
    },
    {
      title: 'Pin the image tag before you rely on this',
      detail: `MAUDE_IMAGE_TAG is "${cfg.imageTag}". \`latest\` means an unplanned upgrade on the next restart.`,
    },
    {
      title: 'Upgrades are yours',
      detail: 'Re-running workspace-up regenerates the files; it does not watch for releases.',
    },
    {
      title: 'The bill is yours',
      detail: 'This runs on your infrastructure. Nothing here monitors spend.',
    },
  ];
  if (cfg.canvasDomain) {
    duties.push({
      title: 'DNS for the canvas domain too',
      detail: `${cfg.canvasDomain} must point at this machine, same as ${cfg.domain} — Caddy fetches its certificate on first request; until DNS lands, canvases are blank frames.`,
    });
  }
  if (cfg.s3) {
    duties.push({
      title: 'Never expire the assets/ prefix',
      detail:
        'A canvas in git history can reference media no current canvas does, so "unreferenced" never means "unreachable". An expired object is a permanently broken canvas.',
    });
  }
  if (cfg.s3?.dev) {
    duties.push({
      title: 'The MinIO credentials are in this directory',
      detail:
        'The dev profile is for local testing. Point a real workspace at real object storage.',
    });
  }
  return duties;
}

/**
 * The self-host sidecar image, resolved.
 *
 * `renderCompose` names it through `${MAUDE_IMAGE_TAG:-latest}` so the operator
 * can re-pin without regenerating; this is that same reference with the tag
 * this run would write into `.env`.
 */
export function renderImageRef(cfg) {
  return `ghcr.io/1agh/maude-render:${cfg.imageTag}`;
}

/**
 * `process.arch` → the platform a container registry names.
 *
 * Always `linux/*`, whatever the host OS is: the sidecar is a Linux container
 * either way, and on Docker Desktop the host kernel is a Linux VM of the same
 * architecture. What decides the answer is the CPU, not the desktop OS.
 */
export function hostContainerPlatform(arch = process.arch) {
  const architecture =
    { x64: 'amd64', arm64: 'arm64', arm: 'arm', ppc64: 'ppc64le', s390x: 's390x' }[arch] ?? arch;
  return `linux/${architecture}`;
}

/**
 * Can THIS machine run the render sidecar? (M10)
 *
 * The failure this exists to prevent: `--render` was accepted, the compose file
 * was written, `docker pull` SUCCEEDED (Docker falls back across architectures
 * on pull), and the operator learned the truth from `exec format error` in the
 * container log — after 2.99 GB. The remedy the product itself recommends
 * failed on the host the product's own AWS runbook recommends.
 *
 * Pure on purpose: the probe is one `docker manifest inspect` away in
 * `hub-workspace.mjs`, and every judgement about what its answer MEANS is here,
 * where it can be tested without a registry.
 *
 * Three verdicts, and the third is deliberate: a probe that could not run is a
 * WARNING, never a refusal. Not knowing the architecture is not evidence of a
 * mismatch, and a guard that blocks an offline operator is a worse bug than the
 * one it guards.
 *
 * @param {object} input
 * @param {string} input.imageRef      the image the compose file will name
 * @param {string} input.hostPlatform  `linux/arm64`, from `hostContainerPlatform()`
 * @param {{status: 'ok'|'missing'|'unknown', platforms?: string[], note?: string}} input.probe
 * @returns {{ok: boolean, level: 'ok'|'warn'|'refuse', message: string}}
 */
export function classifyRenderImage({ imageRef, hostPlatform, probe }) {
  const tag = imageRef.slice(imageRef.lastIndexOf(':') + 1);

  if (probe.status === 'unknown') {
    return {
      ok: true,
      level: 'warn',
      message:
        `\n  ⚠ could not check whether ${imageRef} runs on this machine` +
        `${probe.note ? ` (${probe.note})` : ''}.\n` +
        `    This host is ${hostPlatform}. If the image is not published for it, the\n` +
        `    render container will exit with "exec format error" after pulling ~3 GB.\n` +
        `    Check with: docker manifest inspect --verbose ${imageRef}\n\n`,
    };
  }

  if (probe.status === 'missing') {
    return {
      ok: false,
      level: 'refuse',
      message:
        `--render names an image that is not published: ${imageRef}\n\n` +
        (tag === 'latest'
          ? '  ghcr.io/1agh/maude-render publishes RELEASE TAGS ONLY — there is no\n' +
            '  `latest`. The hub image has one, which is why the default tag looks\n' +
            '  like it should work here and does not.\n\n' +
            '  Pass the release you want, e.g. --image-tag v1.0.3. It pins the hub too.\n'
          : `  Pick a published release tag (see\n` +
            `  https://github.com/1aGh/maude/pkgs/container/maude-render), or drop\n` +
            `  --render: ZIP export and Maude Desktop work either way.\n`),
    };
  }

  const platforms = probe.platforms ?? [];
  if (platforms.includes(hostPlatform)) return { ok: true, level: 'ok', message: '' };

  return {
    ok: false,
    level: 'refuse',
    message:
      `--render cannot work on this machine.\n\n` +
      `  ${imageRef}\n` +
      `  is published for ${platforms.join(', ') || 'no architecture this can read'}; ` +
      `this host is ${hostPlatform}.\n\n` +
      `  Docker would pull it anyway — it falls back across architectures on pull —\n` +
      `  and the container would exit with "exec format error" after ~3 GB.\n\n` +
      `  What to do:\n` +
      `    • run the workspace on ${platforms[0] ?? 'matching'} hardware ` +
      `(on AWS that is t3.small, not t4g.small), or\n` +
      `    • pin --image-tag to a release published for ${hostPlatform}, or\n` +
      `    • drop --render: ZIP export still works, and Maude Desktop renders\n` +
      `      PNG/PDF/PPTX/video locally.\n`,
  };
}
