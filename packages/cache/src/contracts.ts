/**
 * Backing store for the cache. Implement this to add a driver.
 *
 * Values are handed to the store already serialized to a string, so a store
 * only ever deals in strings and never needs to know about JSON.
 */
export interface CacheStore {
    get(key: string): Promise<string | null>
    /** `ttlSeconds` of undefined means store without expiry. */
    set(key: string, value: string, ttlSeconds?: number): Promise<void>
    forget(key: string): Promise<void>
    /** Remove every key this store owns. */
    flush(): Promise<void>
    /**
     * Atomic increment, creating the key at 0 first. Returns the new value.
     * Used by rate limiting, where a read-modify-write would race.
     */
    increment(key: string, by: number, ttlSeconds?: number): Promise<number>
    /** Milliseconds since the epoch at which `key` expires, or null if it has no expiry. */
    expiresAt(key: string): Promise<number | null>
}
