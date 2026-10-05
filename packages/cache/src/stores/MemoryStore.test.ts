import { describe, it, expect, vi, afterEach } from 'vitest'
import { MemoryStore } from './MemoryStore.js'

afterEach(() => { vi.useRealTimers() })

describe('MemoryStore', () => {
    it('round-trips a value', async () => {
        const store = new MemoryStore()
        await store.set('k', 'v')
        expect(await store.get('k')).toBe('v')
    })

    it('returns null for a missing key', async () => {
        expect(await new MemoryStore().get('nope')).toBeNull()
    })

    it('forgets and flushes', async () => {
        const store = new MemoryStore()
        await store.set('a', '1')
        await store.set('b', '2')
        await store.forget('a')
        expect(await store.get('a')).toBeNull()
        expect(await store.get('b')).toBe('2')
        await store.flush()
        expect(await store.get('b')).toBeNull()
    })

    it('expires a value once its TTL passes', async () => {
        vi.useFakeTimers()
        const store = new MemoryStore()
        await store.set('k', 'v', 10)
        expect(await store.get('k')).toBe('v')

        vi.advanceTimersByTime(9_999)
        expect(await store.get('k')).toBe('v')

        vi.advanceTimersByTime(2)
        expect(await store.get('k')).toBeNull()
    })

    it('stores without expiry when no TTL is given', async () => {
        vi.useFakeTimers()
        const store = new MemoryStore()
        await store.set('k', 'v')
        vi.advanceTimersByTime(10_000_000)
        expect(await store.get('k')).toBe('v')
        expect(await store.expiresAt('k')).toBeNull()
    })

    it('rejects a non-positive TTL', async () => {
        const store = new MemoryStore()
        await expect(store.set('k', 'v', 0)).rejects.toThrow(/positive, finite/)
        await expect(store.set('k', 'v', Number.NaN)).rejects.toThrow(/positive, finite/)
    })

    it('increments from absent', async () => {
        const store = new MemoryStore()
        expect(await store.increment('n', 1)).toBe(1)
        expect(await store.increment('n', 2)).toBe(3)
        expect(await store.increment('n', -1)).toBe(2)
    })

    // Re-applying the TTL on each increment would make a rate-limit window
    // slide forward forever and never reset.
    it('keeps the original expiry across increments', async () => {
        vi.useFakeTimers()
        const store = new MemoryStore()
        await store.increment('hits', 1, 10)
        const first = await store.expiresAt('hits')

        vi.advanceTimersByTime(5_000)
        await store.increment('hits', 1, 10)
        expect(await store.expiresAt('hits')).toBe(first)

        vi.advanceTimersByTime(5_001)
        expect(await store.get('hits')).toBeNull()
    })

    it('reports expiresAt as epoch ms', async () => {
        vi.useFakeTimers()
        vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
        const store = new MemoryStore()
        await store.set('k', 'v', 60)
        expect(await store.expiresAt('k')).toBe(Date.parse('2026-01-01T00:01:00Z'))
    })

    describe('bounded size', () => {
        it('rejects an invalid maxEntries', () => {
            expect(() => new MemoryStore({ maxEntries: 0 })).toThrow(/positive integer/)
            expect(() => new MemoryStore({ maxEntries: 1.5 })).toThrow(/positive integer/)
        })

        // An unbounded process-local cache is a memory leak for any key space
        // the caller does not control.
        it('never exceeds maxEntries', async () => {
            const store = new MemoryStore({ maxEntries: 3 })
            for (let i = 0; i < 10; i++) await store.set(`k${i}`, String(i))
            expect(store.size).toBeLessThanOrEqual(3)
        })

        it('evicts the entry closest to expiry first', async () => {
            vi.useFakeTimers()
            const store = new MemoryStore({ maxEntries: 2 })
            await store.set('soon', '1', 10)
            await store.set('later', '2', 1000)
            await store.set('new', '3', 500)

            expect(await store.get('soon')).toBeNull()
            expect(await store.get('later')).toBe('2')
            expect(await store.get('new')).toBe('3')
        })

        it('prefers evicting expiring entries over permanent ones', async () => {
            vi.useFakeTimers()
            const store = new MemoryStore({ maxEntries: 2 })
            await store.set('permanent', 'p')
            await store.set('expiring', 'e', 10)
            await store.set('new', 'n', 1000)

            expect(await store.get('permanent')).toBe('p')
            expect(await store.get('expiring')).toBeNull()
        })

        it('overwriting an existing key does not evict', async () => {
            const store = new MemoryStore({ maxEntries: 2 })
            await store.set('a', '1')
            await store.set('b', '2')
            await store.set('a', 'updated')
            expect(await store.get('a')).toBe('updated')
            expect(await store.get('b')).toBe('2')
        })
    })
})
