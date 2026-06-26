import { describe, it, expect, vi } from 'vitest'
import { Gate, AccessDeniedError } from './Gate.js'
import { can } from './middleware/Can.js'
import type { HttpContext } from '@pearl-framework/http'

interface User { id: number; role: string }

function makeGate(): Gate<User> {
    return new Gate<User>()
        .define('admin', (u) => u?.role === 'admin')
        .define('edit-post', (u, post) => !!u && (post as { authorId: number }).authorId === u.id)
}

describe('Gate', () => {
    it('allows / denies based on the ability', async () => {
        const gate = makeGate()
        expect(await gate.allows('admin', { id: 1, role: 'admin' })).toBe(true)
        expect(await gate.allows('admin', { id: 1, role: 'user' })).toBe(false)
        expect(await gate.denies('admin', null)).toBe(true)
    })

    it('denies unknown abilities by default', async () => {
        const gate = makeGate()
        expect(await gate.allows('does-not-exist', { id: 1, role: 'admin' })).toBe(false)
    })

    it('passes extra args to the ability (policy style)', async () => {
        const gate = makeGate()
        const user: User = { id: 7, role: 'user' }
        expect(await gate.allows('edit-post', user, { authorId: 7 })).toBe(true)
        expect(await gate.allows('edit-post', user, { authorId: 8 })).toBe(false)
    })

    it('authorize() throws AccessDeniedError (403) when denied', async () => {
        const gate = makeGate()
        await expect(gate.authorize('admin', { id: 1, role: 'user' })).rejects.toBeInstanceOf(AccessDeniedError)
        try {
            await gate.authorize('admin', { id: 1, role: 'user' })
        } catch (e) {
            expect((e as AccessDeniedError).statusCode).toBe(403)
        }
        await expect(gate.authorize('admin', { id: 1, role: 'admin' })).resolves.toBeUndefined()
    })
})

describe('can() middleware', () => {
    function makeCtx(user: User | null) {
        let forbidden: string | undefined
        const ctx = {
            get: (_k: string) => user ?? undefined,
            response: { forbidden(msg: string) { forbidden = msg } },
        } as unknown as HttpContext
        return { ctx, getForbidden: () => forbidden }
    }

    it('calls next when allowed', async () => {
        const { ctx } = makeCtx({ id: 1, role: 'admin' })
        const next = vi.fn()
        await can(makeGate(), 'admin')(ctx, next)
        expect(next).toHaveBeenCalledOnce()
    })

    it('responds 403 and skips next when denied', async () => {
        const { ctx, getForbidden } = makeCtx({ id: 1, role: 'user' })
        const next = vi.fn()
        await can(makeGate(), 'admin')(ctx, next)
        expect(next).not.toHaveBeenCalled()
        expect(getForbidden()).toMatch(/Not authorized/)
    })
})
