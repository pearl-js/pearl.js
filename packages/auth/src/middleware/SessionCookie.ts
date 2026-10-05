import { AsyncLocalStorage } from 'node:async_hooks'
import type { HttpContext, MiddlewareFn, NextFn, CookieOptions } from '@pearl-framework/http'
import type { AuthUser } from '../contracts/index.js'
import type { SessionGuard } from '../guards/SessionGuard.js'

export interface SessionCookieOptions {
    /** Cookie name holding the opaque session id. Default `pearl_session`. */
    name?: string
    /**
     * Verify the cookie's signature. Default true — an unsigned session cookie
     * lets a client submit arbitrary ids and probe the session store directly.
     * Requires `cookieSecret` on the kernel.
     */
    signed?: boolean
    /** Attributes for the issued cookie. `httpOnly`/`sameSite`/`path` default as in `Response.cookie`. */
    cookie?: Omit<CookieOptions, 'signed'>
    /** Reject with 401 when no valid session is present. Default false. */
    required?: boolean
}

/**
 * Carries the current response's cookie writer so a rotated session id can be
 * re-issued. `SessionGuard.onRotate` is configured once on the guard, but the
 * `Set-Cookie` belongs to whichever request is in flight — this bridges the two
 * without widening the guard's contract.
 */
const rotation = new AsyncLocalStorage<{ rotate: (newId: string) => void }>()

/**
 * Pass as `SessionGuard`'s `onRotate` so `rotateOnUse` sessions keep working:
 *
 *   new SessionGuard(provider, store, {
 *     rotateOnUse: true,
 *     onRotate: rotateSessionCookie(),
 *   })
 *
 * Without it a rotated id is never sent to the browser and the user is logged
 * out on their next request.
 */
export function rotateSessionCookie(): (newId: string, oldId: string) => void {
    return (newId: string): void => {
        rotation.getStore()?.rotate(newId)
    }
}

/**
 * Resolve the session cookie into `auth.user`, and re-issue the cookie when the
 * guard rotates the id.
 *
 *   router.use(session(guard))
 *   router.get('/me', handler, [session(guard, { required: true })])
 */
export function session<TUser extends AuthUser>(
    guard: SessionGuard<TUser>,
    options: SessionCookieOptions = {},
): MiddlewareFn {
    const name = options.name ?? 'pearl_session'
    const signed = options.signed ?? true

    return async (ctx: HttpContext, next: NextFn): Promise<void> => {
        const id = signed ? ctx.request.signedCookie(name) : ctx.request.cookie(name)

        if (!id) {
            if (options.required) {
                ctx.response.unauthorized('No active session.')
                return
            }
            await next()
            return
        }

        const rotate = (newId: string): void => {
            writeSessionCookie(ctx, newId, name, signed, options.cookie)
            ctx.set('auth.token', newId)
        }

        const user = await rotation.run({ rotate }, () => guard.user(id))

        if (!user) {
            // The id is stale or forged — drop it so the browser stops resending.
            ctx.response.clearCookie(name, options.cookie ?? {})
            if (options.required) {
                ctx.response.unauthorized('Session expired.')
                return
            }
            await next()
            return
        }

        ctx.set('auth.user', user)
        if (ctx.get('auth.token') === undefined) ctx.set('auth.token', id)

        await next()
    }
}

/**
 * Issue a session for `user` and set the cookie. Call this from your login
 * handler after verifying credentials.
 */
export async function startSession<TUser extends AuthUser>(
    ctx: HttpContext,
    guard: SessionGuard<TUser>,
    user: TUser,
    options: SessionCookieOptions = {},
): Promise<string> {
    const id = await guard.issueSession(user)
    writeSessionCookie(ctx, id, options.name ?? 'pearl_session', options.signed ?? true, options.cookie)
    ctx.set('auth.user', user)
    ctx.set('auth.token', id)
    return id
}

/** Destroy the current session and clear the cookie. */
export async function endSession<TUser extends AuthUser>(
    ctx: HttpContext,
    guard: SessionGuard<TUser>,
    options: SessionCookieOptions = {},
): Promise<void> {
    const name = options.name ?? 'pearl_session'
    const id = ctx.get<string>('auth.token')
    if (id) await guard.logout(id)
    ctx.response.clearCookie(name, options.cookie ?? {})
}

function writeSessionCookie(
    ctx: HttpContext,
    id: string,
    name: string,
    signed: boolean,
    cookie: Omit<CookieOptions, 'signed'> | undefined,
): void {
    ctx.response.cookie(name, id, { ...cookie, signed })
}
