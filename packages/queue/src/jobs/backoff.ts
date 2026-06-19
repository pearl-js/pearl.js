/**
 * Backoff strategies for job retries. These return the delay (in ms)
 * before the next attempt, given the attempt number (1-indexed).
 */

export type BackoffStrategy = (attempt: number) => number

export interface ExponentialBackoffOptions {
    /** Initial delay in ms. */
    base?: number
    /** Multiplier per attempt. */
    factor?: number
    /** Cap on the delay so retries don't explode. */
    maxDelay?: number
    /** Add ±jitterPercent random jitter to break thundering herds. */
    jitterPercent?: number
}

/** Constant delay between every attempt. */
export const fixedBackoff = (delay: number): BackoffStrategy => () => delay

/** Linear growth: delay * attempt. */
export const linearBackoff = (delay: number, maxDelay = Infinity): BackoffStrategy =>
    (attempt) => Math.min(delay * attempt, maxDelay)

/** Classic exponential: base * factor^(attempt - 1), with optional jitter. */
export const exponentialBackoff = (options: ExponentialBackoffOptions = {}): BackoffStrategy => {
    const base = options.base ?? 1000
    const factor = options.factor ?? 2
    const maxDelay = options.maxDelay ?? 60_000
    const jitterPercent = options.jitterPercent ?? 0

    return (attempt) => {
        const raw = base * Math.pow(factor, Math.max(0, attempt - 1))
        const capped = Math.min(raw, maxDelay)
        if (jitterPercent === 0) return capped
        const swing = capped * jitterPercent
        return Math.max(0, capped + (Math.random() * 2 - 1) * swing)
    }
}

/**
 * `retryWith` is a generic retry helper for one-off async ops (HTTP calls,
 * external API hits, etc.). For BullMQ-managed retries on Jobs, prefer
 * overriding `Job.jobOptions.backoff` — the queue handles re-enqueue itself.
 */
export interface RetryOptions {
    attempts: number
    backoff?: BackoffStrategy
    /** Decide whether an error is retryable. Defaults to "always". */
    shouldRetry?: (error: unknown, attempt: number) => boolean
    /** Called before each retry sleep — useful for logging. */
    onRetry?: (error: unknown, attempt: number, delayMs: number) => void
}

export async function retryWith<T>(fn: () => Promise<T>, options: RetryOptions): Promise<T> {
    const attempts = Math.max(1, options.attempts)
    const backoff = options.backoff ?? exponentialBackoff()
    const shouldRetry = options.shouldRetry ?? (() => true)

    let lastError: unknown
    for (let attempt = 1; attempt <= attempts; attempt++) {
        try {
            return await fn()
        } catch (error) {
            lastError = error
            if (attempt === attempts || !shouldRetry(error, attempt)) throw error
            const delay = backoff(attempt)
            options.onRetry?.(error, attempt, delay)
            if (delay > 0) await sleep(delay)
        }
    }
    throw lastError
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
}
