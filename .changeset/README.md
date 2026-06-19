# Changesets

This directory drives Pearl.js releases. **You should add a changeset to every PR that changes published behavior.**

## How to add a changeset

```bash
pnpm changeset
```

Pick the packages you changed, pick the bump level (patch/minor/major), and write a short summary. A `*.md` file lands in this directory — commit it with the rest of your PR.

## Bump levels

- **patch** — bug fixes, internal refactors, doc-only changes
- **minor** — new APIs, new options, anything backwards-compatible
- **major** — breaking changes to public APIs or runtime behavior

## What happens after merge

1. PR with a changeset merges to `main`.
2. The `Release` workflow opens (or updates) a **"Version Packages"** PR. That PR bumps every package, regenerates per-package `CHANGELOG.md`, and clears the consumed `.changeset/*.md` files.
3. Merging the Version Packages PR triggers the same workflow again — this time it publishes every bumped package to npm and creates a corresponding GitHub Release with the changelog.

All `@pearl-framework/*` packages are **linked**: any bump propagates across all of them so the framework ships at one version.

## Skipping a release for a PR

If your change is genuinely irrelevant to consumers (CI tweaks, repo housekeeping, internal docs), skip the changeset. The Changesets bot will mark the PR `noChangeset` on the PR conversation — that's fine, no need to add a stub.
