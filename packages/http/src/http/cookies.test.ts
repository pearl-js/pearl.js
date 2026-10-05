import { describe, it, expect } from 'vitest'
import {
    parseCookieHeader,
    serializeCookie,
    signCookie,
    unsignCookie,
} from './cookies.js'

describe('parseCookieHeader', () => {
    it('returns an empty map for a missing or empty header', () => {
        expect(parseCookieHeader(undefined)).toEqual({})
        expect(parseCookieHeader('')).toEqual({})
    })

    it('parses multiple pairs and trims whitespace', () => {
        expect(parseCookieHeader('a=1; b=2;c=3')).toEqual({ a: '1', b: '2', c: '3' })
    })

    it('percent-decodes values and strips quotes', () => {
        expect(parseCookieHeader('u=a%40b.com')).toEqual({ u: 'a@b.com' })
        expect(parseCookieHeader('q="spaced value"')).toEqual({ q: 'spaced value' })
    })

    it('keeps a value containing = intact', () => {
        expect(parseCookieHeader('t=abc=def=')).toEqual({ t: 'abc=def=' })
    })

    // Browsers send the most specific cookie first; preferring the last would
    // let a sibling subdomain's wildcard cookie override the host's own.
    it('keeps the first occurrence of a duplicated name', () => {
        expect(parseCookieHeader('sid=real; sid=planted')).toEqual({ sid: 'real' })
    })

    it('survives a malformed percent-escape', () => {
        expect(parseCookieHeader('x=%E0%A4%A')).toEqual({ x: '%E0%A4%A' })
    })

    it('skips pairs with no name', () => {
        expect(parseCookieHeader('=novalue; a=1')).toEqual({ a: '1' })
    })
})

describe('serializeCookie', () => {
    it('applies the secure-by-default attributes', () => {
        expect(serializeCookie('sid', 'abc')).toBe('sid=abc; Path=/; HttpOnly; SameSite=Lax')
    })

    it('encodes the value', () => {
        expect(serializeCookie('u', 'a@b.com')).toContain('u=a%40b.com')
    })

    it('honours explicit attributes', () => {
        const out = serializeCookie('sid', 'abc', {
            maxAge: 60,
            path: '/app',
            domain: 'example.com',
            secure: true,
            sameSite: 'strict',
        })
        expect(out).toContain('Max-Age=60')
        expect(out).toContain('Path=/app')
        expect(out).toContain('Domain=example.com')
        expect(out).toContain('Secure')
        expect(out).toContain('SameSite=Strict')
    })

    it('allows opting out of HttpOnly', () => {
        expect(serializeCookie('v', '1', { httpOnly: false })).not.toContain('HttpOnly')
    })

    it('floors a fractional Max-Age (browsers discard a decimal)', () => {
        expect(serializeCookie('v', '1', { maxAge: 1.9 })).toContain('Max-Age=1')
    })

    it('prefers maxAge over expires when both are given', () => {
        const out = serializeCookie('v', '1', { maxAge: 5, expires: new Date(0) })
        expect(out).toContain('Max-Age=5')
        expect(out).not.toContain('Expires=')
    })

    it('rejects an invalid cookie name', () => {
        expect(() => serializeCookie('bad name', 'v')).toThrow(/Invalid cookie name/)
        expect(() => serializeCookie('a;b', 'v')).toThrow(/Invalid cookie name/)
    })

    // SameSite=None without Secure is silently dropped by browsers.
    it('rejects sameSite none without secure', () => {
        expect(() => serializeCookie('v', '1', { sameSite: 'none' })).toThrow(/requires secure/)
        expect(serializeCookie('v', '1', { sameSite: 'none', secure: true })).toContain('SameSite=None')
    })
})

describe('cookie signing', () => {
    const secret = 'test-secret'

    it('round-trips a signed value', () => {
        const signed = signCookie('session-id', secret)
        expect(signed).not.toBe('session-id')
        expect(unsignCookie(signed, secret)).toBe('session-id')
    })

    it('rejects a tampered value', () => {
        const signed = signCookie('user-1', secret)
        const tampered = signed.replace('user-1', 'user-2')
        expect(unsignCookie(tampered, secret)).toBeNull()
    })

    it('rejects a valid signature made with another secret', () => {
        expect(unsignCookie(signCookie('v', 'other-secret'), secret)).toBeNull()
    })

    it('rejects an unsigned value', () => {
        expect(unsignCookie('plain', secret)).toBeNull()
        expect(unsignCookie('', secret)).toBeNull()
        expect(unsignCookie('trailing.', secret)).toBeNull()
    })

    it('preserves a value containing the separator', () => {
        const signed = signCookie('a.b.c', secret)
        expect(unsignCookie(signed, secret)).toBe('a.b.c')
    })
})
