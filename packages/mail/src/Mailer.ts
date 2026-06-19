import type { MailTransport } from './transports/index.js'
import type { Mailable, MailAddress } from './mail/Mailable.js'

export interface MailerConfig {
    from?: MailAddress | string
    transport: MailTransport
    /**
     * Default concurrency for `sendBulk`. Caps how many transport.send calls
     * run in parallel. Defaults to 10 — high enough for most SMTP providers,
     * low enough to avoid exhausting connection pools.
     */
    defaultBulkConcurrency?: number
}

export interface SendBulkOptions {
    /** Maximum mails in-flight at once. Overrides `defaultBulkConcurrency`. */
    concurrency?: number
    /**
     * If true, individual send failures are collected and returned in
     * `BulkSendResult.errors` instead of aborting the batch.
     */
    continueOnError?: boolean
}

export interface BulkSendResult {
    sent: number
    errors: Array<{ index: number; error: unknown }>
}

const DEFAULT_BULK_CONCURRENCY = 10

export class Mailer {
    constructor(private readonly config: MailerConfig) {}

    // ─── Sending ──────────────────────────────────────────────────────────────

    async send(mailable: Mailable): Promise<void> {
        const mail = await mailable.compile(this.config.from)
        await this.config.transport.send(mail)
    }

    /**
     * Send many mailables with bounded concurrency.
     *
     * By default fails fast on the first error. Pass `continueOnError: true`
     * to collect errors and return a result summary instead.
     */
    async sendBulk(
        mailables: Mailable[],
        options: SendBulkOptions = {},
    ): Promise<BulkSendResult> {
        const concurrency = Math.max(
            1,
            options.concurrency
                ?? this.config.defaultBulkConcurrency
                ?? DEFAULT_BULK_CONCURRENCY,
        )

        const result: BulkSendResult = { sent: 0, errors: [] }
        let cursor = 0

        const worker = async (): Promise<void> => {
            while (cursor < mailables.length) {
                const index = cursor++
                const mailable = mailables[index]
                if (!mailable) continue

                try {
                    await this.send(mailable)
                    result.sent++
                } catch (error) {
                    if (!options.continueOnError) throw error
                    result.errors.push({ index, error })
                }
            }
        }

        const lanes = Math.min(concurrency, mailables.length)
        await Promise.all(Array.from({ length: lanes }, () => worker()))

        return result
    }

    // ─── Transport access ─────────────────────────────────────────────────────

    get transport(): MailTransport {
        return this.config.transport
    }
}
