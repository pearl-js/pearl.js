import { describe, it, expect, vi, afterEach } from 'vitest'
import { CacheRateLimitStore } from './CacheRateLimitStore.js'
import { MemoryStore } from './MemoryStore.js'

afterEach(() => { vi.useRealTimers() })

describe('CacheRateLimitStore', () => {
    it('counts hits per key', async () => {
        const limiter = new CacheRateLimitStore(new MemoryStore())
        expect((await limiter.hit('ip:1', 60_000)).count).toBe(1)
        expect((await limiter.hit('ip:1', 60_000)).count).toBe(2)
        expect((await limiter.hit('ip:2', 60_000)).count).toBe(1)
    })

    it('reports a resetAt inside the window', async () => {
        vi.useFakeTimers()
        vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
        const limiter = new CacheRateLimitStore(new MemoryStore())
        const { resetAt } = await limiter.hit('k', 60_000)
        expect(resetAt).toBe(Date.parse('2026-01-01T00:01:00Z'))
    })

    // A sliding window would never reset for a caller who keeps hitting it.
    it('keeps the window fixed from the first hit', async () => {
        vi.useFakeTimers()
        const limiter = new CacheRateLimitStore(new MemoryStore())
        const first = await limiter.hit('k', 10_000)

        vi.advanceTimersByTime(5_000)
        const second = await limiter.hit('k', 10_000)
        expect(second.resetAt).toBe(first.resetAt)
        expect(second.count).toBe(2)

        vi.advanceTimersByTime(5_001)
        expect((await limiter.hit('k', 10_000)).count).toBe(1)
    })

    it('resets a key', async () => {
        const limiter = new CacheRateLimitStore(new MemoryStore())
        await limiter.hit('k', 60_000)
        await limiter.reset('k')
        expect((await limiter.hit('k', 60_000)).count).toBe(1)
    })

    it('rejects an unusable window', async () => {
        const limiter = new CacheRateLimitStore(new MemoryStore())
        await expect(limiter.hit('k', 0)).rejects.toThrow(/positive, finite/)
        await expect(limiter.hit('k', Number.NaN)).rejects.toThrow(/positive, finite/)
    })

    it('namespaces keys so they cannot collide with cached values', async () => {
        const store = new MemoryStore()
        const limiter = new CacheRateLimitStore(store, 'rl:')
        await limiter.hit('abc', 60_000)
        expect(await store.get('rl:abc')).toBe('1')
        expect(await store.get('abc')).toBeNull()
    })
})
