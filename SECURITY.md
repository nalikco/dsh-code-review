# Security

Report vulnerabilities through [GitHub private vulnerability reporting](https://github.com/nalikco/dsh-code-review/security/advisories/new) if enabled, otherwise contact the owner privately. Do not put credentials or proprietary diffs in public issues.

This is installed host code: review the package and pin a trusted commit. The plugin registers a bundled native skill, parses command arguments and queues one invocation message on the current agent. The message is stamped `source.kind: 'skill-invocation'` and carries the full rendered instructions, so nothing is attributed to the user and the queued review keeps its instructions across plugin unload. It does not execute Git/shell, inspect the workspace, change permissions, create subagents itself or write source files.

The **agent** may use its normal tools, read source code, delegate and edit files. DSH owns sandbox, Auto review, approvals, plan mode and cancellation. The prompt asks for no source edits by default and permits fixes only with `--fix`, but this is **not a hard read-only guarantee**. There is no additional plugin guard or safety gate. A model can misinterpret instructions or produce an incorrect fix, and prompt injection remains possible.

Source and tool results may reach the session's configured LLM provider and persist in ordinary DSH storage. This plugin adds no telemetry endpoint or separate provider. Use only with data you are authorized to send to that provider.

After handoff, ordinary DSH controls own the task. Command completion only confirms queueing; plugin unload does not retract an accepted message, and the queued invocation no longer depends on the plugin staying loaded because its instructions are embedded. This is still a prompt instruction, not an enforced guard. Do not install a project/user/preset skill with the same `dsh-code-review` name: a conflicting registration shadows the skill. An abort before handoff prevents queueing, but cancellation after handoff is the normal agent/queue operation. No new authority for commit, push, deployment, production mutation or public comments is granted by the prompt.

Avoid editing the same files concurrently with fix mode and inspect the final diff. Version guards and editing behavior are those of ordinary DSH tools; this plugin provides no transaction, rollback or external-editor race protection.

Compatibility has been tested with DSH0.2.1-rc.2 SDK (and peers for 0.2.0-rc.2/0.2.1-rc.1) on Node22/24. CI also declares macOS and Linux Docker. Live-model accuracy, every preset/provider and Windows are not established by those tests. Revalidate after DSH upgrades.
