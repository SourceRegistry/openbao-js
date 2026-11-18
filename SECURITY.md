# Security Policy

openbao-js handles tokens and secrets, so we take security reports seriously. Thank you for helping keep it and its users safe.

## Supported versions

The project is on 0.x. Security fixes are released for the **latest minor version** only, under both package names.

| Version | Supported |
| --- | --- |
| Latest 0.x minor (currently 0.1.x) | ✅ |
| Older 0.x minors | ❌ Upgrade to the latest minor |

`@sourceregistry/openbao-js` and `openbao-js` are the same code, published from the same release.

## Reporting a vulnerability

**Please don't open a public issue, discussion or pull request for a vulnerability.**

Report it privately through GitHub: **[Report a vulnerability](https://github.com/SourceRegistry/openbao-js/security/advisories/new)** (or the repository's *Security* tab → *Report a vulnerability*). Only the maintainers can see it.

Please include:

- the affected version(s) and runtime (Node.js, Bun, Deno, browser, ...)
- a description of the issue and its impact
- steps or a minimal snippet to reproduce it
- any suggested fix, if you have one

Never include real tokens, unseal keys or secret values. Use a dev server (`bao server -dev`) for reproductions.

## What to expect

These are best-effort targets for a volunteer-maintained project:

| Step | Target |
| --- | --- |
| Acknowledge your report | within 5 business days |
| Initial assessment (confirmed or not, severity) | within 14 days |
| Fix released | depends on severity and complexity; we'll keep you updated |

Once a fix is released we publish a GitHub security advisory (with a CVE where appropriate) and credit you, unless you'd rather stay anonymous. Please keep the details private until the advisory is published.

## Scope

**In scope:** vulnerabilities in this client library, for example:

- tokens, secrets or wrapping tokens sent to the wrong host or path, or leaked into logs, error messages or URLs
- request paths or headers that can be manipulated through user-supplied input (path segments, namespaces, query values)
- login or token handling that applies a token to the wrong client or namespace
- weaknesses in the published packages or release pipeline (provenance, build output)

**Out of scope:** report these elsewhere:

- vulnerabilities in **OpenBao itself**: follow the [OpenBao security policy](https://github.com/openbao/openbao/security/policy) (reports go to `openbao-security@lists.openssf.org`)
- vulnerabilities in a dependency of your own application or bundler
- issues that need an attacker who already controls your OpenBao server, your process environment (`BAO_TOKEN`, `BAO_ADDR`), or a custom `fetch` / `requestInit` you passed in

## Using openbao-js safely

- **Use HTTPS** for anything but a local dev server. For a private CA or client certificates, pass an undici `dispatcher` through `requestInit` (see the README). Don't disable certificate verification.
- **Don't log tokens.** The client never puts the token in URLs or error messages: `OpenBaoError` and `OpenBaoConnectionError` contain the method, path and the server's response, never request headers. Treat `error.body` with care anyway, as it is the server's raw response.
- **Prefer short-lived credentials.** Use auth methods (AppRole, JWT, Kubernetes, ...) over long-lived static tokens, keep TTLs short, and use `bao.auth.token.keepAlive()` rather than long TTLs.
- **Hand over secrets with response wrapping**, for example `generateWrappedSecretId()` and `sys.wrapping.unwrap()`, so they are single-use and never travel in plain form.
- **Scope clients.** Use `withToken()` / `withNamespace()` for per-tenant or per-request work, so one caller's token never leaks into another's client.
- **Verify what you install.** Both packages are published from GitHub Actions with npm provenance. Check with `npm audit signatures`, or look for the provenance badge on npmjs.com.
