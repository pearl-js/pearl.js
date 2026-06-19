import { describe, it, expect, vi } from 'vitest'
import {
    fixedBackoff,
    linearBackoff,
    exponentialBackoff,
    retryWith,
} from './backoff.js'

describe('backoff strategies', () => {
    it('fixed backoff returns the same delay', () => {
        const b = fixedBackoff(500)
        expect(b(1)).toBe(500)
        expect(b(10)).toBe(500)
    })

    it('linear backoff scales by attempt and respects cap', () => {
        const b = linearBackoff(100, 350)
        expect(b(1)).toBe(100)
        expect(b(2)).toBe(200)
        expect(b(5)).toBe(350)
    })

    it('exponential backoff doubles and caps', () => {
        const b = exponentialBackoff({ base: 100, factor: 2, maxDelay: 800 })
        expect(b(1)).toBe(100)
        expect(b(2)).toBe(200)
        expect(b(3)).toBe(400)
        expect(b(4)).toBe(800)
        expect(b(5)).toBe(800) // capped
    })

    it('exponential backoff with jitter stays within ± range', () => {
        const b = exponentialBackoff({ base: 1000, factor: 1, jitterPercent: 0.25 })
        for (let i = 0; i < 50; i++) {
            const v = b(1)
            expect(v).toBeGreaterThanOrEqual(750)
            expect(v).toBeLessThanOrEqual(1250)
        }
    })
})

describe('retryWith', () => {
    it('returns value on first success', async () => {
        const fn = vi.fn().mockResolvedValue(42)
        const result = await retryWith(fn, { attempts: 3 })
        expect(result).toBe(42)
        expect(fn).toHaveBeenCalledTimes(1)
    })

    it('retries failed attempts up to the limit', async () => {
        const fn = vi
            .fn()
            .mockRejectedValueOnce(new Error('1'))
            .mockRejectedValueOnce(new Error('2'))
            .mockResolvedValue('ok')
        const result = await retryWith(fn, { attempts: 3, backoff: () => 0 })
        expect(result).toBe('ok')
        expect(fn).toHaveBeenCalledTimes(3)
    })

    it('throws final error if all attempts fail', async () => {
        const fn = vi.fn().mockRejectedValue(new Error('always'))
        await expect(retryWith(fn, { attempts: 2, backoff: () => 0 })).rejects.toThrow('always')
        expect(fn).toHaveBeenCalledTimes(2)
    })

    it('honors shouldRetry to short-circuit', async () => {
        const fn = vi.fn().mockRejectedValue(new Error('fatal'))
        const shouldRetry = vi.fn().mockReturnValue(false)
        await expect(
            retryWith(fn, { attempts: 5, backoff: () => 0, shouldRetry }),
        ).rejects.toThrow('fatal')
        expect(fn).toHaveBeenCalledTimes(1)
    })

    it('calls onRetry between attempts', async () => {
        const fn = vi
            .fn()
            .mockRejectedValueOnce(new Error('a'))
            .mockResolvedValue('done')
        const onRetry = vi.fn()
        await retryWith(fn, { attempts: 2, backoff: () => 0, onRetry })
        expect(onRetry).toHaveBeenCalledTimes(1)
    })
})
