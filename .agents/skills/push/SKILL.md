---
name: push
description: Publish Earthlight commits to dev, or ship them to main and follow both deliveries a main push starts, the explorer Worker and the package update on personal-site dev, to their live versions. Use for explicit push requests, including "пуш". Commit-only and skill-authoring requests do not authorize publication; asset publication is separate.
---

# Push

A bare `push` or `пуш` publishes every local commit ahead of `origin/dev` on
the current branch to `dev`. Shipping, or an explicit request for `main`,
publishes the same tip to both `dev` and `main`, so `origin/main` stays an
ancestor of `origin/dev`. List the range before pushing. Uncommitted work stays
out unless the user asks for it. Never force-push, and never check out another
branch in a shared working tree; push with an explicit refspec.

A push to `dev` starts no GitHub workflow and no delivery to personal-site; it
is finished when `git ls-remote origin dev` shows the pushed SHA. A push to
`main` starts two independent deliveries:

1. Cloudflare Workers Builds builds and deploys the explorer at
   https://earthlight.maxvyshniakov.com (docs/deployment.md).
2. GitHub Actions `Update personal site dev`, on the self-hosted homelab runner
   (CT 108; maxvyshniakov/proxmox `docs/ci-runner.md`), verifies the commit, updates the
   package on personal-site `dev` and pushes there; Cloudflare then deploys
   https://dev.maxvyshniakov.com (docs/integration.md).

## Before pushing

- This repository has no pre-push hook. Run `bun run verify` on the exact tree
  you push, and `bun run verify:scene` for rendering changes. Both deliveries
  run verify again on Linux.
- Builds download only the assets named in `assets-manifest.json`. A new asset
  release must be published first, which needs its own authorization.

## Push

`git fetch`, rebase onto `origin/dev`, then `git push origin HEAD:dev` for
`dev`, or `git push origin HEAD:dev HEAD:main` to ship. Both are fast-forwards.
A rejection means another commit landed: fetch, inspect it and rebase onto it.

## Follow the explorer

Cloudflare adds `Workers Builds: earthlight` to the pushed commit as
`in_progress` when the build starts and completes it when the build ends, about
five minutes later; it stops builds at 20. The account runs one build at a
time, so the personal-site dev build waits for this one.

```sh
gh api repos/maxvyshniakov/earthlight/commits/<sha>/check-runs \
  --jq '.check_runs[] | select(.app.slug == "cloudflare-workers-and-pages") | [.name, .status, .conclusion, .details_url, .output.summary] | @tsv'
```

Poll about every 30 seconds until its status is `completed`. On failure, open `details_url`
for the build log; the previous deployment stays live. On success, its summary
names the Version ID. From a personal-site checkout, whose `bun run cf`
supplies the local Cloudflare credential, confirm it is active, read-only:
`bun run cf deployments status --name earthlight`.

## Follow personal-site dev

```sh
gh run list --workflow personal-site-dev.yml --commit <sha> --json databaseId,status,conclusion,url
gh run watch <run-id> --exit-status
```

A run that logs "A newer Earthlight commit superseded this run" succeeds
without pushing; follow the newer commit's run instead. After a pushing run,
`earthlight.lock.json` on personal-site `dev` records this SHA as `revision`:

```sh
gh api 'repos/maxvyshniakov/personal-site/commits?sha=dev&path=earthlight.lock.json&per_page=1' --jq '.[0].sha'
```

Follow that dev commit's Cloudflare build and live version as personal-site's
push skill describes (`.agents/skills/push/SKILL.md` in that repository). On a
failed run, read `gh run view <run-id> --log-failed`; retries are in that
repository's docs/earthlight-delivery.md.

Wait for both deliveries before ending the turn. `/earthlight-version.json` on
either site records the deployed SHA, behind Cloudflare Access; check it only
from a browser session that is already authenticated, and otherwise say it was
not checked.

## Report

Report the pushed range and SHA; the explorer check, Version ID and whether it
is active; the Actions run and the personal-site dev commit, check and Version
ID; and anything left unverified.
