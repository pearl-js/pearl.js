import { describe, it, expect, beforeEach } from 'vitest'
import { MailFake, type CapturedMail } from './MailFake.js'

const mail = (overrides: Partial<CapturedMail> = {}): CapturedMail => ({
    to: 'user@example.com',
    subject: 'Welcome',
    ...overrides,
})

describe('MailFake', () => {
    let fake: MailFake

    beforeEach(() => {
        fake = new MailFake()
    })

    describe('send() + accessors', () => {
        it('starts with an empty sent buffer', () => {
            expect(fake.sent).toEqual([])
            expect(fake.last()).toBeUndefined()
        })

        it('captures sent mail without delivering it', async () => {
            const m = mail({ subject: 'Hi' })
            await fake.send(m)
            expect(fake.sent).toEqual([m])
            expect(fake.last()).toBe(m)
        })

        it('preserves insertion order across multiple sends', async () => {
            await fake.send(mail({ subject: 'A' }))
            await fake.send(mail({ subject: 'B' }))
            await fake.send(mail({ subject: 'C' }))
            expect(fake.sent.map((m) => m.subject)).toEqual(['A', 'B', 'C'])
            expect(fake.last()?.subject).toBe('C')
        })
    })

    describe('assertSent()', () => {
        it('passes when a mail with the given subject was sent', async () => {
            await fake.send(mail({ subject: 'Welcome' }))
            expect(() => fake.assertSent('Welcome')).not.toThrow()
        })

        it('throws when no mail matches the subject', async () => {
            await fake.send(mail({ subject: 'Welcome' }))
            expect(() => fake.assertSent('Other')).toThrow()
        })

        it('throws when nothing has been sent', () => {
            expect(() => fake.assertSent('Welcome')).toThrow()
        })

        it('accepts a predicate matcher', async () => {
            await fake.send(mail({ to: 'a@example.com', subject: 'A' }))
            await fake.send(mail({ to: 'b@example.com', subject: 'B' }))
            expect(() => fake.assertSent((m) => m.to === 'b@example.com')).not.toThrow()
            expect(() => fake.assertSent((m) => m.to === 'c@example.com')).toThrow()
        })

        it('returns this for chaining', async () => {
            await fake.send(mail({ subject: 'Welcome' }))
            expect(fake.assertSent('Welcome')).toBe(fake)
        })
    })

    describe('assertNotSent()', () => {
        it('passes when no mail matches', async () => {
            await fake.send(mail({ subject: 'Other' }))
            expect(() => fake.assertNotSent('Welcome')).not.toThrow()
        })

        it('throws when a matching mail was sent', async () => {
            await fake.send(mail({ subject: 'Welcome' }))
            expect(() => fake.assertNotSent('Welcome')).toThrow()
        })

        it('accepts a predicate matcher', async () => {
            await fake.send(mail({ to: 'spam@example.com' }))
            expect(() => fake.assertNotSent((m) => m.to === 'spam@example.com')).toThrow()
            expect(() => fake.assertNotSent((m) => m.to === 'safe@example.com')).not.toThrow()
        })
    })

    describe('assertSentTo()', () => {
        it('passes when a mail was sent to the given address (string recipient)', async () => {
            await fake.send(mail({ to: 'user@example.com' }))
            expect(() => fake.assertSentTo('user@example.com')).not.toThrow()
        })

        it('passes when address is one of many recipients (array recipient)', async () => {
            await fake.send(mail({ to: ['alice@example.com', 'bob@example.com'] }))
            expect(() => fake.assertSentTo('bob@example.com')).not.toThrow()
        })

        it('throws when address was never a recipient', async () => {
            await fake.send(mail({ to: 'user@example.com' }))
            expect(() => fake.assertSentTo('other@example.com')).toThrow(
                /other@example\.com/,
            )
        })
    })

    describe('assertCount() / assertNothingSent()', () => {
        it('assertCount passes on exact match', async () => {
            await fake.send(mail())
            await fake.send(mail())
            expect(() => fake.assertCount(2)).not.toThrow()
        })

        it('assertCount throws on mismatch with a helpful message', async () => {
            await fake.send(mail())
            expect(() => fake.assertCount(2)).toThrow(/Expected 2 mail\(s\).*got 1/)
        })

        it('assertNothingSent passes on a fresh fake', () => {
            expect(() => fake.assertNothingSent()).not.toThrow()
        })

        it('assertNothingSent throws after any send', async () => {
            await fake.send(mail())
            expect(() => fake.assertNothingSent()).toThrow()
        })
    })

    describe('reset()', () => {
        it('clears captured mail in place (keeps sent reference stable)', async () => {
            await fake.send(mail())
            await fake.send(mail())
            const ref = fake.sent
            fake.reset()
            expect(fake.sent).toBe(ref)
            expect(fake.sent).toEqual([])
            expect(fake.last()).toBeUndefined()
            expect(() => fake.assertNothingSent()).not.toThrow()
        })
    })
})
