import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Container } from '@pearl-framework/core'
import { Job } from '../jobs/Job.js'
import { QueueServiceProvider, type QueueServiceConfig } from './QueueServiceProvider.js'

// vi.mock is hoisted above module scope, so the spy state has to be hoisted too.
const { started } = vi.hoisted(() => ({
    started: [] as Array<{ queue: string; registered: unknown[] }>,
}))

// The real worker opens a Redis connection on start(); stub it so boot() can
// be exercised without a server.
vi.mock('../workers/QueueWorker.js', () => ({
    QueueWorker: class {
        readonly registered: unknown[] = []
        constructor(public readonly queue: string) {}
        register(...jobs: unknown[]) { this.registered.push(...jobs); return this }
        start() { started.push({ queue: this.queue, registered: this.registered }); return this }
        async stop() {}
    },
}))

class SendEmail extends Job {
    async handle(): Promise<void> {}
}

class Other extends Job {
    async handle(): Promise<void> {}
}

function makeProvider(config: QueueServiceConfig): QueueServiceProvider {
    // `config` is a protected field on the base, so a subclass field
    // initializer (which runs after the base's) is the way to supply it.
    class Configured extends QueueServiceProvider {
        protected override config = config
    }
    return new Configured(new Container())
}

beforeEach(() => {
    started.length = 0
})

describe('QueueServiceProvider', () => {
    it('does nothing when no workers are configured', async () => {
        const provider = makeProvider({ connection: {} })
        provider.register()
        await provider.boot()
        expect(started).toHaveLength(0)
    })

    // A worker with an empty registry throws "No job registered" for every job
    // it receives, which used to happen silently for the documented config.
    it('refuses to start a worker with no job classes', async () => {
        const provider = makeProvider({ connection: {}, workers: [{ queue: 'default' }] })
        provider.register()
        await expect(provider.boot()).rejects.toThrow(/has no job classes/)
        expect(started).toHaveLength(0)
    })

    it('names the offending queue in the error', async () => {
        const provider = makeProvider({ connection: {}, workers: [{ queue: 'mail' }] })
        provider.register()
        await expect(provider.boot()).rejects.toThrow(/"mail"/)
    })

    it('registers the top-level jobs on every worker', async () => {
        const provider = makeProvider({
            connection: {},
            jobs: [SendEmail],
            workers: [{ queue: 'default' }, { queue: 'mail' }],
        })
        provider.register()
        await provider.boot()

        expect(started.map((w) => w.queue)).toEqual(['default', 'mail'])
        for (const worker of started) {
            expect(worker.registered).toEqual([SendEmail])
        }
    })

    it('lets a worker override the job list', async () => {
        const provider = makeProvider({
            connection: {},
            jobs: [SendEmail],
            workers: [{ queue: 'mail', jobs: [Other] }],
        })
        provider.register()
        await provider.boot()
        expect(started[0]?.registered).toEqual([Other])
    })
})
