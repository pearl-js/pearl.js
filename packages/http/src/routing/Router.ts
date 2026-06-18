import type { HttpContext } from '../http/HttpContext.js'
import type { Middleware } from './Pipeline.js'

export type RouteHandler = (ctx: HttpContext) => Promise<void> | void

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'OPTIONS' | 'HEAD'

export interface Route {
    method: HttpMethod
    path: string
    handler: RouteHandler
    middleware: Middleware[]
    paramKeys: string[]
    regex: RegExp
}

export interface RouteMatch {
    route: Route
    params: Record<string, string>
}

export class Router {
    private readonly routes: Route[] = []
    private globalMiddleware: Middleware[] = []

    // ─── Global middleware ───────────────────────────────────────────────────

    use(...middleware: Middleware[]): this {
        this.globalMiddleware.push(...middleware)
        return this
    }

    // ─── Route registration ──────────────────────────────────────────────────

    get(path: string, handler: RouteHandler, middleware: Middleware[] = []): this {
        return this.add('GET', path, handler, middleware)
    }

    post(path: string, handler: RouteHandler, middleware: Middleware[] = []): this {
        return this.add('POST', path, handler, middleware)
    }

    put(path: string, handler: RouteHandler, middleware: Middleware[] = []): this {
        return this.add('PUT', path, handler, middleware)
    }

    patch(path: string, handler: RouteHandler, middleware: Middleware[] = []): this {
        return this.add('PATCH', path, handler, middleware)
    }

    delete(path: string, handler: RouteHandler, middleware: Middleware[] = []): this {
        return this.add('DELETE', path, handler, middleware)
    }

    options(path: string, handler: RouteHandler, middleware: Middleware[] = []): this {
        return this.add('OPTIONS', path, handler, middleware)
    }

    // ─── Route groups ────────────────────────────────────────────────────────

    group(
        prefix: string,
        callback: (router: Router) => void,
        middleware: Middleware[] = [],
    ): this {
        const child = new Router()
        callback(child)

        for (const route of child.routes) {
        this.add(
            route.method,
            prefix + route.path,
            route.handler,
            [...middleware, ...route.middleware],
        )
        }
        return this
    }

    // ─── Route matching ──────────────────────────────────────────────────────

    match(method: string, path: string): RouteMatch | null {
        for (const route of this.routes) {
        if (route.method !== method.toUpperCase()) continue

        const match = route.regex.exec(path)
        if (!match) continue

        const params: Record<string, string> = {}
        let malformed = false
        for (let i = 0; i < route.paramKeys.length; i++) {
            try {
                params[route.paramKeys[i]!] = decodeURIComponent(match[i + 1] ?? '')
            } catch {
                malformed = true
                break
            }
        }
        if (malformed) continue

        return { route, params }
        }
        return null
    }

    get allRoutes(): Route[] {
        return this.routes
    }

    get globalMiddlewares(): Middleware[] {
        return this.globalMiddleware
    }

    // ─── Internal ────────────────────────────────────────────────────────────

    private add(
        method: HttpMethod,
        path: string,
        handler: RouteHandler,
        middleware: Middleware[],
    ): this {
        const { regex, paramKeys } = this.compilePath(path)
        this.routes.push({ method, path, handler, middleware, paramKeys, regex })
        return this
    }

    /**
     * Compile a route path pattern into a RegExp.
     *
     * Pattern syntax:
     *   - `:name`  → capture group bound to `name`
     *   - `*`      → wildcard, captures the rest of the path
     *   - any other character is matched literally
     *
     * NOTE on literal colons: a `:` in a literal segment WILL be treated as the
     * start of a parameter name (e.g. `/api:v1` is parsed as literal `/api`
     * followed by param `v1`). If you need a literal colon, prefix it with a
     * backslash: `/api\:v1`.
     */
    private compilePath(path: string): { regex: RegExp; paramKeys: string[] } {
        const paramKeys: string[] = []
        const ESCAPED_COLON = '\x00COLON\x00'

        // 1. Honor user-escaped `\:` — swap for a placeholder so it survives
        //    parameter extraction and regex escaping.
        let working = path.replace(/\\:/g, ESCAPED_COLON)

        // 2. Extract `:name` parameters and replace with a placeholder that
        //    won't be touched by regex-special escaping.
        const PARAM_TOKEN = '\x00PARAM\x00'
        working = working.replace(/:([a-zA-Z_][a-zA-Z0-9_]*)/g, (_m, key: string) => {
            paramKeys.push(key)
            return PARAM_TOKEN
        })

        // 3. Escape all remaining regex special characters in literal segments.
        working = working.replace(/[.*+?^${}()|[\]\\]/g, (c) => `\\${c}`)

        // 4. Restore placeholders to their regex equivalents.
        const pattern = working
            .replace(/\\\*/g, '(.*)')
            .replaceAll(PARAM_TOKEN, '([^/]+)')
            .replaceAll(ESCAPED_COLON, ':')

        return {
            regex: new RegExp(`^${pattern}$`),
            paramKeys,
        }
    }
}