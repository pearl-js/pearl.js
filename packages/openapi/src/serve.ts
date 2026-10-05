import type { HttpContext, Router } from '@pearl-framework/http'
import { generateOpenApiDocument, type OpenApiOptions } from './document.js'

export interface ServeOpenApiOptions extends OpenApiOptions {
    /** Where the JSON document is served. Default `/openapi.json`. */
    documentPath?: string
    /**
     * Where the browsable UI is served. Default `/docs`. Pass `false` to serve
     * only the JSON — appropriate when the spec feeds a gateway or a client
     * generator rather than humans.
     */
    uiPath?: string | false
}

/**
 * Register the OpenAPI document (and optionally a Swagger UI page) on a router.
 *
 *   serveOpenApi(router, { info: { title: 'My API', version: '1.0.0' } })
 *
 * Call it after your routes are registered: the document is built from the
 * route table, and routes added afterwards are generated on the next request
 * since the document is rebuilt per request.
 *
 * The document reflects whatever the router holds, including routes you may not
 * want public. Use `excludePaths`, or `describeRoute(..., { hidden: true })`,
 * and put this behind auth in production if the API is not meant to be
 * discoverable.
 */
export function serveOpenApi(router: Router, options: ServeOpenApiOptions): Router {
    const documentPath = options.documentPath ?? '/openapi.json'
    const uiPath = options.uiPath === undefined ? '/docs' : options.uiPath

    // The document path itself is never interesting in the document.
    const excludePaths = [...(options.excludePaths ?? []), documentPath]
    if (uiPath !== false) excludePaths.push(uiPath)

    router.get(documentPath, async (ctx: HttpContext) => {
        ctx.response.json(generateOpenApiDocument(router, { ...options, excludePaths }))
    })

    if (uiPath !== false) {
        router.get(uiPath, async (ctx: HttpContext) => {
            ctx.response.html(swaggerUiHtml(options.info.title, documentPath))
        })
    }

    return router
}

/**
 * Swagger UI loaded from a CDN. Keeping it out of the package avoids shipping
 * roughly a megabyte of vendored assets for a page most deployments never
 * expose; the trade-off is that the UI needs network access to that CDN.
 */
function swaggerUiHtml(title: string, documentPath: string): string {
    const safeTitle = escapeHtml(title)
    const safePath = JSON.stringify(documentPath)

    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${safeTitle} - API reference</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui.css">
</head>
<body>
<div id="swagger-ui"></div>
<script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-bundle.js" crossorigin></script>
<script>
window.ui = SwaggerUIBundle({ url: ${safePath}, dom_id: '#swagger-ui', deepLinking: true })
</script>
</body>
</html>
`
}

function escapeHtml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
}
