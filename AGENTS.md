# Earthlight

Use Bun 1.3.14. Run `bun run verify` after changes and verify rendered
scene behavior with `bun run verify:scene <base-url> <output-directory>`.
Use an isolated agent-browser session for local browser checks.

Large scene assets belong in GitHub Releases, not Git. Download the pinned
archive with `bun run assets`. Keep provenance and attribution alongside data.

The personal site is a separate consumer. Do not change its checkout as part
of work in this repository. `bun run sync:site <site-dir> [ref]` imports only
committed source and must preserve Earthlight's wrapper and tooling.
`source-snapshot.json` records the imported commit and the asset release.
The sync refuses a dirty worktree and removes files that are no longer imported.
Review its diff and run verification before committing. Changed binary assets
need a new release archive and checksum.

Documentation is maintained here and is not imported from the site. The README
is public-facing: keep it free of internal process notes. Dated experiments go
under `docs/lab/`; README images go under `docs/media/` and come from the demo.

Never include private credentials, machine paths, or unrelated site content.
