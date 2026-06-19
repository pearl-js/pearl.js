import { randomBytes, timingSafeEqual } from 'node:crypto'
import type { AuthGuard, AuthUser, UserProvider } from '../contracts/index.js'

export interface SessionRecord {
    id: string
    userId: number | string
    expiresAt?: Date
}

export interface SessionStore {
    find(id: string): Promise<SessionRecord | null>
    save(record: SessionRecord): Promise<void>
    destroy(id: string): Promise<void>
    destroyAll(userId: number | string): Promise<void>
}

export interface SessionConfig {
    /** Lifetime in seconds. Default: 2 hours. */
    lifetimeSeconds?: number
    /** If true, a new session id is issued on every successful check (rotation). */
    rotateOnUse?: boolean
}

/**
 * Cookie/session-style guard. Token issued via `attempt` is the opaque
 * session id; pair this with your cookie middleware to send it as
 * `Set-Cookie` on login and read it on subsequent requests.
 */
export class SessionGuard<TUser extends AuthUser = AuthUser>
    implements AuthGuard<TUser>
{
    private readonly lifetimeMs: number
    private readonly rotateOnUse: boolean

    constructor(
        private readonly provider: UserProvider<TUser>,
        private readonly store: SessionStore,
        config: SessionConfig = {},
    ) {
        this.lifetimeMs = (config.lifetimeSeconds ?? 7200) * 1000
        this.rotateOnUse = config.rotateOnUse ?? false
    }

    async attempt(identifier: string, password: string): Promise<string | null> {
        const user = await this.provider.findByCredentials(identifier, password)
        if (!user) return null
        return this.issueSession(user)
    }

    async issueSession(user: TUser): Promise<string> {
        const id = randomBytes(32).toString('hex')
        await this.store.save({
            id,
            userId: user.getAuthIdentifier(),
            expiresAt: new Date(Date.now() + this.lifetimeMs),
        })
        return id
    }

    async check(token: string): Promise<TUser | null> {
        return this.user(token)
    }

    async user(token: string): Promise<TUser | null> {
        if (!token) return null
        const record = await this.store.find(token)
        if (!record) return null

        // Constant-time compare against the stored id to make session-id
        // brute forcing slightly less attractive. (The store lookup itself
        // is the primary defense — this just removes a timing side channel
        // from a noop equality check.)
        if (!constantTimeEquals(record.id, token)) return null

        if (record.expiresAt && record.expiresAt < new Date()) {
            await this.store.destroy(token)
            return null
        }

        const user = await this.provider.findById(record.userId)
        if (!user) return null

        if (this.rotateOnUse) {
            await this.store.destroy(token)
            await this.issueSession(user)
        }

        return user
    }

    async logout(token: string): Promise<void> {
        await this.store.destroy(token)
    }

    async logoutAll(user: TUser): Promise<void> {
        await this.store.destroyAll(user.getAuthIdentifier())
    }
}

function constantTimeEquals(a: string, b: string): boolean {
    const ab = Buffer.from(a)
    const bb = Buffer.from(b)
    if (ab.length !== bb.length) return false
    return timingSafeEqual(ab, bb)
}
