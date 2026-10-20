# Earthlight

Use Bun 1.3.14. Run `bun run verify` and verify rendered behavior with
`bun run verify:scene <base-url> <output-directory>`. Use an isolated
agent-browser session for local browser checks.

Earthlight owns the renderer, controls, HUD, data pipelines and scene tests.
The personal site consumes its package. Do not copy source from that consumer.
Background and explorer share the renderer and photographic defaults; background
must not install keyboard, wheel, touch or navigation controls.

Large assets are generated under `public/media/earthlight` and published as an
immutable, checksummed manifest to R2. `bun run assets:prepare` creates the
manifest and compact background fallback for packaging. Never commit large
source datasets or credentials. Keep provenance and attribution with assets.
Publishing assets is separate from deploying the applications. Never enable
metered subscriptions or change billing without explicit owner authorization.

Push with `.agents/skills/push/SKILL.md`. Everyday pushes go to `dev`. Shipping
pushes the same tip to `dev` and `main`; a push to `main` deploys the explorer
and updates personal-site `dev` (on the self-hosted homelab runner), and is
finished when both deliveries have a final result.

Documentation is maintained here. Dated experiments live under `docs/lab`.
Name code, markup and URL parameters with the terms in `docs/glossary.md`.
Keep the README public-facing and free of machine paths or private content.
