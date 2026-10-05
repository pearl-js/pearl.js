# @pearl-framework/cache

## 2.0.0

### Minor Changes

- [#5](https://github.com/pearl-js/pearl.js/pull/5) [`6df8638`](https://github.com/pearl-js/pearl.js/commit/6df86389c032f5f0ce9f0c341c5e9967f27350f1) Thanks [@skd09](https://github.com/skd09)! - Add `@pearl-framework/cache` — a key/value cache with in-memory and Redis stores, plus a distributed rate-limit store.

  `Cache` wraps a `CacheStore` and handles serialization: `get`, `put`, `has`, `pull`, `forget`, `flush`, atomic `increment`/`decrement`, and `remember`/`rememberForever`. `remember` caches a `null` result rather than re-running the factory on every request, and `has()` distinguishes a cached `null` from a miss.

  `MemoryStore` is process-local and bounded (10,000 entries by default), evicting the entry closest to expiry and preferring expiring entries over ones stored without a TTL — an unbounded process-local cache is a memory leak for any key space the caller does not control. `RedisStore` takes any client matching `RedisLike`, so `ioredis` stays an optional peer dependency; it prefixes every key so `flush()` cannot delete another application's data and uses `SCAN` rather than `KEYS`.

  `CacheRateLimitStore` adapts any `CacheStore` to the HTTP package's `RateLimitStore`. The bundled rate-limit store is process-local, so behind more than one worker the effective limit was `max × processes`; backing it with `RedisStore` makes the window shared. The TTL is applied only by the increment that creates the key, so the window is fixed from the first hit instead of sliding forward on every request.

### Patch Changes

- Updated dependencies []:
  - @pearl-framework/core@2.0.0
