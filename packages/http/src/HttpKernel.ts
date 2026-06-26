import { createServer, type Server } from 'node:http'
import { Request } from './http/Request.js'
import { Response } from './http/Response.js'
import { HttpContext } from './http/HttpContext.js'
import { Pipeline } from './routing/Pipeline.js'
import { Router } from './routing/Router.js'

export interface KernelOptions {
    router?: Router
    port?: number
    host?: string
    /**
     * Maximum bytes accepted from a single request body. Requests exceeding
     * this are dropped with a 413 before the handler runs. Defaults to 1 MiB.
     */
    maxBodyBytes?: number
    /**
     * Called for every unhandled exception that escapes the middleware chain.
     * Receives the raw error; runs BEFORE the generic 500 response is sent.
     * Use it to ship errors to your APM. The client never sees the error
     * message unless the error sets an explicit `statusCode` below 500.
     */
    onUnhandledError?: (error: unknown) => void
}

export class HttpKernel {
    private readonly server: Server
    private readonly maxBodyBytes: number
    private readonly onUnhandledError?: (error: unknown) => void
    private _router: Router

    constructor(options: KernelOptions = {}) {
            this._router = options.router ?? new Router()
            this.maxBodyBytes = options.maxBodyBytes ?? 1_048_576
            if (options.onUnhandledError !== undefined) {
                this.onUnhandledError = options.onUnhandledError
            }
            this.server = createServer(async (rawReq, rawRes) => {
            await this.handleRequest(rawReq, rawRes)
        })
    }

    // ─── Router ───────────────────────────────────────────────────────────────

    useRouter(router: Router): this {
        this._router = router
        return this
    }

    get router(): Router {
        return this._router
    }

    // ─── Handler (for testing) ────────────────────────────────────────────────

    get handler() {
        return this.handleRequest.bind(this)
    }

    // ─── Server lifecycle ─────────────────────────────────────────────────────

    listen(port = 3000, host = 'localhost', callback?: () => void): this {
        this.server.listen(port, host, callback)
        return this
    }

    close(): Promise<void> {
        return new Promise((resolve, reject) => {
        this.server.close((err) => (err ? reject(err) : resolve()))
        })
    }

    // ─── Request handling ─────────────────────────────────────────────────────

    private async handleRequest(
        rawReq: import('node:http').IncomingMessage,
        rawRes: import('node:http').ServerResponse,
    ): Promise<void> {
        const res = new Response(rawRes)

        try {
            const req = await Request.fromIncoming(rawReq, { maxBodyBytes: this.maxBodyBytes })
            const ctx = new HttpContext(req, res)

            const match = this._router.match(req.method, req.path)
            if (match) req.setParams(match.params)

            // Global middleware runs for EVERY request — including ones that
            // match no route — so cross-cutting concerns like CORS can handle
            // preflight (OPTIONS) requests and short-circuit before the 404.
            const middleware = [
                ...this._router.globalMiddlewares,
                ...(match ? match.route.middleware : []),
            ]

            await new Pipeline(ctx)
                .through(middleware)
                .run(async (ctx: HttpContext) => {
                    if (match) {
                        await match.route.handler(ctx)
                    } else if (!ctx.response.sent) {
                        ctx.response.notFound(`Cannot ${req.method} ${req.path}`)
                    }
                })
        } catch (error) {
            if (res.sent) return

            // Errors with an explicit statusCode below 500 are deliberate client
            // errors thrown by the framework or app — their messages are safe to
            // surface. Everything else is an unhandled exception whose message
            // may leak implementation details, so the client only sees a
            // generic 500.
            const statusCode = (error as { statusCode?: number }).statusCode
            const isClientFacing =
                typeof statusCode === 'number' && statusCode >= 400 && statusCode < 500

            if (isClientFacing) {
                const message = error instanceof Error ? error.message : 'Bad Request'
                res.json({ message }, statusCode)
                return
            }

            this.onUnhandledError?.(error)
            res.serverError('Internal Server Error')
        }
    }
}