# @pearl-framework/cache

Key/value caching for Pearl.js, with a process-local store for single-process apps and a Redis store for everything else.

Part of [Pearl.js](https://github.com/pearl-js/pearl.js). Installed for you by `@pearl-framework/pearl`.

---

## Installation

```bash
npm install @pearl-framework/cache
npm install ioredis          # only for RedisStore
```

`ioredis` is an optional peer dependency — the memory store needs nothing extra.

---

## Getting Started

```typescript
import { Cache, MemoryStore } from '@pearl-framework/cache'

const cache = new Cache(new MemoryStore(), { ttlSeconds: 300 })

await cache.put('plan:free', { seats: 3 })
const plan = await cache.get<{ seats: number }>('plan:free')
```

The cache handles serialization, so values round-trip as the shape you stored.

---

## `remember`

The pattern worth reaching for: return the cached value, or compute it once and cache it.

```typescript
const user = await cache.remember(`user:${id}`, () => db.findUser(id), 600)
```

A `null` result is cached too. That matters — a lookup that legitimately finds nothing would otherwise re-run on every request, which is the hot path caching exists to protect. Use `has()` if you need to tell a cached `null` from a miss.

If the factory throws, nothing is cached and the error propagates.

```typescript
await cache.rememberForever('config:regions', () => loadRegions())  // ignores the default TTL
```

---

## API

| Method | Behaviour |
|---|---|
| `get<T>(key)` | Value, or `undefined` when absent |
| `has(key)` | Distinguishes a cached `null` from a miss |
| `put(key, value, ttl?)` | Store, using the default TTL when omitted |
| `remember(key, factory, ttl?)` | Cached value, else compute and cache |
| `rememberForever(key, factory)` | As above with no expiry |
| `pull<T>(key)` | Read, then remove |
| `forget(key)` | Remove one key |
| `flush()` | Remove everything this store owns |
| `increment(key, by?, ttl?)` | Atomic; returns the new value |
| `decrement(key, by?, ttl?)` | Atomic; returns the new value |

---

## Stores

### MemoryStore

Process-local. Entries are not shared between workers and are lost on restart.

```typescript
new MemoryStore({ maxEntries: 10_000 })   // default
```

Bounded on purpose. An unbounded process-local cache is a memory leak for any key space the caller does not control — user ids, URLs, search terms — so once `maxEntries` is reached the entry closest to expiry is evicted, preferring expiring entries over ones stored without a TTL.

### RedisStore

Shared across processes, survives restarts.

```typescript
import Redis from 'ioredis'
import { RedisStore } from '@pearl-framework/cache'

const store = new RedisStore(new Redis(process.env.REDIS_URL!), { prefix: 'myapp:cache:' })
```

The prefix keeps keys from colliding with other users of the same database and scopes `flush()` so it cannot delete another application's data. `flush()` uses `SCAN`, not `KEYS` — the latter blocks the server for the length of the keyspace.

The constructor accepts anything structurally matching `RedisLike`, so a cluster client or a test fake works without this package depending on `ioredis` at runtime.

### Writing your own

Implement `CacheStore`. Values arrive already serialized, so a store only ever deals in strings.

```typescript
export interface CacheStore {
  get(key: string): Promise<string | null>
  set(key: string, value: string, ttlSeconds?: number): Promise<void>
  forget(key: string): Promise<void>
  flush(): Promise<void>
  increment(key: string, by: number, ttlSeconds?: number): Promise<number>
  expiresAt(key: string): Promise<number | null>
}
```

---

## Distributed rate limiting

The rate-limit store that ships with `@pearl-framework/http` is process-local, so behind more than one worker each process keeps its own counters and the effective limit becomes `max × processes`. `CacheRateLimitStore` fixes that:

```typescript
import { RateLimiter } from '@pearl-framework/http'
import { CacheRateLimitStore, RedisStore } from '@pearl-framework/cache'

RateLimiter.useStore(new CacheRateLimitStore(new RedisStore(redis)))
```

The window is fixed from the first hit rather than sliding: the TTL is applied only by the increment that creates the key, so a caller who keeps hitting the endpoint still gets a reset.

---

## Service provider

```typescript
import { CacheServiceProvider, RedisStore } from '@pearl-framework/cache'
import type { CacheServiceConfig } from '@pearl-framework/cache'

export class AppCacheServiceProvider extends CacheServiceProvider {
  protected config: CacheServiceConfig = {
    store: new RedisStore(new Redis(process.env.REDIS_URL!)),
    ttlSeconds: 300,
  }
}
```

Register it, then resolve `Cache` from the container:

```typescript
const cache = app.container.make(Cache)
```

---

## Related

- [`@pearl-framework/http`](../http#readme) — rate limiting that can use this package's stores
- [`@pearl-framework/core`](../core#readme) — container and service providers
