# Publishing

## Branches
- Everyday destination: `dev`. Shipping, or an explicit request for `main`, publishes the same tip to `dev` and `main`.
- `main` only receives a SHA that `dev` receives in the same push, so `origin/main` stays an ancestor of `origin/dev`.
- Base branch for cleanup: `dev`.

## Gate
- No pre-push hook. Run `bun run verify` on the exact tree you push, and
  `bun run verify:scene <base-url> <output-directory>` for rendering changes. Both `main` deliveries run verify again
  on Linux. This repository has no GitHub Actions workflow.
- Builds download only the assets named in `assets-manifest.json`. A new asset release must be published first
  ([integration.md](../integration.md), "Publish an asset release"); that needs its own authorization.

## Push
- `dev`: `git push origin HEAD:dev`.
- Ship: `git push origin HEAD:dev HEAD:main`.
- Both are fast-forwards. No promote tool.

## CI
- A push to `dev` starts no workflow and no delivery; it is finished when `git ls-remote origin dev` shows the SHA.
- A push to `main` starts the explorer build; start the personal-site delivery yourself (below). Shipping is finished
  when both have a final result. Wait for both before ending the turn.
- Explorer: Cloudflare Workers Builds deploys https://earthlight.maxvyshniakov.com ([deployment.md](../deployment.md)).
  It adds the check `Workers Builds: earthlight` to the pushed commit, `in_progress` while building (about five
  minutes; Cloudflare stops it at 20). The account runs one build at a time, so the personal-site dev build waits for
  this one. Poll about every 30 seconds until `completed`:

  ```sh
  gh api repos/maxvyshniakov/earthlight/commits/<sha>/check-runs \
    --jq '.check_runs[] | select(.app.slug == "cloudflare-workers-and-pages") | [.name, .status, .conclusion, .details_url, .output.summary] | @tsv'
  ```

  On failure `details_url` has the build log; the previous deployment stays live.
- Personal-site dev: personal-site's GitHub Actions workflow `Update Earthlight on dev` (`earthlight-dev.yml`) pulls
  `main`, verifies it, updates the package on personal-site `dev` and pushes there; Cloudflare then deploys the
  personal site's dev environment ([integration.md](../integration.md)). It also runs every three hours; after a ship,
  dispatch it instead of waiting:

  ```sh
  gh workflow run earthlight-dev.yml -R maxvyshniakov/personal-site
  gh run list -R maxvyshniakov/personal-site --workflow earthlight-dev.yml -L 1 --json databaseId,status,url
  gh run watch <run-id> -R maxvyshniakov/personal-site --exit-status
  ```

  A run whose `check` job finds the SHA already on personal-site `dev` ends there. On failure read
  `gh run view <run-id> -R maxvyshniakov/personal-site --log-failed`; retries are in personal-site
  `docs/earthlight-delivery.md`.

## Release
- None beyond shipping to `main`. Asset publication is separate and needs its own authorization.

## After publish
- Explorer: the check's summary names the Version ID. Confirm it is active, read-only, from a personal-site checkout
  (its `bun run cf` supplies the Cloudflare credential): `bun run cf deployments status --name earthlight`.
- Personal-site dev: after a pushing run, `earthlight.lock.json` on personal-site `dev` records this SHA as `revision`.
  Find that commit, then follow its Cloudflare build and live version by personal-site `docs/agents/publishing.md`:

  ```sh
  gh api 'repos/maxvyshniakov/personal-site/commits?sha=dev&path=earthlight.lock.json&per_page=1' --jq '.[0].sha'
  ```

- `/earthlight-version.json` on either site records the deployed SHA, behind Cloudflare Access. Check it only from a
  browser session that is already authenticated; otherwise say it was not checked.

## Report
- For `main`: the explorer check, its Version ID and whether it is active; the personal-site Actions run, the
  personal-site dev commit, its check and Version ID.
