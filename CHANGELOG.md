# Changelog

## 1.3.0

- The `/code-review` slash command is removed; the plugin registers only the native skill, so it no longer appears twice in the `/` menu.
- The skill is renamed from `dsh-code-review` to `code-review` and is now model-invocable as well as user-invocable.
- Subagents are no longer mandatory: the agent performs the three review passes itself and delegates only for large changes, to save tokens.

## 1.2.2

- The `/code-review` command no longer queues any user-attributed text. The invocation message itself carries `source.kind: 'skill-invocation'` (name `dsh-code-review`, form `instructions`), so Chat renders it as a native skill-invocation chip instead of a message that looks like it was typed by the user.
- The queued message embeds the full rendered `<skill_content>` instructions (via the native `renderSkillContent`) followed by the invocation parameters, so the `dsh-tool-skill` gesture scanner is no longer involved and no separate injection is needed. A queued review now survives plugin unload with its instructions intact.
- The `@deepseek-ai/dsh-tool-skill` peer dependency is dropped; `@deepseek-ai/dsh-skill` is now a real runtime import. Peer ranges widened to cover the tested SDK 0.2.1-rc.2 and Cordis 4.0.5.
- Tests updated: queued messages must contain zero `user`-sourced review text, and parameter text cannot invoke unrelated skills through the gesture scanner.

## 1.2.1

- Support DSH 0.2.1-rc.1. The plugin now declares its own `engines.dsh` range (`^0.2.0-rc.2`) so the DSH loader accepts both the 0.2.0-rc.2 and 0.2.1 prerelease runtimes instead of skipping the bundle for exact SDK peer pins.
- Widen the four SDK peer ranges to `0.2.0-rc.2 || 0.2.1-rc.1`, so `npm ci` resolves the 0.2.1 SDK tree while 0.2.0-rc.2 consumers remain installable.
- Refresh devDependencies and `package-lock.json` for SDK 0.2.1-rc.1, adding `dsh-fs-local` and `dsh-working-directory` for the integration host.
- Mount the new `fs` and `workingDirectory` services plus the `tool-skill` adapter in integration tests; assert the plugin itself still injects only `commands` and `skills`.

## 1.2.0

- Register the review instructions as an explicit-only native `dsh-code-review` skill.
- Queue a short invocation with mode/base/focus instead of a full human-attributed prompt. The normal DSH skill adapter injects the instructions with `skill-invocation` provenance.
- Preserve flags and ordinary agent execution without restoring a custom review engine.
- Escape parameter slashes to avoid accidental invocation of unrelated skills. Require the native skill registry and skill adapter; avoid conflicting skills of the same name.

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
