---
'@pearl-framework/auth': minor
'@pearl-framework/http': minor
---

Add a cookie layer and a session middleware that makes `SessionGuard` usable end to end.

`Request` gains `cookies`, `cookie(name)`, and `signedCookie(name)`; `Response` gains `cookie()`, `clearCookie()`, and `appendHeader()`. Outgoing cookies default to `HttpOnly`, `SameSite=Lax`, `Path=/`, and each is emitted as its own `Set-Cookie` header. Signed cookies use HMAC-SHA256 with a timing-safe compare and read back as `undefined` when forged, so a tampered value is indistinguishable from a missing one. Set `cookieSecret` on `HttpKernel` to enable them.

`session()`, `startSession()`, `endSession()`, and `rotateSessionCookie()` wire `SessionGuard` to that cookie layer: the middleware resolves a signed session cookie into `auth.user`, clears a stale or forged id, and re-issues the cookie when `rotateOnUse` rotates it. Previously `SessionGuard` was exported but unusable without hand-rolling `Set-Cookie` parsing, and a rotated id had no way to reach the browser.

`Response.appendHeader()` accumulates comma-joined headers instead of overwriting, which `header()` does — relevant for `Vary`, where a clobbered value can make a CDN serve one origin's response to another.
