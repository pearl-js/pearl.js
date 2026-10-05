import { describe, it, expect } from 'vitest'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { Request } from './Request.js'
import { Response } from './Response.js'
import { signCookie } from './cookies.js'

function makeRequest(cookieHeader?: string, secret?: string): Request {
    const raw = {
        url: '/',
        method: 'GET',
        headers: cookieHeader === undefined ? {} : { cookie: cookieHeader },
    } as unknown as IncomingMessage
    const req = new Request(raw)
    if (secret !== undefined) req.setCookieSecret(secret)
    return req
}

function makeResponse(secret?: string) {
    const written: { status?: number; headers?: Record<string, string | string[]> } = {}
    const raw = {
        writeHead(status: number, headers: Record<string, string | string[]>) {
            written.status = status
            written.headers = headers
            return this
        },
        end() {},
    } as unknown as ServerResponse
    const res = new Response(raw, secret === undefined ? {} : { cookieSecret: secret })
    return { res, written, setCookies: () => (written.headers?.['set-cookie'] ?? []) as string[] }
}

describe('Request cookies', () => {
    it('reads cookies off the header', () => {
        const req = makeRequest('a=1; b=2')
        expect(req.cookies).toEqual({ a: '1', b: '2' })
        expect(req.cookie('a')).toBe('1')
        expect(req.cookie('missing')).toBeUndefined()
    })

    it('returns an empty map when no Cookie header is present', () => {
        expect(makeRequest().cookies).toEqual({})
    })

    it('verifies a signed cookie', () => {
        const req = makeRequest(`sid=${signCookie('abc', 's3cret')}`, 's3cret')
        expect(req.signedCookie('sid')).toBe('abc')
    })

    it('treats a tampered signed cookie as absent', () => {
        const signed = signCookie('abc', 's3cret').replace('abc', 'xyz')
        const req = makeRequest(`sid=${signed}`, 's3cret')
        expect(req.signedCookie('sid')).toBeUndefined()
    })

    it('treats an unsigned cookie as absent when read as signed', () => {
        expect(makeRequest('sid=abc', 's3cret').signedCookie('sid')).toBeUndefined()
    })

    it('throws a clear error when no secret is configured', () => {
        expect(() => makeRequest('sid=abc').signedCookie('sid')).toThrow(/needs a cookie secret/)
    })
})

describe('Response cookies', () => {
    it('emits one Set-Cookie header per cookie', () => {
        const { res, setCookies } = makeResponse()
        res.cookie('a', '1').cookie('b', '2')
        res.send()
        expect(setCookies()).toHaveLength(2)
        expect(setCookies()[0]).toContain('a=1')
        expect(setCookies()[1]).toContain('b=2')
    })

    it('sends no Set-Cookie when none were queued', () => {
        const { res, written } = makeResponse()
        res.send()
        expect(written.headers?.['set-cookie']).toBeUndefined()
    })

    it('signs a cookie when asked', () => {
        const { res, setCookies } = makeResponse('s3cret')
        res.cookie('sid', 'abc', { signed: true })
        res.send()
        expect(setCookies()[0]).toContain(encodeURIComponent(signCookie('abc', 's3cret')))
    })

    it('throws when signing without a secret', () => {
        const { res } = makeResponse()
        expect(() => res.cookie('sid', 'abc', { signed: true })).toThrow(/needs a cookie secret/)
    })

    it('clearCookie expires the cookie', () => {
        const { res, setCookies } = makeResponse()
        res.clearCookie('sid')
        res.send()
        expect(setCookies()[0]).toContain('Max-Age=0')
    })

    it('round-trips through Request', () => {
        const { res, setCookies } = makeResponse('s3cret')
        res.cookie('sid', 'session-value', { signed: true })
        res.send()

        const header = setCookies()[0]!.split(';')[0]!
        expect(makeRequest(header, 's3cret').signedCookie('sid')).toBe('session-value')
    })
})

describe('Response.appendHeader', () => {
    it('sets the header when absent', () => {
        const { res, written } = makeResponse()
        res.appendHeader('vary', 'Origin')
        res.send()
        expect(written.headers?.['vary']).toBe('Origin')
    })

    // header() overwrites, which silently drops an earlier middleware's Vary
    // and lets a CDN serve one origin's response to another.
    it('accumulates instead of clobbering', () => {
        const { res, written } = makeResponse()
        res.appendHeader('vary', 'Accept-Encoding')
        res.appendHeader('vary', 'Origin')
        res.send()
        expect(written.headers?.['vary']).toBe('Accept-Encoding, Origin')
    })

    it('does not duplicate an existing value', () => {
        const { res, written } = makeResponse()
        res.appendHeader('vary', 'Origin')
        res.appendHeader('vary', 'origin')
        res.send()
        expect(written.headers?.['vary']).toBe('Origin')
    })
})
