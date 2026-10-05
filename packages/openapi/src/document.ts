import { zodToJsonSchema } from 'zod-to-json-schema'
import type { Route, Router } from '@pearl-framework/http'
import type { FormRequest } from '@pearl-framework/validate'
import { getRouteDescription, type RouteDescription } from './describe.js'

export interface OpenApiInfo {
    title: string
    version: string
    description?: string
}

export interface OpenApiOptions {
    info: OpenApiInfo
    servers?: Array<{ url: string; description?: string }>
    /** Methods to skip. Defaults to HEAD and OPTIONS, which the kernel handles. */
    excludeMethods?: string[]
    /** Paths to skip, matched exactly against the router's path. */
    excludePaths?: string[]
}

type JsonSchema = Record<string, unknown>

interface Operation {
    summary?: string
    description?: string
    tags?: string[]
    deprecated?: boolean
    parameters?: JsonSchema[]
    requestBody?: JsonSchema
    responses: Record<string, JsonSchema>
}

/** Methods that carry a request body. */
const BODY_METHODS = new Set(['POST', 'PUT', 'PATCH'])

/**
 * Build an OpenAPI 3.1 document from a router.
 *
 * Paths, methods and path parameters come from the route table; request schemas
 * come from the `FormRequest` attached by `ValidationPipe`. Nothing is declared
 * twice, so the document cannot drift from the validation that actually runs.
 */
export function generateOpenApiDocument(
    router: Router,
    options: OpenApiOptions,
): JsonSchema {
    const excludeMethods = new Set(
        (options.excludeMethods ?? ['HEAD', 'OPTIONS']).map((m) => m.toUpperCase()),
    )
    const excludePaths = new Set(options.excludePaths ?? [])

    const paths: Record<string, Record<string, Operation>> = {}

    for (const route of router.allRoutes) {
        if (excludeMethods.has(route.method) || excludePaths.has(route.path)) continue

        const description = getRouteDescription(route.method, route.path)
        if (description?.hidden) continue

        const openApiPath = toOpenApiPath(route.path)
        paths[openApiPath] ??= {}
        paths[openApiPath][route.method.toLowerCase()] = buildOperation(route, description)
    }

    return {
        openapi: '3.1.0',
        info: {
            title: options.info.title,
            version: options.info.version,
            ...(options.info.description !== undefined && {
                description: options.info.description,
            }),
        },
        ...(options.servers !== undefined && { servers: options.servers }),
        paths,
    }
}

/** `/users/:id` becomes `/users/{id}`; an escaped colon stays literal. */
export function toOpenApiPath(path: string): string {
    const ESCAPED = '\u0000COLON\u0000'
    return path
        .replace(/\\:/g, ESCAPED)
        .replace(/:([A-Za-z0-9_]+)/g, '{$1}')
        .replace(/\*/g, '{wildcard}')
        .split(ESCAPED)
        .join(':')
}

function buildOperation(route: Route, description?: RouteDescription): Operation {
    const schema = extractSchema(route)
    const operation: Operation = { responses: {} }

    if (description?.summary !== undefined) operation.summary = description.summary
    if (description?.description !== undefined) operation.description = description.description
    if (description?.tags !== undefined) operation.tags = description.tags
    if (description?.deprecated === true) operation.deprecated = true

    const { parameters, body } = splitSchema(route, schema)
    if (parameters.length > 0) operation.parameters = parameters
    if (body !== undefined) operation.requestBody = body

    operation.responses = buildResponses(route, schema !== undefined, description)
    return operation
}

/**
 * Pull the JSON Schema off the FormRequest that `ValidationPipe` tagged onto
 * the route's middleware.
 */
function extractSchema(route: Route): JsonSchema | undefined {
    for (const middleware of route.middleware) {
        const tagged = middleware as { formRequest?: new () => FormRequest }
        if (typeof tagged.formRequest !== 'function') continue

        try {
            const instance = new tagged.formRequest()
            return zodToJsonSchema(instance.schema, { $refStrategy: 'none' }) as JsonSchema
        } catch {
            // A FormRequest whose constructor needs arguments, or a schema the
            // converter cannot represent. Document the route without a schema
            // rather than failing the whole document.
            return undefined
        }
    }
    return undefined
}

/**
 * Split the validated fields into path/query parameters and a request body.
 *
 * `FormRequest.resolveInput` merges body, query and params into one object, so
 * the schema describes all three at once. Path parameters are identified by the
 * route; for methods without a body the rest become query parameters.
 */
function splitSchema(
    route: Route,
    schema: JsonSchema | undefined,
): { parameters: JsonSchema[]; body?: JsonSchema } {
    const properties =
        (schema?.['properties'] as Record<string, JsonSchema> | undefined) ?? {}
    const required = new Set((schema?.['required'] as string[] | undefined) ?? [])
    const parameters: JsonSchema[] = []

    for (const name of route.paramKeys) {
        const property = properties[name]
        parameters.push({
            name,
            in: 'path',
            // A path parameter is part of the URL, so it is always required
            // regardless of how the schema marks it.
            required: true,
            schema: property ?? { type: 'string' },
        })
    }

    const remaining = Object.entries(properties).filter(
        ([name]) => !route.paramKeys.includes(name),
    )

    if (!BODY_METHODS.has(route.method)) {
        for (const [name, property] of remaining) {
            parameters.push({ name, in: 'query', required: required.has(name), schema: property })
        }
        return { parameters }
    }

    if (remaining.length === 0) return { parameters }

    const bodySchema: JsonSchema = {
        type: 'object',
        properties: Object.fromEntries(remaining),
    }
    const bodyRequired = remaining.map(([name]) => name).filter((name) => required.has(name))
    if (bodyRequired.length > 0) bodySchema['required'] = bodyRequired

    return {
        parameters,
        body: {
            required: bodyRequired.length > 0,
            content: { 'application/json': { schema: bodySchema } },
        },
    }
}

function buildResponses(
    route: Route,
    hasSchema: boolean,
    description?: RouteDescription,
): Record<string, JsonSchema> {
    const responses: Record<string, JsonSchema> = {}

    responses[route.method === 'POST' ? '201' : '200'] = { description: 'Successful response' }

    // What the framework actually returns, so it belongs in the document
    // whether or not the author listed it.
    if (hasSchema) {
        responses['422'] = {
            description: 'Validation failed',
            content: {
                'application/json': {
                    schema: {
                        type: 'object',
                        properties: {
                            message: { type: 'string' },
                            errors: {
                                type: 'object',
                                additionalProperties: { type: 'array', items: { type: 'string' } },
                            },
                        },
                    },
                },
            },
        }
    }

    for (const [status, response] of Object.entries(description?.responses ?? {})) {
        responses[status] = {
            description: response.description,
            ...(response.schema !== undefined && {
                content: { 'application/json': { schema: response.schema } },
            }),
        }
    }

    return responses
}
