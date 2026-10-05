import chalk from 'chalk'
import type { Command } from 'commander'
import path from 'node:path'
import { existsSync, readdirSync } from 'node:fs'
import {
    bootstrapSpecifier,
    requireBootstrap,
    runInProject,
} from '../utils/run-in-project.js'

const JOBS_DIR = 'src/jobs'

export function queueWork(program: Command): void {
    program
        .command('queue:work')
        .description('Process queued jobs until stopped')
        .option('-q, --queue <name>', 'Queue to consume', 'default')
        .option('-c, --concurrency <n>', 'Jobs processed in parallel', '1')
        .option('-d, --jobs-dir <dir>', 'Directory holding the job classes', JOBS_DIR)
        .action(async (options: { queue: string; concurrency: string; jobsDir: string }) => {
            const bootstrap = requireBootstrap()

            const concurrency = Number(options.concurrency)
            if (!Number.isInteger(concurrency) || concurrency < 1) {
                console.error(
                    `\n${chalk.red('✘')} --concurrency must be a positive integer ` +
                    `(got ${chalk.cyan(options.concurrency)}).\n`,
                )
                process.exit(1)
            }

            const dir = path.resolve(process.cwd(), options.jobsDir)
            if (!existsSync(dir)) {
                console.error(
                    `\n${chalk.red('✘')} No job directory at ${chalk.cyan(options.jobsDir)}.\n` +
                    `  Generate one with ${chalk.cyan('pearl make:job SendWelcomeEmail')}.\n`,
                )
                process.exit(1)
            }

            const files = readdirSync(dir)
                .filter((f) => /\.(ts|js|mts|mjs)$/.test(f) && !f.endsWith('.d.ts') && !f.includes('.test.'))
                .sort()

            if (files.length === 0) {
                console.error(
                    `\n${chalk.red('✘')} No job classes in ${chalk.cyan(options.jobsDir)}.\n` +
                    `  A worker with an empty registry fails every job it receives.\n`,
                )
                process.exit(1)
            }

            console.log(`\n${chalk.bold.magenta('Pearl.js')} ${chalk.dim('queue:work')}`)
            console.log(`${chalk.dim('─────────────────────────────────────')}`)
            console.log(`  ${chalk.dim('Queue')}        ${chalk.cyan(options.queue)}`)
            console.log(`  ${chalk.dim('Concurrency')}  ${chalk.cyan(String(concurrency))}`)
            console.log(`  ${chalk.dim('Jobs')}         ${chalk.cyan(String(files.length))} from ${chalk.cyan(options.jobsDir)}`)
            console.log(`${chalk.dim('─────────────────────────────────────')}\n`)

            const from = path.resolve(process.cwd(), 'node_modules/.pearl')
            const imports = files
                .map((f, i) => {
                    const rel = path.relative(from, path.join(dir, f)).split(path.sep).join('/')
                    const spec = rel.startsWith('.') ? rel : `./${rel}`
                    return `import * as jobs${i} from ${JSON.stringify(spec)}`
                })
                .join('\n')

            const modules = files.map((_, i) => `jobs${i}`).join(', ')

            const code = await runInProject('queue-work', `
import { bootstrap } from ${JSON.stringify(bootstrapSpecifier(bootstrap))}
import { Job, QueueWorker } from '@pearl-framework/queue'
${imports}

const app = await bootstrap()

// Every exported class extending Job, across the job directory.
const registry = []
for (const mod of [${modules}]) {
    for (const exported of Object.values(mod)) {
        if (typeof exported === 'function' && exported.prototype instanceof Job) {
            registry.push(exported)
        }
    }
}

if (registry.length === 0) {
    console.error('No classes extending Job were exported from the job directory.')
    await app.terminate()
    process.exit(1)
}

const config = app.config.get('queue', {})
const connection = config.connection ?? {
    host: process.env.REDIS_HOST ?? '127.0.0.1',
    port: Number(process.env.REDIS_PORT ?? 6379),
}

const worker = new QueueWorker(${JSON.stringify(options.queue)}, {
    connection,
    concurrency: ${concurrency},
    ...(config.prefix !== undefined && { prefix: config.prefix }),
})

worker.register(...registry)
worker.start()

console.log(\`Listening on "\${${JSON.stringify(options.queue)}}" with \${registry.length} job type(s). Ctrl-C to stop.\`)

let stopping = false
for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
        // A second signal should kill it outright rather than queue another drain.
        if (stopping) process.exit(130)
        stopping = true
        console.log('\\nDraining in-flight jobs…')
        worker.stop()
            .then(() => app.terminate())
            .then(() => process.exit(0))
            .catch((err) => { console.error(err); process.exit(1) })
    })
}
`)

            if (code !== 0) process.exit(code)
        })
}
