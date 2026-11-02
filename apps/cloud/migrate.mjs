// Schema migration — Cloud Phase 12/13.
//
// PURE: takes the schema TEXT, never reads a disk. That is not tidiness — a
// `readFileSync` here made the Worker unpublishable (`No such module
// "node:fs"`), and the failure was invisible locally because the deploy
// output was being grepped for a success line. CI caught it; the decision
// layer taking data instead of fetching it is what makes that fixable in one
// place (DDR-196 §1).
//
// Who supplies the text:
//   - the Worker: `import schemaSql from './schema.sql'` via wrangler's Text
//     rule, so `schema.sql` stays the single source of truth;
//   - Node tests and local tools: `readSchemaSql()` below, which is the only
//     thing in this file that touches a filesystem and is never imported by
//     the Worker.

/** Split schema text into executable statements. One splitter, one behaviour. */
export function schemaStatements(sql) {
  return String(sql)
    .replace(/--[^\n]*/g, '') // comments carry no semantics for the engine
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => `${s};`);
}

/**
 * Versioned migrations beyond the baseline. Each entry runs once — guarded by
 * the schema_migrations row, because ALTER TABLE ADD COLUMN is not idempotent
 * the way CREATE IF NOT EXISTS is.
 */
export const MIGRATIONS = [
  {
    version: 2, // Phase 13 — one-account identity
    statements: [
      // Google-linking safety (the no-silent-merge rule) needs to know whether
      // an address was ever actually verified, and which Google subject a row
      // is linked to. `google_sub` is UNIQUE — one Google identity, one account.
      'ALTER TABLE accounts ADD COLUMN email_verified_at INTEGER;',
      'ALTER TABLE accounts ADD COLUMN google_sub TEXT;',
      'CREATE UNIQUE INDEX IF NOT EXISTS accounts_google ON accounts (google_sub) WHERE google_sub IS NOT NULL;',
      'ALTER TABLE accounts ADD COLUMN password_hash TEXT;',
      // Sessions are server-side rows so revocation is real: deleting the row
      // ends the session, not merely the next cookie refresh. `id` stores a
      // SHA-256 of the cookie value — a database read never yields a usable
      // credential.
      `CREATE TABLE IF NOT EXISTS sessions (
        id          TEXT PRIMARY KEY,
        account_id  TEXT NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
        created_at  INTEGER NOT NULL,
        expires_at  INTEGER NOT NULL,
        revoked_at  INTEGER
      );`,
      'CREATE INDEX IF NOT EXISTS sessions_account ON sessions (account_id);',
    ],
  },
  {
    version: 3, // Phase 19 — where a project mirrors to
    statements: [
      // `owner/name`, validated by mirror.mjs before it is ever written. Stored
      // on the PROJECT, because the control plane must be able to answer "is
      // this the repository that project is allowed to push to" without
      // trusting the asking cell — that check is the whole point of the
      // credential boundary.
      'ALTER TABLE projects ADD COLUMN mirror_repo TEXT;',
      'ALTER TABLE projects ADD COLUMN mirror_branch TEXT;',
    ],
  },
  {
    version: 4, // Phase 22 — membership, so a project can have more than an owner
    statements: [
      // Membership is a CONTROL-PLANE fact (DDR-204). It used to be implied by
      // whoever had a password on a particular cell, which meant removing
      // somebody required reaching into their cell — and left no way to end a
      // session they already had.
      `CREATE TABLE IF NOT EXISTS project_members (
        project_id TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
        account_id TEXT NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
        role       TEXT NOT NULL CHECK (role IN ('viewer','member','owner')),
        added_at   INTEGER NOT NULL,
        PRIMARY KEY (project_id, account_id)
      );`,
      'CREATE INDEX IF NOT EXISTS members_account ON project_members (account_id);',
    ],
  },
  {
    version: 5, // Phase 22 — inviting someone who has no account yet
    statements: [
      // SEPARATE from account_invites, which invites somebody to the PLATFORM
      // (Phase 6). A project invite has to carry the project and the role, and
      // overloading one table would mean a row whose meaning depends on which
      // columns happen to be null — and every reader having to know that.
      `CREATE TABLE IF NOT EXISTS project_invites (
        id          TEXT PRIMARY KEY,
        project_id  TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
        email       TEXT NOT NULL,
        role        TEXT NOT NULL CHECK (role IN ('viewer','member')),
        created_at  INTEGER NOT NULL,
        expires_at  INTEGER NOT NULL,
        redeemed_at INTEGER,
        revoked_at  INTEGER
      );`,
      'CREATE INDEX IF NOT EXISTS project_invites_email ON project_invites (email);',
    ],
  },
  {
    version: 6, // Phase 14 — checkout attempts, the provision-first ledger
    statements: [
      // One row per Checkout Session. `payment` records how the DDR-203
      // ordering settled — authorized (card held, workspace building),
      // charged (workspace answered, subscription kept), voided (it did not,
      // subscription cancelled at zero cost). The row is the idempotence:
      // a redelivered return or a refreshed waiting room finds it settled.
      `CREATE TABLE IF NOT EXISTS checkout_attempts (
        session_id      TEXT PRIMARY KEY,
        project_id      TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
        payment         TEXT NOT NULL DEFAULT 'pending'
                          CHECK (payment IN ('pending','authorized','charged','voided')),
        subscription_id TEXT,
        authorized_at   INTEGER,
        settled_at      INTEGER,
        created_at      INTEGER NOT NULL
      );`,
      'CREATE INDEX IF NOT EXISTS checkout_attempts_project ON checkout_attempts (project_id);',
    ],
  },
  {
    version: 7, // Phase 23 C — the desktop signs in like a device, not like a browser
    statements: [
      // One row per pending device sign-in. The device_code is the poller's
      // secret; the user_code is what a human confirms on /activate. Rows are
      // short-lived and deleted on redemption.
      `CREATE TABLE IF NOT EXISTS device_codes (
        device_code      TEXT PRIMARY KEY,
        user_code        TEXT NOT NULL UNIQUE,
        client_name      TEXT,
        approved_account TEXT,
        created_at       INTEGER NOT NULL,
        expires_at       INTEGER NOT NULL
      );`,
      // Personal tokens: what a device HOLDS after the flow. Stored hashed —
      // a leaked D1 dump must not be a bag of live credentials. Revocable
      // from the Account page, which is the revocation surface the offline
      // project-token story has needed all along.
      `CREATE TABLE IF NOT EXISTS personal_tokens (
        id           TEXT PRIMARY KEY,
        account_id   TEXT NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
        label        TEXT,
        created_at   INTEGER NOT NULL,
        last_used_at INTEGER,
        revoked_at   INTEGER
      );`,
      'CREATE INDEX IF NOT EXISTS personal_tokens_account ON personal_tokens (account_id);',
    ],
  },
  {
    version: 8, // feature-bug-report-button — daily quota buckets for /report
    statements: [
      // One row per (bucket, UTC day). Buckets are `install:<id>` and
      // `ip:<addr>`; report.mjs increments-with-cap so an unauthenticated
      // intake endpoint can exist without being an issue-spam oracle. Rows are
      // tiny and self-expiring in effect (old days are never read again).
      `CREATE TABLE IF NOT EXISTS report_quota (
        bucket TEXT    NOT NULL,
        day    TEXT    NOT NULL,
        count  INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (bucket, day)
      );`,
    ],
  },
  {
    version: 9, // Phase 23 B3 / Phase 17 — one-time handoff codes (browser → app)
    statements: [
      // The claim ticket a maude:// deep link carries instead of a bearer
      // token. Stored hashed, single-use (used_at burns it), two-minute TTL.
      // Role is captured at mint AND re-decided at exchange, so a code never
      // outlives a removal.
      `CREATE TABLE IF NOT EXISTS handoff_codes (
        id         TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        account_id TEXT NOT NULL,
        role       TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        used_at    INTEGER
      );`,
      'CREATE INDEX IF NOT EXISTS handoff_codes_project ON handoff_codes (project_id);',
    ],
  },
  {
    version: 10, // Phase 23 B2 — removals reach live sessions, not just future tokens
    statements: [
      // One row per removal/demotion that must kill live workspace sessions.
      // The cell sweeps these (derived-secret gated /internal/revocations) and
      // revokes the person's peer tokens — closing the "already signed in"
      // window the 12h TTL merely bounds.
      `CREATE TABLE IF NOT EXISTS member_revocations (
        project_id TEXT NOT NULL,
        email      TEXT NOT NULL,
        revoked_at INTEGER NOT NULL
      );`,
      'CREATE INDEX IF NOT EXISTS member_revocations_project ON member_revocations (project_id, revoked_at);',
    ],
  },
  {
    version: 11, // validate 2026-07-30 — the plane's own rate-limit budget
    statements: [
      // One row per hit, so the window is genuinely SLIDING: a fixed window
      // lets an attacker spend the whole budget at 59s and again at 61s.
      // Volume is auth attempts, never document traffic, and the edge prunes
      // rows older than an hour on every spend.
      `CREATE TABLE IF NOT EXISTS rate_hits (
        bucket TEXT    NOT NULL,
        at     INTEGER NOT NULL
      );`,
      'CREATE INDEX IF NOT EXISTS rate_hits_bucket ON rate_hits (bucket, at);',
    ],
  },
  {
    version: 12, // Cloud Phase 24 B1 — per-tenant config stops being Worker-GLOBAL
    statements: [
      // What a cell starts FROM, on first boot only. It used to be the
      // cells-Worker's own `MAUDE_SEED_REPO` — one value shared by every
      // tenant, which meant customer number two's first boot could clone
      // customer number one's project. It belongs on the project row, where
      // the id in the query is the isolation.
      'ALTER TABLE projects ADD COLUMN seed_repo TEXT;',
    ],
  },
  {
    version: 13, // 2026-08-01 — a single bad Stripe read must not start a teardown
    statements: [
      // When we FIRST saw a non-active subscription for a tenant that was
      // running. Suspension waits until the reading has persisted, so an API
      // blip cannot detach a paying customer's address on one sweep. NULL =
      // nothing adverse currently seen, which is every existing row.
      'ALTER TABLE projects ADD COLUMN adverse_since INTEGER;',
    ],
  },
  {
    version: 14, // Cloud Phase 25 B1 — the browser door has its own handoff lane
    statements: [
      // WHICH SURFACE a code was minted for. The desktop lane refuses viewers
      // (an app session is an editing credential); the BROWSER lane must not,
      // because "look, comment and download" is exactly what a viewer's role
      // means and the browser is where they do it. Recording the surface at
      // mint time is what lets the exchange apply the right rule instead of
      // one rule pretending to fit both. NULL reads as 'app' — every code
      // that exists today was minted for the app.
      'ALTER TABLE handoff_codes ADD COLUMN surface TEXT;',
    ],
  },
  {
    version: 15, // Cloud Phase 25 D1/D2 — the mirror grows a second MODE
    statements: [
      // WHICH SHAPE this project's mirror has. NULL reads as 'backup' — every
      // mirror that exists today pushes the cell's whole repository onto a
      // disjoint branch, and that stays exactly as it is. 'design-sync' is the
      // new shape: the .design tree into a folder of the customer's own repo,
      // on top of their history, as a pull request.
      'ALTER TABLE projects ADD COLUMN mirror_mode TEXT;',
      // Only design-sync uses these; backup ignores them.
      'ALTER TABLE projects ADD COLUMN mirror_folder TEXT;',
    ],
  },
  {
    version: 16, // RCA 2026-08-04 — the address can finally be proven
    statements: [
      // Links we mail to prove somebody reads an address: 'verify' (unblocks
      // Google linking) and 'reset' (chooses a new password). Stored hashed and
      // single-use, like sessions and handoff codes. Until this table existed,
      // `accounts.email_verified_at` was writable by nothing in the product,
      // so every password account was permanently barred from Google sign-in
      // and, with no reset flow, unrecoverable once its password was forgotten.
      `CREATE TABLE IF NOT EXISTS email_tokens (
        id         TEXT PRIMARY KEY,
        account_id TEXT NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
        purpose    TEXT NOT NULL CHECK (purpose IN ('verify','reset')),
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        used_at    INTEGER
      );`,
      'CREATE INDEX IF NOT EXISTS email_tokens_account ON email_tokens (account_id, purpose);',
      // BACKFILL — invite-created accounts only.
      //
      // An invitation is delivered TO the address and is single-use; redeeming
      // one is the same proof a verification link carries, and invites.mjs
      // simply never recorded it. The predicate below is the 'create' mode's
      // signature: the account did not exist when the invitation was minted
      // (`accounts.created_at >= i.created_at`), so redemption is what created
      // it.
      //
      // Password-SIGNUP accounts are deliberately NOT backfilled. Verifying
      // those wholesale is precisely the silent merge the no-silent-merge rule
      // exists to prevent — an attacker who pre-registered victim@gmail.com
      // would be handed the victim's Google sign-in. They go through the new
      // verification email like anyone else.
      //
      // `email_verified_at` is set to the account's own creation time, not to
      // now: the address was proven then, and a migration should not claim
      // today's date for a fact that is months old.
      `UPDATE accounts SET email_verified_at = created_at
        WHERE email_verified_at IS NULL
          AND google_sub IS NULL
          AND EXISTS (
            SELECT 1 FROM project_invites i
             WHERE i.email = accounts.email
               AND i.redeemed_at IS NOT NULL
               AND accounts.created_at >= i.created_at
          );`,
    ],
  },
  {
    version: 17, // Maude v2 S9.8 (V2-1.7 §5.8) — Can view, canvas grants, links, requests
    // ATOMIC: a table rebuild is drop + rename, and a crash between the two
    // would leave the membership table missing. D1 runs a `batch()` as ONE
    // transaction, so the rebuild and its schema_migrations row land together
    // or not at all — and a re-run after a failure starts from intact v16.
    atomic: true,
    statements: [
      // SQLite cannot alter a CHECK, so the two role-pinned tables are rebuilt
      // the standard way: create `_v2`, copy every row verbatim, drop, rename,
      // recreate the indexes. Nothing references these two tables, and the
      // deferral keeps the copy free of ordering concerns all the same.
      'PRAGMA defer_foreign_keys = on;',
      // `observer` (Can view) joins the stored roles. `source` says where a
      // row came from when it is not a plain invite or an owner's add: a
      // project-scope link (`link:<id>`) or an approved request
      // (`request:<id>`). NULL — every row that exists today — is invite/owner.
      // Turning a link off deletes exactly the rows it created.
      `CREATE TABLE project_members_v2 (
        project_id TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
        account_id TEXT NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
        role       TEXT NOT NULL CHECK (role IN ('observer','viewer','member','owner')),
        added_at   INTEGER NOT NULL,
        source     TEXT,
        PRIMARY KEY (project_id, account_id)
      );`,
      `INSERT INTO project_members_v2 (project_id, account_id, role, added_at)
         SELECT project_id, account_id, role, added_at FROM project_members;`,
      'DROP TABLE project_members;',
      'ALTER TABLE project_members_v2 RENAME TO project_members;',
      'CREATE INDEX IF NOT EXISTS members_account ON project_members (account_id);',
      // An invitation may be to ONE canvas (`canvas_path`, the designRoot-
      // relative path the access claim uses); NULL is the whole project, as
      // every invitation sent so far was.
      `CREATE TABLE project_invites_v2 (
        id          TEXT PRIMARY KEY,
        project_id  TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
        email       TEXT NOT NULL,
        role        TEXT NOT NULL CHECK (role IN ('observer','viewer','member')),
        created_at  INTEGER NOT NULL,
        expires_at  INTEGER NOT NULL,
        redeemed_at INTEGER,
        revoked_at  INTEGER,
        canvas_path TEXT
      );`,
      `INSERT INTO project_invites_v2
         (id, project_id, email, role, created_at, expires_at, redeemed_at, revoked_at)
         SELECT id, project_id, email, role, created_at, expires_at, redeemed_at, revoked_at
           FROM project_invites;`,
      'DROP TABLE project_invites;',
      'ALTER TABLE project_invites_v2 RENAME TO project_invites;',
      'CREATE INDEX IF NOT EXISTS project_invites_email ON project_invites (email);',
      // A grant ADDS access to one canvas and never lowers (V2-1.7 G1). Never
      // 'owner': ownership is the project's column.
      `CREATE TABLE IF NOT EXISTS canvas_grants (
        project_id  TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
        account_id  TEXT NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
        canvas_path TEXT NOT NULL,
        role        TEXT NOT NULL CHECK (role IN ('observer','viewer','member')),
        source      TEXT NOT NULL,
        granted_by  TEXT,
        granted_at  INTEGER NOT NULL,
        PRIMARY KEY (project_id, account_id, canvas_path)
      );`,
      'CREATE INDEX IF NOT EXISTS canvas_grants_source ON canvas_grants (project_id, source);',
      // A link: Can view or Can comment only. `team` is a location and grants
      // nothing; `anyone` redeems (signed in) into a `link:<id>` grant. Only a
      // SHA-256 of the secret is stored — a D1 read never yields a usable link.
      `CREATE TABLE IF NOT EXISTS share_links (
        id          TEXT PRIMARY KEY,
        project_id  TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
        canvas_path TEXT,
        role        TEXT NOT NULL CHECK (role IN ('observer','viewer')),
        who         TEXT NOT NULL CHECK (who IN ('team','anyone')),
        secret_hash TEXT,
        created_by  TEXT NOT NULL,
        created_at  INTEGER NOT NULL,
        expires_at  INTEGER,
        revoked_at  INTEGER
      );`,
      'CREATE INDEX IF NOT EXISTS share_links_project ON share_links (project_id);',
      // Ask to edit. One OPEN request per person per scope, held by the index.
      `CREATE TABLE IF NOT EXISTS access_requests (
        id          TEXT PRIMARY KEY,
        project_id  TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
        account_id  TEXT NOT NULL,
        canvas_path TEXT,
        created_at  INTEGER NOT NULL,
        decided_at  INTEGER,
        decision    TEXT CHECK (decision IN ('approved','declined')),
        decided_by  TEXT
      );`,
      `CREATE UNIQUE INDEX IF NOT EXISTS access_requests_open
         ON access_requests (project_id, account_id, IFNULL(canvas_path, ''))
         WHERE decided_at IS NULL;`,
      // The AccessClaim captured at mint (re-decided at exchange), and where
      // the app should land once it has exchanged the code (S9 Q6). NULL —
      // every code minted before v2 — is the legacy role-only claim, no landing.
      'ALTER TABLE handoff_codes ADD COLUMN access TEXT;',
      'ALTER TABLE handoff_codes ADD COLUMN landing TEXT;',
      // "New people join as" (NULL = 'member', today's default).
      'ALTER TABLE projects ADD COLUMN default_invite_role TEXT;',
    ],
  },
  {
    version: 18, // Maude v2 S9.14a (contract S6↔S9 §5.3) — who invited you, and to which comment
    // Two nullable columns, nothing rewritten: every invitation sent before
    // v18 keeps NULL in both, which the invite page reads as "no inviter name"
    // and "no comment". `invited_by` is an ACCOUNT ID (the page shows that
    // account's name, never its e-mail); `thread` is a comment thread id on
    // the invite's canvas, only ever set together with `canvas_path`.
    atomic: true,
    statements: [
      'ALTER TABLE project_invites ADD COLUMN invited_by TEXT;',
      'ALTER TABLE project_invites ADD COLUMN thread TEXT;',
    ],
  },
  {
    version: 19, // Maude v2 S9.15 (Gate 0 A3) — the trial belongs to the account
    statements: [
      // Stamped once, at the first sign-in (`startTrial`, COALESCE). NULL = an
      // account that has not signed in since v19 — its trial has not started.
      'ALTER TABLE accounts ADD COLUMN trial_started_at INTEGER;',
      // NULL = not a trial project (checkout-born, hand-provisioned, legacy):
      // only a row with this set and no subscription can ever pause.
      'ALTER TABLE projects ADD COLUMN trial_ends_at INTEGER;',
      // One row per trial workspace, keyed by the ADDRESS's hash rather than
      // the account, so deleting an account and signing up again on the same
      // address does not mint a second trial — and no plain address is kept.
      // `request_id` makes provisioning idempotent: a retried request finds
      // its own row and answers the same project.
      `CREATE TABLE IF NOT EXISTS trial_claims (
        email_hash TEXT NOT NULL,
        request_id TEXT NOT NULL,
        account_id TEXT NOT NULL,
        project_id TEXT NOT NULL,
        claimed_at INTEGER NOT NULL,
        PRIMARY KEY (email_hash, request_id)
      );`,
      'CREATE INDEX IF NOT EXISTS trial_claims_account ON trial_claims (account_id, request_id);',
    ],
  },
  {
    version: 20, // Maude v2 S9.18 — mention e-mails, the switch for them, and its unsubscribe link
    // ATOMIC, like v17: `email_tokens` is rebuilt (SQLite cannot alter a
    // CHECK) and a crash between drop and rename would lose every live
    // verify/reset link.
    atomic: true,
    statements: [
      'PRAGMA defer_foreign_keys = on;',
      // 'unsub' joins the purposes. It can only turn mention e-mails off; the
      // purpose is bound into the row and re-checked on consumption, so it is
      // never a reset, a verify, or a session.
      `CREATE TABLE email_tokens_v2 (
        id         TEXT PRIMARY KEY,
        account_id TEXT NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
        purpose    TEXT NOT NULL CHECK (purpose IN ('verify','reset','unsub')),
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        used_at    INTEGER
      );`,
      `INSERT INTO email_tokens_v2 (id, account_id, purpose, created_at, expires_at, used_at)
         SELECT id, account_id, purpose, created_at, expires_at, used_at FROM email_tokens;`,
      'DROP TABLE email_tokens;',
      'ALTER TABLE email_tokens_v2 RENAME TO email_tokens;',
      'CREATE INDEX IF NOT EXISTS email_tokens_account ON email_tokens (account_id, purpose);',
      // Which e-mails an account gets. No row = the defaults (mention e-mails
      // on), so nothing is backfilled and every existing account keeps today's
      // behaviour until it says otherwise.
      `CREATE TABLE IF NOT EXISTS email_prefs (
        account_id TEXT PRIMARY KEY REFERENCES accounts (id) ON DELETE CASCADE,
        mentions   INTEGER NOT NULL DEFAULT 1 CHECK (mentions IN (0, 1)),
        updated_at INTEGER NOT NULL
      );`,
      // What was mailed, for two limits only: the same thread does not mail the
      // same person twice within the hour, and a project's cell cannot mail
      // past its daily cap. No address and no text — ids and a time.
      `CREATE TABLE IF NOT EXISTS mention_emails (
        project_id TEXT NOT NULL,
        account_id TEXT NOT NULL,
        thread     TEXT NOT NULL,
        sent_at    INTEGER NOT NULL
      );`,
      'CREATE INDEX IF NOT EXISTS mention_emails_project ON mention_emails (project_id, sent_at);',
      'CREATE INDEX IF NOT EXISTS mention_emails_thread ON mention_emails (project_id, account_id, thread, sent_at);',
    ],
  },
];

/** Run one migration's statements plus its schema_migrations row. */
async function runMigration(db, m) {
  const mark = db
    .prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)')
    .bind(m.version, Date.now());
  if (m.atomic && typeof db.batch === 'function') {
    // One transaction: the version row lands only with every statement.
    await db.batch([...m.statements.map((sql) => db.prepare(sql)), mark]);
    return;
  }
  for (const sql of m.statements) await db.prepare(sql).run();
  await mark.run();
}

/** Apply baseline + pending versioned migrations. Safe to run repeatedly. */
export async function applySchema(db, schemaSql) {
  if (!schemaSql) throw new Error('applySchema needs the schema text (see readSchemaSql)');
  for (const sql of schemaStatements(schemaSql)) {
    await db.prepare(sql).run();
  }
  for (const m of MIGRATIONS) {
    const done = await db
      .prepare('SELECT 1 AS x FROM schema_migrations WHERE version = ?')
      .bind(m.version)
      .first();
    if (done) continue;
    await runMigration(db, m);
  }
  const row = await db.prepare('SELECT MAX(version) AS v FROM schema_migrations').first();
  return { version: row?.v ?? null, statements: schemaStatements(schemaSql).length };
}

/**
 * Read `schema.sql` from disk — NODE ONLY.
 *
 * Deliberately a dynamic import of `node:fs`, so bundling this module for the
 * Worker cannot pull the module in. The Worker never calls this; it imports
 * the .sql as text.
 */
export async function readSchemaSql() {
  const { readFileSync } = await import('node:fs');
  const { dirname, join } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  return readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'schema.sql'), 'utf8');
}
