# openbao-js

Typed, ergonomic, **zero-dependency** TypeScript client for the [OpenBao](https://openbao.org) HTTP API.

[![npm](https://img.shields.io/npm/v/@sourceregistry/openbao-js)](https://www.npmjs.com/package/@sourceregistry/openbao-js)
[![CI](https://github.com/SourceRegistry/openbao-js/actions/workflows/release.yml/badge.svg)](https://github.com/SourceRegistry/openbao-js/actions/workflows/release.yml)
[![Docs](https://img.shields.io/badge/docs-typedoc-blue)](https://sourceregistry.github.io/openbao-js/)

📖 **API reference:** https://sourceregistry.github.io/openbao-js/

- Built on the platform `fetch` — works in Node.js ≥ 20, Bun, Deno, and edge runtimes
- ESM + CommonJS builds with full type declarations
- Namespaces, response wrapping, retries with backoff, timeouts, typed errors
- Typed helpers for common workflows; every other endpoint via `bao.request()`

> **Status: 0.x** — the API may still change between minor versions. Pin a minor range (`~0.x.y`) if you need stability.

### API coverage

Typed helpers cover what applications and pipelines typically do: KV, transit, database credentials, PKI issuance, SSH, TOTP, identity, logins for every auth method, response wrapping, and the common `sys/*` endpoints (health, seal, mounts, auth, policies, leases, namespaces, capabilities, tools, audit).

Not (yet) wrapped: mostly operator endpoints — `sys/generate-root`, `sys/rekey`, `sys/storage/raft`, `sys/quotas`, `sys/plugins`, `sys/config/*`, `sys/pprof`, `sys/monitor` — plus the Kubernetes, LDAP and RabbitMQ secrets engines and some advanced PKI/transit features. These all work today through the [raw API](#raw-api-access); open an issue if you'd like a typed helper.

The same package is published under two names — use whichever you prefer:

```sh
npm install @sourceregistry/openbao-js
# or
npm install openbao-js
```

## Quick start

```ts
import { OpenBao } from '@sourceregistry/openbao-js';

const bao = new OpenBao({
  address: 'https://bao.example.com:8200', // default: $BAO_ADDR / $VAULT_ADDR / http://127.0.0.1:8200
  token: process.env.BAO_TOKEN,            // default: $BAO_TOKEN / $VAULT_TOKEN
  namespace: 'team-a',                     // optional, default: $BAO_NAMESPACE
});

// KV v2
const kv = bao.kv2('secret');
await kv.write('app/db', { username: 'app', password: 's3cr3t' });
const { password } = await kv.get<{ username: string; password: string }>('app/db');

// Transit
const transit = bao.transit();
const ciphertext = await transit.encrypt('orders', 'card=4111...');
const plaintext = await transit.decrypt('orders', ciphertext);
```

## Authentication

Login helpers return the `auth` block **and store the token on the client** so subsequent calls are authenticated. Pass `{ setToken: false }` to opt out.

```ts
// AppRole
await bao.auth.approle().login(roleId, secretId);

// Userpass / LDAP / RADIUS
await bao.auth.userpass().login('alice', 'password');
await bao.auth.ldap('corp-ldap').login('alice', 'password');

// JWT (e.g. GitHub Actions, GitLab CI)
await bao.auth.jwt('github').login(idToken, 'ci-role');

// Kubernetes (reads the projected service-account token)
await bao.auth.kubernetes().loginWithServiceAccount('my-app');

// Any other auth method
await bao.auth.method('github').login({ token: ghToken });
```

Keep a renewable token alive in a long-running service:

```ts
const renewer = bao.auth.token.keepAlive({ onError: console.error });
// ...
renewer.stop();
```

Token management:

```ts
const child = await bao.auth.token.create({ policies: ['read-only'], ttl: '1h' });
const info = await bao.auth.token.lookupSelf();
await bao.auth.token.revoke(child.client_token);
```

## Scoped clients

`withNamespace` and `withToken` return independent copies — changing the token on one never affects another.

```ts
const teamB = bao.withNamespace('team-b');
const asApp = bao.withToken(appToken);
```

## Secrets engines

Every engine is created through a factory that accepts the mount path, so you can use multiple mounts side by side.

| Factory | Engine | Highlights |
| --- | --- | --- |
| `bao.kv2(mount = 'secret')` | KV v2 | `get`, `read`, `write` (CAS), `patch`, `list`, `scan`, `listDetailed`, `delete`/`undelete`/`destroy`, metadata, config |
| `bao.kv1(mount = 'kv')` | KV v1 | `get`, `set`, `delete`, `list` |
| `bao.cubbyhole` | Cubbyhole | same as KV v1 |
| `bao.transit(mount = 'transit')` | Transit | keys, `encrypt`/`decrypt` (base64 handled for you), batch, `rewrap`, data keys, `sign`/`verify`, `hmac`, `random`, `hash` |
| `bao.pki(mount = 'pki')` | PKI | `issue`, `sign`, `revoke`, roles, root/intermediate lifecycle, issuers, URLs, CRL, tidy |
| `bao.database(mount = 'database')` | Database | connections, roles, static roles, `creds` (with lease), `staticCreds`, rotation |
| `bao.totp(mount = 'totp')` | TOTP | keys, `code`, `validate` |
| `bao.ssh(mount = 'ssh')` | SSH | CA config, roles, `sign`, `issue`, OTP |
| `bao.identity` | Identity | entities, groups, aliases, lookup, OIDC identity tokens |

Collections of named configuration objects (roles, users, connections, …) share one shape:

```ts
await bao.pki().roles.write('web', { allowed_domains: ['example.com'], allow_subdomains: true });
await bao.pki().roles.list();        // ['web']
await bao.pki().roles.read('web');
await bao.pki().roles.exists('api'); // false
await bao.pki().roles.delete('web');
```

Dynamic credentials return the full envelope so the lease can be managed:

```ts
const creds = await bao.database().creds('readonly');
console.log(creds.data.username, creds.lease_id, creds.lease_duration);
await bao.sys.leases.renew(creds.lease_id, '1h');
await bao.sys.leases.revoke(creds.lease_id);
```

## System backend

```ts
await bao.sys.health();                       // never throws for sealed/standby — inspect the flags
await bao.sys.mounts.enable('kv-team', { type: 'kv', options: { version: '2' } });
await bao.sys.auth.enable('approle', { type: 'approle' });
await bao.sys.policies.acl.write('app', `path "secret/data/app/*" { capabilities = ["read"] }`);
await bao.sys.capabilitiesSelf(['secret/data/app/db']);
await bao.sys.namespaces.create('team-a');
await bao.sys.tools.random(32);
```

Also available: `seal`, `unseal`, `init`, `leader`, `stepDown`, `rotate`, `keyStatus`, `versionHistory`, `metrics`, `sys.audit`, `sys.leases`, `sys.policies.password`, `sys.wrapping`.

## Response wrapping

```ts
// Hand a secret-id to a workload without exposing it in transit
const wrap = await bao.auth.approle().generateWrappedSecretId('my-app', '5m');
// ... deliver wrap.token, then on the workload:
const { data } = await bao.sys.wrapping.unwrap<{ secret_id: string }>(wrap.token);

// Wrap any request
await bao.read('secret/data/app/db', { wrapTTL: '1m' });
```

## Raw API access

Every OpenBao endpoint is reachable, typed helper or not, with the same namespace, token, wrapping, retry and error handling. Paths are relative to `/v1/`.

```ts
const creds = await bao.read<{ username: string; password: string }>('rabbitmq/creds/my-role');
await bao.write('rabbitmq/config/connection', { connection_uri: '...', username: '...', password: '...' });
await bao.list('auth/approle/role');
await bao.request({ method: 'PUT', path: 'sys/plugins/reload/backend', body: { plugin: 'kv' } });
```

## Errors

```ts
import { OpenBaoError, OpenBaoConnectionError, isNotFound } from '@sourceregistry/openbao-js';

try {
  await bao.kv2().get('missing');
} catch (err) {
  if (isNotFound(err)) { /* 404 */ }
  if (err instanceof OpenBaoError) console.log(err.status, err.errors);
  if (err instanceof OpenBaoConnectionError && err.timedOut) { /* timeout */ }
}
```

`list()` helpers return `[]` instead of throwing when a path has no entries.

## Configuration

| Option | Default | Description |
| --- | --- | --- |
| `address` | `$BAO_ADDR`, `$VAULT_ADDR`, `http://127.0.0.1:8200` | Server URL |
| `token` | `$BAO_TOKEN`, `$VAULT_TOKEN` | Client token |
| `namespace` | `$BAO_NAMESPACE`, `$VAULT_NAMESPACE` | Sent as `X-Vault-Namespace` |
| `timeout` | `60000` | Per-request timeout (ms), `0` disables |
| `retry` | `{ retries: 2, statusCodes: [412, 429, 503] }` | Exponential backoff with jitter; honours `Retry-After`. `false` disables |
| `headers` | `{}` | Extra headers on every request |
| `fetch` | `globalThis.fetch` | Custom fetch implementation |
| `requestInit` | – | Extra `RequestInit` fields, e.g. an undici `dispatcher` |
| `requestHeader` | `true` | Send `X-Vault-Request: true` |
| `useEnv` | `true` | Read defaults from environment variables |

### Custom TLS (CA bundle, client certificates)

```ts
import { Agent } from 'undici';
import { readFileSync } from 'node:fs';

const bao = new OpenBao({
  address: 'https://bao.internal:8200',
  requestInit: {
    dispatcher: new Agent({
      connect: { ca: readFileSync('ca.pem'), cert: readFileSync('client.pem'), key: readFileSync('client-key.pem') },
    }),
  },
});
await bao.auth.cert().login();
```

## Development

See [CONTRIBUTING.md](CONTRIBUTING.md) for the full guide: project layout, adding a helper, commit conventions.

```sh
npm ci
npm run check            # typecheck + unit tests + build
npm run docs             # API reference → ./docs (TypeDoc)

# integration tests against a real dev server
docker run --rm -p 8200:8200 openbao/openbao server -dev -dev-root-token-id=root -dev-listen-address=0.0.0.0:8200
BAO_ADDR=http://127.0.0.1:8200 BAO_TOKEN=root npm run test:integration
```

Commits follow [Conventional Commits](https://www.conventionalcommits.org) — while on 0.x, `feat:` and breaking changes (`feat!:` / `BREAKING CHANGE:`) → minor, `fix:` → patch. Releases are fully automated by semantic-release on push to `main` (`next` / `beta` publish prereleases); each release updates [CHANGELOG.md](CHANGELOG.md) and the [GitHub releases](https://github.com/SourceRegistry/openbao-js/releases). Dependabot proposes weekly tooling updates as `build(deps)` / `ci` PRs, which don't trigger a release.

## Releasing / publishing

Both `@sourceregistry/openbao-js` and `openbao-js` are published from `.github/workflows/release.yml`. For each package, `@semantic-release/npm` **tries OIDC trusted publishing first** and only falls back to the `NPM_TOKEN` secret when that fails.

1. **First release:** add an npm automation/granular token as the repository secret `NPM_TOKEN` (it needs publish rights for both names and the `@sourceregistry` scope). Make sure the `v0.0.0` baseline tag is on GitHub (`git push origin v0.0.0`), then push a `feat:` commit to `main` → **0.1.0**.
2. **After the first release:** on npmjs.com, open each package → *Settings* → *Trusted Publisher* → GitHub Actions, with organization `SourceRegistry`, repository `openbao-js`, workflow `release.yml`.
3. Delete the `NPM_TOKEN` secret. All future releases publish via OIDC with provenance.

**Going 1.0:** remove the `{ "breaking": true, "release": "minor" }` rule from `.releaserc.json` and land a commit with a `BREAKING CHANGE:` footer — semantic-release will publish 1.0.0.

## License

Apache-2.0
