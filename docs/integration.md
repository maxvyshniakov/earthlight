# Integration and releases

Earthlight is the only source for scene rendering, photographic defaults,
camera controls, HUD and scene tests. The personal site embeds
`earthlight/background`; the explorer uses `earthlight/astro` at its subdomain
root. Laboratory pages live under `/lab/`. The site has no `/orbit/` route.

The background has no controls or navigation listeners. It uses compact
overviews, disables streamed surface/terrain detail and aurora, caps rendering
resolution and pauses while hidden. Reduced motion uses the poster. Both modes
use the same renderer and `scene-defaults.ts` grade.

## Develop and update the consumer

Every verified push to Earthlight `main` runs `.github/workflows/personal-site-dev.yml`.
It downloads and checks the pinned assets, runs `bun run verify`, then updates
the package in `personal-site/dev`, verifies that site and pushes a scoped commit.
Cloudflare Builds deploys the resulting dev commit. Public-site `main` is not an
automatic target. Runs are serialized; superseded revisions skip publication.

The workflow's repository-scoped deploy key is stored in the Earthlight Actions
secret `PERSONAL_SITE_DEV_DEPLOY_KEY`. Its public half is the `Earthlight dev delivery`
deploy key in `personal-site`. GitHub's ordinary read-only job token handles only
Earthlight checkout and revision checks; no Cloudflare token is given to Actions.
The consumer's `earthlight.lock.json` and `/earthlight-version.json` record the
exact source SHA, archive checksum and asset version. See its
`docs/earthlight-delivery.md` for retries, rollback and key rotation.

In the site, `bun run dev:earthlight` resolves the component to the neighboring
Earthlight checkout. Edits are made here and watched by Astro/Vite. The normal
site build uses the exact package archive committed under `vendor/`, with its
integrity in `bun.lock`; it needs neither a sibling checkout nor registry auth.

For a manual update of committed Earthlight source, run `bun run earthlight:update` in the site, then
`bun run verify`. This creates a package artifact; never edit the archive or
copy scene source back into the site. Old unreferenced vendor archives may be
removed when committing the update. A package registry can replace this
transport later without changing component imports.

`assetBaseURL` selects a versioned media root for either component. The explorer
also accepts `terrainBaseURL` for its same-origin DEM proxy. The asset root is
passed per renderer, including all tile layers, rather than stored globally.
The background package contains a 2.6 MB fallback set for offline development;
`earthlight/astro-integration` serves/copies it when using its exported
`backgroundAssetBase` instead of the media domain.

## Assets and cost boundaries

`bun run assets:prepare` hashes all prepared scene data, writes
`assets-manifest.json`, and generates the background package files. The
manifest version is a hash of the paths, lengths and SHA-256 checksums.
`bun run assets` downloads missing or changed files from the pinned static
release and checks every checksum.

R2 bucket `media` is private, with neither custom domains nor an `r2.dev` URL.
It contains one archive and manifest per release under
`earthlight/releases/<version>/`. Only release tools access it. Visitor traffic
uses Workers Static Assets at
`https://media.maxvyshniakov.com/earthlight/<version>/`, with immutable caching
and public read CORS. There is no R2 binding in the media Workers.

Cloudflare does not provide a hard R2 spending cap. The uploader checks all
visible buckets before adding data and refuses projected storage above 8 GB,
archives above 512 MiB, or 100 objects created during the current month. These
are publishing safeguards, not account-wide billing limits; writes made with
other tools are outside their control. Static visitor requests are free and
unlimited. `media:prepare` rejects more than 19,000 files or any file above
25 MiB, below the Workers Free file-count limit.

## Publish an asset release

Run the following from the personal-site checkout, using its Keychain wrapper.
The scripts never activate subscriptions or change billing:

```sh
bun --cwd ../earthlight run assets:prepare
bun --cwd ../earthlight run media:prepare
bun scripts/with-cloudflare.mjs bun ../earthlight/scripts/publish-assets.mjs
bun run cf deploy --config ../earthlight/.media/wrangler-root.json
bun run cf deploy --config ../earthlight/.media/wrangler-version.json
```

The root Worker owns the media hostname and only serves a 404. Each immutable
asset version gets a separate static Worker and path route. Older versions
remain available to older packages without doubling a Worker's file count.
Do not remove an asset Worker while a consumer references its version.
Before creating more releases, inspect the account's remaining Worker allowance.

Check the published manifest and representative texture/binary files, CORS,
cache headers, and absence of public R2 access before deploying consumers.

## Deploy the explorer

`bun run build:deploy` builds with the pinned public asset root and removes
the local data copy from `dist`. From the site checkout, deploy with
`bun run cf deploy --config ../earthlight/wrangler.jsonc`. The terrain proxy
stays with Earthlight; the personal site no longer has a terrain handler.

The normal `bun run build` retains local data for the full rendering fixtures.
Run `bun run verify` and `bun run verify:scene <url> <output-directory>` against
that preview; then smoke-test the deployed explorer with remote assets.
