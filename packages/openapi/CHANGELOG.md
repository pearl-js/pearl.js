# @pearl-framework/openapi

## 2.0.0

### Minor Changes

- [#6](https://github.com/pearl-js/pearl.js/pull/6) [`2d04a59`](https://github.com/pearl-js/pearl.js/commit/2d04a59e2eeb06c3c4a2d578db62a4457f92b067) Thanks [@skd09](https://github.com/skd09)! - Add `@pearl-framework/openapi` — an OpenAPI 3.1 document and Swagger UI derived from the route table.

  `serveOpenApi(router, { info })` registers `GET /openapi.json` and `GET /docs`; `generateOpenApiDocument(router, options)` returns the document for a build step instead. Paths, methods and path parameters come from the router, and request schemas come from the `FormRequest` that `ValidationPipe` attaches to the route — so nothing is declared twice and the document cannot drift from the validation that actually runs.

  Because `FormRequest.resolveInput` merges body, query and route params into one object, the generator splits them back apart: fields named by the route become path parameters (always required, since the route cannot match without them), the rest become a request body on `POST`/`PUT`/`PATCH` and query parameters otherwise. The `422` response the framework returns on a validation failure is documented automatically. `HEAD` and `OPTIONS` are excluded by default.

  `describeRoute(method, path, …)` adds what a schema cannot express — summary, description, tags, extra responses, `deprecated`, and `hidden` to omit a route.

  `ValidationPipe` now returns a `ValidationMiddleware` carrying a `formRequest` property. Existing call sites are unaffected; the tag is what makes schema discovery possible without a second declaration.

  The Swagger UI page loads assets from a CDN rather than vendoring them, so it needs network access to that CDN. The document reflects every route the router holds — use `excludePaths` or `hidden`, and put `/docs` behind auth if the API is not meant to be discoverable.

### Patch Changes

- Updated dependencies [[`2d04a59`](https://github.com/pearl-js/pearl.js/commit/2d04a59e2eeb06c3c4a2d578db62a4457f92b067), [`3aea8fc`](https://github.com/pearl-js/pearl.js/commit/3aea8fc5b9c5e62febf4a84225c65330a9dd7bca), [`acadafd`](https://github.com/pearl-js/pearl.js/commit/acadafd9487d9aac38df099ea02c43739d64b56b)]:
  - @pearl-framework/validate@2.0.0
  - @pearl-framework/http@2.0.0
  - @pearl-framework/core@2.0.0
