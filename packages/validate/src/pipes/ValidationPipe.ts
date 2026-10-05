import type { HttpContext, NextFn } from '@pearl-framework/http'
import type { FormRequest } from '../FormRequest.js'
import { ValidationException } from '../ValidationException.js'

type FormRequestConstructor<T extends FormRequest> = new () => T

/**
 * The middleware ValidationPipe returns, tagged with the FormRequest it
 * validates against. `@pearl-framework/openapi` reads this to derive request
 * schemas from the routes themselves, so documenting an endpoint needs no
 * second declaration that can drift from the validation.
 */
export interface ValidationMiddleware {
    (ctx: HttpContext, next: NextFn): Promise<void>
    readonly formRequest: new () => FormRequest
}

/**
 * ValidationPipe is a middleware factory that validates the request
 * using a FormRequest class before passing to the controller.
 *
 * Usage in route definition:
 *   router.post('/posts', createPost, [ValidationPipe(CreatePostRequest)])
 *
 * Usage in controller decorator:
 *   @Post('/posts', [ValidationPipe(CreatePostRequest)])
 *   async store(ctx: HttpContext) { ... }
 */
export function ValidationPipe<T extends FormRequest>(
  RequestClass: FormRequestConstructor<T>,
): ValidationMiddleware {
    const middleware = async (ctx: HttpContext, next: NextFn): Promise<void> => {
        try {
            const instance = new RequestClass()
            const validated = await instance.validate(ctx)

            // Attach validated data to context for controller to read
            ctx.set('validated', validated)

            await next()
        } catch (error) {
            if (error instanceof ValidationException) {
                // Response already sent by FormRequest.validate()
                return
            }
            throw error
        }
    }

    return Object.defineProperty(middleware, 'formRequest', {
        value: RequestClass,
        enumerable: true,
    }) as ValidationMiddleware
}