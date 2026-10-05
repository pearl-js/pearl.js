# @pearl-framework/pearl

## 2.0.0

### Minor Changes

- [#6](https://github.com/pearl-js/pearl.js/pull/6) [`2d04a59`](https://github.com/pearl-js/pearl.js/commit/2d04a59e2eeb06c3c4a2d578db62a4457f92b067) Thanks [@skd09](https://github.com/skd09)! - Add `@pearl-framework/openapi` — an OpenAPI 3.1 document and Swagger UI derived from the route table.

  `serveOpenApi(router, { info })` registers `GET /openapi.json` and `GET /docs`; `generateOpenApiDocument(router, options)` returns the document for a build step instead. Paths, methods and path parameters come from the router, and request schemas come from the `FormRequest` that `ValidationPipe` attaches to the route — so nothing is declared twice and the document cannot drift from the validation that actually runs.

  Because `FormRequest.resolveInput` merges body, query and route params into one object, the generator splits them back apart: fields named by the route become path parameters (always required, since the route cannot match without them), the rest become a request body on `POST`/`PUT`/`PATCH` and query parameters otherwise. The `422` response the framework returns on a validation failure is documented automatically. `HEAD` and `OPTIONS` are excluded by default.

  `describeRoute(method, path, …)` adds what a schema cannot express — summary, description, tags, extra responses, `deprecated`, and `hidden` to omit a route.

  `ValidationPipe` now returns a `ValidationMiddleware` carrying a `formRequest` property. Existing call sites are unaffected; the tag is what makes schema discovery possible without a second declaration.

  The Swagger UI page loads assets from a CDN rather than vendoring them, so it needs network access to that CDN. The document reflects every route the router holds — use `excludePaths` or `hidden`, and put `/docs` behind auth if the API is not meant to be discoverable.

- [#5](https://github.com/pearl-js/pearl.js/pull/5) [`6df8638`](https://github.com/pearl-js/pearl.js/commit/6df86389c032f5f0ce9f0c341c5e9967f27350f1) Thanks [@skd09](https://github.com/skd09)! - Add `@pearl-framework/cache` — a key/value cache with in-memory and Redis stores, plus a distributed rate-limit store.

  `Cache` wraps a `CacheStore` and handles serialization: `get`, `put`, `has`, `pull`, `forget`, `flush`, atomic `increment`/`decrement`, and `remember`/`rememberForever`. `remember` caches a `null` result rather than re-running the factory on every request, and `has()` distinguishes a cached `null` from a miss.

  `MemoryStore` is process-local and bounded (10,000 entries by default), evicting the entry closest to expiry and preferring expiring entries over ones stored without a TTL — an unbounded process-local cache is a memory leak for any key space the caller does not control. `RedisStore` takes any client matching `RedisLike`, so `ioredis` stays an optional peer dependency; it prefixes every key so `flush()` cannot delete another application's data and uses `SCAN` rather than `KEYS`.

  `CacheRateLimitStore` adapts any `CacheStore` to the HTTP package's `RateLimitStore`. The bundled rate-limit store is process-local, so behind more than one worker the effective limit was `max × processes`; backing it with `RedisStore` makes the window shared. The TTL is applied only by the increment that creates the key, so the window is fixed from the first hit instead of sliding forward on every request.

### Patch Changes

- [#1](https://github.com/pearl-js/pearl.js/pull/1) [`8bb577d`](https://github.com/pearl-js/pearl.js/commit/8bb577d2d4c4cd093ac25aabea0883d38d7d67aa) Thanks [@skd09](https://github.com/skd09)! - Add the `repository` and `homepage` fields to the meta package, and pin its publish registry.

  `NPM_CONFIG_PROVENANCE` is enabled for releases, and npm refuses to generate a provenance attestation for a package with no `repository` field — so publishing `@pearl-framework/pearl` would fail while the other ten packages succeeded. Also sets `publishConfig.registry` to match the rest of the workspace.

- Updated dependencies [[`2d04a59`](https://github.com/pearl-js/pearl.js/commit/2d04a59e2eeb06c3c4a2d578db62a4457f92b067), [`3bce1c0`](https://github.com/pearl-js/pearl.js/commit/3bce1c07bc6bcb9ffd8a27e7897a5d134efbc4b1), [`3aea8fc`](https://github.com/pearl-js/pearl.js/commit/3aea8fc5b9c5e62febf4a84225c65330a9dd7bca), [`acadafd`](https://github.com/pearl-js/pearl.js/commit/acadafd9487d9aac38df099ea02c43739d64b56b), [`6df8638`](https://github.com/pearl-js/pearl.js/commit/6df86389c032f5f0ce9f0c341c5e9967f27350f1)]:
  - @pearl-framework/openapi@2.0.0
  - @pearl-framework/validate@2.0.0
  - @pearl-framework/queue@2.0.0
  - @pearl-framework/auth@2.0.0
  - @pearl-framework/http@2.0.0
  - @pearl-framework/cache@2.0.0
  - @pearl-framework/core@2.0.0
  - @pearl-framework/database@2.0.0
  - @pearl-framework/events@2.0.0
  - @pearl-framework/mail@2.0.0

## 1.3.0

### Minor Changes

- Add three primitives every API needs: CORS, named rate limiters, and an authorization gate.

  **@pearl-framework/http**

  - `Cors` middleware — configurable `origin` (string / array / predicate / `true`/`false`), `methods`, `allowedHeaders`, `exposedHeaders`, `credentials`, and `maxAge`. Handles preflight (`OPTIONS`) requests and echoes the specific origin (never `*`) when `credentials` is enabled, as the spec requires.
  - Named rate limiters — `RateLimiter.for('login', (ctx) => ({ windowMs, max }))` plus a `throttle('login')` middleware. Swappable backing store via `RateLimiter.useStore(store)` (e.g. a Redis store for multi-process limits), per-key partitioning, and standard `X-RateLimit-*` / `Retry-After` headers.
  - **Behavior change:** global middleware registered with `router.use()` now runs for _every_ request, including requests that match no route, so cross-cutting middleware like `Cors` can answer preflight requests before the 404. Unmatched requests still return 404 when nothing handles them.

  **@pearl-framework/auth**

  - `Gate` — define abilities and policies in code (`gate.define('edit-post', (user, post) => …)`), then check them with `allows` / `denies` / `authorize`. `authorize()` throws `AccessDeniedError`, which surfaces as an HTTP 403.
  - `can(gate, ability, argResolver?)` middleware — route-level authorization that runs after `Authenticate`, responding 403 when the user fails the ability.

### Patch Changes

- Updated dependencies []:
  - @pearl-framework/auth@1.3.0
  - @pearl-framework/core@1.3.0
  - @pearl-framework/database@1.3.0
  - @pearl-framework/events@1.3.0
  - @pearl-framework/http@1.3.0
  - @pearl-framework/mail@1.3.0
  - @pearl-framework/queue@1.3.0
  - @pearl-framework/validate@1.3.0

## 1.2.0

### Minor Changes

- Move authentication onto Node's built-in `crypto` and fix several auth/validation correctness issues.

  **auth — now zero third-party crypto dependencies**

  - `Hash` now uses Node's `scrypt` instead of `bcryptjs`. **Breaking:** the stored hash format has changed, so password hashes created by earlier versions will no longer verify — plan to re-hash on next successful login or via a password reset.
  - `JwtGuard` now signs and verifies tokens with `node:crypto` instead of `jsonwebtoken` (HS256/384/512 and RS256/384/512). The configured algorithm is enforced on verification (the token's own `alg` header is never trusted); `none`, tampered, and expired tokens are rejected.
  - `bcryptjs` and `jsonwebtoken` (and their `@types`) are removed from dependencies.

  **Fixes**

  - `SessionGuard` rotation no longer silently logs users out — the rotated session id is surfaced via a new `onRotate(newId, oldId)` hook so your cookie layer can re-issue it.
  - `AuthServiceProvider` now wires the session and API-token guards (and resolves the default guard at boot), not just JWT.
  - `FormRequest` no longer lets the request body override route params (mass-assignment hardening); precedence is now body → query → route params.

  **Removed**

  - The non-functional experimental HTTP route decorators (`Controller`, `Get`/`Post`/`Put`/`Patch`/`Delete`) and the `reflect-metadata` dependency. They never produced routes — use the imperative `Router` API.

### Patch Changes

- Updated dependencies []:
  - @pearl-framework/auth@1.2.0
  - @pearl-framework/core@1.2.0
  - @pearl-framework/database@1.2.0
  - @pearl-framework/events@1.2.0
  - @pearl-framework/http@1.2.0
  - @pearl-framework/mail@1.2.0
  - @pearl-framework/queue@1.2.0
  - @pearl-framework/validate@1.2.0

## 1.1.4

### Patch Changes

- Update repository URLs to the pearl-js GitHub organization.

- Updated dependencies []:
  - @pearl-framework/auth@1.1.4
  - @pearl-framework/core@1.1.4
  - @pearl-framework/database@1.1.4
  - @pearl-framework/events@1.1.4
  - @pearl-framework/http@1.1.4
  - @pearl-framework/mail@1.1.4
  - @pearl-framework/queue@1.1.4
  - @pearl-framework/validate@1.1.4

## 1.1.3

### Patch Changes

- Refresh the meta-package's dependency pins so `npm install @pearl-framework/pearl` installs every `@pearl-framework/*` package at 1.1.2. The previous 1.1.2 release of the meta still pinned `core`, `events`, and `queue` at 1.1.1 because those three were bumped to 1.1.2 in a follow-up release that never re-published the meta. No code changes; this release exists only to align the installed dependency tree.

  - @pearl-framework/core@1.1.2
  - @pearl-framework/events@1.1.2
  - @pearl-framework/queue@1.1.2

## 1.1.2

### Patch Changes

- Updated dependencies [[`8596d0f`](https://github.com/skd09/pearl.js/commit/8596d0f137e89b9a15fb4eececceba22c720fa2e), [`de92297`](https://github.com/skd09/pearl.js/commit/de92297f5101deefa4511b9f33c55bcedc7a8ad8)]:
  - @pearl-framework/http@1.1.2
  - @pearl-framework/database@1.1.2
  - @pearl-framework/mail@1.1.2
  - @pearl-framework/auth@1.1.2
  - @pearl-framework/validate@1.1.2
