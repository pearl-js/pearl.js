import type { CacheStore } from '../contracts.js'

interface Entry {
    value: string
    /** Epoch ms, or null for no expiry. */
    expiresAt: number | null
}

export interface MemoryStoreOptions {
    /**
     * Cap on the number of live entries. Once reached, the entry closest to
     * expiry is evicted. Defaults to 10,000 — an unbounded process-local cache
     * is a memory leak under any key space the caller does not control (user
     * ids, URLs, search terms).
     */
    maxEntries?: number
}

/**
 * Process-local cache. Appropriate for a single process; entries are not
 * shared between workers and are lost on restart. Use `RedisStore` when more
 * than one process must see the same value.
 */
export class MemoryStore implements CacheStore {
    private readonly entries = new Map<string, Entry>()
    private readonly maxEntries: number

    constructor(options: MemoryStoreOptions = {}) {
        const max = options.maxEntries ?? 10_000
        if (!Number.isInteger(max) || max < 1) {
            throw new Error('MemoryStore: maxEntries must be a positive integer')
        }
        this.maxEntries = max
    }

    async get(key: string): Promise<string | null> {
        return this.read(key)?.value ?? null
    }

    async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
        this.write(key, value, ttlSeconds)
    }

    async forget(key: string): Promise<void> {
        this.entries.delete(key)
    }

    async flush(): Promise<void> {
        this.entries.clear()
    }

    async increment(key: string, by: number, ttlSeconds?: number): Promise<number> {
        const existing = this.read(key)
        const next = Number(existing?.value ?? 0) + by

        // Preserve the original expiry: re-applying the TTL on every increment
        // would make a rate-limit window slide forward forever and never reset.
        if (existing) {
            existing.value = String(next)
        } else {
            this.write(key, String(next), ttlSeconds)
        }
        return next
    }

    async expiresAt(key: string): Promise<number | null> {
        return this.read(key)?.expiresAt ?? null
    }

    /** Live entry count, expired-but-unswept entries excluded. */
    get size(): number {
        this.sweep()
        return this.entries.size
    }

    private read(key: string): Entry | undefined {
        const entry = this.entries.get(key)
        if (!entry) return undefined
        if (entry.expiresAt !== null && entry.expiresAt <= Date.now()) {
            this.entries.delete(key)
            return undefined
        }
        return entry
    }

    private write(key: string, value: string, ttlSeconds?: number): void {
        if (ttlSeconds !== undefined && (!Number.isFinite(ttlSeconds) || ttlSeconds <= 0)) {
            throw new Error(
                `MemoryStore: ttlSeconds must be a positive, finite number (got ${String(ttlSeconds)})`,
            )
        }

        if (!this.entries.has(key) && this.entries.size >= this.maxEntries) {
            this.evictOne()
        }

        this.entries.set(key, {
            value,
            expiresAt: ttlSeconds === undefined ? null : Date.now() + ttlSeconds * 1000,
        })
    }

    private evictOne(): void {
        this.sweep()
        if (this.entries.size < this.maxEntries) return

        // Nothing expired, so drop whichever entry expires soonest. Entries
        // with no expiry are evicted last — they were stored deliberately.
        let victim: string | undefined
        let soonest = Infinity
        for (const [key, entry] of this.entries) {
            const at = entry.expiresAt ?? Infinity
            if (at < soonest) {
                soonest = at
                victim = key
            }
        }
        // All entries are non-expiring: fall back to the oldest inserted.
        this.entries.delete(victim ?? this.entries.keys().next().value!)
    }

    private sweep(): void {
        const now = Date.now()
        for (const [key, entry] of this.entries) {
            if (entry.expiresAt !== null && entry.expiresAt <= now) this.entries.delete(key)
        }
    }
}
