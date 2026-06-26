// Contracts
export type { AuthUser, UserProvider, AuthGuard } from './contracts/index.js'

// Core
export { AuthManager } from './AuthManager.js'
export { Hash } from './Hash.js'

// Guards
export { JwtGuard } from './guards/JwtGuard.js'
export type { JwtConfig, JwtPayload } from './guards/JwtGuard.js'
export { ApiTokenGuard } from './guards/ApiTokenGuard.js'
export type { TokenRecord, TokenStore } from './guards/ApiTokenGuard.js'
export { SessionGuard } from './guards/SessionGuard.js'
export type { SessionRecord, SessionStore, SessionConfig } from './guards/SessionGuard.js'

// Middleware
export { Authenticate, OptionalAuth } from './middleware/Authenticate.js'
export type { AuthMiddlewareOptions } from './middleware/Authenticate.js'

// Authorization
export { Gate, AccessDeniedError } from './Gate.js'
export type { Ability } from './Gate.js'
export { can } from './middleware/Can.js'

// Service Provider
export { AuthServiceProvider } from './providers/AuthServiceProvider.js'
export type { AuthServiceConfig } from './providers/AuthServiceProvider.js'