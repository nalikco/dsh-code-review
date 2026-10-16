# Security

## Reporting

Do not include credentials, proprietary source code, private diffs or machine-specific paths in public issues. Use [GitHub private vulnerability reporting](https://github.com/nalikco/dsh-code-review/security/advisories/new) if enabled. Otherwise contact the repository owner privately before disclosing details.

## Trust boundaries

- This is a **host plugin**. Installed JavaScript executes inside DSH with the operating-system user's permissions, outside the session tool sandbox. Install only reviewed code and pin a reviewed Git commit.
- Review sends the selected diff, repository instructions, version snapshots and any context read by reviewer tools to the session's configured LLM provider. Child session logs and ordinary spill files may persist this data. Do not review secrets or proprietary code with a provider you are not authorized to use. The plugin adds no telemetry endpoint or provider of its own.
- Repository source, comments and instructions are untrusted review data. Prompts separate them from the review protocol, but prompt injection and model errors remain possible. Independent validation is not proof of correctness.
- Review children receive a read-only sandbox and monotonic tool guards before publication. Only `read`, `glob`, `grep` and structured submission are admitted. These names refer to the installed host tools: other host plugins and tool implementations are trusted. Read-only means no source-file mutations, not zero writes to DSH session/spill storage.
- Git collection is an explicit host-side read capability, not a model shell tool. Git runs without a shell, with inherited `GIT_*` overrides removed, hooks/fsmonitor disabled, lazy fetch disabled and submodule diff forced to short/nonrecursive. Repositories configured with clean/process filters or partial-clone fetching are rejected. The installed Git binary, configuration files and parent directories are trusted; this is not a sandbox against another same-user process racing configuration or paths.
- `--fix` does not write through host filesystem APIs. It hands exact, independently validated worktree replacements to a normal parent turn using the existing `read`/`edit` tools. Existing Auto review, pre-execute decisions, monotonic guards, observation requirements and downstream filesystem freshness guards remain authoritative. The added restrictions can deny but cannot approve another policy's rejection.
- Fix handoff is refused in read-only, active/pending plan mode and PTC-only presentation. The machine-generated followup is not forged human authorization. Auto may refuse a fix requiring additional human authority.
- A successful slash-command result means **queued**, not applied. Applied edits are logged as normal tool calls/results. Command cancellation or plugin unload cancels owned fix work while preserving unrelated queued input. Cancellation is cooperative; a mutation already committed cannot be undone by abort.
- SDK version guards detect stale snapshots but are **not atomic compare-and-swap against external editors**. A write can race between the SDK's version probe and atomic rename. Do not modify the worktree concurrently with `--fix`. There is no multi-file transaction or automatic rollback.
- Fixes are limited to existing changed worktree files; index/base findings are report-only. No file creation/deletion, instruction-file edits, cross-file fixes, shell, delegation, escalation, commit, push or GitHub publication is authorized by this plugin.

## Supported versions and verification

The integration targets DSH service packages `0.2.0-rc.2`, Cordis `~4.0.4`, Schemastery `~3.18.4` and Node.js 22 or newer. These DSH APIs are prerelease: revalidate after upgrades. Linux/Docker has been tested locally; CI also declares macOS checks. Windows and remote filesystem backends are not validated. Scripted-adapter tests validate mechanics, not live-model quality or every provider/preset combination.
