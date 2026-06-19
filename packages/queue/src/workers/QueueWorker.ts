import { Worker as BullWorker, type ConnectionOptions, type Job as BullJob } from 'bullmq'
import type { Job } from '../jobs/Job.js'

const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

function safeMerge<T extends object>(target: T, source: Record<string, unknown>): T {
    for (const key of Object.keys(source)) {
        if (!UNSAFE_KEYS.has(key)) {
            (target as Record<string, unknown>)[key] = source[key]
        }
    }
    return target
}

type JobConstructor = new (...args: never[]) => Job

export type UnknownJobHandler = (jobName: string, data: unknown, error: Error) => void | Promise<void>

export interface WorkerOptions {
  connection: ConnectionOptions
  prefix?: string
  concurrency?: number
  /**
   * Called when a job arrives whose class isn't registered. Defaults to a
   * console.error. Useful for routing unknown-job alerts to your monitoring.
   */
  onUnknownJob?: UnknownJobHandler
}

/**
 * QueueWorker processes jobs from a named queue.
 *
 * Usage:
 *   const worker = new QueueWorker('default', options)
 *   worker.register(SendWelcomeEmail, ProcessPayment)
 *   worker.start()
 */
export class QueueWorker {
    private readonly registry = new Map<string, JobConstructor>()
    private worker: BullWorker | undefined = undefined

    constructor(
        private readonly queueName: string,
        private readonly options: WorkerOptions,
    ) {}

    // ─── Registration ─────────────────────────────────────────────────────────

    register(...jobClasses: JobConstructor[]): this {
        for (const JobClass of jobClasses) {
            this.registry.set(JobClass.name, JobClass)
        }
        return this
    }

    // ─── Lifecycle ────────────────────────────────────────────────────────────

    start(): this {
        if (this.worker) {
            throw new Error(
                `[QueueWorker] Worker for queue "${this.queueName}" is already running. Call stop() before calling start() again.`
            )
        }

        this.worker = new BullWorker(
        this.queueName,
        async (bullJob: BullJob) => {
            await this.process(bullJob)
        },
        {
            connection: this.options.connection,
            prefix: this.options.prefix ?? 'pearl',
            concurrency: this.options.concurrency ?? 5,
        },
        )

        this.worker.on('failed', async (bullJob, error) => {
        if (!bullJob) return
            await this.handleFailed(bullJob, error)
        })

        return this
    }

    async stop(): Promise<void> {
        await this.worker?.close()
        this.worker = undefined
    }

    // ─── Processing ───────────────────────────────────────────────────────────

    private async process(bullJob: BullJob): Promise<void> {
        const JobClass = this.registry.get(bullJob.name)

        if (!JobClass) {
            throw new Error(
                `No job registered for "${bullJob.name}" on queue "${this.queueName}". ` +
                `Did you forget to call worker.register(${bullJob.name})?`
            )
        }

        const job = safeMerge(new JobClass(), bullJob.data) as Job
        await job.handle()
    }

    private async handleFailed(bullJob: BullJob, error: Error): Promise<void> {
        const isLastAttempt =
            bullJob.attemptsMade >= (bullJob.opts.attempts ?? 1)

        if (!isLastAttempt) return

        const JobClass = this.registry.get(bullJob.name)
        if (!JobClass) {
            // The job class isn't registered on this worker. The original
            // `process()` call already threw — surface it via the configured
            // hook so it isn't silently dropped, then bail.
            await this.reportUnknownJob(bullJob, error)
            return
        }

        try {
            const job = safeMerge(new JobClass(), bullJob.data) as Job
            await job.failed(error)
        } catch (failedHookError) {
            console.error(
                `[QueueWorker] Job "${bullJob.name}" failed() hook threw on queue "${this.queueName}":`,
                failedHookError,
            )
        }
    }

    private async reportUnknownJob(bullJob: BullJob, error: Error): Promise<void> {
        const handler = this.options.onUnknownJob
        if (handler) {
            try {
                await handler(bullJob.name, bullJob.data, error)
            } catch (handlerError) {
                console.error('[QueueWorker] onUnknownJob handler threw:', handlerError)
            }
            return
        }
        console.error(
            `[QueueWorker] Unknown job "${bullJob.name}" failed permanently on queue "${this.queueName}":`,
            error,
        )
    }
}