import { PearlError } from '@pearl-framework/core'

export class AuthorizationException extends PearlError {
    readonly code = 'AUTHORIZATION_FAILED'

    constructor(message = 'This action is unauthorized.') {
        super(message)
    }

    toJSON(): { message: string; code: string } {
        return { message: this.message, code: this.code }
    }
}
