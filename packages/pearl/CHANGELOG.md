# @pearl-framework/pearl

## 1.1.3

### Patch Changes

- Refresh the meta-package's dependency pins so `npm install @pearl-framework/pearl` installs every `@pearl-framework/*` package at 1.1.2. The previous 1.1.2 release of the meta still pinned `core`, `events`, and `queue` at 1.1.1 because those three were bumped to 1.1.2 in a follow-up release that never re-published the meta. No code changes; this release exists only to align the installed dependency tree.

  - @pearl-framework/core@1.1.2
  - @pearl-framework/events@1.1.2
  - @pearl-framework/queue@1.1.2

## 1.1.2

### Patch Changes

- Updated dependencies [[`8596d0f`](https://github.com/skd09/pearl.js/commit/8596d0f137e89b9a15fb4eececceba22c720fa2e), [`de92297`](https://github.com/skd09/pearl.js/commit/de92297f5101deefa4511b9f33c55bcedc7a8ad8)]:
  - @pearl-framework/http@1.1.2
  - @pearl-framework/database@1.1.2
  - @pearl-framework/mail@1.1.2
  - @pearl-framework/auth@1.1.2
  - @pearl-framework/validate@1.1.2
