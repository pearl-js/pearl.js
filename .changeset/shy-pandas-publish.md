---
'@pearl-framework/pearl': patch
---

Add the `repository` and `homepage` fields to the meta package, and pin its publish registry.

`NPM_CONFIG_PROVENANCE` is enabled for releases, and npm refuses to generate a provenance attestation for a package with no `repository` field — so publishing `@pearl-framework/pearl` would fail while the other ten packages succeeded. Also sets `publishConfig.registry` to match the rest of the workspace.
