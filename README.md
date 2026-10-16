# DSH Code Review

English | [Русский](README.ru.md)

Version **1.2.0**, [MIT](LICENSE). A small `/code-review` command backed by a **native DSH skill**, combining correctness/security, reuse/quality and efficiency.

```text
/code-review
/code-review --fix
/code-review --base main
/code-review --focus "error handling"
/code-review --help
```

## Native skill, not a pasted user prompt

The plugin registers [REVIEW_PROMPT.md](REVIEW_PROMPT.md) as the explicit-only `dsh-code-review` skill. The command queues a **short** user invocation with mode/base/focus. The standard `dsh-tool-skill` adapter recognizes `/dsh-code-review` and injects the full instructions with `source.kind: skill-invocation`, not as text attributed to the user.

The model still receives the instructions as user-role skill context. The current DSH Chat handles this as native skill context rather than a long human bubble; exact presentation depends on the DSH version. The plugin adds no custom UI renderer. It does not move the rules into a persistent system prompt or add another review engine.

The agent uses normal DSH tools to inspect diffs and project instructions, run three review directions through available subagents, validate findings and report. If delegation is unavailable, the skill asks for three passes in the current agent with the limitation disclosed. The skill is user-invocable but not automatically model-invocable, so merely installing it does not start reviews.

**Analysis-only is a prompt instruction, not a hard read-only sandbox.** `--fix` asks for confirmed fixes/local simplifications, final-diff inspection and relevant available checks. No commit, push, deploy or public comments are authorized. DSH owns model, tools, permissions, approvals, plan mode, cancellation and subagents.

| Option | Meaning |
| --- | --- |
| Default | Review without source edits; staged/unstaged separately plus relevant untracked source files. |
| `--fix` | Ask for confirmed fixes through ordinary session tools after review. |
| `--base <ref>` | Review relative to merge-base of ref/HEAD, including working-tree changes. |
| `--focus "text"` | Additional topic; quote values containing spaces or starting with flags. |
| `--help` | Help without waking the agent. |

Quotes group values without shell expansion. Regex/path backslashes are preserved; `\"` and `\\` escape quotes/backslashes inside double quotes. Parameters use JSON; slashes are escaped as `\u002f` so focus text cannot accidentally invoke another skill. Composer attachments are not accepted.

Command success means **queued**, not finished or even loaded yet. A busy agent finishes its current turn first. Use ordinary DSH queue/turn controls after handoff. **Keep the plugin enabled until skill loading occurs.** Disabling it removes the command and skill, but not accepted queue messages; a queued invocation then lacks its instructions and asks the agent to stop/report that limitation. Already injected instructions remain in session history.

## Installation

In DSH **Plugins → bundle installation**:

```text
https://github.com/nalikco/dsh-code-review.git
```

Pin a reviewed commit using `#<commit-sha>` or install a local clone by absolute path. Inspect installation status; `restart-required` requires restart. Publishing Git changes does not update an installed profile automatically.

Requires Node22+, DSH0.2.0-rc.2/Cordis~4.0.4, services `commands` and `skills`, and an **active native `dsh-tool-skill` adapter in the agent composition**. Installing an npm peer package alone does not activate that adapter. If skills are disabled in your preset, enable the shipped skill capability there before using this command.

Do not register another global `code-review` command or any project/user/preset skill named `dsh-code-review`: normal registry precedence can override the bundled skill. No plugin settings/build/install scripts. `private:true` prevents accidental npm publication, not Git/local installation. Uninstall through Plugin Manager.

## Deliberately small

No custom Git collector, duplicated snapshots, diff-size limit/batching, finding JSON protocol, provider routing, child lifecycle management, guards or fix scheduler. The agent chooses context under ordinary DSH/model limits. Old engine settings are unused. Like an ordinary skill, validation and analysis-only behavior depend on the model, not plugin enforcement.

Source and tool results may reach the configured LLM provider and persist in DSH storage. Use authorized data only. No telemetry endpoint or separate provider. See [SECURITY.md](SECURITY.md).

## Development

```sh
npm ci --ignore-scripts
npm run test:all
npm run test:package
```

Tests verify short user invocation versus full `skill-invocation` instructions, native gesture loading, argument preservation, busy queue/cancellation/unload and the packed artifact. Scripted adapters do not establish live-model accuracy or live GUI rendering. See [CONTRIBUTING.md](CONTRIBUTING.md), [CHANGELOG.md](CHANGELOG.md).

Inspired by the [official code-review plugin](https://github.com/anthropics/claude-code/blob/main/plugins/code-review/commands/code-review.md) and [published Simplify prompt](https://github.com/dsdanielpark/claude-code-system-prompts/blob/main/system-prompts/skill-simplify.md). Independent implementation, not affiliated with Anthropic.
