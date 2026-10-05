import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import chalk from 'chalk'

/** Where the app's providers are registered and booted, in preference order. */
const BOOTSTRAP_CANDIDATES = ['src/bootstrap.ts', 'src/bootstrap.js']

/**
 * Locate the app's bootstrap module. Commands that need a booted container
 * (migrate, db:seed, queue:work) go through it so provider registration lives
 * in one place instead of being duplicated per command.
 */
export function findBootstrap(cwd = process.cwd()): string | null {
    for (const candidate of BOOTSTRAP_CANDIDATES) {
        const full = path.resolve(cwd, candidate)
        if (existsSync(full)) return full
    }
    return null
}

export function requireBootstrap(cwd = process.cwd()): string {
    const found = findBootstrap(cwd)
    if (found) return found

    console.error(
        `\n${chalk.red('✘')} Could not find ${chalk.cyan('src/bootstrap.ts')}.\n\n` +
        `  This command boots your app to read its configuration. Create\n` +
        `  ${chalk.cyan('src/bootstrap.ts')} exporting a ${chalk.cyan('bootstrap()')} that returns a booted\n` +
        `  Application, then have your entrypoint call it:\n\n` +
        `  ${chalk.dim('export async function bootstrap() {')}\n` +
        `  ${chalk.dim('  const app = new Application({ root: import.meta.dirname })')}\n` +
        `  ${chalk.dim('  app.register(DatabaseServiceProvider)')}\n` +
        `  ${chalk.dim('  await app.boot()')}\n` +
        `  ${chalk.dim('  return app')}\n` +
        `  ${chalk.dim('}')}\n\n` +
        `  Projects scaffolded with ${chalk.cyan('pearl new')} already have one.\n`,
    )
    process.exit(1)
}

/**
 * Run a generated script with the project's own module resolution.
 *
 * The script is written under the project's `node_modules/.pearl/` rather than
 * executed from the CLI's own directory: bare specifiers like
 * `@pearl-framework/database` must resolve against the app's dependency tree,
 * which a file living in the CLI package cannot rely on under pnpm's strict
 * node_modules layout.
 */
export async function runInProject(
    name: string,
    source: string,
    options: { cwd?: string; env?: Record<string, string> } = {},
): Promise<number> {
    const cwd = options.cwd ?? process.cwd()
    const dir = path.resolve(cwd, 'node_modules/.pearl')
    const file = path.join(dir, `${name}-${process.pid}.mts`)

    mkdirSync(dir, { recursive: true })
    writeFileSync(file, source, 'utf8')

    try {
        return await new Promise<number>((resolve, reject) => {
            const child = spawn('npx', ['tsx', file], {
                cwd,
                stdio: 'inherit',
                env: { ...process.env, ...options.env },
            })
            child.on('error', reject)
            child.on('exit', (code, signal) => {
                // A signalled exit has a null code; report it the way a shell would.
                resolve(signal ? 128 : code ?? 1)
            })
        })
    } finally {
        rmSync(file, { force: true })
    }
}

/** Import specifier for the bootstrap module, relative to node_modules/.pearl. */
export function bootstrapSpecifier(bootstrapPath: string, cwd = process.cwd()): string {
    const from = path.resolve(cwd, 'node_modules/.pearl')
    const rel = path.relative(from, bootstrapPath).split(path.sep).join('/')
    return rel.startsWith('.') ? rel : `./${rel}`
}
