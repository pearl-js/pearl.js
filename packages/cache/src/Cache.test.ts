import { describe, it, expect, vi } from 'vitest'
import { Cache } from './Cache.js'
import { MemoryStore } from './stores/MemoryStore.js'

const makeCache = (ttlSeconds?: number) =>
    new Cache(new MemoryStore(), ttlSeconds === undefined ? {} : { ttlSeconds })

describe('Cache', () => {
    it('puts and gets, preserving types through JSON', async () => {
        const cache = makeCache()
        await cache.put('obj', { a: 1, b: ['x'] })
        expect(await cache.get('obj')).toEqual({ a: 1, b: ['x'] })
        await cache.put('num', 42)
        expect(await cache.get('num')).toBe(42)
        await cache.put('bool', false)
        expect(await cache.get('bool')).toBe(false)
    })

    it('returns undefined for a missing key', async () => {
        expect(await makeCache().get('nope')).toBeUndefined()
    })

    it('distinguishes a cached null from a miss', async () => {
        const cache = makeCache()
        await cache.put('nothing', null)
        expect(await cache.get('nothing')).toBeNull()
        expect(await cache.has('nothing')).toBe(true)
        expect(await cache.has('absent')).toBe(false)
    })

    it('forgets and flushes', async () => {
        const cache = makeCache()
        await cache.put('a', 1)
        await cache.forget('a')
        expect(await cache.has('a')).toBe(false)

        await cache.put('b', 2)
        await cache.flush()
        expect(await cache.has('b')).toBe(false)
    })

    describe('remember', () => {
        it('calls the factory once and caches the result', async () => {
            const cache = makeCache()
            const factory = vi.fn(async () => ({ id: 1 }))

            expect(await cache.remember('user:1', factory)).toEqual({ id: 1 })
            expect(await cache.remember('user:1', factory)).toEqual({ id: 1 })
            expect(factory).toHaveBeenCalledOnce()
        })

        it('accepts a synchronous factory', async () => {
            expect(await makeCache().remember('k', () => 'v')).toBe('v')
        })

        // A lookup that legitimately finds nothing would otherwise re-run on
        // every request — the hot path caching is meant to protect.
        it('caches a null result instead of re-running', async () => {
            const cache = makeCache()
            const factory = vi.fn(async () => null)

            expect(await cache.remember('missing-user', factory)).toBeNull()
            expect(await cache.remember('missing-user', factory)).toBeNull()
            expect(factory).toHaveBeenCalledOnce()
        })

        it('propagates a throwing factory and caches nothing', async () => {
            const cache = makeCache()
            await expect(cache.remember('k', () => { throw new Error('boom') }))
                .rejects.toThrow('boom')
            expect(await cache.has('k')).toBe(false)
        })

        it('rememberForever ignores the default TTL', async () => {
            const cache = makeCache(60)
            await cache.rememberForever('k', () => 'v')
            expect(await cache.get('k')).toBe('v')
        })
    })

    it('pull reads then removes', async () => {
        const cache = makeCache()
        await cache.put('once', 'value')
        expect(await cache.pull('once')).toBe('value')
        expect(await cache.has('once')).toBe(false)
        expect(await cache.pull('gone')).toBeUndefined()
    })

    it('increments and decrements', async () => {
        const cache = makeCache()
        expect(await cache.increment('n')).toBe(1)
        expect(await cache.increment('n', 4)).toBe(5)
        expect(await cache.decrement('n', 2)).toBe(3)
    })

    it('treats a non-JSON value under a key as a miss', async () => {
        const store = new MemoryStore()
        await store.set('k', 'not json')
        const cache = new Cache(store)
        expect(await cache.get('k')).toBeUndefined()
        expect(await cache.has('k')).toBe(false)
    })

    it('expires using the default TTL', async () => {
        vi.useFakeTimers()
        const cache = makeCache(10)
        await cache.put('k', 'v')
        vi.advanceTimersByTime(10_001)
        expect(await cache.get('k')).toBeUndefined()
        vi.useRealTimers()
    })

    it('a per-call TTL overrides the default', async () => {
        vi.useFakeTimers()
        const cache = makeCache(10)
        await cache.put('k', 'v', 100)
        vi.advanceTimersByTime(50_000)
        expect(await cache.get('k')).toBe('v')
        vi.useRealTimers()
    })
})
