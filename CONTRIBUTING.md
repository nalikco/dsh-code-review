# Development

## Environment

Use Node.js22 or24 and Git on Linux or macOS. All SDK dependencies are pinned to the checked DSH service version in the manifest and lockfile. Do not copy an installed Desktop archive or commit extracted SDK files.

```sh
npm ci --ignore-scripts
npm run test:all
npm run test:package
```

For core tests only, `npm test` requires no dependency installation. Integration tests need the SDK dependencies installed by `npm ci`. They use isolated temporary Git repositories, real DSH services and scripted adapters. They do not contact a live model or alter a DSH profile.

`npm run test:package` packs into a temporary directory, verifies the exact public file allowlist, installs the packed artifact into a fresh consumer directory without scripts, verifies its manifest/import and exercises actual SDK command registration/help/unload. Test dependencies are not included in the release package.

## CI

The workflow declares Linux/macOS and Node22/24. It removes the hosted image's Git LFS filter defaults from both global and system Git configuration on the disposable runner, then runs clean dependency installation, unit/integration tests and the packed-artifact check. Production review intentionally rejects configured executable filters, including unused Git LFS defaults; this check must not be disabled to make CI green. Git environment overrides alone cannot isolate these tests because the production Git launcher clears inherited `GIT_*` controls. Do not run the runner configuration cleanup on your development machine. A local run is not evidence that GitHub-hosted CI has passed: check the actual workflow after an authorized push.

## Review requirements

- Keep the review default source-read-only. All mutation proposals must use the normal parent tool policy pipeline.
- Add a regression for policy, cancellation, queue ownership, staged coordinates or Git-helper issues before changing them.
- Test against the pinned public SDK, not only mocks. Do not replace a failed policy check with a manual host operation.
- Keep machine-generated proposals distinct from authenticated human authority.
- Preserve downstream filesystem vetoes and original snapshot freshness. Never overwrite another policy's version requirement.
- Keep ordinary user inbox input intact when cancelling owned fix work.
- Treat source code/instructions as data; never put tokens, private diffs or real credentials in fixtures.
- Update English/Russian user docs and SECURITY.md when behavior or trust boundaries change.

## Release checklist

1. Review the complete Git diff and tracked file list for private files or unrelated work.
2. Update version/changelog when appropriate and run clean tests on supported runtimes.
3. Pack and test the actual artifact; inspect its file list and SHA-256.
4. Commit only intended files with a model co-author trailer.
5. Push/tag or publish only after explicit maintainer approval. This repository is intended for Git installation; `private:true` prevents accidental npm registry publication.
6. Pin the release commit for installation and recheck compatibility after DSH upgrades. Publication is separate from updating a running DSH profile.

Report vulnerabilities privately as described in [SECURITY.md](SECURITY.md).
