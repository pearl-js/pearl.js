import type { HttpContext } from '../http/HttpContext.js'
import type { MiddlewareClass, NextFn } from '../routing/Pipeline.js'

/**
 * CORS configuration.
 *
 * `origin` accepts:
 *   - `'*'` (or omitted) — allow any origin. Cannot be combined with
 *     `credentials` (the constructor throws); list the origins explicitly.
 *   - a specific origin string — allowed only if it matches exactly
 *   - an array of allowed origins
 *   - a predicate `(origin) => boolean`
 *   - `true` — reflect whatever origin is requested
 *   - `false` — disallow all cross-origin requests
 */
export interface CorsOptions {
    origin?: string | string[] | boolean | ((origin: string) => boolean)
    /** Allowed methods for preflight. Defaults to the common verb set. */
    methods?: string[]
    /** Allowed request headers. Defaults to reflecting the requested headers. */
    allowedHeaders?: string[]
    /** Response headers the browser is allowed to read. */
    exposedHeaders?: string[]
    /**
     * Send `Access-Control-Allow-Credentials: true`. Default false.
     *
     * Requires an explicit `origin` — combining it with `'*'`, `true`, or an
     * omitted origin throws, since reflecting any caller's origin while
     * allowing credentials lets any site read authenticated responses.
     */
    credentials?: boolean
    /** Preflight cache lifetime in seconds (`Access-Control-Max-Age`). */
    maxAge?: number
    /** Status code for a successful preflight. Default 204. */
    optionsSuccessStatus?: number
}

const DEFAULT_METHODS = ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS']

/**
 * Cross-Origin Resource Sharing middleware.
 *
 * Register it globally so it can handle preflight requests for any path:
 *
 *   router.use(new Cors({ origin: ['https://app.example.com'], credentials: true }))
 */
export class Cors implements MiddlewareClass {
    constructor(private readonly options: CorsOptions = {}) {
        const { origin, credentials } = options
        if (credentials === true && (origin === undefined || origin === '*' || origin === true)) {
            throw new Error(
                'Cors: credentials cannot be combined with a reflected origin. ' +
                'Echoing an arbitrary Origin alongside Access-Control-Allow-Credentials lets ' +
                'any site read authenticated responses. Pass an explicit origin ' +
                '(string, array, or predicate).',
            )
        }
    }

    async handle(ctx: HttpContext, next: NextFn): Promise<void> {
        const requestOrigin = ctx.request.header('origin')

        // Not a cross-origin request — nothing to do.
        if (!requestOrigin) {
            await next()
            return
        }

        const allowOrigin = this.resolveOrigin(requestOrigin)
        const preflight = this.isPreflight(ctx)

        // Origin not allowed: add no CORS headers. End preflight so the browser
        // gets a clean (header-less, thus blocked) response; let real requests
        // continue without CORS headers.
        if (allowOrigin === null) {
            if (preflight) {
                ctx.response.status(403).send()
                return
            }
            await next()
            return
        }

        ctx.response.header('access-control-allow-origin', allowOrigin)
        if (allowOrigin !== '*') ctx.response.header('vary', 'Origin')
        if (this.options.credentials) {
            ctx.response.header('access-control-allow-credentials', 'true')
        }

        if (preflight) {
            ctx.response.header(
                'access-control-allow-methods',
                (this.options.methods ?? DEFAULT_METHODS).join(', '),
            )

            const allowedHeaders = this.options.allowedHeaders
                ? this.options.allowedHeaders.join(', ')
                : ctx.request.header('access-control-request-headers')
            if (allowedHeaders) {
                ctx.response.header('access-control-allow-headers', allowedHeaders)
            }

            if (this.options.maxAge !== undefined) {
                ctx.response.header('access-control-max-age', String(this.options.maxAge))
            }

            ctx.response.status(this.options.optionsSuccessStatus ?? 204).send()
            return
        }

        // Actual (non-preflight) request.
        if (this.options.exposedHeaders && this.options.exposedHeaders.length > 0) {
            ctx.response.header(
                'access-control-expose-headers',
                this.options.exposedHeaders.join(', '),
            )
        }

        await next()
    }

    private isPreflight(ctx: HttpContext): boolean {
        return (
            ctx.request.method === 'OPTIONS' &&
            ctx.request.header('access-control-request-method') !== undefined
        )
    }

    /** Resolve the value for `Access-Control-Allow-Origin`, or null if disallowed. */
    private resolveOrigin(requestOrigin: string): string | null {
        const origin = this.options.origin

        // `*` only. Reflecting the request origin here would defeat CORS, and the
        // constructor rejects pairing a reflected origin with credentials.
        if (origin === undefined || origin === '*') return '*'
        if (origin === true) return requestOrigin
        if (origin === false) return null
        if (typeof origin === 'string') return origin === requestOrigin ? requestOrigin : null
        if (Array.isArray(origin)) return origin.includes(requestOrigin) ? requestOrigin : null
        if (typeof origin === 'function') return origin(requestOrigin) ? requestOrigin : null
        return null
    }
}
