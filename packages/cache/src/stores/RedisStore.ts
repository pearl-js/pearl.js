import type { CacheStore } from '../contracts.js'

/**
 * The slice of ioredis this store uses. Declared structurally so the package
 * does not hard-depend on ioredis — any client with these methods works, and
 * tests can pass a fake.
 */
export interface RedisLike {
    get(key: string): Promise<string | null>
    set(key: string, value: string): Promise<unknown>
    set(key: string, value: string, mode: 'EX', ttl: number): Promise<unknown>
    del(...keys: string[]): Promise<number>
    incrby(key: string, by: number): Promise<number>
    expire(key: string, seconds: number): Promise<number>
    pttl(key: string): Promise<number>
    scan(cursor: string, match: 'MATCH', pattern: string, count: 'COUNT', n: number): Promise<[string, string[]]>
}

export interface RedisStoreOptions {
    /**
     * Prefixed onto every key. Keeps cache keys from colliding with other
     * users of the same Redis database, and scopes `flush()` so it cannot
     * delete another application's data.
     */
    prefix?: string
}

/**
 * Redis-backed cache. Values are shared across processes and survive restarts.
 *
 * Pass an ioredis client (or anything matching `RedisLike`):
 *
 *   new RedisStore(new Redis(process.env.REDIS_URL), { prefix: 'cache:' })
 */
export class RedisStore implements CacheStore {
    private readonly prefix: string

    constructor(
        private readonly client: RedisLike,
        options: RedisStoreOptions = {},
    ) {
        this.prefix = options.prefix ?? 'pearl:cache:'
    }

    async get(key: string): Promise<string | null> {
        return this.client.get(this.k(key))
    }

    async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
        if (ttlSeconds === undefined) {
            await this.client.set(this.k(key), value)
            return
        }
        assertTtl(ttlSeconds)
        // Redis EX takes whole seconds and rejects 0, so round up.
        await this.client.set(this.k(key), value, 'EX', Math.max(1, Math.ceil(ttlSeconds)))
    }

    async forget(key: string): Promise<void> {
        await this.client.del(this.k(key))
    }

    /**
     * Delete every key under this store's prefix. Uses SCAN rather than KEYS,
     * which blocks the server for the length of the keyspace.
     */
    async flush(): Promise<void> {
        let cursor = '0'
        do {
            const [next, keys] = await this.client.scan(cursor, 'MATCH', `${this.prefix}*`, 'COUNT', 500)
            cursor = next
            if (keys.length > 0) await this.client.del(...keys)
        } while (cursor !== '0')
    }

    async increment(key: string, by: number, ttlSeconds?: number): Promise<number> {
        const full = this.k(key)
        const value = await this.client.incrby(full, by)

        // INCRBY creates the key with no expiry. Apply the TTL only when this
        // call created it (value === by), or the window would slide forward on
        // every hit and never reset.
        if (ttlSeconds !== undefined && value === by) {
            assertTtl(ttlSeconds)
            await this.client.expire(full, Math.max(1, Math.ceil(ttlSeconds)))
        }
        return value
    }

    async expiresAt(key: string): Promise<number | null> {
        const ms = await this.client.pttl(this.k(key))
        // -1: key exists with no expiry. -2: key does not exist.
        return ms < 0 ? null : Date.now() + ms
    }

    private k(key: string): string {
        return `${this.prefix}${key}`
    }
}

function assertTtl(ttlSeconds: number): void {
    if (!Number.isFinite(ttlSeconds) || ttlSeconds <= 0) {
        throw new Error(
            `RedisStore: ttlSeconds must be a positive, finite number (got ${String(ttlSeconds)})`,
        )
    }
}
