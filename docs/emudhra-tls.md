# eMudhra TLS gate

Run `bun run security:tls` explicitly before network installs or credentialed
operations. This dependency-free live check uses the actual Bun runtime's
`fetch` and `https` clients: a valid npm registry control must succeed and all
12 incident fixtures must fail with a trust-chain rejection. DNS errors,
timeouts and other certificate errors fail closed. Source:
<https://emudhra.we-have-a-problem.com/>.

Bun remains pinned to 1.3.14. The current version accepts compromised chains;
`SSL_CERT_FILE` and `--cafile` did not remediate all 12 fixtures in the measured
runtime. The gate therefore blocks affected network work. It detects unsafe
trust; it does not repair Bun or establish package-manager TLS behavior. No
fixed Bun release is assumed. Normal local verification/build commands remain
independent of this online check.

After an upstream fix is verified, run the check again in each actual execution
environment. Node, package-manager native paths, Git/SSH, downloaded actions,
containers and Cloudflare remote builds have independent trust boundaries and
need their own verification. Existing installed dependencies do not imply that
future downloads are protected. Do not disable certificate verification or
claim that a root-bundle environment variable fixes the pinned Bun runtime.

The consumer-delivery workflow checks Bun before dependency installation and
before the private consumer checkout. Asset publication and deployment package
commands also run the gate first. Direct script invocation can bypass it.

GitHub checkout/setup actions run before repository gates; protecting those
requires runner-level remediation. The Bun gate does not attest Node trust.

## Explicit safe Bun option

The local `safe-bun` command runs the verified official canary revision
`0c864a07c4a76e56816e10bdd5886d0b0ea86664` with validated OS trust and the same
binary on nested script paths. Use `safe-bun run security:tls` before network
work and `safe-bun install --frozen-lockfile` for an explicit safe install.
Default `bun` remains 1.3.14 and remains unsafe for network work. This is a
temporary tested prerelease option, with cached artifacts and pinned checksums,
not a stable-version promotion. See the personal site repository's `docs/safe-bun.md` for usage, environment checks,
compatibility results and optional Docker image overrides. No push or deployment
is implied.
