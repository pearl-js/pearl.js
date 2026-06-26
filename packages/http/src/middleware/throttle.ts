import type { HttpContext } from '../http/HttpContext.js'
import type { MiddlewareFn, NextFn } from '../routing/Pipeline.js'
import { MemoryRateLimitStore, type RateLimitStore } from './RateLimit.js'

/** The limit a named limiter applies to a given request. */
export interface Limit {
    /** Window length in milliseconds. */
    windowMs: number
    /** Max requests allowed per key within the window. */
    max: number
    /** Partition key — defaults to the client IP. Use it to limit per-user, per-tenant, etc. */
    key?: string
    /** Override the 429 response body. */
    message?: string
}

export type LimitResolver = (ctx: HttpContext) => Limit

function clientIp(ctx: HttpContext): string {
    return ctx.request.nodeRequest.socket.remoteAddress ?? 'unknown'
}

/**
 * Registry of named rate limiters (Laravel-style).
 *
 *   RateLimiter.useStore(redisStore)                       // optional, defaults to in-memory
 *   RateLimiter.for('login', () => ({ windowMs: 15 * 60_000, max: 5 }))
 *   RateLimiter.for('api', (ctx) => ({ windowMs: 60_000, max: 60, key: ctx.get('auth.user')?.id }))
 *
 * Then apply per route with the `throttle()` middleware.
 */
export class RateLimiter {
    private static store: RateLimitStore = new MemoryRateLimitStore()
    private static readonly limiters = new Map<string, LimitResolver>()

    /** Swap the backing store — e.g. a Redis store so limits hold across processes. */
    static useStore(store: RateLimitStore): void {
        RateLimiter.store = store
    }

    /** Define a named limiter. */
    static for(name: string, resolver: LimitResolver): void {
        RateLimiter.limiters.set(name, resolver)
    }

    static resolve(name: string): LimitResolver | undefined {
        return RateLimiter.limiters.get(name)
    }

    static get currentStore(): RateLimitStore {
        return RateLimiter.store
    }

    /** Remove all registered limiters (useful in tests). */
    static clear(): void {
        RateLimiter.limiters.clear()
    }
}

/**
 * Apply a named limiter defined via `RateLimiter.for(name, …)`.
 *
 *   router.post('/auth/login', handler, [throttle('login')])
 */
export function throttle(name: string): MiddlewareFn {
    return async (ctx: HttpContext, next: NextFn): Promise<void> => {
        const resolver = RateLimiter.resolve(name)
        if (!resolver) {
            throw new Error(
                `No rate limiter named "${name}". Define it with RateLimiter.for('${name}', …) ` +
                `before using throttle('${name}').`,
            )
        }

        const limit = resolver(ctx)
        const store = RateLimiter.currentStore
        const bucketKey = `${name}:${limit.key ?? clientIp(ctx)}`

        const { count, resetAt } = await store.hit(bucketKey, limit.windowMs)
        const remaining = Math.max(0, limit.max - count)
        const resetSeconds = Math.ceil((resetAt - Date.now()) / 1000)

        ctx.response.header('x-ratelimit-limit', String(limit.max))
        ctx.response.header('x-ratelimit-remaining', String(remaining))
        ctx.response.header('x-ratelimit-reset', String(Math.max(0, resetSeconds)))

        if (count > limit.max) {
            ctx.response.header('retry-after', String(Math.max(1, resetSeconds)))
            ctx.response.status(429).json({ message: limit.message ?? 'Too many requests' })
            return
        }

        await next()
    }
}
