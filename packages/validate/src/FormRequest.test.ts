import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { FormRequest } from './FormRequest.js'
import { AuthorizationException } from './AuthorizationException.js'
import { ValidationException } from './ValidationException.js'
import type { HttpContext } from '@pearl-framework/http'

class TestRequest extends FormRequest {
    readonly schema = z.object({ name: z.string().min(1) })
    override authorize(): boolean { return false }
}

class AllowedRequest extends FormRequest {
    readonly schema = z.object({ name: z.string().min(1) })
}

function makeCtx(body: Record<string, unknown>): HttpContext {
    return {
        request: { query: {}, params: {}, body },
        response: {
            forbidden() {},
            unprocessable() {},
        },
    } as unknown as HttpContext
}

describe('FormRequest', () => {
    it('throws AuthorizationException when authorize() returns false', async () => {
        const ctx = makeCtx({ name: 'ok' })
        await expect(new TestRequest().validate(ctx)).rejects.toBeInstanceOf(AuthorizationException)
    })

    it('throws ValidationException on schema failure', async () => {
        const ctx = makeCtx({ name: '' })
        await expect(new AllowedRequest().validate(ctx)).rejects.toBeInstanceOf(ValidationException)
    })

    it('returns parsed data on success', async () => {
        const ctx = makeCtx({ name: 'pearl' })
        const data = await new AllowedRequest().validate(ctx)
        expect(data).toEqual({ name: 'pearl' })
    })

    it('static validate() works as a shortcut', async () => {
        const ctx = makeCtx({ name: 'pearl' })
        const data = await AllowedRequest.validate(ctx)
        expect(data).toEqual({ name: 'pearl' })
    })
})
