# `@maude/site` — Documentation site

Public documentation for the `mdcc` CLI and the `flow` + `design` plugins. Built with [Fumadocs](https://fumadocs.dev) + Next.js 16 (App Router) + Tailwind v4 + Orama (client-side search).

## Run locally

From the **repo root** (pnpm workspace):

```bash
pnpm install                          # install root + site deps in one pass
pnpm --filter @maude/site dev     # → http://localhost:3000
# shortcut:
pnpm dev:site
```

The site is not part of the published npm package — it deploys separately (Cloudflare Workers; see [Deploy](#deploy)).

## Layout

```
site/
├── app/                          # Next.js App Router
│   ├── (home)/                   # marketing / landing
│   ├── docs/[[...slug]]/         # docs pages
│   ├── api/search/route.ts       # Orama search endpoint
│   ├── llms.txt/                 # llms.txt route handler
│   ├── llms.mdx/docs/[[...slug]] # raw MDX for LLM consumption
│   └── og/docs/[...slug]/        # OG image generation
├── content/docs/                 # the actual MDX pages
├── lib/
│   ├── shared.ts                 # appName, route constants, gitConfig
│   ├── source.ts                 # Fumadocs `loader()` wiring
│   └── layout.shared.tsx         # shared nav/footer
├── components/mdx.tsx            # MDX component overrides
├── source.config.ts              # Fumadocs MDX config + Zod schemas
└── next.config.mjs               # `withMDX()` wrap
```

## Authoring

- Add or edit MDX under `content/docs/`.
- Frontmatter: `title`, `description` required. Optional `full: true` for full-width pages.
- Folder + `meta.json` controls sidebar order — see [Fumadocs Source API](https://fumadocs.dev/docs/headless/source-api).
- Re-run `pnpm --filter @maude/site dev` (or just let Next.js hot-reload).

## Search

Client-side via Orama. New MDX files are picked up on next build — no manual indexing.

## Deploy

**Production is Cloudflare Workers** (since 2026-11-05). [OpenNext](https://opennext.js.org/cloudflare) turns the `next build` output into the Worker `maude-site`, which serves `maude.sh` and `www.maude.sh` (custom domains, declared in `wrangler.jsonc`; `www` 301s to the apex through a zone Redirect Rule). `.github/workflows/site-deploy.yml` deploys it on every push to `main` that can change the site. The old Vercel project `maude` (team `iagh`) is disconnected from Git and no longer serves anything. The `maude.sh` domain *registration* is still with Vercel (registrar, renews June 2027): that is the registrar only, not hosting.

| | |
| --- | --- |
| Build | `pnpm cf:build` (`pnpm build` is the plain `next build`) |
| Run the built site locally | `pnpm cf:preview` (wrangler, http://localhost:8787) |
| Deploy | the workflow, or `pnpm cf:deploy` |
| Config | `wrangler.jsonc`, `open-next.config.ts`, `worker.mjs` |

**Keep the `routes` block in `wrangler.jsonc`.** `wrangler deploy` detaches every custom domain its config does not declare: without it the next deploy takes `maude.sh` off the Worker.

### What is different on Workers

- **No middleware.** Next 16 `proxy.ts` is Node-only and OpenNext refuses it. The raw-markdown access to docs (`/docs/x.md`, or `Accept: text/markdown` on `/docs/x`) is `rewrites()` in `next.config.mjs`.
- **Videos get byte ranges from the Worker** (`worker.mjs`). Workers static assets answer a `Range` with `200` and the whole file, and Safari will not play a `<video>` that way. Only `/*.mp4` goes through it (`assets.run_worker_first`).
- **No CDN in front of the routes.** `/releases/...` (the desktop updater feed) and `/desktop/download/...` call the GitHub API; `lib/edge-cache.ts` keeps their answer in the Workers Cache API for the route's own `s-maxage`. Set `GITHUB_TOKEN` (below) so a cache miss is not limited to 60 GitHub requests an hour.
- **Analytics is Cloudflare Web Analytics**, a cookieless beacon rendered only when `NEXT_PUBLIC_CF_BEACON_TOKEN` is set at build time (the workflow passes the `CF_BEACON_TOKEN` repository variable). There is no token in the repo.
- **The incremental cache is the read-only static-assets one**, because every page is prerendered and nothing revalidates. If a page ever needs `revalidate`, switch `open-next.config.ts` to the R2 cache and add the bucket to `wrangler.jsonc`.
- **Size.** About 20.8 MiB uncompressed, 4.0 MiB gzipped: needs Workers Paid (10 MiB), not Free (3 MiB). Check with `pnpm exec wrangler deploy --dry-run --outdir /tmp/out`.
- **No PR previews.** `pnpm cf:preview` after `pnpm cf:build` is the local check.

### Setup (already done; for a new account or a rotated token)

1. **API token** (Cloudflare dashboard, My Profile, API Tokens, custom): *Account > Workers Scripts > Edit*, *Zone > Workers Routes > Edit* (zone `maude.sh` only), *Account > Account Settings > Read*.
2. **GitHub** (Settings > Secrets and variables > Actions): secret `CLOUDFLARE_SITE_API_TOKEN` = that token (its own secret: `CLOUDFLARE_API_TOKEN` is the Cloud fleet's and has other scopes); secret `CLOUDFLARE_ACCOUNT_ID` = `b5b596efe65abb732777c7171dc18145`; optional variable `CF_BEACON_TOKEN` = the Web Analytics token.
3. **Worker secret** `GITHUB_TOKEN`: `cd site && pnpm exec wrangler secret put GITHUB_TOKEN` (a fine-grained token with read-only access to public repositories).

### Auto-generated reference content

`content/docs/reference/` is generated by `pnpm gen:reference` (= `node scripts/build-{command,schema}-reference.mjs`). It's **committed** to the repo so the docs read the same in any checkout; the Cloudflare deploy builds from the full checkout and regenerates it.

Workflow: after editing `plugins/{flow,design}/commands/*.md` or `plugins/flow/.claude-plugin/config.schema.json`, run `pnpm --filter @maude/site gen:reference` and commit the diff. The `prebuild` script also runs the generators, and no-ops when the source dirs aren't present.

### Manual deploy from a clone

Cloudflare (needs the token from the setup above, and a checkout with tags and full history: the stats read them):

```bash
export CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=b5b596efe65abb732777c7171dc18145
pnpm --filter @maude/site cf:build && pnpm --filter @maude/site cf:deploy
```

