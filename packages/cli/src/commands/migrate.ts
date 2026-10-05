import chalk from 'chalk'
import type { Command } from 'commander'
import {
    bootstrapSpecifier,
    requireBootstrap,
    runInProject,
} from '../utils/run-in-project.js'

export function migrate(program: Command): void {
    program
        .command('migrate')
        .description('Run database migrations')
        .option(
            '-f, --folder <folder>',
            'Folder holding the migration files',
            'database/migrations',
        )
        .action(async (options: { folder: string }) => {
            const bootstrap = requireBootstrap()
            const spec = bootstrapSpecifier(bootstrap)

            console.log(`\n${chalk.bold.magenta('Pearl.js')} ${chalk.dim('migrate')}`)
            console.log(`  ${chalk.dim('Folder')}  ${chalk.cyan(options.folder)}\n`)

            const code = await runInProject('migrate', `
import { bootstrap } from ${JSON.stringify(spec)}
import { DatabaseManager, Migrator } from '@pearl-framework/database'

const app = await bootstrap()

try {
    const db = app.container.make(DatabaseManager)
    const migrator = new Migrator(db.adapter, {
        migrationsFolder: ${JSON.stringify(options.folder)},
    })
    await migrator.run()
    console.log('Migrations applied.')
} finally {
    // Runs each provider's shutdown(), releasing pooled connections — without
    // it the process hangs on an open socket.
    await app.terminate()
}
`)

            if (code !== 0) {
                console.error(`\n${chalk.red('✘')} Migration failed.\n`)
                process.exit(code)
            }
            console.log(`\n${chalk.green('✔')} Done.\n`)
        })
}
