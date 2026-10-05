import type { CacheStore } from './contracts.js'

/** Sentinel distinguishing "cached null" from "not cached". */
const MISS = Symbol('cache.miss')

export interface CacheOptions {
    /** Default TTL in seconds applied when a call does not pass one. Omit for no expiry. */
    ttlSeconds?: number
}

/**
 * Cache facade over a `CacheStore`.
 *
 *   const cache = new Cache(new MemoryStore(), { ttlSeconds: 300 })
 *   const user = await cache.remember(`user:${id}`, () => db.findUser(id))
 */
export class Cache {
    constructor(
        private readonly store: CacheStore,
        private readonly options: CacheOptions = {},
    ) {}

    async get<T>(key: string): Promise<T | undefined> {
        const decoded = await this.read<T>(key)
        return decoded === MISS ? undefined : decoded
    }

    async has(key: string): Promise<boolean> {
        return (await this.read(key)) !== MISS
    }

    async put<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
        await this.store.set(key, JSON.stringify(value), this.ttl(ttlSeconds))
    }

    async forget(key: string): Promise<void> {
        await this.store.forget(key)
    }

    async flush(): Promise<void> {
        await this.store.flush()
    }

    /**
     * Return the cached value, or compute it, cache it, and return it.
     *
     * A `null` or `undefined` result from `factory` is cached too — otherwise
     * a lookup that legitimately finds nothing re-runs on every request, which
     * is exactly the hot path caching is meant to protect.
     */
    async remember<T>(key: string, factory: () => T | Promise<T>, ttlSeconds?: number): Promise<T> {
        const cached = await this.read<T>(key)
        if (cached !== MISS) return cached

        const value = await factory()
        await this.put(key, value, ttlSeconds)
        return value
    }

    /** `remember` with no expiry, regardless of the default TTL. */
    async rememberForever<T>(key: string, factory: () => T | Promise<T>): Promise<T> {
        const cached = await this.read<T>(key)
        if (cached !== MISS) return cached

        const value = await factory()
        await this.store.set(key, JSON.stringify(value))
        return value
    }

    /** Read, then delete. Returns undefined when the key was not present. */
    async pull<T>(key: string): Promise<T | undefined> {
        const value = await this.get<T>(key)
        if (value !== undefined) await this.forget(key)
        return value
    }

    /** Atomic increment. Returns the new value. */
    async increment(key: string, by = 1, ttlSeconds?: number): Promise<number> {
        return this.store.increment(key, by, this.ttl(ttlSeconds))
    }

    async decrement(key: string, by = 1, ttlSeconds?: number): Promise<number> {
        return this.store.increment(key, -by, this.ttl(ttlSeconds))
    }

    private async read<T>(key: string): Promise<T | typeof MISS> {
        const raw = await this.store.get(key)
        if (raw === null) return MISS
        try {
            return JSON.parse(raw) as T
        } catch {
            // Someone else wrote a non-JSON value under this key. Treat it as a
            // miss rather than throwing on a read path.
            return MISS
        }
    }

    private ttl(override?: number): number | undefined {
        return override ?? this.options.ttlSeconds
    }
}
