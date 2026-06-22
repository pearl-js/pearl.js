import { describe, it, expect } from 'vitest'
import { Readable } from 'node:stream'
import type { IncomingMessage } from 'node:http'
import { Request } from './Request.js'

interface FakeIncomingOptions {
    method?: string
    url?: string
    headers?: Record<string, string>
    body?: string | Buffer | Iterable<Buffer>
}

function fakeIncoming(opts: FakeIncomingOptions = {}): IncomingMessage {
    const body = opts.body ?? ''
    const source = typeof body === 'string'
        ? [Buffer.from(body)]
        : Buffer.isBuffer(body) ? [body] : Array.from(body)

    const stream = Readable.from(source) as unknown as IncomingMessage
    Object.assign(stream, {
        method:  opts.method  ?? 'POST',
        url:     opts.url     ?? '/',
        headers: opts.headers ?? {},
    })
    return stream
}

describe('Request.parseBody — size limit', () => {
    it('parses a JSON body under the limit', async () => {
        const req = await Request.fromIncoming(
            fakeIncoming({
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ a: 1 }),
            }),
            { maxBodyBytes: 1024 },
        )
        expect(req.body).toEqual({ a: 1 })
    })

    it('rejects with 413 when Content-Length declares a body above the limit', async () => {
        const tooBig = 'x'.repeat(100)
        const promise = Request.fromIncoming(
            fakeIncoming({
                headers: { 'content-type': 'text/plain', 'content-length': '100' },
                body: tooBig,
            }),
            { maxBodyBytes: 32 },
        )
        await expect(promise).rejects.toMatchObject({ statusCode: 413 })
    })

    it('rejects with 413 when chunked body exceeds the limit mid-stream', async () => {
        const promise = Request.fromIncoming(
            fakeIncoming({
                headers: { 'content-type': 'text/plain' },
                body: [Buffer.alloc(20, 'x'), Buffer.alloc(20, 'x'), Buffer.alloc(20, 'x')],
            }),
            { maxBodyBytes: 32 },
        )
        await expect(promise).rejects.toMatchObject({ statusCode: 413 })
    })

    it('uses the 1 MiB default when no limit is passed', async () => {
        const req = await Request.fromIncoming(
            fakeIncoming({
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ payload: 'x'.repeat(1000) }),
            }),
        )
        expect(req.body.payload).toBe('x'.repeat(1000))
    })

    it('skips body parsing for GET requests regardless of body content', async () => {
        const req = await Request.fromIncoming(
            fakeIncoming({
                method: 'GET',
                headers: { 'content-type': 'application/json', 'content-length': '999999999' },
            }),
            { maxBodyBytes: 16 },
        )
        expect(req.body).toEqual({})
    })

    it('rejects with 400 (not 413) for malformed JSON inside the limit', async () => {
        const promise = Request.fromIncoming(
            fakeIncoming({
                headers: { 'content-type': 'application/json' },
                body: '{not-json',
            }),
            { maxBodyBytes: 1024 },
        )
        await expect(promise).rejects.toMatchObject({ statusCode: 400 })
    })
})
