import { describe, it, expect } from 'vitest'
import { Router } from './Router.js'

describe('Router.compilePath via match()', () => {
    const make = () => {
        const r = new Router()
        r.get('/users/:id', () => {})
        r.get('/files/*', () => {})
        r.get('/api\\:v1/items', () => {})
        return r
    }

    it('extracts named parameters', () => {
        const router = make()
        const m = router.match('GET' as const, '/users/42')
        expect(m).not.toBeNull()
        expect(m!.params).toEqual({ id: '42' })
    })

    it('captures wildcard segments', () => {
        const router = make()
        const m = router.match('GET' as const, '/files/a/b/c.txt')
        expect(m).not.toBeNull()
    })

    it('respects backslash-escaped colons as literals', () => {
        const router = make()
        const m = router.match('GET' as const, '/api:v1/items')
        expect(m).not.toBeNull()
        // No params should be captured — `:v1` was a literal segment.
        expect(m!.params).toEqual({})
    })

    it('does not match unrelated paths', () => {
        const router = make()
        expect(router.match('GET' as const, '/nope')).toBeNull()
    })
})
