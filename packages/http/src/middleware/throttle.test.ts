import { describe, it, expect, beforeEach, vi } from 'vitest'
import { RateLimiter, throttle } from './throttle.js'
import { MemoryRateLimitStore } from './RateLimit.js'
import type { HttpContext } from '../http/HttpContext.js'

function makeCtx(ip = '1.2.3.4') {
    const headers: Record<string, string> = {}
    let status = 200
    let body: unknown

    const response = {
        header(k: string, v: string) { headers[k.toLowerCase()] = v; return response },
        status(c: number) { status = c; return response },
        json(d: unknown, s?: number) { if (s !== undefined) status = s; body = d },
    }
    const request = { nodeRequest: { socket: { remoteAddress: ip } } }

    const ctx = { request, response } as unknown as HttpContext
    return { ctx, headers, getStatus: () => status, getBody: () => body }
}

describe('throttle / RateLimiter', () => {
    beforeEach(() => {
        RateLimiter.clear()
        RateLimiter.useStore(new MemoryRateLimitStore())
    })

    it('throws for an unknown limiter name', async () => {
        const { ctx } = makeCtx()
        await expect(throttle('missing')(ctx, vi.fn())).rejects.toThrow(/No rate limiter named/)
    })

    it('allows up to max, then returns 429 with headers', async () => {
        RateLimiter.for('login', () => ({ windowMs: 60_000, max: 2 }))
        const mw = throttle('login')

        const a = makeCtx(); const nextA = vi.fn()
        await mw(a.ctx, nextA)
        expect(nextA).toHaveBeenCalledOnce()
        expect(a.headers['x-ratelimit-remaining']).toBe('1')

        const b = makeCtx(); const nextB = vi.fn()
        await mw(b.ctx, nextB)
        expect(nextB).toHaveBeenCalledOnce()
        expect(b.headers['x-ratelimit-remaining']).toBe('0')

        const c = makeCtx(); const nextC = vi.fn()
        await mw(c.ctx, nextC)
        expect(nextC).not.toHaveBeenCalled()
        expect(c.getStatus()).toBe(429)
        expect(c.headers['retry-after']).toBeDefined()
    })

    it('partitions buckets by client (different IPs are independent)', async () => {
        RateLimiter.for('perIp', () => ({ windowMs: 60_000, max: 1 }))
        const mw = throttle('perIp')

        const ip1a = makeCtx('1.1.1.1'); const n1a = vi.fn(); await mw(ip1a.ctx, n1a)
        const ip1b = makeCtx('1.1.1.1'); const n1b = vi.fn(); await mw(ip1b.ctx, n1b)
        const ip2  = makeCtx('2.2.2.2'); const n2  = vi.fn(); await mw(ip2.ctx, n2)

        expect(n1a).toHaveBeenCalledOnce()  // first from ip1 — allowed
        expect(n1b).not.toHaveBeenCalled()  // second from ip1 — blocked
        expect(n2).toHaveBeenCalledOnce()   // ip2 has its own bucket — allowed
    })

    it('honors an explicit partition key', async () => {
        RateLimiter.for('byTenant', () => ({ windowMs: 60_000, max: 1, key: 'tenant-42' }))
        const mw = throttle('byTenant')

        // Same key across different IPs → shared bucket
        const a = makeCtx('1.1.1.1'); const na = vi.fn(); await mw(a.ctx, na)
        const b = makeCtx('9.9.9.9'); const nb = vi.fn(); await mw(b.ctx, nb)

        expect(na).toHaveBeenCalledOnce()
        expect(nb).not.toHaveBeenCalled()
    })
})
