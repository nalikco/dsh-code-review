# Changelog

## 1.1.0

- Replace the custom review engine with a thin command that queues a readable combined review/simplify prompt on the current agent.
- Remove host Git/evidence collection, size limits/batching, finding JSON protocol, custom child orchestration, guards and fix scheduling.
- Keep `--fix`, `--base`, `--focus` and `--help`; normal DSH tools, model, permissions and cancellation own execution.
- Default no-edit behavior is now a prompt instruction, not an extra enforced sandbox. No plugin configuration is needed; old engine limits are unused.
- Preserve Git history for rollback; no live profile changes are performed by this rewrite.
- Preserve literal regex/path backslashes in quoted focus values and cover command abort, unsupported attachments, retained queued work and existing parent tool policies.

## 1.0.2 (unpublished engine experiment)

- Keep full worktree/index/base snapshots host-side instead of duplicating them in every review prompt.
- Review large scopes in deterministic per-file batches, bounded by `maxDiffBytes` and `maxReviewBatches` (default eight), without omitting files or truncating evidence.
- Collect literal per-file Git diffs, preserve staged/unstaged sides together, and route independent validators to the relevant batch with one command-wide validation cap and concurrency three.
- Report explicit limits for oversized individual files/instructions and excessive batch counts before starting model work.

## 1.0.1

- Fix `cannot get property "fs" without inject` when a command runs against an agent-loop context. Resolve active services with Cordis scoped `get()` without changing isolation, policy or lifecycle ownership.
- Cover `sandboxPolicy`, fix scheduling and reviewer service access with the same scoped lookup.
- Construct SDK service providers through real plugin fibers in review/fix integration tests, and exercise evidence collection from the installed packed artifact.

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
