# Changelog

## 1.0.0

First release prepared for public Git installation.

- Three parallel review directions plus independent finding validation.
- Separate staged/unstaged/untracked scope and worktree/index/base coordinates.
- Read-only child tools and inherited session model/reasoning.
- Explicit `--fix` handoff through normal parent tools and policies, replacing the development prototype's direct host writes.
- Preserve downstream observation/freshness vetoes, stop after tool errors and preserve unrelated queued user work on cancellation.
- Harden Git collection against configured helpers, nested submodule filters and inherited configuration overrides.
- Support unborn/orphan branches, severity-preserving deduplication and per-finding validation failures.

## Unpublished development prototypes (0.1.x)

These builds were never public releases. The early host-side fix path bypassed parent tool policies and could lose partial-apply reporting on cancellation; it was replaced before 1.0.0. Use the initial public release 1.0.0 or newer.
