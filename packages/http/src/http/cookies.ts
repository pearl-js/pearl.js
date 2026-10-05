import { createHmac, timingSafeEqual } from 'node:crypto'

/** Attributes for an outgoing `Set-Cookie`. */
export interface CookieOptions {
    /** Lifetime in seconds. Omit for a session cookie (cleared when the browser closes). */
    maxAge?: number
    /** Absolute expiry. `maxAge` wins when both are given. */
    expires?: Date
    /** Defaults to `/` so the cookie is sent for every path. */
    path?: string
    domain?: string
    /**
     * Withhold the cookie from `document.cookie`. Defaults to **true** — a
     * session id readable by script is one XSS away from account takeover.
     */
    httpOnly?: boolean
    /**
     * Send only over HTTPS. Defaults to **false** so local http development
     * works; set it to true in any deployed environment.
     */
    secure?: boolean
    /** Defaults to `lax`, which blocks the cross-site POSTs that drive CSRF. */
    sameSite?: 'strict' | 'lax' | 'none'
    /** Sign the value so tampering is detectable. Requires a cookie secret. */
    signed?: boolean
}

const SIGNATURE_SEPARATOR = '.'

/**
 * Parse a `Cookie` request header into a flat map.
 *
 * Duplicate names keep the FIRST occurrence: browsers send the most specific
 * cookie first, and taking the last would let a wildcard-domain cookie planted
 * by a sibling subdomain override the host's own (session fixation).
 */
export function parseCookieHeader(header: string | undefined): Record<string, string> {
    const out: Record<string, string> = {}
    if (!header) return out

    for (const pair of header.split(';')) {
        const eq = pair.indexOf('=')
        if (eq < 1) continue

        const name = pair.slice(0, eq).trim()
        if (!name || Object.prototype.hasOwnProperty.call(out, name)) continue

        let value = pair.slice(eq + 1).trim()
        if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1)

        out[name] = safeDecode(value)
    }
    return out
}

/** Serialize one cookie into a `Set-Cookie` value. */
export function serializeCookie(
    name: string,
    value: string,
    options: CookieOptions = {},
): string {
    if (!COOKIE_NAME.test(name)) {
        throw new Error(`Invalid cookie name: ${JSON.stringify(name)}`)
    }

    const parts = [`${name}=${encodeURIComponent(value)}`]

    parts.push(`Path=${options.path ?? '/'}`)
    if (options.domain !== undefined) parts.push(`Domain=${options.domain}`)

    if (options.maxAge !== undefined) {
        if (!Number.isFinite(options.maxAge)) {
            throw new Error(`Invalid cookie maxAge: ${String(options.maxAge)}`)
        }
        // Max-Age must be an integer; browsers discard a fractional value.
        parts.push(`Max-Age=${Math.floor(options.maxAge)}`)
    } else if (options.expires !== undefined) {
        parts.push(`Expires=${options.expires.toUTCString()}`)
    }

    if (options.httpOnly ?? true) parts.push('HttpOnly')
    if (options.secure) parts.push('Secure')

    const sameSite = options.sameSite ?? 'lax'
    parts.push(`SameSite=${sameSite[0]!.toUpperCase()}${sameSite.slice(1)}`)

    // SameSite=None is ignored by browsers unless the cookie is also Secure,
    // which silently drops the cookie rather than erroring.
    if (sameSite === 'none' && !options.secure) {
        throw new Error('Cookie sameSite "none" requires secure: true, or browsers drop it.')
    }

    return parts.join('; ')
}

/** Append an HMAC-SHA256 signature to a value. */
export function signCookie(value: string, secret: string): string {
    return `${value}${SIGNATURE_SEPARATOR}${hmac(value, secret)}`
}

/**
 * Verify and strip a signature. Returns null when the value was tampered with,
 * unsigned, or signed with a different secret.
 */
export function unsignCookie(signed: string, secret: string): string | null {
    const cut = signed.lastIndexOf(SIGNATURE_SEPARATOR)
    if (cut < 1) return null

    const value = signed.slice(0, cut)
    const provided = signed.slice(cut + 1)
    if (!provided) return null

    return constantTimeEquals(provided, hmac(value, secret)) ? value : null
}

const COOKIE_NAME = /^[\w!#$%&'*+\-.^`|~]+$/

function hmac(value: string, secret: string): string {
    return createHmac('sha256', secret).update(value).digest('base64url')
}

function constantTimeEquals(a: string, b: string): boolean {
    const ab = Buffer.from(a)
    const bb = Buffer.from(b)
    if (ab.length !== bb.length) return false
    return timingSafeEqual(ab, bb)
}

/**
 * A malformed percent-escape makes decodeURIComponent throw. A bad cookie is
 * not worth failing the request over, so fall back to the raw value.
 */
function safeDecode(value: string): string {
    try {
        return decodeURIComponent(value)
    } catch {
        return value
    }
}
