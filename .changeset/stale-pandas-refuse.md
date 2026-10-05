---
'@pearl-framework/auth': minor
'@pearl-framework/http': major
---

**Breaking:** refuse credentialed CORS with a reflected origin. Also fixes authorization policies with async resolvers.

`can()` did not await its `argResolver`, so the ability received a pending promise instead of the resource and every async policy denied. A rejecting resolver also escaped the pipeline as an unhandled rejection rather than reaching the kernel.

`Cors` echoed the caller's `Origin` alongside `Access-Control-Allow-Credentials: true` when no origin was configured, which let any site read authenticated responses.

**This is the breaking change.** `credentials: true` now requires an explicit `origin` and throws at construction when paired with `'*'`, `true`, or an omitted origin. A `new Cors({ credentials: true })` that previously started now fails fast at boot. Migrate by listing your origins:

```ts
// before - reflected any origin, which defeated CORS
new Cors({ credentials: true })

// after
new Cors({ origin: ['https://app.example.com'], credentials: true })
```

A disallowed preflight now answers 403 rather than the configured success status.

`throttle()` now validates the resolved limit the way `RateLimit`'s constructor does. `windowMs: 0` silently disabled the limiter and `NaN` locked the key out for the process lifetime; both now throw naming the limiter. `Limit.key` and `Limit.message` are typed `| undefined` so the documented per-user bucket compiles under `exactOptionalPropertyTypes`.
