import { describe, it, expect } from 'vitest'
import { Mailer } from './Mailer.js'
import type { MailTransport } from './transports/index.js'
import type { Mailable, BuiltMail } from './mail/Mailable.js'

class StubMailable {
    constructor(public readonly id: number, private readonly shouldFail = false) {}
    async compile(): Promise<BuiltMail> {
        if (this.shouldFail) throw new Error(`compile failed ${this.id}`)
        return { to: ['x@y.com'], subject: `m${this.id}` }
    }
}

function makeTransport(): { transport: MailTransport; sent: BuiltMail[]; inflight: () => number } {
    const sent: BuiltMail[] = []
    let active = 0
    let peak = 0
    const transport: MailTransport = {
        async send(mail) {
            active++
            peak = Math.max(peak, active)
            await new Promise((r) => setTimeout(r, 5))
            sent.push(mail)
            active--
        },
    } as MailTransport
    return { transport, sent, inflight: () => peak }
}

describe('Mailer.sendBulk', () => {
    it('respects concurrency cap', async () => {
        const { transport, inflight } = makeTransport()
        const mailer = new Mailer({ transport })
        const mailables = Array.from({ length: 20 }, (_, i) => new StubMailable(i) as unknown as Mailable)

        await mailer.sendBulk(mailables, { concurrency: 3 })

        expect(inflight()).toBeLessThanOrEqual(3)
    })

    it('fails fast by default', async () => {
        const { transport } = makeTransport()
        const mailer = new Mailer({ transport })
        const mailables = [
            new StubMailable(1) as unknown as Mailable,
            new StubMailable(2, true) as unknown as Mailable,
            new StubMailable(3) as unknown as Mailable,
        ]
        await expect(mailer.sendBulk(mailables, { concurrency: 1 })).rejects.toThrow()
    })

    it('collects errors with continueOnError', async () => {
        const { transport, sent } = makeTransport()
        const mailer = new Mailer({ transport })
        const mailables = [
            new StubMailable(1) as unknown as Mailable,
            new StubMailable(2, true) as unknown as Mailable,
            new StubMailable(3) as unknown as Mailable,
        ]
        const result = await mailer.sendBulk(mailables, {
            concurrency: 2,
            continueOnError: true,
        })
        expect(result.sent).toBe(2)
        expect(result.errors).toHaveLength(1)
        expect(result.errors[0]!.index).toBe(1)
        expect(sent).toHaveLength(2)
    })
})
