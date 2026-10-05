---
'@pearl-framework/cli': minor
'@pearl-framework/queue': minor
---

Add `pearl migrate`, `pearl db:seed`, and `pearl queue:work`, and let the queue config name its job classes.

`Migrator` already carried a docstring saying "Pearl's CLI (`pearl migrate`) delegates to this class", but no such command existed — the migration workflow had no entry point. The three new commands load `src/bootstrap.ts`, a module that registers providers and boots the container without starting a server, so configuration lives in one place instead of being duplicated per command. `pearl new` now scaffolds it and the entrypoint calls it; existing projects need to add it (the CLI prints the shape when it is missing). Generated scripts run under the project's own `node_modules` so framework imports resolve under pnpm's strict layout.

`queue:work` registers every class extending `Job` exported from `src/jobs`, drains in-flight jobs on `SIGINT`/`SIGTERM`, and refuses to start on an empty job directory rather than running a worker that fails every job.

`QueueServiceConfig` gains `jobs` (and a per-worker `jobs` override). `QueueServiceProvider.boot()` never called `worker.register(...)` and the config had no way to supply job classes, so every worker it started had an empty registry and threw `No job registered` for each job it received — the configuration shown in the queue README failed 100% of jobs. Starting a worker with no job classes now throws at boot naming the queue.

There is no `migrate:rollback`: Drizzle generates no down migrations, so it would be a no-op for the default adapter.
