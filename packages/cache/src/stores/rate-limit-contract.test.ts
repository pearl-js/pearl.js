import { describe, it, expect } from 'vitest'
import type { RateLimitStore } from '@pearl-framework/http'
import { CacheRateLimitStore } from './CacheRateLimitStore.js'
import { MemoryStore } from './MemoryStore.js'

/**
 * The point of this adapter is that `RateLimiter.useStore()` accepts it, so
 * the contract is asserted at compile time rather than described in a README.
 */
describe('CacheRateLimitStore satisfies RateLimitStore', () => {
    it('is assignable to the HTTP package contract', async () => {
        const store: RateLimitStore = new CacheRateLimitStore(new MemoryStore())

        const { count, resetAt } = await store.hit('k', 60_000)
        expect(count).toBe(1)
        expect(resetAt).toBeGreaterThan(Date.now())

        await store.reset('k')
        expect((await store.hit('k', 60_000)).count).toBe(1)
    })
})
