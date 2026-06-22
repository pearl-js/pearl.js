import type { IncomingMessage } from 'node:http'

export interface ParsedBody {
    [key: string]: unknown
}

export class Request {
    private _body: ParsedBody = {}
    private _params: Record<string, string> = {}
    private _query: Record<string, string> = {}
    private _path: string
    private _query_string: string

    constructor(private readonly raw: IncomingMessage) {
        const rawUrl = raw.url ?? '/'
        const qIndex = rawUrl.indexOf('?')
        this._path = qIndex === -1 ? rawUrl : rawUrl.slice(0, qIndex)
        this._query_string = qIndex === -1 ? '' : rawUrl.slice(qIndex + 1)

        // Parse query string
        new URLSearchParams(this._query_string).forEach((value, key) => {
        this._query[key] = value
        })
    }

    // ─── HTTP metadata ──────────────────────────────────────────────────────

    get method(): string {
        return this.raw.method?.toUpperCase() ?? 'GET'
    }

    get path(): string {
        return this._path
    }

    get url(): string {
        return this.raw.url ?? '/'
    }

    get headers(): Record<string, string | string[] | undefined> {
        return this.raw.headers as Record<string, string | string[] | undefined>
    }

    header(name: string): string | undefined {
        const value = this.raw.headers[name.toLowerCase()]
        return Array.isArray(value) ? value[0] : value
    }

    // ─── Route params ────────────────────────────────────────────────────────

    get params(): Record<string, string> {
        return this._params
    }

    setParams(params: Record<string, string>): void {
        this._params = params
    }

    param(key: string): string | undefined {
        return this._params[key]
    }

    // ─── Query string ────────────────────────────────────────────────────────

    get query(): Record<string, string> {
        return this._query
    }

    // ─── Body ────────────────────────────────────────────────────────────────

    get body(): ParsedBody {
        return this._body
    }

    setBody(body: ParsedBody): void {
        this._body = body
    }

    input<T = unknown>(key: string, fallback?: T): T {
        const value = this._body[key] ?? this._query[key]
        return (value as T) ?? (fallback as T)
    }

    // ─── Content negotiation ─────────────────────────────────────────────────

    get contentType(): string {
        return this.header('content-type') ?? ''
    }

    isJson(): boolean {
        return this.contentType.includes('application/json')
    }

    wantsJson(): boolean {
        return (this.header('accept') ?? '').includes('application/json')
    }

    // ─── Raw node request ────────────────────────────────────────────────────

    get nodeRequest(): IncomingMessage {
        return this.raw
    }

    // ─── Static factory ──────────────────────────────────────────────────────

    static async fromIncoming(
        raw: IncomingMessage,
        options: { maxBodyBytes?: number } = {},
    ): Promise<Request> {
        const req = new Request(raw)
        await req.parseBody(options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES)
        return req
    }

    private async parseBody(maxBytes: number): Promise<void> {
        if (this.method === 'GET' || this.method === 'HEAD') return

        // Honour Content-Length when the client declares an honest size — cheaper
        // than reading any bytes off the wire when we already know it's too big.
        const declared = Number(this.header('content-length'))
        if (Number.isFinite(declared) && declared > maxBytes) {
            throw payloadTooLarge(maxBytes)
        }

        return new Promise((resolve, reject) => {
        const chunks: Buffer[] = []
        let received = 0

        const cleanup = () => {
            this.raw.removeListener('data',  onData)
            this.raw.removeListener('error', onError)
            this.raw.removeListener('end',   onEnd)
        }

        const fail = (err: Error) => { cleanup(); this.raw.resume(); reject(err) }

        const onData  = (chunk: Buffer) => {
            received += chunk.length
            if (received > maxBytes) {
                // Drop the socket — we can't trust the client to stop sending.
                this.raw.destroy()
                return fail(payloadTooLarge(maxBytes))
            }
            chunks.push(chunk)
        }
        const onError = (err: Error)    => fail(err)
        const onEnd   = () => {
            cleanup()
            const raw = Buffer.concat(chunks).toString('utf-8')
            if (!raw) return resolve()

            if (this.isJson()) {
            try { this._body = JSON.parse(raw) as ParsedBody } catch {
                const err = new Error('Invalid JSON body') as Error & { statusCode: number }
                err.statusCode = 400
                return reject(err)
            }
            } else if (this.contentType.includes('application/x-www-form-urlencoded')) {
            new URLSearchParams(raw).forEach((value, key) => { this._body[key] = value })
            }

            resolve()
        }

        this.raw.on('data',  onData)
        this.raw.on('error', onError)
        this.raw.on('end',   onEnd)
        })
    }
}

/**
 * Default request body cap. Without a limit, a single attacker can exhaust
 * server memory with a streamed multi-GB body. Mirrors Fastify's default
 * (Express's 100KB is friendlier but trips JSON-heavy APIs).
 */
const DEFAULT_MAX_BODY_BYTES = 1_048_576 // 1 MiB

function payloadTooLarge(limit: number): Error & { statusCode: number } {
    const err = new Error(
        `Request body exceeds the configured limit of ${limit} bytes.`,
    ) as Error & { statusCode: number }
    err.statusCode = 413
    return err
}