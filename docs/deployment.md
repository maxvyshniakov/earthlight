# Explorer deployment

Configure Cloudflare Workers Builds to connect `maxvyshniakov/earthlight`
directly to the `earthlight` Worker at `https://earthlight.maxvyshniakov.com`.
Only pushes to `main` should deploy. The separate GitHub Actions workflow
updates the package used by `personal-site/dev`; it does not deploy the explorer.

| Setting | Value |
| --- | --- |
| Production branch | `main` |
| Root directory | `/` |
| Build command | `bun run assets && bun run verify && bun run build:deploy` |
| Deploy command | `bun run deploy` |
| `BUN_VERSION` | `1.3.14` |
| `NODE_VERSION` | `22` |
| Preview branches | None |

The Cloudflare GitHub App needs selected-repository access to `earthlight`.
The trigger uses the existing `personal-site - Workers Builds` deployment
credential, held by Cloudflare. No local Keychain token is copied into CI.
Bun installs the locked dependencies and runs the project scripts. Wrangler is
pinned in `bun.lock` and runs under Node because Bun 1.3.14 can terminate its
undici uploads prematurely.

The build downloads the immutable assets named by `assets-manifest.json` and
checks their lengths and SHA-256 checksums before running the tests, Astro check
and build. Deployment uses the published asset origin and excludes the local
asset copy. A failed build leaves the previous deployment active.

`workers_dev` and `preview_urls` remain disabled. The custom domain keeps its
existing Cloudflare Access policy. This pipeline does not publish new asset
manifests or deploy the public personal site.

## Verify and recover

After a push, inspect the Worker's Builds history for the exact source SHA and
successful deploy step. `/earthlight-version.json` records that SHA, the asset
version and build timestamp, with `Cache-Control: no-store`. It requires the
same Access login as the scene. The deployment annotation also records the SHA.
Check the scene with published assets before treating a release as verified.

Retry a failed build from Cloudflare's build history. A corrective commit on
`main` follows the same checks; use deployment history for an immediate rollback.
Do not rewrite shared Git history to roll back a deployment.

For a deliberate local deployment, run the same build command, then execute
`bun run deploy` with the authorized Cloudflare credential supplied through the
local credential wrapper. The wrapper belongs to the machine, not this repo.

Reference: [Cloudflare Workers Builds API](https://developers.cloudflare.com/workers/ci-cd/builds/api-reference/).
