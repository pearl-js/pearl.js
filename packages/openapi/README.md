# @pearl-framework/openapi

Generate an OpenAPI 3.1 document from your routes and `FormRequest` schemas.

Part of [Pearl.js](https://github.com/pearl-js/pearl.js). Installed for you by `@pearl-framework/pearl`.

---

## Why this exists

Express and Fastify both leave you maintaining a spec by hand, next to the validation that actually runs. The two drift: a field becomes optional in the Zod schema and the spec keeps saying it is required.

Pearl already knows the method, the path, the path parameters, and — through `ValidationPipe` — the Zod schema that gates the request. This package reads all of that from the router. The document is derived, so it cannot disagree with the validation.

---

## Installation

```bash
npm install @pearl-framework/openapi
```

---

## Getting Started

```typescript
import { Router } from '@pearl-framework/http'
import { serveOpenApi } from '@pearl-framework/openapi'

const router = new Router()

router.post('/users', createUser, [ValidationPipe(CreateUserRequest)])
router.get('/users/:id', showUser)

// Register AFTER your routes
serveOpenApi(router, {
  info: { title: 'My API', version: '1.0.0' },
  servers: [{ url: 'https://api.example.com' }],
})
```

That serves:

- `GET /openapi.json` — the document
- `GET /docs` — Swagger UI

```typescript
serveOpenApi(router, { info, uiPath: false })        // JSON only
serveOpenApi(router, { info, documentPath: '/spec' }) // different path
```

The UI loads Swagger from a CDN rather than vendoring roughly a megabyte of assets into the package, so the page needs network access to that CDN.

---

## What gets derived

Given:

```typescript
class UpdateUserRequest extends FormRequest {
  readonly schema = z.object({
    id:    z.string(),
    name:  z.string().optional(),
    email: z.string().email(),
  })
}

router.put('/users/:id', updateUser, [ValidationPipe(UpdateUserRequest)])
```

you get `PUT /users/{id}` with `id` as a required path parameter, `name` and `email` in the request body (`email` required), a `200`, and the `422` shape the framework actually returns on a validation failure.

`FormRequest.resolveInput` merges body, query, and route params into one object, so a single schema covers all three. The generator splits them back apart:

| Where a field lands | Rule |
|---|---|
| Path parameter | The route declares it (`:id`) |
| Request body | Any remaining field, on `POST`/`PUT`/`PATCH` |
| Query parameter | Any remaining field, on every other method |

A path parameter is always marked required, even if the schema says `.optional()` — the route cannot match without it.

`HEAD` and `OPTIONS` are excluded by default.

---

## Adding what a schema cannot express

Summaries, tags and extra responses are the only things you write by hand:

```typescript
import { describeRoute } from '@pearl-framework/openapi'

describeRoute('POST', '/users', {
  summary: 'Create a user',
  tags: ['Users'],
  responses: {
    '409': { description: 'Email already taken', schema: { type: 'object' } },
  },
})

describeRoute('GET', '/legacy/report', { deprecated: true })
describeRoute('POST', '/internal/reindex', { hidden: true })   // omitted entirely
```

Use the router's path (`/users/:id`), not the OpenAPI form.

---

## Building the document yourself

```typescript
import { generateOpenApiDocument } from '@pearl-framework/openapi'

const document = generateOpenApiDocument(router, {
  info: { title: 'My API', version: '1.0.0' },
  excludePaths: ['/internal/metrics'],
})

await writeFile('openapi.json', JSON.stringify(document, null, 2))
```

Useful in a build step feeding a client generator or an API gateway, with no UI served at runtime.

---

## A note on exposure

The document reflects whatever the router holds, including routes you may not want advertised. Use `excludePaths`, or `describeRoute(..., { hidden: true })`, and put `/docs` behind auth if the API is not meant to be publicly discoverable.

---

## Related

- [`@pearl-framework/validate`](../validate#readme) — `FormRequest` and `ValidationPipe`, the source of the schemas
- [`@pearl-framework/http`](../http#readme) — the router the document is built from
