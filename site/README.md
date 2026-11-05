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

Two targets exist while the site moves hosts. **Production is still Vercel** until the DNS switch below; `pnpm build` (`next build`) stays the Vercel build and is unchanged. The **Cloudflare Workers** build is the way forward: [OpenNext](https://opennext.js.org/cloudflare) turns the `next build` output into a Worker (`maude-site`), `.github/workflows/site-deploy.yml` deploys it on every push to `main` that can change the site.

| | Vercel (until the switch) | Cloudflare Workers |
| --- | --- | --- |
| Build | `pnpm build` | `pnpm cf:build` |
| Run the built site locally | `pnpm start` | `pnpm cf:preview` (wrangler, http://localhost:8787) |
| Deploy | Git integration | `pnpm cf:deploy`, or the workflow |
| Config | Vercel project settings, `../vercel.json` | `wrangler.jsonc`, `open-next.config.ts`, `worker.mjs` |

### What is different on Workers

- **No middleware.** Next 16 `proxy.ts` is Node-only and OpenNext refuses it. The raw-markdown access to docs (`/docs/x.md`, or `Accept: text/markdown` on `/docs/x`) is `rewrites()` in `next.config.mjs`, which both hosts honour.
- **Videos get byte ranges from the Worker** (`worker.mjs`). Workers static assets answer a `Range` with `200` and the whole file, and Safari will not play a `<video>` that way. Only `/*.mp4` goes through it (`assets.run_worker_first`).
- **No CDN in front of the routes.** `/releases/...` (the desktop updater feed) and `/desktop/download/...` call the GitHub API; `lib/edge-cache.ts` keeps their answer in the Workers Cache API for the route's own `s-maxage`. The Cache API does nothing on a `*.workers.dev` hostname, so there each request calls GitHub until the custom domain is attached; set `GITHUB_TOKEN` (below).
- **Analytics is Cloudflare Web Analytics**, a cookieless beacon rendered only when `NEXT_PUBLIC_CF_BEACON_TOKEN` is set at build time (the workflow passes the `CF_BEACON_TOKEN` repository variable). There is no token in the repo.
- **The incremental cache is the read-only static-assets one**, because every page is prerendered and nothing revalidates. No R2 bucket or KV namespace exists. If a page ever needs `revalidate`, switch `open-next.config.ts` to the R2 cache and add the bucket to `wrangler.jsonc`.
- **Size.** The Worker is about 20.8 MiB uncompressed, 4.0 MiB gzipped: over the Workers Free limit (3 MiB), inside Workers Paid (10 MiB). Check with `pnpm exec wrangler deploy --dry-run --outdir /tmp/out`.
- **No PR previews** (Vercel made one per PR). `pnpm cf:preview` after `pnpm cf:build` is the local check.

### Cloudflare Workers: one-time setup

1. **API token** (Cloudflare dashboard, My Profile, API Tokens, Create Token, custom). Permissions: *Account > Workers Scripts > Edit*, *Zone > Workers Routes > Edit* (zone `maude.sh`), *Account > Account Settings > Read*. Scope the account and the zone to this account only.
2. **GitHub repository settings** (Settings > Secrets and variables > Actions):
   - secret `CLOUDFLARE_API_TOKEN`: the token above
   - secret `CLOUDFLARE_ACCOUNT_ID`: `b5b596efe65abb732777c7171dc18145`
   - variable `CF_BEACON_TOKEN`: the Web Analytics token (Cloudflare dashboard, Analytics & Logs, Web Analytics, add the site, copy the token). Optional: without it the site ships no beacon.
3. **Worker secret** `GITHUB_TOKEN` (lifts the 60 requests/hour GitHub API limit for the updater feed and the download redirect). It lives on the Worker, so set it after the first deploy: `cd site && pnpm exec wrangler secret put GITHUB_TOKEN`. A fine-grained token with read-only access to public repositories is enough.
4. The plan must be **Workers Paid** (bundle size above).

### First deploy (workers.dev)

Actions > *Site deploy (Cloudflare Workers)* > *Run workflow* on `main`. The Worker is then at `https://maude-site.<account-subdomain>.workers.dev`. Nothing else changes: `maude.sh` still points at Vercel. Check the preview URL the same way as `pnpm cf:preview` (`/`, `/docs`, `/docs/legal/terms`, `/desktop`, `/api/search?query=canvas`, `/llms.txt`, `/sitemap.xml`, the sitemap's URLs, `/intro.mp4` with a `Range` header, `/releases/darwin/aarch64/0.0.1`).

### The DNS switch

1. In a PR, uncomment the `routes` block in `wrangler.jsonc` (`maude.sh` and `www.maude.sh`, both `custom_domain: true`). Do not merge yet.
2. In the Cloudflare DNS for `maude.sh`, delete Vercel's records for `maude.sh` and `www` (the apex A and the `www` CNAME). A custom domain will not attach while another record holds the name. The site is down from here until step 3 finishes.
3. Merge the PR. The workflow deploys, and Cloudflare creates the DNS records and certificates for both names.
4. Check `https://maude.sh/` and `https://www.maude.sh/`. If `www` should redirect to the apex, add a Redirect Rule (the Vercel project did it, Workers will not).
5. Watch the Web Analytics dashboard for the first pageviews.

### Turning off Vercel

After the switch has held for a day or two: remove `maude.sh` and `www.maude.sh` from the Vercel project's domains, disable its Git integration (or delete the project `maude` in team `iagh`; this also ends PR previews), and move any value you still need out of its environment variables. Then, in a follow-up commit, delete `../vercel.json`, drop the Vercel wording from the root `README.md`, and note the move in DDR-005.

### Auto-generated reference content

`content/docs/reference/` is generated by `pnpm gen:reference` (= `node scripts/build-{command,schema}-reference.mjs`). It's **committed** to the repo because Vercel uploads only `site/` — the build cannot reach `../../plugins/` siblings. (The Cloudflare deploy builds from the full checkout, so there the generators run for real.)

Workflow: after editing `plugins/{flow,design}/commands/*.md` or `plugins/flow/.claude-plugin/config.schema.json`, run `pnpm --filter @maude/site gen:reference` and commit the diff. The `prebuild` script also runs the generators, but gracefully no-ops when source dirs aren't present (e.g. during the Vercel build).

### Manual deploy from a clone

Cloudflare (needs the token from the setup above, and a checkout with tags and full history: the stats read them):

```bash
export CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=b5b596efe65abb732777c7171dc18145
pnpm --filter @maude/site cf:build && pnpm --filter @maude/site cf:deploy
```

Vercel:

```bash
cd site
npx -y vercel@latest deploy --prod --yes      # production
npx -y vercel@latest deploy                    # preview
```

The CLI uses your personal Vercel auth (`vercel login` once). For maintainer-only manual operations.
