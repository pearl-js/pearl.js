import type { HttpMethod } from '@pearl-framework/http'

/** Prose and response metadata a schema cannot express. */
export interface RouteDescription {
    summary?: string
    description?: string
    tags?: string[]
    /** Mark the operation deprecated in the generated document. */
    deprecated?: boolean
    /** Extra or overriding responses, keyed by status code. */
    responses?: Record<string, { description: string; schema?: unknown }>
    /** Omit this route from the document entirely. */
    hidden?: boolean
}

const descriptions = new Map<string, RouteDescription>()

const key = (method: string, path: string): string => `${method.toUpperCase()} ${path}`

/**
 * Attach documentation to a route. Everything derivable - path, method, params,
 * request schema - comes from the router, so this is only for what it cannot
 * know.
 *
 *   describeRoute('POST', '/users', {
 *     summary: 'Create a user',
 *     tags: ['Users'],
 *     responses: { '201': { description: 'Created' } },
 *   })
 */
export function describeRoute(
    method: HttpMethod,
    path: string,
    description: RouteDescription,
): void {
    descriptions.set(key(method, path), description)
}

export function getRouteDescription(
    method: string,
    path: string,
): RouteDescription | undefined {
    return descriptions.get(key(method, path))
}

/** Drop every registered description. Intended for tests. */
export function clearRouteDescriptions(): void {
    descriptions.clear()
}
