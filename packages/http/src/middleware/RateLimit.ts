import type { HttpContext } from '../http/HttpContext.js'
import type { MiddlewareClass, NextFn } from '../routing/Pipeline.js'

/**
 * Backing store for rate-limit counters. Default is an in-memory store
 * appropriate for single-process apps. For multi-process / horizontally
 * scaled deployments, supply a Redis-backed implementation.
 */
export interface RateLimitStore {
    /**
     * Increment the counter for `key` and return the current count plus
     * the timestamp (ms since epoch) at which the window resets.
     */
    hit(key: string, windowMs: number): Promise<{ count: number; resetAt: number }>
    reset(key: string): Promise<void>
}

export interface RateLimitOptions {
    /** Window length in milliseconds. */
    windowMs: number
    /** Max requests allowed per key within the window. */
    max: number
    /** Key extractor — defaults to the client IP (see `trustProxy`). */
    keyGenerator?: (ctx: HttpContext) => string
    /** Override the 429 response body. */
    message?: string
    /** Custom store. Defaults to a process-local in-memory store. */
    store?: RateLimitStore
    /**
     * When true (default), adds `X-RateLimit-Limit`, `X-RateLimit-Remaining`,
     * and `X-RateLimit-Reset` headers to responses.
     */
    standardHeaders?: boolean
    /**
     * Whether to trust `X-Forwarded-For` for the client IP.
     *
     * **Default: `false`** — uses `socket.remoteAddress` only.
     *
     * Set to `true` ONLY when your app sits behind a reverse proxy (nginx,
     * Cloudflare, ELB, etc.) that overwrites the header. If you trust
     * `X-Forwarded-For` while running on the public internet, any client
     * can send their own header and bypass the rate limit entirely.
     */
    trustProxy?: boolean
}

export class MemoryRateLimitStore implements RateLimitStore {
    private readonly buckets = new Map<string, { count: number; resetAt: number }>()

    async hit(key: string, windowMs: number): Promise<{ count: number; resetAt: number }> {
        const now = Date.now()
        const existing = this.buckets.get(key)

        if (!existing || existing.resetAt <= now) {
            const bucket = { count: 1, resetAt: now + windowMs }
            this.buckets.set(key, bucket)
            this.sweepIfNeeded(now)
            return bucket
        }

        existing.count++
        return existing
    }

    async reset(key: string): Promise<void> {
        this.buckets.delete(key)
    }

    /** Best-effort cleanup of expired buckets — bounded work per call. */
    private lastSweep = 0
    private sweepIfNeeded(now: number): void {
        if (now - this.lastSweep < 60_000) return
        this.lastSweep = now
        for (const [key, bucket] of this.buckets) {
            if (bucket.resetAt <= now) this.buckets.delete(key)
        }
    }
}

const defaultStore = new MemoryRateLimitStore()

function makeDefaultKey(trustProxy: boolean): (ctx: HttpContext) => string {
    return (ctx) => {
        if (trustProxy) {
            const fwd = ctx.request.header('x-forwarded-for')
            if (fwd) {
                const first = fwd.split(',')[0]
                if (first) return first.trim()
            }
        }
        const socket = ctx.request.nodeRequest.socket
        return socket.remoteAddress ?? 'unknown'
    }
}

/**
 * Fixed-window rate-limit middleware.
 *
 * Usage:
 *   router.use(new RateLimit({ windowMs: 60_000, max: 100 }))
 *
 *   // Per-route:
 *   router.post('/login', handler, [
 *     new RateLimit({ windowMs: 15 * 60_000, max: 5 }),
 *   ])
 */
export class RateLimit implements MiddlewareClass {
    private readonly store: RateLimitStore
    private readonly keyGenerator: (ctx: HttpContext) => string
    private readonly standardHeaders: boolean

    constructor(private readonly options: RateLimitOptions) {
        if (!Number.isFinite(options.windowMs) || options.windowMs <= 0) {
            throw new Error('RateLimit: windowMs must be a positive number')
        }
        if (!Number.isFinite(options.max) || options.max <= 0) {
            throw new Error('RateLimit: max must be a positive number')
        }
        this.store = options.store ?? defaultStore
        this.keyGenerator = options.keyGenerator ?? makeDefaultKey(options.trustProxy ?? false)
        this.standardHeaders = options.standardHeaders ?? true
    }

    async handle(ctx: HttpContext, next: NextFn): Promise<void> {
        const key = this.keyGenerator(ctx)
        const { count, resetAt } = await this.store.hit(key, this.options.windowMs)
        const remaining = Math.max(0, this.options.max - count)
        const resetSeconds = Math.ceil((resetAt - Date.now()) / 1000)

        if (this.standardHeaders) {
            ctx.response.header('x-ratelimit-limit', String(this.options.max))
            ctx.response.header('x-ratelimit-remaining', String(remaining))
            ctx.response.header('x-ratelimit-reset', String(Math.max(0, resetSeconds)))
        }

        if (count > this.options.max) {
            ctx.response.header('retry-after', String(Math.max(1, resetSeconds)))
            ctx.response
                .status(429)
                .json({ message: this.options.message ?? 'Too many requests' })
            return
        }

        await next()
    }
}
