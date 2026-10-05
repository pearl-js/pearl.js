import { ServiceProvider } from '@pearl-framework/core'
import { Cache } from '../Cache.js'
import { MemoryStore } from '../stores/MemoryStore.js'
import type { CacheStore } from '../contracts.js'

export interface CacheServiceConfig {
    /** Store instance. Defaults to a process-local `MemoryStore`. */
    store?: CacheStore
    /** Default TTL in seconds for `put`/`remember` calls that omit one. */
    ttlSeconds?: number
}

/**
 * Binds `Cache` into the container.
 *
 *   export class AppCacheServiceProvider extends CacheServiceProvider {
 *     protected config: CacheServiceConfig = {
 *       store: new RedisStore(new Redis(process.env.REDIS_URL!)),
 *       ttlSeconds: 300,
 *     }
 *   }
 */
export class CacheServiceProvider extends ServiceProvider {
    protected config: CacheServiceConfig = {}

    register(): void {
        this.container.singleton(
            Cache,
            () => new Cache(
                this.config.store ?? new MemoryStore(),
                this.config.ttlSeconds === undefined ? {} : { ttlSeconds: this.config.ttlSeconds },
            ),
        )
    }
}
