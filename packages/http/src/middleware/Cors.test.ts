import { describe, it, expect, vi } from 'vitest'
import { Cors } from './Cors.js'
import type { HttpContext } from '../http/HttpContext.js'

function makeCtx(opts: { method?: string; headers?: Record<string, string> }) {
    const reqHeaders = opts.headers ?? {}
    const headers: Record<string, string> = {}
    let status = 200
    let sent = false

    const response = {
        header(k: string, v: string) { headers[k.toLowerCase()] = v; return response },
        status(c: number) { status = c; return response },
        send() { sent = true },
        get sent() { return sent },
    }
    const request = {
        method: opts.method ?? 'GET',
        header: (k: string) => reqHeaders[k.toLowerCase()],
    }

    const ctx = { request, response } as unknown as HttpContext
    return { ctx, headers, getStatus: () => status, wasSent: () => sent }
}

const preflight = (origin = 'https://app.test') => ({
    origin,
    'access-control-request-method': 'POST',
    'access-control-request-headers': 'content-type, authorization',
})

describe('Cors', () => {
    it('passes through requests with no Origin', async () => {
        const { ctx, headers } = makeCtx({})
        const next = vi.fn()
        await new Cors().handle(ctx, next)
        expect(next).toHaveBeenCalledOnce()
        expect(headers['access-control-allow-origin']).toBeUndefined()
    })

    it('allows any origin by default (*)', async () => {
        const { ctx, headers } = makeCtx({ headers: { origin: 'https://app.test' } })
        const next = vi.fn()
        await new Cors().handle(ctx, next)
        expect(headers['access-control-allow-origin']).toBe('*')
        expect(next).toHaveBeenCalledOnce()
    })

    it('echoes the origin (not *) and sets credentials when credentials=true', async () => {
        const { ctx, headers } = makeCtx({ headers: { origin: 'https://app.test' } })
        await new Cors({ credentials: true }).handle(ctx, vi.fn())
        expect(headers['access-control-allow-origin']).toBe('https://app.test')
        expect(headers['access-control-allow-credentials']).toBe('true')
        expect(headers['vary']).toBe('Origin')
    })

    it('only allows origins in the allow-list', async () => {
        const allowed = makeCtx({ headers: { origin: 'https://ok.test' } })
        await new Cors({ origin: ['https://ok.test'] }).handle(allowed.ctx, vi.fn())
        expect(allowed.headers['access-control-allow-origin']).toBe('https://ok.test')

        const denied = makeCtx({ headers: { origin: 'https://evil.test' } })
        const next = vi.fn()
        await new Cors({ origin: ['https://ok.test'] }).handle(denied.ctx, next)
        expect(denied.headers['access-control-allow-origin']).toBeUndefined()
        expect(next).toHaveBeenCalledOnce()
    })

    it('answers preflight with 204 and does not call next', async () => {
        const { ctx, headers, getStatus, wasSent } = makeCtx({
            method: 'OPTIONS',
            headers: preflight(),
        })
        const next = vi.fn()
        await new Cors({ origin: ['https://app.test'], maxAge: 600 }).handle(ctx, next)

        expect(next).not.toHaveBeenCalled()
        expect(wasSent()).toBe(true)
        expect(getStatus()).toBe(204)
        expect(headers['access-control-allow-methods']).toContain('POST')
        expect(headers['access-control-allow-headers']).toBe('content-type, authorization')
        expect(headers['access-control-max-age']).toBe('600')
    })
})
