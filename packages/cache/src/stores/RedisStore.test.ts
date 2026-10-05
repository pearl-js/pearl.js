import { describe, it, expect, vi } from 'vitest'
import { RedisStore, type RedisLike } from './RedisStore.js'

/** Minimal in-process stand-in with the semantics this store relies on. */
function fakeRedis() {
    const data = new Map<string, string>()
    const ttl = new Map<string, number>()
    const calls: string[] = []

    const client = {
        async get(k: string) { calls.push(`get ${k}`); return data.get(k) ?? null },
        async set(k: string, v: string, mode?: string, seconds?: number) {
            calls.push(`set ${k}${mode ? ` ${mode} ${String(seconds)}` : ''}`)
            data.set(k, v)
            if (mode === 'EX' && seconds !== undefined) ttl.set(k, seconds)
            return 'OK'
        },
        async del(...keys: string[]) {
            calls.push(`del ${keys.join(',')}`)
            let n = 0
            for (const k of keys) { if (data.delete(k)) n++; ttl.delete(k) }
            return n
        },
        async incrby(k: string, by: number) {
            calls.push(`incrby ${k} ${by}`)
            const next = Number(data.get(k) ?? 0) + by
            data.set(k, String(next))
            return next
        },
        async expire(k: string, seconds: number) {
            calls.push(`expire ${k} ${seconds}`)
            ttl.set(k, seconds)
            return 1
        },
        async pttl(k: string) {
            if (!data.has(k)) return -2
            const t = ttl.get(k)
            return t === undefined ? -1 : t * 1000
        },
        async scan(_c: string, _m: 'MATCH', pattern: string) {
            calls.push(`scan ${pattern}`)
            const re = new RegExp(`^${pattern.replace('*', '.*')}$`)
            return ['0', [...data.keys()].filter((k) => re.test(k))] as [string, string[]]
        },
    } as unknown as RedisLike

    return { client, data, ttl, calls }
}

describe('RedisStore', () => {
    it('prefixes keys', async () => {
        const { client, data } = fakeRedis()
        await new RedisStore(client, { prefix: 'app:' }).set('k', 'v')
        expect([...data.keys()]).toEqual(['app:k'])
    })

    it('defaults to the pearl prefix', async () => {
        const { client, data } = fakeRedis()
        await new RedisStore(client).set('k', 'v')
        expect([...data.keys()]).toEqual(['pearl:cache:k'])
    })

    it('round-trips through the prefix', async () => {
        const { client } = fakeRedis()
        const store = new RedisStore(client)
        await store.set('k', 'v')
        expect(await store.get('k')).toBe('v')
        await store.forget('k')
        expect(await store.get('k')).toBeNull()
    })

    it('sets with EX when given a TTL and without when not', async () => {
        const { client, ttl, calls } = fakeRedis()
        const store = new RedisStore(client, { prefix: 'p:' })
        await store.set('a', '1', 30)
        expect(ttl.get('p:a')).toBe(30)
        await store.set('b', '2')
        expect(ttl.has('p:b')).toBe(false)
        expect(calls).toContain('set p:a EX 30')
    })

    // Redis EX takes whole seconds and rejects 0.
    it('rounds a fractional TTL up to at least one second', async () => {
        const { client, ttl } = fakeRedis()
        const store = new RedisStore(client, { prefix: 'p:' })
        await store.set('a', '1', 0.2)
        expect(ttl.get('p:a')).toBe(1)
        await store.set('b', '1', 2.3)
        expect(ttl.get('p:b')).toBe(3)
    })

    it('rejects a non-positive TTL', async () => {
        const { client } = fakeRedis()
        const store = new RedisStore(client)
        await expect(store.set('k', 'v', 0)).rejects.toThrow(/positive, finite/)
        await expect(store.set('k', 'v', Number.NaN)).rejects.toThrow(/positive, finite/)
    })

    // INCRBY creates the key with no expiry; applying the TTL on every hit
    // would slide a rate-limit window forward forever.
    it('applies the TTL only on the increment that creates the key', async () => {
        const { client, calls } = fakeRedis()
        const store = new RedisStore(client, { prefix: 'p:' })

        expect(await store.increment('hits', 1, 60)).toBe(1)
        expect(calls.filter((c) => c.startsWith('expire'))).toHaveLength(1)

        expect(await store.increment('hits', 1, 60)).toBe(2)
        expect(calls.filter((c) => c.startsWith('expire'))).toHaveLength(1)
    })

    it('reports expiresAt from pttl, and null without an expiry', async () => {
        vi.useFakeTimers()
        vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
        const { client } = fakeRedis()
        const store = new RedisStore(client)

        await store.set('with', 'v', 60)
        expect(await store.expiresAt('with')).toBe(Date.parse('2026-01-01T00:01:00Z'))

        await store.set('without', 'v')
        expect(await store.expiresAt('without')).toBeNull()
        expect(await store.expiresAt('absent')).toBeNull()
        vi.useRealTimers()
    })

    describe('flush', () => {
        it('deletes only keys under the prefix', async () => {
            const { client, data } = fakeRedis()
            const store = new RedisStore(client, { prefix: 'mine:' })
            await store.set('a', '1')
            await store.set('b', '2')
            data.set('someone-else:c', '3')

            await store.flush()
            expect([...data.keys()]).toEqual(['someone-else:c'])
        })

        // KEYS blocks the server for the length of the keyspace.
        it('uses SCAN rather than KEYS', async () => {
            const { client, calls } = fakeRedis()
            await new RedisStore(client).flush()
            expect(calls.some((c) => c.startsWith('scan'))).toBe(true)
            expect(calls.some((c) => c.startsWith('keys'))).toBe(false)
        })
    })
})
