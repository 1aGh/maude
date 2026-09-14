# syntax=docker/dockerfile:1.7-labs
# Maude Hub — production image.
#
# Phase 9 Task 7; build context widened to the REPO ROOT in Cloud Phase 16:
#
#   docker build -t maude-hub -f apps/hub/Dockerfile .
#
# The context used to be apps/hub alone, which was tidier. It stopped being
# possible when the hub gained the server-side workspace agent: that agent
# drives the SAME `createAutoCommit` the desktop uses, and a second copy of the
# append-only commit rules is exactly the kind of duplication that ends with a
# server-made commit and a desktop-made commit behaving differently. So the
# bundler stage reaches one file out of apps/studio, and the stage layout below
# mirrors the repo so that relative import resolves identically in both places.
#
# Published as ghcr.io/1agh/maude-hub:vX.Y.Z + :latest on every release tag
# (amd64 + arm64 via buildx). Runtime is Node, NOT Bun: Hocuspocus' crossws
# adapter rejects Bun/Deno and better-sqlite3 is not Bun-compatible
# (DDR-052). Bun is only the bundler in the build stage.
#
# better-sqlite3 is a NATIVE module — its compiled .node binding is locked to a
# specific Node ABI. It CANNOT be built in the Bun stage: prebuild-install bails
# under Bun ("not yet supported in Bun", oven-sh/bun#4290) so it would source-
# compile against Bun's bundled Node (v24, ABI 137), which then fails to load in
# the node:20 runtime (ABI 115). So the native binding is compiled in a dedicated
# node:20 stage from the SAME frozen node_modules — `npm rebuild` recompiles the
# already-pinned source, it does NOT re-resolve the dep tree (the DDR-056 frozen-
# install guarantee holds: versions stay exactly what bun.lock pinned).

# ---- Stage 1: bundle src/server.mjs → dist/hub.bundle.mjs with Bun ----
FROM oven/bun:1.3.3 AS bundler
WORKDIR /build
# Frozen install against the COMMITTED bun.lock — the release image must NOT
# re-resolve dependencies at build time (caret ranges + fresh resolution on
# every release tag is a supply-chain hole: a poisoned transitive would land
# in the image every self-hoster pulls). --ignore-scripts skips better-sqlite3's
# postinstall (it would fail under Bun, and the bundler doesn't need the native
# binding — better-sqlite3 is `external` in build.ts). Hocuspocus + Yjs + ws are
# pure JS and inline into the bundle.
# Repo-shaped layout, so `../../studio/sync/autocommit.ts` resolves here exactly
# as it does in a working tree.
WORKDIR /build/apps/hub
COPY apps/hub/package.json apps/hub/bun.lock ./
RUN bun install --frozen-lockfile --ignore-scripts
COPY apps/hub ./
# The files the hub borrows from the studio: the append-only commit engine and
# the repo lock it serializes the checkout with (Cloud Phase 27 D2 — autocommit
# imports `../git/repo-lock.ts`; omitting it fails `bun run build.ts` right
# below with "Could not resolve", which is what broke the v0.54.0 image build).
# Bun strips their types at bundle time, so the Node runtime stage never sees TS.
COPY apps/studio/sync/autocommit.ts /build/apps/studio/sync/autocommit.ts
COPY apps/studio/git/repo-lock.ts /build/apps/studio/git/repo-lock.ts
# And the path validator autocommit screens its batch through before anything
# reaches a git pathspec (v1.0.0 gate A5). Same rule, same failure: it was
# tracked — so `check-import-coherence.sh` was green — but not COPIED, and the
# first build of this image after the import landed died on
# `Could not resolve: "../git/safe-rel.ts"`. Nothing in `quality.yml` builds the
# hub image, so the gate that caught it was the B2 fleet drill; on a release tag
# it would have been the tag itself. See T15b in the post-1.0 backlog for the
# manifest gate that would make this a test rather than a discovery.
COPY apps/studio/git/safe-rel.ts /build/apps/studio/git/safe-rel.ts
# Same rule again: where a synced canvas belongs on disk, and the eight rules
# that decide whether an incoming `syncMeta.path` may be believed. A second
# `.mjs` spelling of those rules would be a spelling without the traversal
# corpus that gives them their value — and `canvas-slug.ts` comes with it
# because rule 7 (the path must slug back to its own document) is only a check
# at all while it calls the REAL slug function rather than a copy of it.
COPY apps/studio/sync/canvas-path.ts /build/apps/studio/sync/canvas-path.ts
COPY apps/studio/canvas-slug.ts /build/apps/studio/canvas-slug.ts
# The source validator the studio projector gates disk writes with, and the
# byte ceilings it reads. The workspace agent refuses to write or commit a body
# it rejects (audit 2026-09-13 P0 #2) — with the SAME parser, not a hub-side
# approximation. `oxc-parser` stays external (build.ts) and comes from this
# image's frozen node_modules, pinned to the studio's exact version.
COPY apps/studio/sync/source-validation.ts /build/apps/studio/sync/source-validation.ts
COPY apps/studio/sync/limits.ts /build/apps/studio/sync/limits.ts
# Same rule, third file: the `git log` format string, its argv (including the
# GIT_LITERAL_PATHSPECS hardening that must travel WITH a scoped argv) and its
# parser. `src/history.mjs` serves the cloud-managed desktop's History tab, and
# the desktop's own `/_api/git/log` draws its rows through the same renderer —
# a second spelling here is how a cloud row and a local row come to differ in a
# field that renderer reads. Omitting it fails `bun run build.ts` below with
# "Could not resolve".
COPY apps/studio/git/log-format.ts /build/apps/studio/git/log-format.ts
# The mirror argv + push classifier, imported (never re-typed) by the cell's
# mirror lane. Its tests assert the ABSENCE of any force flag — absence being
# exactly what a later edit adds with nothing noticing — so a second copy here
# would be a copy without that guarantee.
COPY apps/cloud/mirror.mjs /build/apps/cloud/mirror.mjs
# Same rule, second file (Cloud Phase 25 D1): the design-sync decision module —
# which folder, which branch, the argv, and the tests that assert their base
# branch is never a push target. Re-typing it here would be re-typing exactly
# the guarantees those tests exist to hold.
COPY apps/cloud/design-sync.mjs /build/apps/cloud/design-sync.mjs
RUN bun run build.ts --release

# ---- Stage 2: compile the native better-sqlite3 binding for the node:20 ABI ----
FROM node:20-bookworm-slim AS native
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /build
# Carry the frozen-resolved node_modules from the bundler, then recompile ONLY
# better-sqlite3 against this stage's Node headers (ABI 115). --build-from-source
# forces node-gyp to compile the vendored, frozen C source instead of downloading
# an opaque prebuilt binary over the network — deterministic + supply-chain-tight.
# `npm rebuild <pkg>` never touches the dependency graph, so versions stay pinned.
COPY --from=bundler /build/apps/hub/node_modules ./node_modules
COPY --from=bundler /build/apps/hub/package.json ./package.json
RUN npm rebuild better-sqlite3 --build-from-source

# ---- Stage 2.4: the studio server binary (Cloud Phase 27 / DDR-209) ----
#
# THE CELL RUNS THE REAL STUDIO. Not a re-implementation of one — that was
# Phase 25 B3, and the owner found out by opening his own project and seeing a
# poorer application than his desktop's. The hub is now a proxy in front of
# this binary.
#
# WHY A COMPILED BINARY AND NOT THE SOURCE. Running from source means shipping
# the studio's entire production closure — remotion, pixi, onnxruntime,
# react-dom — into an image whose SIZE an unresolved outage RCA already lists
# as a suspect. `bun build --compile` bakes the server's own graph and drops
# the rest. The phase's cost gate names this fallback by hand; it is taken
# deliberately, not discovered.
#
# It also REPLACES the standalone Bun this image used to carry for the build
# sandbox: a compiled Bun binary re-entered with `BUN_BE_BUN=1` IS a JS runtime
# (DDR-177), so one artifact serves both jobs instead of two serving one each.
FROM oven/bun:1.3.3 AS studio-build
WORKDIR /build/apps/studio
COPY apps/studio/package.json apps/studio/bun.lock ./
# DDR-176 — `apps/studio` registers its OWN `patchedDependencies` (the
# css-tree/csso bun-compile-compat patches), and they resolve RELATIVE to this
# package. Copying them is not optional plumbing: skipping the equivalent step
# once already shipped two releases whose compiled sidecar crash-looped on boot.
COPY patches /build/patches
# Frozen, for the same supply-chain reason as the hub's own install above.
RUN bun install --frozen-lockfile --ignore-scripts
COPY apps/studio ./
COPY plugins/design/templates /build/plugins/design/templates
# `apps/studio/http.ts` imports `../../cli/lib/design-ownership.mjs` (the
# adopt/detach ownership logic — DDR-228), so the cloud studio build resolves
# it at compile time and MUST have it in context. The import landed between
# v1.0.0 and v1.0.1 and broke this stage with `Could not resolve` because
# nothing staged `cli/` here — the studio dir is copied, its one cross-package
# dependency was not. design-ownership.mjs imports only node builtins, so this
# single file is the whole closure; a new `../../cli/` import from studio needs
# its own line (there is exactly one today — grep guards it in CI would be nice).
COPY cli/lib/design-ownership.mjs /build/cli/lib/design-ownership.mjs
# The client bundle + stylesheet are COMMITTED artifacts (see CLAUDE.md: what
# you commit is what ships) — MAUDE_SKIP_RUNTIME_BUILD keeps the runtime bundles
# verbatim for the same reason. The E1 seal below records what came out of here.
# TARGETARCH is buildx's own — hardcoding an arch here produced a cell whose
# studio crash-looped under Rosetta with `failed to open elf at
# /lib64/ld-linux-x86-64.so.2`, on an image that otherwise built and started
# perfectly. The multi-arch release (`hub-image.yml` builds amd64 + arm64) would
# have shipped one good arch and one broken one.
ARG TARGETARCH
# THE CLOUD VARIANT — Cloud Phase 27 D1. `--cloud` compiles the studio with the
# secret-bearing surfaces REPLACED BY INERT STUBS rather than merely pruned from
# the route table: the ACP agent and its `bash -c` installer, the `$SHELL -ilc`
# probes, the exporter subprocess, the BYOK provider adapters, the GitHub REST
# client, the cloud/hub endpoints. They were unreachable in a cell before this;
# now they are not in the image, which is what DDR-123's "claude never runs on
# our infrastructure" actually claims. `scripts/check-cloud-binary.sh` asserts
# it against the built artifact — present in a desktop binary, absent here.
#
# `rm -f dist/maude-*` FIRST, and then take the binary by its EXACT name.
#
# `dist/` has to be copied in (the committed runtime bundles + the client are
# read from it), and a developer's tree routinely carries binaries for whatever
# platforms they last built. Globbing for `maude-*` picked one of THOSE — the
# image built cleanly, started cleanly, and crash-looped with `rosetta error:
# failed to open elf at /lib64/ld-linux-x86-64.so.2` because the staged binary
# was a stale x86-64 artifact from the build context rather than the arm64 one
# this stage had just produced.
RUN rm -f dist/maude-* \
 && case "${TARGETARCH:-amd64}" in \
      amd64) STUDIO_TARGET=bun-linux-x64; STUDIO_SLUG=linux-x64 ;; \
      arm64) STUDIO_TARGET=bun-linux-arm64; STUDIO_SLUG=linux-arm64 ;; \
      *) echo "unsupported TARGETARCH: ${TARGETARCH}" >&2; exit 1 ;; \
    esac \
 && echo "[cell] studio target: ${STUDIO_TARGET} (cloud variant)" \
 && MAUDE_SKIP_RUNTIME_BUILD=1 bun run build.ts --release --cloud --target=${STUDIO_TARGET} \
 && test -f "dist/maude-cloud-${STUDIO_SLUG}" \
 && mv "dist/maude-cloud-${STUDIO_SLUG}" /build/maude-server \
 && chmod +x /build/maude-server
# E1 — seal the client artifacts. The cell refuses to boot when what is on disk
# is not what came out of this stage. A tag is not an identity; a hash is.
# The list is the CONTRACT, not a description: an artifact named here that the
# runtime stage forgot to COPY makes the cell refuse to boot with "MISSING",
# naming the file. That is how `comment-mount.js` gets to stay staged — it went
# unstaged once, and because it is imported in the same `Promise.all` as the
# canvas module, the pane simply went blank.
RUN node -e "const{createHash}=require('crypto'),{readFileSync,writeFileSync}=require('fs');\
const a={};for(const r of ['dist/client.bundle.js','dist/styles.css','dist/comment-mount.js'])\
a[r]=createHash('sha256').update(readFileSync(r)).digest('hex');\
writeFileSync('/build/bundle-manifest.json',JSON.stringify({artifacts:a},null,2));"

# ---- Stage 2.5: the canvas build sandbox's own dependencies ----
#
# Cloud Phase 25 A1. The cell BUILDS a tenant's canvas (the viewer's browser
# evaluates it — that is the line DDR-193 §2 draws, and it is unmoved: no
# browser enters this image). The build runs the studio's OWN engine under Bun
# so the artifact is identical to the desktop's, which needs three things here:
# the engine's source, the two npm packages it parses with, and a Bun to run
# them. Nothing from this stage is on the server's own module path — the
# sandbox is a separate process with an empty environment.
FROM oven/bun:1.3.3 AS canvas-deps
WORKDIR /canvas
# oxc-parser + magic-string are the identity pass (data-cd-id injection); the
# rest of the engine's imports are the studio's own files, copied below.
# EXACT versions, matching apps/studio/package.json — the sandbox's parser is
# the desktop's parser, or the two produce different `data-cd-id`s and a
# comment anchored in the browser stops resolving in the app.
RUN echo '{"name":"maude-canvas-sandbox","private":true,"dependencies":{"magic-string":"0.30.21","oxc-parser":"0.139.0"}}' > package.json \
  && bun install --no-save

# ---- Stage 3: runtime ----
FROM node:20-bookworm-slim AS runtime
# git is load-bearing since Cloud Phase 16: in a workspace deployment autosave
# IS git (DDR-195 §3), and a hub without it keeps no history at all — which
# would also make "mirror to GitHub" a claim with nothing behind it.
#
# ca-certificates is load-bearing WITH it. Node carries its own CA bundle, so
# every fetch-based feature works without this and the omission looks harmless
# — but git uses the SYSTEM store, so `MAUDE_SEED_REPO` failed every clone with
# "server certificate verification failed. CAfile: none". Found by running the
# image, not by reading it.
RUN apt-get update \
  && apt-get install -y --no-install-recommends tini wget git ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
# node_modules comes from the `native` stage (frozen versions + a node:20-ABI
# better-sqlite3 binding); the JS bundle + admin assets come from the bundler.
COPY --from=native /build/node_modules ./node_modules
COPY --from=bundler /build/apps/hub/dist ./dist
# The hub's own manifest, because `readOwnVersion()` in the bundle resolves
# `../package.json` from /app/dist — i.e. THIS file. It was never staged, so
# that read has always hit its `catch` and `/health` has always answered
# `"version": "0.0.0"`. That looked like the manifest's placeholder value and
# was diagnosed as such when apps/hub joined the release line; moving the value
# was necessary and not sufficient, since the file the runtime reads was absent
# either way. v0.58.0 shipped with `releaseVersion: "0.58.0"` (read from the
# studio manifest, which IS staged) beside `version: "0.0.0"` — the exact
# ambiguity the release-version work exists to remove.
COPY --from=bundler /build/apps/hub/package.json ./package.json
# The boot entrypoint (Track A' A1). Staged from the build context rather than
# the bundler stage because it is shell, not something Bun emits — and it is
# named by CMD at the bottom of this file, so a missing COPY here is a
# container that cannot start at all rather than one that starts unsafely.
COPY --chmod=755 apps/hub/entrypoint.sh /app/entrypoint.sh

# ---- the canvas build sandbox (Cloud Phase 25 A1) ----
#
# A Bun to run the studio's engine with, the engine itself as SOURCE (Bun reads
# TypeScript natively — there is nothing to compile), its two parser deps, the
# workers that drive it, and the pre-built browser runtime bundles the shell's
# importmap points at. Staged under /canvas so the sandbox's file surface is
# one obvious directory rather than scattered through /app.
#
# CONTAINMENT IS UNTOUCHED: no browser enters this image, and the boot-time,
# build-time and CI assertions that say so are unmodified. A bundler is not a
# renderer — the cell parses and transforms; the viewer's browser is what
# evaluates (DDR-193 §2 / Phase 25 A0).
# THE STUDIO (Cloud Phase 27 / DDR-209). One compiled binary, and beside it the
# files it reads from disk rather than carries: the client the browser loads,
# the pre-built runtime bundles, the canvas shell template, and the engine
# SOURCE the build sandbox runs in a child process.
#
# The standalone `bun` this image used to carry is GONE. `maude-server` is a
# compiled Bun binary, so `BUN_BE_BUN=1` re-enters it as a JS runtime (DDR-177)
# — one artifact for the server and the sandbox instead of two.
#
# Repo-shaped under /maude, because the studio resolves its canvas-shell
# template as `<root>/../../plugins/design/templates`. A flat layout would put
# that at `/plugins`, which works right up until someone moves the root.
COPY --from=studio-build /build/maude-server /app/maude-server
COPY --from=studio-build /build/bundle-manifest.json /app/bundle-manifest.json
COPY --from=canvas-deps /canvas/node_modules /maude/node_modules
# The engine's own source — the sandbox runs it as SOURCE (Bun reads TypeScript
# natively). No pre-built bundles, no tests. `stickers/` and `media/` DO ship:
# the manifest declares `/_stickers/`, `/_api/stickers` and `/_media/` as
# read-safe, and excluding the payload behind an open lane is how the cloud
# StickerPicker showed "No stickers bundled" for every tenant (RCA 2026-08-13,
# .ai/logs/rca/issue-cloud-studio-parity-stickers-and-ds-variables.md).
COPY --exclude=dist --exclude=test \
     --exclude=e2e --exclude=node_modules \
     apps/studio /maude/apps/studio
# Fail the BUILD, not the tenant: a future exclude (or a context that lost the
# packs) must never again produce an image whose sticker/media routes serve an
# empty directory.
RUN test -n "$(find /maude/apps/studio/stickers -mindepth 2 -maxdepth 2 -name manifest.json -print -quit)" \
 || (echo "hub image: no sticker packs under apps/studio/stickers — the /_stickers lane would serve nothing" >&2; exit 1)
RUN test -f /maude/apps/studio/media/intro.mp4 \
 || (echo "hub image: apps/studio/media/intro.mp4 missing — the /_media lane would serve nothing" >&2; exit 1)
# What the SERVER reads off disk, taken FROM THE BUILD STAGE — not from the
# build context. This is E1 being taken seriously rather than described: the
# bytes that were hashed into `bundle-manifest.json` and the bytes that get
# served have to be the same object, or the seal is checking a file nobody
# reads. (`dist/client.bundle.js` is REBUILT by every release build — see
# CLAUDE.md — so the committed copy and the staged copy genuinely can differ,
# and v0.51.1 shipped a blank window exactly that way.)
COPY --from=studio-build /build/apps/studio/dist/client.bundle.js \
     /build/apps/studio/dist/styles.css \
     /build/apps/studio/dist/comment-mount.js /maude/apps/studio/dist/
COPY --from=studio-build /build/apps/studio/dist/runtime /maude/apps/studio/dist/runtime
COPY plugins/design/templates /maude/plugins/design/templates
# The runtime bundles are ALSO reachable at the legacy path the hub's asset
# lane looked them up under, so nothing that used it has to learn a new one.
COPY --from=studio-build /build/apps/studio/dist/runtime /app/dist/canvas-runtime
# The engine resolves `magic-string` / `oxc-parser` from the nearest
# node_modules; /maude/apps/studio sits under /maude, so the staged modules are
# on its resolution path without a second install.
ENV MAUDE_STUDIO_BIN=/app/maude-server \
    MAUDE_BUN_PATH=/app/maude-server \
    MAUDE_STUDIO_SRC=/maude/apps/studio \
    MAUDE_DEV_SERVER_ROOT=/maude/apps/studio \
    MAUDE_CANVAS_WORKERS=/maude/apps/studio \
    MAUDE_CANVAS_RUNTIME_DIR=/app/dist/canvas-runtime \
    MAUDE_IMAGE_MANIFEST_DIR=/app \
    MAUDE_IMAGE_SEALED=1 \
    MAUDE_STUDIO_PORT=4399
# The container runs as the unprivileged `node` user, but a fresh named volume
# mounted at /data is initialized from the image's /data ownership. Create it
# node-owned BEFORE declaring VOLUME (post-VOLUME filesystem changes are
# discarded), so the SQLite db + bootstrap.json are writable at runtime.
# Both mount points must exist and be node-owned BEFORE the VOLUME
# declaration — post-VOLUME filesystem changes are discarded, and a fresh named
# volume inherits the image's ownership. Getting this wrong for /repo made the
# first real container crash-loop on `EACCES: mkdir /repo/.design`, because a
# volume Docker creates for an undeclared path lands as root.
RUN mkdir -p /data /repo && chown node:node /data /repo
VOLUME ["/data", "/repo"]
ENV PORT=1234 \
    DATA_DIR=/data \
    MAUDE_REPO_DIR=/repo \
    NODE_ENV=production
EXPOSE 1234
# /health is an unauthenticated GET (see src/server.mjs onRequest). TLS
# terminates upstream, so the in-container probe stays plain HTTP on loopback.
HEALTHCHECK --interval=30s --timeout=3s --start-period=8s --retries=3 \
  CMD wget -qO- http://localhost:1234/health > /dev/null 2>&1 || exit 1
USER node
ENTRYPOINT ["/usr/bin/tini", "--"]
# Track A' A1 — resolve the boot state BEFORE serving, the way the cell has
# since Phase 5. This image used to go straight to the server, so a lost /repo
# was re-seeded from MAUDE_SEED_REPO and came up green over the loss. The
# decision itself lives in `dist/rehydrate.mjs` (one table, both entrypoints),
# never in this shell.
CMD ["/app/entrypoint.sh"]
