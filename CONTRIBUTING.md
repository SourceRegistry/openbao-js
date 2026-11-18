# Contributing to openbao-js

Thanks for helping out! This guide covers local setup, how the code is organised, how to add a typed helper, and how commits turn into releases.

- **Bugs:** open a [bug report](https://github.com/SourceRegistry/openbao-js/issues/new?template=bug_report.yml).
- **Missing helper for an endpoint:** open a [typed helper request](https://github.com/SourceRegistry/openbao-js/issues/new?template=helper_request.yml). Until it lands, the endpoint works through `bao.request()`.
- **Security issues:** report them [privately](https://github.com/SourceRegistry/openbao-js/security/advisories/new), never in a public issue. See [SECURITY.md](SECURITY.md).

## Setup

Requirements: Node.js 20 or later (24 recommended, CI uses it for releases) and npm.

```sh
git clone https://github.com/SourceRegistry/openbao-js.git
cd openbao-js
npm ci
npm run check
```

| Script | What it does |
| --- | --- |
| `npm run check` | Typecheck, unit tests and build. Run it before pushing. |
| `npm run typecheck` | `tsc --noEmit` over `src` and `test` |
| `npm test` / `npm run test:watch` | Unit tests (Vitest, mocked `fetch`) |
| `npm run test:integration` | Integration tests against a real OpenBao server (see below) |
| `npm run build` | ESM + CJS + `.d.ts` into `dist/` (tsup) |
| `npm run docs` | API reference into `docs/` (TypeDoc). Warnings fail the build. |

### Integration tests

They run in CI against OpenBao 2.6.5 and `latest`. To run them locally, start a dev server:

```sh
docker run --rm -p 8200:8200 openbao/openbao \
  server -dev -dev-root-token-id=root -dev-listen-address=0.0.0.0:8200

BAO_ADDR=http://127.0.0.1:8200 BAO_TOKEN=root npm run test:integration
```

Without `BAO_ADDR` and `BAO_TOKEN` the suite is skipped. Tests mount engines at unique paths and clean up after themselves, so a shared dev server is fine.

## Project layout

```
src/
  core.ts             HTTP transport: headers, namespaces, wrapping, retries, timeouts, errors
  client.ts           OpenBao class: module getters and mount-based factories
  errors.ts           OpenBaoError, OpenBaoConnectionError
  types.ts            Shared types (ApiResponse, AuthInfo, CallOptions, ...)
  utils.ts            Path encoding, base64, query building
  api/base.ts         MountedApi, AuthMethodApi, Resource, postData/getData
  api/sys.ts          sys/* endpoints
  api/auth.ts         Auth methods and the bao.auth aggregator
  api/secrets/*.ts    Secrets engines
test/unit/            Mocked-fetch tests (helpers.ts has mockClient)
test/integration/     Tests against a real server
scripts/              Release helpers (alias package, publish reconciliation)
```

## Adding a helper

Most helpers are a few lines thanks to the building blocks in `src/api/base.ts`:

| Building block | Use for |
| --- | --- |
| `MountedApi` | An engine or method at a configurable mount. `this.path(...segments)` builds URL-encoded paths. |
| `AuthMethodApi` | An auth method. `this.doLogin(path, body, opts)` logs in and stores the token unless `setToken: false`. |
| `Resource<TRead, TWrite>` | A named collection (`roles/:name`, `users/:name`, ...): `list`, `read`, `write`, `delete`, `exists`. |
| `postData` / `getData` | POST or GET and return the response's `data`. |

Example: a new secrets engine.

```ts
// src/api/secrets/rabbitmq.ts
import type { OpenBaoCore } from '../../core.js';
import type { ApiResponse, CallOptions } from '../../types.js';
import { MountedApi, Resource } from '../base.js';

export interface RabbitMqRole {
  vhosts?: string;
  tags?: string;
  [key: string]: unknown;
}

export class RabbitMq extends MountedApi {
  /** Roles (`<mount>/roles/:name`). */
  readonly roles: Resource<RabbitMqRole, RabbitMqRole>;

  constructor(client: OpenBaoCore, mount = 'rabbitmq') {
    super(client, mount);
    this.roles = new Resource(client, this.path('roles'));
  }

  /** Generates credentials. Returns the full envelope so the lease can be managed. */
  creds(role: string, opts?: CallOptions): Promise<ApiResponse<{ username: string; password: string }>> {
    return this.client.read(this.path('creds', role), opts);
  }
}
```

Then:

1. **Wire it up.** Add a factory to `OpenBao` in `src/client.ts` (`rabbitmq(mount = 'rabbitmq')`), or to `Auth` in `src/api/auth.ts` for an auth method.
2. **Export it** from `src/index.ts`.
3. **Document it.** Every public class, method and option needs a TSDoc comment. TypeDoc turns these into the API reference, and the docs build fails on warnings such as an unexported type that a public API refers to.
4. **Test it.** Add unit tests in `test/unit/` that check the method, path and body using `mockClient`. Add an integration test in `test/integration/` when the dev server supports the engine.
5. **Update the README** coverage section if the helper fills a listed gap.

### Conventions

- **Return values.** Return the payload (`data`) when callers don't need the envelope. Return the full `ApiResponse` when it carries a lease (`lease_id`), `auth` or `wrap_info`.
- **Options.** Name parameters the way OpenBao does (`token_policies`, `ttl`, ...) so the OpenBao docs apply directly. Use camelCase only for client-side conveniences (`keyVersion`, `setToken`).
- **Every method accepts `CallOptions`** last, so per-call `namespace`, `token`, `wrapTTL`, `signal` and `headers` always work.
- **Base64.** Accept `string | Uint8Array` and encode or decode for the caller (see `transit.ts`).
- **Lists.** `list()` returns `[]` for empty or missing paths instead of throwing a 404.
- **No runtime dependencies.** The package uses only platform APIs (`fetch`, `TextEncoder`, `atob`/`btoa`). Node-only APIs must be loaded with a dynamic `import()` inside the method that needs them, as `loginWithServiceAccount` does.

## Commits and releases

Commits follow [Conventional Commits](https://www.conventionalcommits.org). semantic-release reads them on `main` to pick the next version, write `CHANGELOG.md` and publish both `@sourceregistry/openbao-js` and `openbao-js` to npm.

| Commit | Release while on 0.x |
| --- | --- |
| `fix: ...` | patch (0.1.0 → 0.1.1) |
| `feat: ...` | minor (0.1.0 → 0.2.0) |
| `feat!: ...` or a `BREAKING CHANGE:` footer | minor (0.1.0 → 0.2.0) |
| `docs:`, `test:`, `refactor:`, `build:`, `ci:`, `chore:` | no release |

Use `fix`/`feat` only for changes users of the package will notice. Tooling, CI and test changes use the non-releasing types.

**Don't write `[skip ci]` (or `[ci skip]`) in a commit message**, not even quoted. GitHub skips every workflow for a head commit containing it, so the PR gets no checks. Only the automated `chore(release)` commit uses it.

## Pull requests

1. Branch from `main` and keep each PR focused on one change.
2. Run `npm run check` (and `npm run docs` if you changed public APIs).
3. Open the PR. CI runs unit tests on Node 20, 22 and 24, the integration suite and the docs build.
4. PRs are merged with **rebase**, so each commit lands on `main` as written. Make every commit message a valid Conventional Commit.

## Dependencies

Dependabot opens weekly grouped PRs for dev tooling and GitHub Actions. Two majors are pinned on purpose:

- **TypeScript stays on 6.x.** TypeScript 7 ships no compiler API, which tsup (declaration output) and TypeDoc need.
- **`conventional-changelog-conventionalcommits` stays on 9.x.** Version 10 needs a changelog writer that the semantic-release plugins don't use yet.

Raise an issue before lifting either pin.

## License

By contributing, you agree that your contributions are licensed under the [Apache-2.0 License](LICENSE).
