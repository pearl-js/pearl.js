import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { NoneAdapter } from './NoneAdapter.js'
import type { SqliteConfig } from '../config.js'

// Mock the dynamic `import('better-sqlite3')` inside NoneAdapter.connect()
// so the test doesn't depend on the native binding being built.
const databaseInstances: Array<{
    filename: string
    close: ReturnType<typeof vi.fn>
}> = []

vi.mock('better-sqlite3', () => ({
    default: vi.fn().mockImplementation((filename: string) => {
        const instance = { filename, close: vi.fn() }
        databaseInstances.push(instance)
        return instance
    }),
}))

const sqliteConfig: SqliteConfig = { driver: 'sqlite', filename: ':memory:' }

describe('NoneAdapter', () => {
    beforeEach(() => {
        databaseInstances.length = 0
    })

    describe('when not connected', () => {
        it('connection() throws a descriptive error', () => {
            const adapter = new NoneAdapter(sqliteConfig)
            expect(() => adapter.connection()).toThrow(/NoneAdapter: not connected/)
        })

        it('client getter throws (alias of connection())', () => {
            const adapter = new NoneAdapter(sqliteConfig)
            expect(() => adapter.client).toThrow(/NoneAdapter: not connected/)
        })

        it('disconnect() is a no-op when never connected', async () => {
            const adapter = new NoneAdapter(sqliteConfig)
            await expect(adapter.disconnect()).resolves.toBeUndefined()
        })
    })

    describe('sqlite driver', () => {
        let adapter: NoneAdapter

        beforeEach(() => {
            adapter = new NoneAdapter(sqliteConfig)
        })

        afterEach(async () => {
            await adapter.disconnect()
        })

        it('connect() instantiates the driver with the configured filename', async () => {
            await adapter.connect()
            expect(databaseInstances).toHaveLength(1)
            expect(databaseInstances[0]?.filename).toBe(':memory:')
        })

        it('connection() returns the constructed client', async () => {
            await adapter.connect()
            expect(adapter.connection()).toBe(databaseInstances[0])
        })

        it('client getter returns the same instance as connection()', async () => {
            await adapter.connect()
            expect(adapter.client).toBe(adapter.connection())
        })

        it('connect() is idempotent — repeated calls reuse the same client', async () => {
            await adapter.connect()
            await adapter.connect()
            expect(databaseInstances).toHaveLength(1)
        })

        it('disconnect() calls close() on the underlying client', async () => {
            await adapter.connect()
            const created = databaseInstances[0]!
            await adapter.disconnect()
            expect(created.close).toHaveBeenCalledTimes(1)
        })

        it('disconnect() releases the client so subsequent connection() throws again', async () => {
            await adapter.connect()
            await adapter.disconnect()
            expect(() => adapter.connection()).toThrow(/NoneAdapter: not connected/)
        })

        it('disconnect() is idempotent and does not double-close', async () => {
            await adapter.connect()
            const created = databaseInstances[0]!
            await adapter.disconnect()
            await expect(adapter.disconnect()).resolves.toBeUndefined()
            expect(created.close).toHaveBeenCalledTimes(1)
        })

        it('connect() after disconnect() builds a fresh client', async () => {
            await adapter.connect()
            await adapter.disconnect()
            await adapter.connect()
            expect(databaseInstances).toHaveLength(2)
            expect(adapter.connection()).toBe(databaseInstances[1])
        })
    })
})
