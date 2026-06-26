/**
 * An ability check. Receives the (possibly null) user and any extra arguments
 * passed to `allows`/`authorize` — e.g. the resource being acted on.
 */
export type Ability<TUser = unknown> = (
    user: TUser | null,
    ...args: unknown[]
) => boolean | Promise<boolean>

/** Thrown by `Gate.authorize()` when an ability is denied. Surfaces as HTTP 403. */
export class AccessDeniedError extends Error {
    readonly statusCode = 403
    constructor(message = 'Forbidden') {
        super(message)
        this.name = 'AccessDeniedError'
    }
}

/**
 * Authorization gate — define named abilities (and policies) in code, then
 * check them anywhere.
 *
 *   const gate = new Gate<User>()
 *     .define('admin', (u) => u?.role === 'admin')
 *     .define('edit-post', (u, post) => !!u && (post as Post).authorId === u.id)
 *
 *   if (await gate.allows('admin', user)) { … }
 *   await gate.authorize('edit-post', user, post)   // throws AccessDeniedError if denied
 *
 * Pair with the `can()` middleware to protect routes.
 */
export class Gate<TUser = unknown> {
    private readonly abilities = new Map<string, Ability<TUser>>()

    define(ability: string, fn: Ability<TUser>): this {
        this.abilities.set(ability, fn)
        return this
    }

    has(ability: string): boolean {
        return this.abilities.has(ability)
    }

    /** True if the ability is defined AND its check returns true. Unknown abilities deny. */
    async allows(ability: string, user: TUser | null, ...args: unknown[]): Promise<boolean> {
        const fn = this.abilities.get(ability)
        if (!fn) return false
        return (await fn(user, ...args)) === true
    }

    async denies(ability: string, user: TUser | null, ...args: unknown[]): Promise<boolean> {
        return !(await this.allows(ability, user, ...args))
    }

    /** Throw `AccessDeniedError` (HTTP 403) if the ability is denied. */
    async authorize(ability: string, user: TUser | null, ...args: unknown[]): Promise<void> {
        if (await this.denies(ability, user, ...args)) {
            throw new AccessDeniedError(`Not authorized: ${ability}`)
        }
    }
}
