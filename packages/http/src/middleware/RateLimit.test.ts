import { describe, it, expect } from 'vitest'
import { RateLimit, MemoryRateLimitStore } from './RateLimit.js'
import type { HttpContext } from '../http/HttpContext.js'

function makeCtx(): HttpContext {
    const headers: Record<string, string> = {}
    let status = 200
    let body: unknown = null
    return {
        request: {
            header: () => undefined,
            nodeRequest: { socket: { remoteAddress: '1.2.3.4' } },
        },
        response: {
            header(k: string, v: string) {
                headers[k.toLowerCase()] = v
                return this
            },
            status(s: number) {
                status = s
                return this
            },
            json(data: unknown) {
                body = data
            },
            // expose for assertions
            _headers: headers,
            get _status() { return status },
            get _body() { return body },
        },
    } as unknown as HttpContext
}

describe('RateLimit middleware', () => {
    it('passes requests under the limit through', async () => {
        const store = new MemoryRateLimitStore()
        const mw = new RateLimit({ windowMs: 1000, max: 3, store })
        const ctx = makeCtx()
        let called = 0
        await mw.handle(ctx, async () => { called++ })
        await mw.handle(ctx, async () => { called++ })
        expect(called).toBe(2)
    })

    it('blocks with 429 once the limit is exceeded', async () => {
        const store = new MemoryRateLimitStore()
        const mw = new RateLimit({ windowMs: 1000, max: 2, store })
        const ctx = makeCtx()
        let downstream = 0

        await mw.handle(ctx, async () => { downstream++ })
        await mw.handle(ctx, async () => { downstream++ })
        await mw.handle(ctx, async () => { downstream++ })

        expect(downstream).toBe(2)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const res = ctx.response as any
        expect(res._status).toBe(429)
        expect(res._body).toMatchObject({ message: expect.any(String) })
        expect(res._headers['retry-after']).toBeDefined()
    })

    it('sets standard rate-limit headers', async () => {
        const store = new MemoryRateLimitStore()
        const mw = new RateLimit({ windowMs: 1000, max: 5, store })
        const ctx = makeCtx()
        await mw.handle(ctx, async () => {})
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const headers = (ctx.response as any)._headers
        expect(headers['x-ratelimit-limit']).toBe('5')
        expect(headers['x-ratelimit-remaining']).toBe('4')
    })

    it('isolates keys', async () => {
        const store = new MemoryRateLimitStore()
        let key = 'a'
        const mw = new RateLimit({ windowMs: 1000, max: 1, store, keyGenerator: () => key })
        const ctxA = makeCtx()
        const ctxB = makeCtx()
        let aOk = 0; let bOk = 0
        await mw.handle(ctxA, async () => { aOk++ })
        key = 'b'
        await mw.handle(ctxB, async () => { bOk++ })
        expect(aOk).toBe(1)
        expect(bOk).toBe(1)
    })

    it('rejects invalid options', () => {
        expect(() => new RateLimit({ windowMs: 0, max: 1 })).toThrow()
        expect(() => new RateLimit({ windowMs: 1000, max: -1 })).toThrow()
    })
})
