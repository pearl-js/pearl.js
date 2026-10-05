import type { ServerResponse } from 'node:http'
import { serializeCookie, signCookie, type CookieOptions } from './cookies.js'

export class Response {
    private _statusCode = 200
    private _headers: Record<string, string> = {
        'content-type': 'application/json',
    }
    private _sent = false
    private readonly _cookies: string[] = []
    private readonly _cookieSecret?: string

    constructor(
        private readonly raw: ServerResponse,
        options: { cookieSecret?: string } = {},
    ) {
        if (options.cookieSecret !== undefined) this._cookieSecret = options.cookieSecret
    }

    // ─── Status ──────────────────────────────────────────────────────────────

    status(code: number): this {
        this._statusCode = code
        return this
    }

    // ─── Headers ─────────────────────────────────────────────────────────────

    header(key: string, value: string): this {
        this._headers[key.toLowerCase()] = value
        return this
    }

    /**
     * Add to a comma-joined header instead of replacing it. Use this for
     * headers that accumulate (`Vary`, `Link`); `header()` overwrites, which
     * silently drops an earlier middleware's value.
     */
    appendHeader(key: string, value: string): this {
        const k = key.toLowerCase()
        const existing = this._headers[k]
        if (existing === undefined || existing === '') {
            this._headers[k] = value
            return this
        }
        const present = existing.split(',').map((p) => p.trim().toLowerCase())
        if (!present.includes(value.trim().toLowerCase())) {
            this._headers[k] = `${existing}, ${value}`
        }
        return this
    }

    withHeaders(headers: Record<string, string>): this {
        for (const [key, value] of Object.entries(headers)) {
        this._headers[key.toLowerCase()] = value
        }
        return this
    }

    // ─── Cookies ─────────────────────────────────────────────────────────────

    /**
     * Queue a `Set-Cookie`. Defaults are `HttpOnly`, `SameSite=Lax`, `Path=/`;
     * pass `secure: true` in any deployed environment.
     *
     * Multiple cookies accumulate — each gets its own `Set-Cookie` header, as
     * the spec requires (comma-joining them breaks on `Expires`).
     */
    cookie(name: string, value: string, options: CookieOptions = {}): this {
        let outgoing = value
        if (options.signed) {
            if (this._cookieSecret === undefined) {
                throw new Error(
                    'Response.cookie() with signed: true needs a cookie secret. ' +
                    'Pass cookieSecret to HttpKernel.',
                )
            }
            outgoing = signCookie(value, this._cookieSecret)
        }
        this._cookies.push(serializeCookie(name, outgoing, options))
        return this
    }

    /**
     * Expire a cookie. `path` and `domain` must match the values it was set
     * with, or the browser keeps the original.
     */
    clearCookie(name: string, options: Omit<CookieOptions, 'maxAge' | 'expires'> = {}): this {
        this._cookies.push(serializeCookie(name, '', { ...options, maxAge: 0 }))
        return this
    }

    // ─── Sending ─────────────────────────────────────────────────────────────

    json(data: unknown, status?: number): void {
        if (status !== undefined) this._statusCode = status
        this.header('content-type', 'application/json')
        this.send(JSON.stringify(data))
    }

    text(data: string, status?: number): void {
        if (status !== undefined) this._statusCode = status
        this.header('content-type', 'text/plain; charset=utf-8')
        this.send(data)
    }

    html(data: string, status?: number): void {
        if (status !== undefined) this._statusCode = status
        this.header('content-type', 'text/html; charset=utf-8')
        this.send(data)
    }

    send(body: string | Buffer = ''): void {
        if (this._sent) throw new Error('Response already sent.')
        this._sent = true

        const headers: Record<string, string | string[]> = { ...this._headers }
        if (this._cookies.length > 0) headers['set-cookie'] = this._cookies

        this.raw.writeHead(this._statusCode, headers)
        this.raw.end(body)
    }

    // ─── Redirects ───────────────────────────────────────────────────────────

    redirect(url: string, status = 302): void {
        this.header('location', url)
        this.status(status).send()
    }

    // ─── Common response helpers ─────────────────────────────────────────────

    ok(data: unknown): void {
        this.json(data, 200)
    }

    created(data: unknown): void {
        this.json(data, 201)
    }

    noContent(): void {
        this.status(204).send()
    }

    notFound(message = 'Not Found'): void {
        this.json({ message }, 404)
    }

    unauthorized(message = 'Unauthorized'): void {
        this.json({ message }, 401)
    }

    forbidden(message = 'Forbidden'): void {
        this.json({ message }, 403)
    }

    unprocessable(errors: Record<string, string[]>): void {
        this.json({ message: 'Unprocessable Entity', errors }, 422)
    }

    serverError(message = 'Internal Server Error'): void {
        this.json({ message }, 500)
    }

    // ─── State ───────────────────────────────────────────────────────────────

    get sent(): boolean {
        return this._sent
    }

    get nodeResponse(): ServerResponse {
        return this.raw
    }
}