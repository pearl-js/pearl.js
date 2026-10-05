import chalk from 'chalk'
import type { Command } from 'commander'
import path from 'node:path'
import { existsSync, readdirSync } from 'node:fs'
import {
    bootstrapSpecifier,
    requireBootstrap,
    runInProject,
} from '../utils/run-in-project.js'

const SEEDER_DIR = 'database/seeders'

export function dbSeed(program: Command): void {
    program
        .command('db:seed')
        .description('Run database seeders')
        .option('-c, --class <name>', 'Run a single seeder by file name (without extension)')
        .option('-d, --dir <dir>', 'Directory holding the seeders', SEEDER_DIR)
        .action(async (options: { class?: string; dir: string }) => {
            const bootstrap = requireBootstrap()
            const dir = path.resolve(process.cwd(), options.dir)

            if (!existsSync(dir)) {
                console.error(
                    `\n${chalk.red('✘')} No seeder directory at ${chalk.cyan(options.dir)}.\n` +
                    `  Create one and add a seeder exporting ${chalk.cyan('run(app)')}.\n`,
                )
                process.exit(1)
            }

            const all = readdirSync(dir)
                .filter((f) => /\.(ts|js|mts|mjs)$/.test(f) && !f.endsWith('.d.ts'))
                .sort()

            const selected = options.class
                ? all.filter((f) => f.replace(/\.[^.]+$/, '') === options.class)
                : all

            if (selected.length === 0) {
                const what = options.class
                    ? `No seeder named ${chalk.cyan(options.class)} in ${chalk.cyan(options.dir)}.`
                    : `No seeders found in ${chalk.cyan(options.dir)}.`
                console.error(`\n${chalk.red('✘')} ${what}\n`)
                process.exit(1)
            }

            console.log(`\n${chalk.bold.magenta('Pearl.js')} ${chalk.dim('db:seed')}`)
            for (const f of selected) console.log(`  ${chalk.dim('→')} ${chalk.cyan(f)}`)
            console.log()

            const from = path.resolve(process.cwd(), 'node_modules/.pearl')
            const imports = selected
                .map((f, i) => {
                    const rel = path.relative(from, path.join(dir, f)).split(path.sep).join('/')
                    const spec = rel.startsWith('.') ? rel : `./${rel}`
                    return `import * as seeder${i} from ${JSON.stringify(spec)}`
                })
                .join('\n')

            const calls = selected
                .map((f, i) => `    await runSeeder(${JSON.stringify(f)}, seeder${i})`)
                .join('\n')

            const code = await runInProject('seed', `
import { bootstrap } from ${JSON.stringify(bootstrapSpecifier(bootstrap))}
${imports}

const app = await bootstrap()

async function runSeeder(name, mod) {
    const fn = mod.run ?? mod.default
    if (typeof fn !== 'function') {
        throw new Error(
            \`Seeder \${name} must export run(app) (or a default function). \` +
            'Nothing was exported that could be called.',
        )
    }
    await fn(app)
    console.log(\`  seeded \${name}\`)
}

try {
${calls}
} finally {
    await app.terminate()
}
`)

            if (code !== 0) {
                console.error(`\n${chalk.red('✘')} Seeding failed.\n`)
                process.exit(code)
            }
            console.log(`\n${chalk.green('✔')} Seeded ${selected.length} file(s).\n`)
        })
}
