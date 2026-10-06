# maude-render — the render-worker image (DDR-230).
#
# THE ONE IMAGE THAT CARRIES A BROWSER. The cell and hub images boot-assert
# the opposite (DDR-209 A′1, unchanged); this image exists so they can stay
# that way. It holds: Bun, the studio exporter spine, Playwright's Chromium —
# and NO SECRETS (server.ts refuses to start if any known secret env is set;
# see DDR-230 §1).
#
# FROZEN INSTALL, same supply-chain rule as the hub image: the committed
# apps/studio/bun.lock is what resolves, never a fresh resolution at build
# time — this image renders every self-hoster's exports, a poisoned
# transitive here reads their designs.
#
# Build from the REPO ROOT (the render service imports ../studio):
#   docker build -f apps/render/Dockerfile -t maude-render .

FROM oven/bun:1.4.2 AS deps
WORKDIR /app/apps/studio
COPY apps/studio/package.json apps/studio/bun.lock ./
# Patches must be reachable if apps/studio declares patchedDependencies
# (DDR-176 — a patch entry that cannot resolve fails loud here, not at runtime).
COPY patches /app/patches
RUN bun install --frozen-lockfile

# Playwright's Chromium — the pinned version the lockfile's playwright wants.
# Installed in its own layer so a source-only change doesn't re-download it.
FROM oven/bun:1.4.2 AS browser
WORKDIR /app/apps/studio
COPY --from=deps /app/apps/studio/node_modules ./node_modules
COPY apps/studio/package.json ./
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers
RUN bunx playwright install --with-deps chromium

FROM oven/bun:1.4.2 AS runtime
# Chromium's shared-library closure — same list `playwright install-deps`
# resolves; installed explicitly so the runtime stage stays slim and explicit.
#
# `ghostscript` is NOT part of that closure — it is the `text=outline` PDF
# post-pass (issue #116, exporters/ghostscript.ts). It lives here because this
# is the ONE lane where outlining can work with no user setup: the desktop app
# and the npm CLI resolve `gs` off PATH and refuse loudly when it is absent,
# deliberately, since Ghostscript is AGPL-3.0 and Maude is MIT — invoking a
# separately-installed unmodified program is clean, bundling it into a signed
# .app is not. Distributing it inside THIS image is ordinary Debian
# redistribution (the package carries its own source offer). ~50 MB.
#
# The frozen-install rule at the top of this file is about the bun lockfile
# (JS supply chain); an apt package from the base distro is not in its scope.
COPY --from=browser /opt/pw-browsers /opt/pw-browsers
RUN apt-get update && apt-get install -y --no-install-recommends \
      libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 \
      libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 \
      libgbm1 libasound2 libpango-1.0-0 libcairo2 fonts-liberation \
      fonts-noto-color-emoji \
      ghostscript \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=deps /app/apps/studio/node_modules apps/studio/node_modules
# The exporter spine + the paths module it resolves through (DDR-045). The
# whole studio source ships (it is small and public) so relative imports
# resolve without a bundling step; nothing else in it is reachable — this
# process serves only /render and /_health (server.ts).
COPY apps/studio apps/studio
COPY apps/render apps/render

ENV PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers
# The shims resolve a runtime off PATH (exporters/_runtime.ts) — bun is it.
ENV MAUDE_EXPORT_RUNTIME=/usr/local/bin/bun

# Non-root: nothing here needs privileges, and a Chromium sandbox escape
# should land in an unprivileged uid.
RUN useradd -m render && chown -R render /app
USER render

EXPOSE 8790
CMD ["bun", "apps/render/server.ts"]
