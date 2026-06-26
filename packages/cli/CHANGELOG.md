# @pearl-framework/cli

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

## 1.1.4

### Patch Changes

- Update repository URLs to the pearl-js GitHub organization.

## 1.1.3

### Patch Changes

- Align with 1.1.3 release. No source-level changes; bumped so every @pearl-framework/\* package shares the same version line (see .changeset/config.json `fixed` rule).

## 1.1.2

### Patch Changes

- Align version with the 1.1.2 release. No functional changes; published so apps that pin a single version across the suite (e.g. `^1.1.2`) can upgrade in one step.
