import { describe, it, expect, beforeEach } from 'vitest'
import { Router } from '@pearl-framework/http'
import { FormRequest, ValidationPipe, z } from '@pearl-framework/validate'
import { generateOpenApiDocument, toOpenApiPath } from './document.js'
import { describeRoute, clearRouteDescriptions } from './describe.js'

class CreateUserRequest extends FormRequest {
    readonly schema = z.object({
        email: z.string().email(),
        name: z.string().min(1),
        age: z.number().int().optional(),
    })
}

class UpdateUserRequest extends FormRequest {
    readonly schema = z.object({
        id: z.string(),
        name: z.string().optional(),
    })
}

class ListUsersRequest extends FormRequest {
    readonly schema = z.object({
        page: z.string().optional(),
        search: z.string(),
    })
}

const noop = async (): Promise<void> => {}
const info = { title: 'Test API', version: '2.0.0' }
const doc = (router: Router, extra = {}) =>
    generateOpenApiDocument(router, { info, ...extra }) as any

beforeEach(() => { clearRouteDescriptions() })

describe('toOpenApiPath', () => {
    it('converts route params to OpenAPI braces', () => {
        expect(toOpenApiPath('/users/:id')).toBe('/users/{id}')
        expect(toOpenApiPath('/orgs/:org/users/:id')).toBe('/orgs/{org}/users/{id}')
    })

    it('leaves static paths alone', () => {
        expect(toOpenApiPath('/health')).toBe('/health')
    })

    it('names a wildcard', () => {
        expect(toOpenApiPath('/files/*')).toBe('/files/{wildcard}')
    })

    // The router treats an escaped colon as a literal, so the document must too.
    it('keeps an escaped colon literal', () => {
        expect(toOpenApiPath('/rpc/method\\:call')).toBe('/rpc/method:call')
    })
})

describe('generateOpenApiDocument', () => {
    it('emits a 3.1 document with the given info', () => {
        const d = doc(new Router())
        expect(d.openapi).toBe('3.1.0')
        expect(d.info).toEqual({ title: 'Test API', version: '2.0.0' })
        expect(d.paths).toEqual({})
    })

    it('includes servers when provided', () => {
        const d = doc(new Router(), { servers: [{ url: 'https://api.test' }] })
        expect(d.servers).toEqual([{ url: 'https://api.test' }])
    })

    it('maps routes to paths and methods', () => {
        const router = new Router()
        router.get('/users', noop)
        router.post('/users', noop)
        router.get('/users/:id', noop)

        const d = doc(router)
        expect(Object.keys(d.paths).sort()).toEqual(['/users', '/users/{id}'])
        expect(Object.keys(d.paths['/users']).sort()).toEqual(['get', 'post'])
    })

    it('skips HEAD and OPTIONS by default', () => {
        const router = new Router()
        router.get('/a', noop)
        router.options('/a', noop)
        expect(Object.keys(d2(router)['/a'])).toEqual(['get'])
    })

    it('honours excludePaths', () => {
        const router = new Router()
        router.get('/public', noop)
        router.get('/internal', noop)
        expect(Object.keys(doc(router, { excludePaths: ['/internal'] }).paths)).toEqual(['/public'])
    })

    describe('path parameters', () => {
        it('derives them from the route even with no schema', () => {
            const router = new Router()
            router.get('/users/:id', noop)

            const params = doc(router).paths['/users/{id}'].get.parameters
            expect(params).toEqual([
                { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
            ])
        })

        // A path parameter is part of the URL; optional in the schema is
        // irrelevant to whether the route can match without it.
        it('marks them required even when the schema says optional', () => {
            const router = new Router()
            router.put('/users/:id', noop, [ValidationPipe(UpdateUserRequest)])

            const op = doc(router).paths['/users/{id}'].put
            const idParam = op.parameters.find((p: any) => p.name === 'id')
            expect(idParam.required).toBe(true)
            expect(idParam.in).toBe('path')
        })

        it('keeps path params out of the request body', () => {
            const router = new Router()
            router.put('/users/:id', noop, [ValidationPipe(UpdateUserRequest)])

            const body = doc(router).paths['/users/{id}'].put.requestBody
            expect(Object.keys(body.content['application/json'].schema.properties)).toEqual(['name'])
        })
    })

    describe('request schemas', () => {
        it('derives a body from the FormRequest on a POST', () => {
            const router = new Router()
            router.post('/users', noop, [ValidationPipe(CreateUserRequest)])

            const schema = doc(router).paths['/users'].post
                .requestBody.content['application/json'].schema
            expect(Object.keys(schema.properties).sort()).toEqual(['age', 'email', 'name'])
            expect(schema.required.sort()).toEqual(['email', 'name'])
            expect(schema.properties.email.format).toBe('email')
            expect(schema.properties.age.type).toBe('integer')
        })

        // Fields map to query parameters for methods that carry no body.
        it('derives query parameters on a GET', () => {
            const router = new Router()
            router.get('/users', noop, [ValidationPipe(ListUsersRequest)])

            const op = doc(router).paths['/users'].get
            expect(op.requestBody).toBeUndefined()
            const byName = Object.fromEntries(op.parameters.map((p: any) => [p.name, p]))
            expect(byName['search'].in).toBe('query')
            expect(byName['search'].required).toBe(true)
            expect(byName['page'].required).toBe(false)
        })

        it('omits requestBody when there is no schema', () => {
            const router = new Router()
            router.post('/ping', noop)
            expect(doc(router).paths['/ping'].post.requestBody).toBeUndefined()
        })

        it('documents the 422 the framework actually returns', () => {
            const router = new Router()
            router.post('/users', noop, [ValidationPipe(CreateUserRequest)])
            const responses = doc(router).paths['/users'].post.responses
            expect(responses['422']).toBeDefined()
            expect(responses['201']).toBeDefined()
        })

        it('omits 422 for a route with no validation', () => {
            const router = new Router()
            router.get('/health', noop)
            expect(doc(router).paths['/health'].get.responses['422']).toBeUndefined()
        })

        it('ignores middleware that is not a ValidationPipe', () => {
            const router = new Router()
            router.post('/users', noop, [async (_c, n) => { await n() }])
            expect(doc(router).paths['/users'].post.requestBody).toBeUndefined()
        })
    })

    describe('describeRoute', () => {
        it('adds prose and tags', () => {
            const router = new Router()
            router.post('/users', noop)
            describeRoute('POST', '/users', {
                summary: 'Create a user',
                description: 'Creates and returns a user.',
                tags: ['Users'],
            })

            const op = doc(router).paths['/users'].post
            expect(op.summary).toBe('Create a user')
            expect(op.description).toBe('Creates and returns a user.')
            expect(op.tags).toEqual(['Users'])
        })

        it('adds responses with schemas', () => {
            const router = new Router()
            router.get('/users/:id', noop)
            describeRoute('GET', '/users/:id', {
                responses: { '404': { description: 'No such user', schema: { type: 'object' } } },
            })

            const responses = doc(router).paths['/users/{id}'].get.responses
            expect(responses['404'].description).toBe('No such user')
            expect(responses['404'].content['application/json'].schema).toEqual({ type: 'object' })
        })

        it('marks a route deprecated', () => {
            const router = new Router()
            router.get('/old', noop)
            describeRoute('GET', '/old', { deprecated: true })
            expect(doc(router).paths['/old'].get.deprecated).toBe(true)
        })

        it('hides a route entirely', () => {
            const router = new Router()
            router.get('/public', noop)
            router.get('/secret', noop)
            describeRoute('GET', '/secret', { hidden: true })
            expect(Object.keys(doc(router).paths)).toEqual(['/public'])
        })
    })

    it('produces JSON-serializable output', () => {
        const router = new Router()
        router.post('/users', noop, [ValidationPipe(CreateUserRequest)])
        expect(() => JSON.stringify(doc(router))).not.toThrow()
    })
})

function d2(router: Router) {
    return doc(router).paths
}
