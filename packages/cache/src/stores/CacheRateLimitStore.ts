import type { CacheStore } from '../contracts.js'

/**
 * Adapts a `CacheStore` to `@pearl-framework/http`'s `RateLimitStore`, so
 * limits can be enforced across processes.
 *
 * The in-memory rate-limit store that ships with the HTTP package is
 * process-local: behind more than one worker each process keeps its own
 * counters, so the effective limit is `max × processes`. Backing it with
 * `RedisStore` makes the window shared.
 *
 *   RateLimiter.useStore(new CacheRateLimitStore(new RedisStore(redis)))
 */
export class CacheRateLimitStore {
    constructor(
        private readonly store: CacheStore,
        private readonly prefix = 'ratelimit:',
    ) {}

    async hit(key: string, windowMs: number): Promise<{ count: number; resetAt: number }> {
        if (!Number.isFinite(windowMs) || windowMs <= 0) {
            throw new Error(
                `CacheRateLimitStore: windowMs must be a positive, finite number (got ${String(windowMs)})`,
            )
        }

        const full = `${this.prefix}${key}`
        const ttlSeconds = windowMs / 1000

        // increment applies the TTL only when it creates the key, so the window
        // is fixed from the first hit rather than sliding on every request.
        const count = await this.store.increment(full, 1, ttlSeconds)
        const expiry = await this.store.expiresAt(full)

        return {
            count,
            // A missing expiry means the key was created without one; fall back
            // to a full window so the caller never sees a reset in the past.
            resetAt: expiry ?? Date.now() + windowMs,
        }
    }

    async reset(key: string): Promise<void> {
        await this.store.forget(`${this.prefix}${key}`)
    }
}
