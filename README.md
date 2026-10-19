# DSH Code Review

English | [Русский](README.ru.md)

Version **1.2.2**, [MIT](LICENSE). A small `/code-review` command backed by a **native DSH skill**, combining correctness/security, reuse/quality and efficiency.

```text
/code-review
/code-review --fix
/code-review --base main
/code-review --focus "error handling"
/code-review --help
```

## Native skill, not a pasted user prompt

The plugin registers [REVIEW_PROMPT.md](REVIEW_PROMPT.md) as the explicit-only `dsh-code-review` skill. The command queues **one** message that carries the full rendered `<skill_content>` instructions plus the mode/base/focus parameters, and it is stamped `source.kind: 'skill-invocation'`. Nothing is attributed to the user: Chat shows a native skill-invocation chip, not a bubble that looks like human input, and no `user`-sourced review text ever enters the session.

Because the instructions travel inside the queued message, the standard `dsh-tool-skill` gesture scanner is not involved, and a queued review still runs with its instructions even if the plugin is unloaded afterwards.

The agent uses normal DSH tools to inspect diffs and project instructions, run three review passes itself (subagents only for large changes, to save tokens), validate findings and report. The skill is invocable both by the user and by the model.

**Analysis-only is a prompt instruction, not a hard read-only sandbox.** `--fix` asks for confirmed fixes/local simplifications, final-diff inspection and relevant available checks. No commit, push, deploy or public comments are authorized. DSH owns model, tools, permissions, approvals, plan mode, cancellation and subagents.

| Option | Meaning |
| --- | --- |
| Default | Review without source edits; staged/unstaged separately plus relevant untracked source files. |
| `--fix` | Ask for confirmed fixes through ordinary session tools after review. |
| `--base <ref>` | Review relative to merge-base of ref/HEAD, including working-tree changes. |
| `--focus "text"` | Additional topic; quote values containing spaces or starting with flags. |
| `--help` | Help without waking the agent. |

Quotes group values without shell expansion. Regex/path backslashes are preserved; `\"` and `\\` escape quotes/backslashes inside double quotes. Parameters use JSON; slashes are escaped as `\u002f` so copied invocation text cannot accidentally invoke another skill. Composer attachments are not accepted.

Command success means **queued**, not finished. A busy agent finishes its current turn first. Use ordinary DSH queue/turn controls after handoff. A queued invocation carries its own instructions, so disabling or uninstalling the plugin afterwards does not invalidate work already in the queue.

## Installation

In DSH **Plugins → bundle installation**:

```text
https://github.com/nalikco/dsh-code-review.git
```

Pin a reviewed commit using `#<commit-sha>` or install a local clone by absolute path. Inspect installation status; `restart-required` requires restart. Publishing Git changes does not update an installed profile automatically.

Requires Node22+, DSH0.2.1-rc.2 (0.2.0-rc.2/0.2.1-rc.1 peers retained), Cordis~4.0.5 and services `commands` and `skills`. No plugin settings/build/install scripts. `private:true` prevents accidental npm publication, not Git/local installation. Uninstall through Plugin Manager.

Do not register another global `code-review` command or any project/user/preset skill named `code-review`: a conflicting registration would shadow the skill and confuse the native gesture when `/code-review` is typed directly.

## Deliberately small

No custom Git collector, duplicated snapshots, diff-size limit/batching, finding JSON protocol, provider routing, child lifecycle management, guards or fix scheduler. The agent chooses context under ordinary DSH/model limits. Old engine settings are unused. Like an ordinary skill, validation and analysis-only behavior depend on the model, not plugin enforcement.

Source and tool results may reach the configured LLM provider and persist in DSH storage. Use authorized data only. No telemetry endpoint or separate provider. See [SECURITY.md](SECURITY.md).

## Development

```sh
npm ci --ignore-scripts
npm run test:all
npm run test:package
```

Tests verify that queued invocations are `skill-invocation`-sourced with zero `user`-attributed text, carry full instructions plus parameters, preserve arguments, and cover busy queue/cancellation/unload plus the packed artifact. Scripted adapters do not establish live-model accuracy or live GUI rendering. See [CONTRIBUTING.md](CONTRIBUTING.md), [CHANGELOG.md](CHANGELOG.md).

Inspired by the [official code-review plugin](https://github.com/anthropics/claude-code/blob/main/plugins/code-review/commands/code-review.md) and [published Simplify prompt](https://github.com/dsdanielpark/claude-code-system-prompts/blob/main/system-prompts/skill-simplify.md). Independent implementation, not affiliated with Anthropic.
