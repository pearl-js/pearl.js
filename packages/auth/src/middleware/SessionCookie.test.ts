import { describe, it, expect, vi } from 'vitest'
import { HttpContext, Request, Response, signCookie } from '@pearl-framework/http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { SessionGuard, type SessionRecord, type SessionStore } from '../guards/SessionGuard.js'
import type { AuthUser, UserProvider } from '../contracts/index.js'
import { session, startSession, endSession, rotateSessionCookie } from './SessionCookie.js'

const SECRET = 'cookie-secret'

class User implements AuthUser {
    constructor(public readonly id: number) {}
    getAuthIdentifier(): number { return this.id }
}

function makeProvider(): UserProvider<User> {
    return {
        findById: async (id) => new User(Number(id)),
        findByCredentials: async () => new User(1),
    } as unknown as UserProvider<User>
}

function makeStore(): SessionStore & { records: Map<string, SessionRecord> } {
    const records = new Map<string, SessionRecord>()
    return {
        records,
        find: async (id) => records.get(id) ?? null,
        save: async (r) => { records.set(r.id, r) },
        destroy: async (id) => { records.delete(id) },
        destroyAll: async () => { records.clear() },
    }
}

function makeCtx(cookieHeader?: string) {
    const rawReq = {
        url: '/', method: 'GET',
        headers: cookieHeader === undefined ? {} : { cookie: cookieHeader },
    } as unknown as IncomingMessage
    const written: { status?: number; headers?: Record<string, string | string[]> } = {}
    const rawRes = {
        writeHead(s: number, h: Record<string, string | string[]>) { written.status = s; written.headers = h; return this },
        end() {},
    } as unknown as ServerResponse

    const req = new Request(rawReq)
    req.setCookieSecret(SECRET)
    const res = new Response(rawRes, { cookieSecret: SECRET })
    const ctx = new HttpContext(req, res)

    return {
        ctx,
        setCookies: (): string[] => {
            if (!res.sent) res.send()
            return (written.headers?.['set-cookie'] ?? []) as string[]
        },
        getStatus: () => written.status,
    }
}

const cookieFor = (id: string) => `pearl_session=${encodeURIComponent(signCookie(id, SECRET))}`

describe('session()', () => {
    it('passes through with no cookie when not required', async () => {
        const guard = new SessionGuard(makeProvider(), makeStore())
        const { ctx } = makeCtx()
        const next = vi.fn()
        await session(guard)(ctx, next)
        expect(next).toHaveBeenCalledOnce()
        expect(ctx.get('auth.user')).toBeUndefined()
    })

    it('401s with no cookie when required', async () => {
        const guard = new SessionGuard(makeProvider(), makeStore())
        const { ctx, getStatus } = makeCtx()
        const next = vi.fn()
        await session(guard, { required: true })(ctx, next)
        expect(next).not.toHaveBeenCalled()
        expect(getStatus()).toBe(401)
    })

    it('resolves a valid session onto auth.user', async () => {
        const store = makeStore()
        const guard = new SessionGuard(makeProvider(), store)
        const id = await guard.issueSession(new User(42))

        const { ctx } = makeCtx(cookieFor(id))
        const next = vi.fn()
        await session(guard)(ctx, next)

        expect(next).toHaveBeenCalledOnce()
        expect((ctx.get('auth.user') as User).id).toBe(42)
        expect(ctx.get('auth.token')).toBe(id)
    })

    it('clears the cookie when the session id is unknown', async () => {
        const guard = new SessionGuard(makeProvider(), makeStore())
        const { ctx, setCookies } = makeCtx(cookieFor('does-not-exist'))
        const next = vi.fn()
        await session(guard)(ctx, next)
        expect(next).toHaveBeenCalledOnce()
        expect(setCookies()[0]).toContain('Max-Age=0')
    })

    it('ignores a forged (unsigned) session cookie', async () => {
        const store = makeStore()
        const guard = new SessionGuard(makeProvider(), store)
        const id = await guard.issueSession(new User(1))

        const { ctx } = makeCtx(`pearl_session=${id}`)
        const next = vi.fn()
        await session(guard)(ctx, next)
        expect(ctx.get('auth.user')).toBeUndefined()
    })

    // Without the rotation bridge the new id is never sent and the user is
    // logged out on their next request.
    it('re-issues the cookie when the guard rotates the id', async () => {
        const store = makeStore()
        const guard = new SessionGuard(makeProvider(), store, {
            rotateOnUse: true,
            onRotate: rotateSessionCookie(),
        })
        const id = await guard.issueSession(new User(7))

        const { ctx, setCookies } = makeCtx(cookieFor(id))
        const next = vi.fn()
        await session(guard)(ctx, next)

        expect(next).toHaveBeenCalledOnce()
        const newId = ctx.get<string>('auth.token')
        expect(newId).toBeDefined()
        expect(newId).not.toBe(id)
        expect(setCookies()).toHaveLength(1)
        expect(setCookies()[0]).toContain('pearl_session=')
        // The rotated id must be the one that is live in the store.
        expect(store.records.has(newId!)).toBe(true)
        expect(store.records.has(id)).toBe(false)
    })

    it('honours a custom cookie name', async () => {
        const store = makeStore()
        const guard = new SessionGuard(makeProvider(), store)
        const id = await guard.issueSession(new User(3))

        const header = `sid=${encodeURIComponent(signCookie(id, SECRET))}`
        const { ctx } = makeCtx(header)
        await session(guard, { name: 'sid' })(ctx, vi.fn())
        expect((ctx.get('auth.user') as User).id).toBe(3)
    })
})

describe('startSession / endSession', () => {
    it('issues a signed cookie and populates the context', async () => {
        const store = makeStore()
        const guard = new SessionGuard(makeProvider(), store)
        const { ctx, setCookies } = makeCtx()

        const id = await startSession(ctx, guard, new User(9))

        expect(store.records.has(id)).toBe(true)
        expect(ctx.get('auth.token')).toBe(id)
        expect(setCookies()[0]).toContain('HttpOnly')
    })

    it('round-trips: startSession then session() authenticates', async () => {
        const store = makeStore()
        const guard = new SessionGuard(makeProvider(), store)

        const login = makeCtx()
        const id = await startSession(login.ctx, guard, new User(11))
        const header = login.setCookies()[0]!.split(';')[0]!

        const follow = makeCtx(header)
        await session(guard)(follow.ctx, vi.fn())
        expect((follow.ctx.get('auth.user') as User).id).toBe(11)
        expect(id).toBeTruthy()
    })

    it('destroys the session and clears the cookie', async () => {
        const store = makeStore()
        const guard = new SessionGuard(makeProvider(), store)
        const id = await guard.issueSession(new User(5))

        const { ctx, setCookies } = makeCtx(cookieFor(id))
        await session(guard)(ctx, vi.fn())
        await endSession(ctx, guard)

        expect(store.records.has(id)).toBe(false)
        expect(setCookies().some((c) => c.includes('Max-Age=0'))).toBe(true)
    })
})
