# DSH Code Review

English | [Русский](README.ru.md)

Version **1.1.0**, [MIT](LICENSE). A thin `/code-review` command for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness). It queues a readable review prompt on the current agent, combining correctness/security, reuse/quality and efficiency.

```text
/code-review
/code-review --fix
/code-review --base main
/code-review --focus "error handling"
/code-review --help
```

## How it works

The plugin registers the command, parses its arguments and submits [REVIEW_PROMPT.md](REVIEW_PROMPT.md) through the current agent's normal `followup` queue. The agent does the work with ordinary DSH tools: inspect Git diffs and project instructions, run three review directions using available subagents, validate findings and report the result. If delegation is unavailable, the prompt asks the agent to perform the three passes itself and disclose that limitation.

**Analysis-only is a prompt instruction, not a hard read-only sandbox.** With `--fix`, the prompt asks for confirmed fixes and useful local simplifications, an inspection of the final diff and relevant available checks. It does not authorize commit, push, deploy or publishing GitHub comments. DSH owns normal tools, model selection, permissions, approvals, plan mode, cancellation and subagents; the plugin does not implement another policy layer.

| Option | Meaning |
| --- | --- |
| Default | Ask for review only, without source-file edits; staged/unstaged separately plus relevant untracked source files. |
| `--fix` | Ask the current agent to apply confirmed fixes through ordinary session tools after review. |
| `--base <ref>` | Review relative to the merge-base of this ref and HEAD, including working-tree changes. |
| `--focus "text"` | Additional topic; quote values containing spaces. |
| `--help` | Show help without waking the agent. |

Quotes group values without shell expansion. Literal backslashes in regexes/paths are preserved; use `\"` inside a double-quoted value for a quote and `\\` for an escaped backslash. Quote a flag-leading topic explicitly, for example `--focus "--fix behavior"`. Composer attachments are not accepted by this command.

Command success means **queued**, not that review finished. If the agent is busy, review follows its current turn. After handoff use ordinary DSH turn/queue controls to stop the work. Unloading this plugin removes the slash command but does not cancel tasks the agent already accepted.

## Deliberately small

No custom Git collector, duplicated base/index/worktree snapshots, 500 KB diff limit, batching engine, finding JSON protocol, provider routing, child-agent lifecycle management, extra tool guards or fix scheduler. The agent chooses context and reads within normal DSH/model limits. The old maxFiles/maxDiffBytes/maxFileBytes/maxReviewBatches/maxFindings/maxValidations/timeoutMs settings no longer apply.

This is intentional: like a normal prompt command, finding validation and analysis-only behavior depend on the model. Do not treat the prompt as a security boundary or proof of correctness.

## Installation

In DSH **Plugins → bundle installation**, enter:

```text
https://github.com/nalikco/dsh-code-review.git
```

Pin a reviewed commit with `https://github.com/nalikco/dsh-code-review.git#<commit-sha>` or install the absolute path of a local clone. Do not register another global `code-review` command in the same layer. Inspect the installation result: `restart-required` means a restart is needed.

Requires Node.js22+, DSH service packages0.2.0-rc.2 and Cordis~4.0.4. The only injected service is `commands`; message creation uses the normal LLM SDK. No build/install scripts. `private:true` prevents accidental npm publication while Git/local installation remains supported. Publishing Git changes does not update a running profile automatically.

No plugin configuration is needed. Disable/remove the bundle in Plugin Manager to uninstall.

## Data and trust

The agent may read source code and send it to the configured LLM provider; DSH may persist messages and tool results. Do not review private code or secrets without authorization. This plugin adds no provider or telemetry endpoint and does not execute shell/Git itself. See [SECURITY.md](SECURITY.md).

## Development

```sh
npm ci --ignore-scripts
npm run test:all
npm run test:package
```

Tests cover arguments, prompt content, registration/unload, normal-agent handoff/queue semantics on real DSH SDK services, and the packed artifact. Scripted adapters do not establish live-model review quality. See [CONTRIBUTING.md](CONTRIBUTING.md) and [CHANGELOG.md](CHANGELOG.md).

Inspired by the [official code-review plugin](https://github.com/anthropics/claude-code/blob/main/plugins/code-review/commands/code-review.md) and a [published Simplify prompt](https://github.com/dsdanielpark/claude-code-system-prompts/blob/main/system-prompts/skill-simplify.md). Independent implementation, not affiliated with Anthropic.
