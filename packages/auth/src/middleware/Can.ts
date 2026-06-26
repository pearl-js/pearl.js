import type { HttpContext, MiddlewareFn, NextFn } from '@pearl-framework/http'
import type { Gate } from '../Gate.js'

/**
 * Authorization middleware — allow the request only if the authenticated user
 * passes `ability` on the given Gate. Responds 403 otherwise. Runs AFTER
 * `Authenticate`, which puts the user on the context.
 *
 *   router.get('/admin', handler, [Authenticate(auth), can(gate, 'admin')])
 *
 *   // Policy style — resolve the resource and pass it to the ability:
 *   router.put('/posts/:id', handler, [
 *     Authenticate(auth),
 *     can(gate, 'edit-post', (ctx) => loadPost(ctx.request.param('id'))),
 *   ])
 */
export function can<TUser>(
    gate: Gate<TUser>,
    ability: string,
    argResolver?: (ctx: HttpContext) => unknown,
): MiddlewareFn {
    return async (ctx: HttpContext, next: NextFn): Promise<void> => {
        const user = (ctx.get('auth.user') ?? null) as TUser | null

        const allowed = argResolver
            ? await gate.allows(ability, user, argResolver(ctx))
            : await gate.allows(ability, user)

        if (!allowed) {
            ctx.response.forbidden(`Not authorized: ${ability}`)
            return
        }

        await next()
    }
}
