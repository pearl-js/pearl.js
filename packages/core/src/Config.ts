import { readFileSync, existsSync, mkdirSync } from 'node:fs'
import { resolve, join } from 'node:path'

type ConfigValue = string | number | boolean | null | ConfigValue[] | { [key: string]: ConfigValue }
type ConfigStore = Record<string, ConfigValue>

/**
 * Reads and caches config files from the app's config/ directory.
 * Config values are accessed via dot notation: config.get('database.connections.default')
 */
export class Config {
  private readonly store: ConfigStore = {}
  private loaded = false

  constructor(private readonly configPath: string) {}

  /**
   * Load all config files from the config directory.
   * Called once during application boot.
   * Creates the config directory if it doesn't exist.
   */
  async load(): Promise<void> {
    if (this.loaded) return

    // Auto-create config directory if missing — no need to manually mkdir
    if (!existsSync(this.configPath)) {
      mkdirSync(this.configPath, { recursive: true })
    }

    const { readdirSync } = await import('node:fs')
    const files = readdirSync(this.configPath).filter((f) => f.endsWith('.js') || f.endsWith('.ts'))

    for (const file of files) {
      const name = file.replace(/\.(js|ts)$/, '')
      const filePath = resolve(join(this.configPath, file))
      const module = await import(filePath) as { default: ConfigStore }
      this.store[name] = module.default
    }

    this.loaded = true
  }

  /**
   * Get a config value using dot notation.
   * @example config.get('database.connections.default') // 'postgres'
   * @example config.get('app.name', 'Pearl App')
   */
  get<T extends ConfigValue>(key: string, fallback?: T): T {
    const parts = key.split('.')
    let current: ConfigValue = this.store

    for (const part of parts) {
      if (current === null || typeof current !== 'object' || Array.isArray(current)) {
        return (fallback as T) ?? (() => { throw new Error(`Config key not found: "${key}"`) })()
      }
      current = (current as Record<string, ConfigValue>)[part] ?? null
    }

    if (current === null && fallback !== undefined) return fallback
    if (current === null) throw new Error(`Config key not found: "${key}"`)

    return current as T
  }

  /**
   * Check if a config key exists.
   */
  has(key: string): boolean {
    try {
      this.get(key)
      return true
    } catch {
      return false
    }
  }
}

// -------------------------------------------------------------------------
// env() helper — typed environment variable access
// -------------------------------------------------------------------------

type EnvOptions<T> = {
  default?: T
  required?: boolean
}

function env(key: string): string
function env(key: string, fallback: string): string
function env<T extends string | number | boolean>(key: string, fallback: T): T
function env(key: string, fallback?: unknown): unknown {
  const value = process.env[key]

  if (value === undefined) {
    if (fallback !== undefined) return fallback
    throw new Error(
      `Environment variable "${key}" is not set. ` +
      `Add it to your .env file or provide a default.`
    )
  }

  return value
}

env.bool = (key: string, fallback?: boolean): boolean => {
  const value = process.env[key]
  if (value === undefined) {
    if (fallback !== undefined) return fallback
    throw new Error(`Environment variable "${key}" is not set.`)
  }
  return value === 'true' || value === '1'
}

env.number = (key: string, fallback?: number): number => {
  const value = process.env[key]
  if (value === undefined) {
    if (fallback !== undefined) return fallback
    throw new Error(`Environment variable "${key}" is not set.`)
  }
  const parsed = Number(value)
  if (Number.isNaN(parsed)) {
    throw new Error(`Environment variable "${key}" must be a number, got: "${value}"`)
  }
  return parsed
}

env.optional = (key: string): string | undefined => process.env[key]

export { env }

/**
 * Loads .env file into process.env (Pearl's built-in dotenv).
 * Called at the very start of the boot sequence.
 *
 * Supports:
 *   - Comments (`#`) at start of line or trailing (only for unquoted values).
 *   - Double-quoted values with `\n`, `\r`, `\t`, `\\`, `\"` escapes.
 *   - Single-quoted values (literal, no escape processing).
 *   - Multi-line values inside matching quotes.
 *   - `export KEY=value` prefix (ignored).
 *   - Equals signs inside values (only the first `=` is the separator).
 */
export function loadDotenv(appRoot: string): void {
  const envPath = join(appRoot, '.env')
  if (!existsSync(envPath)) return

  const parsed = parseDotenv(readFileSync(envPath, 'utf-8'))
  for (const [key, value] of Object.entries(parsed)) {
    // Never overwrite existing env vars (real env takes precedence)
    process.env[key] ??= value
  }
}

/**
 * Parse `.env` file contents into a plain object. Exported so tests and
 * tooling can reuse the parser without touching `process.env`.
 */
export function parseDotenv(source: string): Record<string, string> {
  const result: Record<string, string> = {}
  const lines = source.split(/\r?\n/)

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i] ?? ''
    const trimmedStart = line.replace(/^\s+/, '')

    if (trimmedStart === '' || trimmedStart.startsWith('#')) continue

    line = trimmedStart.replace(/^export\s+/, '')

    const eqIndex = line.indexOf('=')
    if (eqIndex === -1) continue

    const key = line.slice(0, eqIndex).trim()
    if (!isValidEnvKey(key)) continue

    let rest = line.slice(eqIndex + 1)
    // Leading whitespace before the value is ignored
    rest = rest.replace(/^\s+/, '')

    const first = rest[0]
    if (first === '"' || first === "'") {
      const { value, nextLine } = readQuoted(lines, i, rest, first)
      result[key] = value
      i = nextLine
    } else {
      // Unquoted: strip trailing comment + whitespace
      const hashIndex = rest.indexOf(' #')
      const raw = (hashIndex === -1 ? rest : rest.slice(0, hashIndex)).trim()
      result[key] = raw
    }
  }

  return result
}

function isValidEnvKey(key: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(key)
}

function readQuoted(
  lines: string[],
  startLine: number,
  firstSegment: string,
  quote: string,
): { value: string; nextLine: number } {
  // Walk the remainder of `firstSegment` (which starts with the opening quote)
  // and subsequent lines until we find the matching unescaped closing quote.
  const supportsEscapes = quote === '"'
  let buf = ''
  let line = startLine
  let segment = firstSegment.slice(1) // drop opening quote

  while (true) {
    let i = 0
    while (i < segment.length) {
      const ch = segment[i]
      if (supportsEscapes && ch === '\\' && i + 1 < segment.length) {
        const next = segment[i + 1]
        if (next === 'n') buf += '\n'
        else if (next === 'r') buf += '\r'
        else if (next === 't') buf += '\t'
        else if (next === '\\') buf += '\\'
        else if (next === '"') buf += '"'
        else buf += next ?? ''
        i += 2
        continue
      }
      if (ch === quote) {
        return { value: buf, nextLine: line }
      }
      buf += ch
      i++
    }

    // No closing quote on this line — continue to the next line
    line++
    if (line >= lines.length) {
      // Unterminated quote: return what we have (lenient, matches dotenv)
      return { value: buf, nextLine: line - 1 }
    }
    buf += '\n'
    segment = lines[line] ?? ''
  }
}