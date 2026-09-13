## §A — Classic AppSec hard-stops

### A1. Injection

- ✘ **NEVER** concatenate user input into SQL, NoSQL, OS command, LDAP, XPath, or template-engine strings
- ✘ **NEVER** trust client-supplied identifiers (table names, column names, sort order, file paths) without an allowlist
- ✘ **NEVER** pass user input into `exec`, `system`, `shell_exec`, `subprocess` with `shell=True`, `child_process.exec`, or backticks
- ✔ Parameterised / prepared statements only (`$1`, `?`, named binds — no string interpolation)
- ✔ ORM query builders with bound parameters; never `query.raw(userInput)`
- ✔ Shell calls via argv arrays (`subprocess.run([...], shell=False)`, `execFile`, `spawn` with explicit args)
- ✔ Allowlist + canonicalise before any reflective lookup (table/column/file by symbolic name)

### A2. Secrets

- ✘ **NEVER** hardcode API keys, tokens, private keys, DB passwords, JWT secrets, or webhook signing keys in source
- ✘ **NEVER** commit `.env`, `.env.production`, `credentials.json`, `*.pem`, `*.p12`, `id_rsa`, or service-account JSON
- ✘ **NEVER** log secrets, full Authorization headers, cookies, or query strings containing tokens
- ✔ Env vars + `.env.example` (schema only, no values) + secret manager (Vault / Doppler / Vercel env / AWS SM)
- ✔ Flag any high-entropy string in the diff: `[A-Za-z0-9_/+=-]{32,}` — review per hit; whitelist test fixtures explicitly
- ✔ Rotate immediately if a secret is ever committed; assume it leaked

### A3. AuthN / AuthZ

- ✘ **NEVER** ship a state-mutating route (POST / PUT / PATCH / DELETE) without an authentication check
- ✘ **NEVER** authorize by client-supplied identifier alone (IDOR — `GET /orders/:id` without ownership check)
- ✘ **NEVER** trust `X-User-Id` / `X-Tenant-Id` / `X-Role` headers from the client
- ✘ **NEVER** rely on the UI to hide a privileged action — the backend must enforce it
- ✔ Server-side authorization on every read AND write — load the object, verify caller owns / has scope
- ✔ Default-deny: missing policy means denied, not allowed
- ✔ Tenant scoping on every query (`WHERE tenant_id = $session.tenantId`) — never optional, never client-supplied
- ✔ Re-verify sensitive actions (delete account, change email, payout) with a recent auth factor

### A4. Crypto

- ✘ **NEVER** use MD5 or SHA-1 for security purposes (passwords, signatures, integrity)
- ✘ **NEVER** roll your own crypto; never invent a "fast" cipher; never use ECB mode
- ✘ **NEVER** use `Math.random()` / `rand()` for tokens, session IDs, nonces, or cryptographic material
- ✘ **NEVER** hardcode an IV / nonce; never reuse the same nonce with the same key
- ✔ AEAD constructions only: AES-GCM, ChaCha20-Poly1305 (stdlib / libsodium)
- ✔ Password hashing: argon2id (preferred), bcrypt (cost ≥ 12), scrypt — never raw SHA family
- ✔ CSPRNG: `crypto.randomBytes` (Node), `secrets` module (Python), `crypto/rand` (Go)
- ✔ Key rotation policy documented; keys never logged

### A5. SSRF / Open Redirect

- ✘ **NEVER** fetch a user-supplied URL without an allowlist of hosts (or DNS-pinned target with private-range deny)
- ✘ **NEVER** follow redirects on a user-supplied fetch without re-checking each hop against the allowlist
- ✘ **NEVER** redirect to a `?next=` / `?return_to=` URL without validating it points to your own origin
- ✔ Allowlist remote hosts; resolve DNS once, validate IP is not in RFC1918 / loopback / link-local / cloud metadata (`169.254.169.254`)
- ✔ Use a hardened HTTP client with `redirects: false` for callbacks; manually verify each hop
- ✔ For oauth-style `return_to`, only accept relative paths or origin-prefixed absolute URLs

### A6. XSS / Output Encoding

- ✘ **NEVER** render user input via `innerHTML`, `dangerouslySetInnerHTML`, `v-html`, `{{{...}}}`, or `bypassSecurityTrust*`
- ✘ **NEVER** inject user data into a `<script>` tag or inline event handler
- ✘ **NEVER** trust a Content-Type from the upload — sniff and validate
- ✔ Framework default escaping (React `{}`, Vue `{{}}`, Angular `{{}}`) — let it do the work
- ✔ If you genuinely need HTML, run it through DOMPurify with a strict allowlist
- ✔ CSP header with `script-src 'self'`, no `unsafe-inline`, nonces or hashes if inline is unavoidable

### A7. CSRF

- ✘ **NEVER** ship a state-mutating GET (every mutation behind POST / PUT / PATCH / DELETE)
- ✘ **NEVER** rely on `Referer` header alone — it's spoofable in some browsers and stripped in others
- ✔ `SameSite=Lax` (default) or `Strict` cookies; `Secure` flag on all auth cookies in prod
- ✔ Anti-CSRF token on cross-origin POST when cookies are the auth mechanism
- ✔ For JSON APIs: prefer `Authorization: Bearer` over cookies (no CSRF concern), or require a custom header

### A8. Deserialization

- ✘ **NEVER** call `pickle.load`, `yaml.load` (without SafeLoader), `eval`, `exec`, `Function(string)`, `node-serialize.unserialize`, `Marshal.load` on untrusted input
- ✘ **NEVER** unmarshal a class graph from network input (Java ObjectInputStream, .NET BinaryFormatter)
- ✔ JSON + strict schema validation (zod / yup / pydantic / marshmallow) for all parsed input
- ✔ `yaml.safe_load`, `JSON.parse`, `msgpack` with type allowlist
- ✔ For polymorphic payloads, use an explicit discriminator + allowlist of constructable types

### A9. Path Traversal

- ✘ **NEVER** `path.join(rootDir, userInput)` without normalising and verifying the result stays inside `rootDir`
- ✘ **NEVER** pass user input to `fs.readFile`, `fs.createReadStream`, or static-file serving without containment check
- ✘ **NEVER** trust file extensions from the upload — re-check after normalisation
- ✔ `path.resolve(rootDir, userInput)` + `if (!resolved.startsWith(rootDir + path.sep))` reject
- ✔ Better: store-by-hash, look up by allowlisted ID; the filesystem path is never user-visible
- ✔ Reject `..`, null bytes (`\0`), URL-encoded traversal (`%2e%2e`), Unicode normalisation tricks

### A10. Dependency / Supply Chain

- ✘ **NEVER** add a dependency without pinning a version (no `latest`, no unbounded ranges in production)
- ✘ **NEVER** install from a fork / unpublished tag / arbitrary git URL without reviewing the diff
- ✘ **NEVER** commit a `package.json` change without committing the matching lockfile entry
- ✘ **NEVER** enable a package's lifecycle scripts (`postinstall`, `preinstall`) for a freshly-added dep without inspecting the script
- ✔ Lockfile committed; CI runs with `--frozen-lockfile` / `npm ci` / `pnpm install --frozen-lockfile`
- ✔ Audit clean: `npm audit` / `pnpm audit` / `pip-audit` / `cargo audit` — investigate high+ before merge
- ✔ Typosquatting check: any new dep whose name is one edit from a popular package → manual verify the publisher
- ✔ For npm: prefer packages with provenance attestation (`npm install --foreground-scripts=false`)

### A11. Logging

- ✘ **NEVER** log full request bodies, response bodies, cookies, or Authorization headers
- ✘ **NEVER** log PII (email, phone, address, payment data) outside dedicated audit pipelines with retention policy
- ✘ **NEVER** log secrets — redaction in the logger isn't a guarantee; don't pass them in
- ✔ Structured logs with explicit field allowlist; redact unknowns by default
- ✔ Separate audit log (immutable, retention-bound) from app log (debug, freely written)

### A12. Error Handling

- ✘ **NEVER** return a stack trace, SQL error text, framework internals, or filesystem path to the client
- ✘ **NEVER** leak the existence of a resource via different error codes (`404` vs `403` on the same path → user enumeration)
- ✘ **NEVER** swallow exceptions silently — every catch logs at the appropriate level
- ✔ Public error: opaque message + correlation ID. Server log: full detail.
- ✔ Same response shape for "wrong password" and "no such user" — never reveal which

---
